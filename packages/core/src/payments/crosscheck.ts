/* BS166: the payment cross-check job. It finds payments x-bridge took that
   our records don't show as paid, and the reverse.

   Why: buyers paid, got the network's SMS, and Zora never marked them paid.
   The poller stops asking about a mobile attempt after 1 hour (card 2 h).
   A late payment then reached us only through the one-shot callback, and
   Cloudflare blocked that. The signed payment.received webhook
   (xbridge-events.ts) is now the main signal. This job is the net under it.

   Two passes, both run by the worker:

   A. recheck (every 5 min). Asks x-bridge again about our attempts that
      ended unpaid ('expired', or 'failed') in the last 7 days. Each attempt
      is asked less often as it ages: every 10 min up to 6 h old, hourly up
      to 24 h, then every 6 h. At most 100 attempts a run, 4 reads at a time.

   B. list (hourly, /v1 key needed). Reads every collection x-bridge created
      in the last 72 h and compares it both ways:
      - x-bridge COMPLETED/PARTIAL and ours not paid → settled (same rules
        as A); no attempt of ours at all → 'gateway_unknown_payment';
      - ours paid and x-bridge not COMPLETED (or not listed, when the list is
        complete) → 'gateway_mismatch'. Nothing is changed.

   Every settlement goes through settleFromStatus → applyOutcome, the same
   path as the poller, the webhook and the admin check, so every guard
   applies: a cart that moved on, a second collection, seats gone (money
   recorded and flagged, never applied twice). A paid answer for an
   attempt we marked FAILED is accepted only when it pays the full amount on
   a pay-in-full cart; otherwise it is flagged for a person. */

import { settleFromStatus, mapLimit } from './service';
import { statusForAttempt, listCollectionsV1, xbridgeV1Config, type ListedCollection } from './xbridge-v1';
import type { CollectionStatusResponse } from './xbridge';
import { readWithTimeout } from './gateway-check';
import { captureStatusRead } from '../gateway-capture';
import { alertOps } from '../ops';

type Sql = any;

export const CROSSCHECK_LIMITS = {
  recheckDays: 7,
  recheckBatch: 100,
  readConcurrency: 4,
  readTimeoutMs: 15_000,
  listHours: 72,
  listMaxPages: 30,
} as const;

const PAID = new Set(['COMPLETED', 'PARTIAL']);

interface Attempt {
  transaction_id: string;
  order_id: string;
  method: string | null;
  status: string;
  amount: string | number;
  provider: string | null;
  schedule_n: number | null;
  collected_amount: string | number | null;
}

export type CrossVerdict = 'settled' | 'flagged' | 'unchanged';

/** Apply a paid answer from x-bridge to one attempt that our records don't
    show as paid. Shared by both passes. */
export async function settlePaidAnswer(
  sql: Sql, a: Attempt, status: CollectionStatusResponse, source: 'crosscheck_recheck' | 'crosscheck_list',
): Promise<CrossVerdict> {
  if (!PAID.has(String(status.status))) return 'unchanged';
  if (a.provider === 'xbridge_v1') return 'unchanged'; // installment receivable: its own webhook
  if (a.status === 'successful') return 'unchanged';
  const collected = Number(status.collectedAmount ?? status.amount ?? 0);
  if (a.status === 'partial' && Number(a.collected_amount ?? 0) >= collected) return 'unchanged';
  if (a.status === 'partial') {
    // We recorded part of it; x-bridge now says more. A person decides.
    await alertOps(sql, 'gateway_mismatch', a.order_id, `${a.transaction_id} ours partial ${a.collected_amount}, x-bridge ${status.status} ${collected}`, { refreshAfterHours: 24 });
    return 'flagged';
  }
  if (a.status === 'failed') {
    if (status.status !== 'COMPLETED' || collected < Number(a.amount)) {
      await alertOps(sql, 'gateway_mismatch', a.order_id, `${a.transaction_id} ours failed, x-bridge ${status.status} ${collected}`, { refreshAfterHours: 24 });
      return 'flagged';
    }
    const r = await settleFromStatus(sql, a.transaction_id, a, status, {
      reopenFailed: { source, amount: collected, by: 'cross-check' },
    });
    if (r.reopenRefused) {
      await alertOps(sql, 'gateway_mismatch', a.order_id, `${a.transaction_id} ours failed, x-bridge ${status.status} ${collected}`, { refreshAfterHours: 24 });
      return 'flagged';
    }
    return r.unapplied ? 'flagged' : 'settled';
  }
  // open or expired: an ordinary (late) settlement
  const r = await settleFromStatus(sql, a.transaction_id, a, status);
  return r.unapplied ? 'flagged' : r.orderStatus ? 'settled' : 'unchanged';
}

async function startRun(sql: Sql, kind: 'recheck' | 'list'): Promise<number> {
  const [r] = await sql`insert into gateway_crosscheck_run (kind) values (${kind}) returning id`;
  return Number(r.id);
}

async function finishRun(sql: Sql, id: number, c: { checked: number; settled: number; flagged: number; errors: number; complete?: boolean; detail?: unknown }): Promise<void> {
  await sql`
    update gateway_crosscheck_run
       set finished_at = now(), checked = ${c.checked}, settled = ${c.settled}, flagged = ${c.flagged},
           errors = ${c.errors}, complete = ${c.complete ?? true}, detail = ${c.detail == null ? null : sql.json(c.detail)}
     where id = ${id}`;
}

export interface CrossCheckResult {
  runId: number;
  checked: number;
  settled: number;
  flagged: number;
  errors: number;
  complete: boolean;
}

/** Pass A: re-ask x-bridge about our unpaid attempts, oldest due first. */
export async function recheckUnpaidAttempts(
  sql: Sql, opts: { read?: (a: Attempt, signal: AbortSignal) => Promise<CollectionStatusResponse> } = {},
): Promise<CrossCheckResult> {
  const runId = await startRun(sql, 'recheck');
  const c = { checked: 0, settled: 0, flagged: 0, errors: 0 };
  const due: Attempt[] = await sql`
    select transaction_id, order_id, method, status, amount, provider, schedule_n, collected_amount
      from payment_transaction
     where status in ('expired', 'failed')
       and created_at > now() - make_interval(days => ${CROSSCHECK_LIMITS.recheckDays})
       and (accepted_at is not null or order_reference is not null)
       and provider is distinct from 'xbridge_v1'
       and (gateway_checked_at is null or gateway_checked_at < now() - (case
             when created_at > now() - interval '6 hours' then interval '10 minutes'
             when created_at > now() - interval '24 hours' then interval '1 hour'
             else interval '6 hours' end))
     order by coalesce(gateway_checked_at, created_at) asc
     limit ${CROSSCHECK_LIMITS.recheckBatch}`;
  const read = opts.read ?? ((a: Attempt, signal: AbortSignal) => statusForAttempt(a.transaction_id, a.provider, signal));
  await mapLimit(due, CROSSCHECK_LIMITS.readConcurrency, async (a) => {
    c.checked++;
    let status: CollectionStatusResponse;
    try {
      status = await readWithTimeout((_id, signal) => read(a, signal), a.transaction_id, CROSSCHECK_LIMITS.readTimeoutMs);
    } catch (e) {
      c.errors++;
      // A 404 (x-bridge never had it) is an answer too: count it and back off.
      if (/failed: 404\b/.test(String((e as Error)?.message ?? ''))) {
        await sql`update payment_transaction set gateway_checked_at = now(), gateway_check_count = gateway_check_count + 1
                   where transaction_id = ${a.transaction_id}`;
      }
      return;
    }
    await sql`update payment_transaction set gateway_checked_at = now(), gateway_check_count = gateway_check_count + 1
               where transaction_id = ${a.transaction_id}`;
    await captureStatusRead(sql, a.transaction_id, status);
    try {
      const v = await settlePaidAnswer(sql, a, status, 'crosscheck_recheck');
      if (v === 'settled') c.settled++;
      else if (v === 'flagged') c.flagged++;
    } catch (e) {
      c.errors++;
      console.error('crosscheck recheck apply failed', a.transaction_id, (e as Error)?.message ?? e);
    }
  });
  await finishRun(sql, runId, c);
  return { runId, ...c, complete: true };
}

/** Pass B: compare x-bridge's list of the last 72 h with our attempts. */
export async function crossCheckList(
  sql: Sql,
  opts: { now?: Date; list?: (from: Date, to: Date) => Promise<{ rows: ListedCollection[]; complete: boolean }> } = {},
): Promise<CrossCheckResult | null> {
  const cfg = xbridgeV1Config();
  if (cfg.mock && !process.env.XBRIDGE_MOCK_LIST_FILE && !opts.list) return null; // nothing to compare against
  const runId = await startRun(sql, 'list');
  const c = { checked: 0, settled: 0, flagged: 0, errors: 0 };
  const to = opts.now ?? new Date();
  const from = new Date(to.getTime() - CROSSCHECK_LIMITS.listHours * 3600_000);
  let listed: { rows: ListedCollection[]; complete: boolean };
  try {
    listed = opts.list
      ? await opts.list(from, to)
      : await listCollectionsV1({ from, to, maxPages: CROSSCHECK_LIMITS.listMaxPages }, cfg);
  } catch (e) {
    await finishRun(sql, runId, { ...c, errors: 1, complete: false, detail: { error: String((e as Error)?.message ?? e).slice(0, 300) } });
    throw e;
  }

  const ids = listed.rows.map((r) => r.transactionId).filter(Boolean);
  const refs = listed.rows.map((r) => r.orderReference).filter((x): x is string => !!x);
  const ours: Attempt[] = ids.length || refs.length ? await sql`
    select transaction_id, order_id, method, status, amount, provider, schedule_n, collected_amount, order_reference
      from payment_transaction
     where transaction_id = any(${ids}) or order_reference = any(${refs})` : [];
  const byId = new Map<string, Attempt & { order_reference?: string | null }>();
  for (const a of ours as any[]) {
    byId.set(a.transaction_id, a);
    if (a.order_reference) byId.set(`ref:${a.order_reference}`, a);
  }

  const seen = new Set<string>();
  for (const row of listed.rows) {
    c.checked++;
    const a = byId.get(row.transactionId) ?? (row.orderReference ? byId.get(`ref:${row.orderReference}`) : undefined);
    if (a) seen.add(a.transaction_id);
    const paid = PAID.has(row.status);
    try {
      if (!a) {
        if (paid) {
          await alertOps(sql, 'gateway_unknown_payment', 'none', `${row.transactionId}|${row.orderReference ?? '?'}|${row.collectedAmount ?? row.amount ?? '?'}`);
          c.flagged++;
        }
        continue;
      }
      if (a.provider === 'xbridge_v1') continue;
      if (paid) {
        const status: CollectionStatusResponse = {
          transactionId: a.transaction_id,
          status: row.status as CollectionStatusResponse['status'],
          amount: row.amount ?? undefined,
          collectedAmount: row.collectedAmount ?? undefined,
          orderReference: row.orderReference ?? undefined,
          failureReason: row.failureReason,
        };
        const v = await settlePaidAnswer(sql, a, status, 'crosscheck_list');
        if (v === 'settled') c.settled++;
        else if (v === 'flagged') c.flagged++;
      } else if (a.status === 'successful' && (row.status === 'FAILED' || row.status === 'EXPIRED')) {
        await alertOps(sql, 'gateway_mismatch', a.order_id, `${a.transaction_id} ours successful, x-bridge ${row.status}`, { refreshAfterHours: 24 });
        c.flagged++;
      }
    } catch (e) {
      c.errors++;
      console.error('crosscheck list apply failed', row.transactionId, (e as Error)?.message ?? e);
    }
  }

  // Ours paid, x-bridge has no such collection. Only trusted on a complete list.
  if (listed.complete) {
    const missing = await sql`
      select transaction_id, order_id from payment_transaction
       where status = 'successful' and provider is distinct from 'xbridge_v1'
         and accepted_at is not null and order_reference is not null
         and order_reference not like 'MOCK-%'
         and created_at between ${from} and ${new Date(to.getTime() - 10 * 60_000)}
         and not (transaction_id = any(${[...seen]}))`;
    for (const m of missing) {
      await alertOps(sql, 'gateway_mismatch', m.order_id, `${m.transaction_id} ours successful, not on x-bridge`, { refreshAfterHours: 24 });
      c.flagged++;
    }
  }

  await finishRun(sql, runId, { ...c, complete: listed.complete, detail: { from: from.toISOString(), to: to.toISOString(), rows: listed.rows.length } });
  return { runId, ...c, complete: listed.complete };
}

/** The latest runs and the open cross-check alerts, for the admin page. */
export async function crossCheckOverview(sql: Sql): Promise<{
  runs: Array<{ id: number; kind: string; startedAt: string; finishedAt: string | null; checked: number; settled: number; flagged: number; errors: number; complete: boolean }>;
  lastRecheckAt: string | null;
  lastListAt: string | null;
}> {
  const rows = await sql`
    select id, kind, started_at, finished_at, checked, settled, flagged, errors, complete
      from gateway_crosscheck_run order by started_at desc limit 30`;
  const iso = (d: any) => (d ? new Date(d).toISOString() : null);
  const runs = rows.map((r: any) => ({
    id: Number(r.id), kind: r.kind, startedAt: iso(r.started_at)!, finishedAt: iso(r.finished_at),
    checked: r.checked, settled: r.settled, flagged: r.flagged, errors: r.errors, complete: r.complete,
  }));
  const last = (k: string) => runs.find((r: any) => r.kind === k && r.finishedAt)?.finishedAt ?? null;
  return { runs, lastRecheckAt: last('recheck'), lastListAt: last('list') };
}

/** Keep the run log short: drop runs older than 14 days. */
export async function purgeCrossCheckRuns(sql: Sql): Promise<number> {
  const r = await sql`delete from gateway_crosscheck_run where started_at < now() - interval '14 days'`;
  return Number(r.count ?? 0);
}

