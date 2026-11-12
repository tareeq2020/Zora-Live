/* BS164: an admin asks x-bridge what happened to every attempt on one cart and
   the cart is updated to match.

   The worker polls only OPEN attempts, and only inside their per-method window
   (mobile 1 h, card 2 h, bill pay 72 h). After that an attempt is 'expired' and
   nothing asks about it again; a late settlement only lands if x-bridge's
   callback gets through, and those are currently blocked (tracker: "x-bridge
   webhooks get 403"). This check closes that gap on demand, one cart at a time.

   Per attempt (newest maxAttempts; read in parallel, applied oldest first):
   - OPEN or EXPIRED → applied through the payment state machine
     (settleFromStatus → applyOutcome), the same code the poller and the
     webhook use, under its locks. The state machine decides whether the cart
     still takes the money (GUARD 2 duplicate collection, GUARD 3 late
     settlement on a cart that moved on, a failure on an attempt the cart no
     longer waits on); money it records but does not apply comes back as
     needs_refund, with an ops alert already raised;
   - an x-bridge /v1 receivable → skipped (settled by its signed webhook);
   - an attempt we stored a gateway error for is still asked (a timed-out POST
     may have been taken), and is skipped only when x-bridge cannot answer;
   - FINISHED (successful | failed | partial) → compared, never changed. A
     disagreement (status, or the amount on a partial) raises a
     'gateway_mismatch' ops alert for a person to fix.

   One check per cart at a time: a gateway_checked row is claimed under a lock
   on the order row (refused while another check runs or within minGapSecs of
   the last), and always filled in at the end, even on failure. */
import { tx } from '../db';
import { collectionStatus, type CollectionStatusResponse } from './xbridge';
import { settleFromStatus, mapStatus, collectedFromStatus, mapLimit, type PaymentOutcome } from './service';
import { captureStatusRead } from '../gateway-capture';
import { sanitizeGatewayError } from '../order-events';
import { alertOps } from '../ops';

type Sql = any; // postgres.js Sql | tx handle

export const GATEWAY_CHECK_LIMITS = {
  /** Minimum gap between two checks of one cart. */
  minGapSecs: 10,
  /** At most this many attempts (newest first) are read per check. */
  maxAttempts: 10,
  /** Status reads in flight at once. */
  readConcurrency: 4,
  /** One status read gives up after this long. */
  readTimeoutMs: 15_000,
  /** A check still marked running after this long is treated as dead. */
  runningStaleSecs: 600,
  /** Retry hint while another check runs (3 rounds of reads at the timeout). */
  typicalRunSecs: 45,
} as const;

const OPEN = new Set(['created', 'pending', 'processing']);
const FINISHED = new Set(['successful', 'failed', 'partial']);

export type GatewayCheckCode = 'order_not_found' | 'rate_limited';

export class GatewayCheckRefused extends Error {
  readonly httpStatus: number;
  constructor(public readonly code: GatewayCheckCode, message: string, public readonly retryAfterSecs: number | null = null) {
    super(message);
    this.name = 'GatewayCheckRefused';
    this.httpStatus = code === 'order_not_found' ? 404 : 429;
  }
}

/** What the check did with one attempt. */
export type AttemptVerdict =
  | 'updated'        // our record changed to match x-bridge
  | 'unchanged'      // x-bridge and our record already agree
  | 'still_pending'  // x-bridge has no final answer yet
  | 'needs_refund'   // money collected that this cart can't take; ops alerted
  | 'mismatch'       // x-bridge disagrees with a finished attempt; ops alerted, nothing changed
  | 'skipped'        // not something x-bridge's status read can answer
  | 'error';         // the status read (or applying it) failed

export interface AttemptCheck {
  transactionId: string;
  method: string | null;
  scheduleN: number | null;
  before: string;
  after: string;
  /** x-bridge's status (PENDING | COMPLETED | PARTIAL | FAILED), null when not read. */
  gatewayStatus: string | null;
  collectedAmount: number | null;
  failureReason: string | null;
  verdict: AttemptVerdict;
  /** What x-bridge's answer means (successful | short | failed | pending), null when not read. */
  outcome: PaymentOutcome | null;
  /** BS165: an admin may accept x-bridge's paid answer for this attempt (ours failed, pay-in-full cart). */
  acceptable: boolean;
  /** One plain line on what happened. */
  note: string;
}

export interface GatewayCheckResult {
  orderId: string;
  orderStatusBefore: string;
  orderStatusAfter: string;
  checkedAt: string;
  /** Newest first. */
  attempts: AttemptCheck[];
  /** Attempts on the cart that were not read (older than the newest maxAttempts). */
  notChecked: number;
  updated: number;
  mismatches: number;
  needsRefund: number;
  errors: number;
}

interface AttemptRow {
  transaction_id: string;
  method: string | null;
  status: string;
  provider: string | null;
  error: string | null;
  schedule_n: number | null;
  collected_amount: number | string | null;
}

const OUTCOME_WORDS: Record<PaymentOutcome, string> = {
  successful: 'paid in full', short: 'paid less than the amount', failed: 'failed', pending: 'still pending',
};

const money = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Does x-bridge's answer match an attempt we already finished? */
function agrees(r: AttemptRow, outcome: PaymentOutcome, collected: number | null): boolean {
  if (r.status === 'successful') return outcome === 'successful';
  if (r.status === 'failed') return outcome === 'failed';
  if (r.status === 'partial') return outcome === 'short' && (collected == null || money(r.collected_amount) === collected);
  return false;
}

export type StatusReader = (transactionId: string, signal: AbortSignal) => Promise<CollectionStatusResponse>;

/** One status read that gives up after ms; the status request is aborted (a
    token fetch already in flight is left to finish on its own). */
export async function readWithTimeout(read: StatusReader, transactionId: string, ms: number): Promise<CollectionStatusResponse> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(transactionId, ctl.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { ctl.abort(); reject(new Error(`no answer after ${Math.round(ms / 1000)} s`)); }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** x-bridge's status route itself answered 404 (it does not know the attempt). */
const NOT_KNOWN = /\/collection\/status\S* failed: 404\b/;

/** One gateway_mismatch alert per distinct disagreement (same key from every
    call site); a re-check brings a stale one back into view. */
async function raiseMismatch(sql: Sql, orderId: string, r: AttemptRow, gatewayStatus: string | null, collected: number | null): Promise<void> {
  const ours = money(r.collected_amount);
  await alertOps(sql, 'gateway_mismatch', orderId,
    `${r.transaction_id} ours ${r.status}${ours != null ? ` ${ours}` : ''}, x-bridge ${gatewayStatus ?? '?'}${collected != null ? ` ${collected}` : ''}`,
    { refreshAfterHours: 24 });
}

/** 'late' | 'duplicate' when the state machine recorded this attempt's money
    without the cart taking it (logged as status_changed with `unapplied`). */
async function unappliedKind(sql: Sql, orderId: string, transactionId: string): Promise<'late' | 'duplicate' | null> {
  const [e] = await sql`
    select detail->>'unapplied' as k from order_event
     where order_id = ${orderId}::uuid and transaction_id = ${transactionId}
       and step = 'status_changed' and detail->>'unapplied' in ('late', 'duplicate')
     order by id desc limit 1`;
  return (e?.k as 'late' | 'duplicate' | undefined) ?? null;
}

/** Claim this check: lock the order row, refuse while another check runs or
    inside the gap, and write the gateway_checked row (filled in at the end). */
async function claim(sql: Sql, orderId: string, who: Record<string, unknown>): Promise<{ eventId: string; status: string }> {
  return tx(async (t: Sql) => {
    const [order] = await t`select id, status from "order" where id = ${orderId}::uuid for update`;
    if (!order) throw new GatewayCheckRefused('order_not_found', 'Order not found.');
    const [last] = await t`
      select extract(epoch from (now() - max(at)))::float as since,
             max(extract(epoch from (at + make_interval(secs => ${GATEWAY_CHECK_LIMITS.runningStaleSecs}) - now())))
               filter (where detail->>'running' = 'true'
                         and at > now() - make_interval(secs => ${GATEWAY_CHECK_LIMITS.runningStaleSecs}))::float as running_left
        from order_event where order_id = ${orderId}::uuid and step = 'gateway_checked'`;
    if (last?.running_left != null) {
      // A check normally ends within its read budget; retry after that.
      const wait = Math.min(Math.ceil(Number(last.running_left)), GATEWAY_CHECK_LIMITS.typicalRunSecs);
      throw new GatewayCheckRefused('rate_limited', 'A check of this cart is already running. Wait for it to finish, then reload.', wait);
    }
    if (last?.since != null && Number(last.since) < GATEWAY_CHECK_LIMITS.minGapSecs) {
      const wait = Math.max(1, Math.ceil(GATEWAY_CHECK_LIMITS.minGapSecs - Number(last.since)));
      throw new GatewayCheckRefused('rate_limited', `This cart was just checked. Try again in ${wait} s.`, wait);
    }
    const [ev] = await t`
      insert into order_event (order_id, step, detail)
      values (${orderId}::uuid, 'gateway_checked', ${t.json({ ...who, running: true } as any)})
      returning id`;
    return { eventId: String(ev.id), status: String(order.status) };
  }, sql);
}

/** Read x-bridge for every attempt on the cart and apply what it says (rules in
    the header). Throws GatewayCheckRefused for order_not_found / rate_limited;
    a failed read or apply is an 'error' verdict on that attempt, not a throw. */
export async function checkOrderWithGateway(
  sql: Sql,
  orderId: string,
  opts: { admin?: { id: string; name: string } | null; statusReader?: StatusReader } = {},
): Promise<GatewayCheckResult> {
  const read: StatusReader = opts.statusReader ?? ((id, signal) => collectionStatus(id, undefined, signal));
  const who = opts.admin ? { by: 'admin', adminId: opts.admin.id, adminName: opts.admin.name } : {};
  const claimed = await claim(sql, orderId, who);
  let detail: Record<string, unknown> = { ...who, failed: true };
  try {
    const result = await runCheck(sql, orderId, claimed.status, read);
    detail = {
      ...who, checked: result.attempts.length, updated: result.updated, mismatches: result.mismatches,
      needsRefund: result.needsRefund, errors: result.errors, from: result.orderStatusBefore, to: result.orderStatusAfter,
    };
    return result;
  } finally {
    // Always close the claim, so the timeline never keeps a half-written check.
    // Stamped when it ends, so it sorts after the steps it caused.
    await sql`update order_event set detail = ${sql.json(detail as any)}, at = now() where id = ${claimed.eventId}`
      .catch((e: unknown) => console.error('gateway_checked update skipped', (e as Error)?.message));
  }
}

async function runCheck(sql: Sql, orderId: string, statusBefore: string, read: StatusReader): Promise<GatewayCheckResult> {
  const rows: (AttemptRow & { total: number })[] = await sql`
    select transaction_id, method, status, provider, error, schedule_n, collected_amount, count(*) over()::int as total
      from payment_transaction
     where order_id = ${orderId}::uuid
     order by created_at desc, transaction_id desc
     limit ${GATEWAY_CHECK_LIMITS.maxAttempts}`;
  const total = rows.length ? Number(rows[0].total) : 0;

  // 1. Read x-bridge (in parallel, bounded, each with a timeout). Nothing is written.
  type Read = { status: CollectionStatusResponse | null; error: string | null };
  const reads: Read[] = rows.map(() => ({ status: null, error: null }));
  await mapLimit(rows.map((r, i) => ({ r, i })), GATEWAY_CHECK_LIMITS.readConcurrency, async ({ r, i }) => {
    if (r.provider === 'xbridge_v1') return;
    try {
      reads[i] = { status: await readWithTimeout(read, String(r.transaction_id), GATEWAY_CHECK_LIMITS.readTimeoutMs), error: null };
    } catch (e) {
      reads[i] = { status: null, error: sanitizeGatewayError(e) };
    }
  });

  const [cart] = await sql`select type from "order" where id = ${orderId}::uuid`;
  const cartType = String(cart?.type ?? '');

  // 2. Apply, oldest first: the first money in is the money that pays the cart.
  const attempts: AttemptCheck[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const rd = reads[i];
    const base = {
      transactionId: String(r.transaction_id), method: r.method ?? null, scheduleN: r.schedule_n ?? null,
      before: String(r.status), gatewayStatus: null as string | null, collectedAmount: null as number | null, failureReason: null as string | null,
      outcome: null as PaymentOutcome | null, acceptable: false,
    };
    const done = (verdict: AttemptVerdict, note: string, after = base.before) => attempts.unshift({ ...base, after, verdict, note });
    const nowStatus = async () => {
      const [x] = await sql`select status from payment_transaction where transaction_id = ${base.transactionId}`;
      return String(x?.status ?? base.before);
    };

    if (r.provider === 'xbridge_v1') { done('skipped', 'Installment receivable: settled by the x-bridge receivable webhook, not this status read.'); continue; }
    if (!rd.status) {
      // Skipped only when x-bridge itself says it doesn't know an attempt it
      // refused at send time; a timeout or a 5xx is an error to retry.
      if (r.error && rd.error && NOT_KNOWN.test(rd.error)) done('skipped', 'x-bridge refused this attempt when it was sent and has no record of it.');
      else done('error', `Couldn't read x-bridge: ${rd.error ?? 'no answer'}`);
      continue;
    }
    const status = rd.status;
    const outcome = mapStatus(status);
    base.gatewayStatus = String(status.status ?? '') || null;
    base.failureReason = status.failureReason ?? null;
    base.collectedAmount = collectedFromStatus(status, outcome);
    base.outcome = outcome;

    try {
      await captureStatusRead(sql, base.transactionId, status); // BS157, best-effort

      if (OPEN.has(base.before) || base.before === 'expired') {
        if (outcome === 'pending') { done('still_pending', 'x-bridge has no final answer yet.'); continue; }
        const s = await settleFromStatus(sql, base.transactionId, { order_id: orderId, method: r.method }, status);
        const after = await nowStatus();
        const late = base.before === 'expired' ? ' Late answer after the attempt timed out.' : '';
        if (s.unapplied === 'duplicate') {
          done('needs_refund', 'x-bridge says paid in full, but the cart was already paid by another attempt. This is a second collection; flagged in Needs attention to refund.', after);
        } else if (s.unapplied === 'late') {
          done('needs_refund', `x-bridge says ${OUTCOME_WORDS[outcome]}, but the cart no longer takes this money (it is ${s.orderStatus ?? 'closed'}).${late} Recorded on the attempt only; flagged in Needs attention to refund or reconcile.`, after);
        } else if (s.orderStatus == null || after === base.before) {
          // Settled by another read (poller, webhook) between our snapshot and now:
          // compare what was stored with what x-bridge says.
          const [stored] = await sql`select collected_amount from payment_transaction where transaction_id = ${base.transactionId}`;
          const now = { ...r, status: after, collected_amount: stored?.collected_amount ?? null };
          if (after === base.before || agrees(now, outcome, base.collectedAmount)) {
            done('unchanged', `x-bridge says ${OUTCOME_WORDS[outcome]}; already applied.`, after);
          } else {
            await raiseMismatch(sql, orderId, now, base.gatewayStatus, base.collectedAmount);
            done('mismatch', `Settled as ${after} by another read just now, but x-bridge says ${OUTCOME_WORDS[outcome]}. Nothing changed automatically; flagged in Needs attention.`, after);
          }
        } else if (s.unapplied === 'attempt_only') {
          done('updated', `x-bridge says it failed. The attempt is marked failed; the cart is unchanged (it was not waiting on this attempt).${late}`, after);
        } else if (s.orderStatus === 'paid_unseatable' && outcome !== 'failed') {
          done('needs_refund', `x-bridge says ${OUTCOME_WORDS[outcome]}, but the cart's tickets are gone, so no pass was issued (paid_unseatable). Refund or reseat the buyer.${late}`, after);
        } else {
          done('updated', `x-bridge says ${OUTCOME_WORDS[outcome]}. Cart is now ${s.orderStatus}.${late}`, after);
        }
        continue;
      }

      if (FINISHED.has(base.before)) {
        // Compare and flag under the attempt's lock, the same lock applyOutcome
        // (and so an admin's accept, or a webhook) takes: a record changed since
        // the snapshot is never flagged on stale data.
        const flagged = await tx(async (t: Sql) => {
          const [cur] = await t`
            select status, collected_amount from payment_transaction where transaction_id = ${base.transactionId} for update`;
          const now = { ...r, status: String(cur?.status ?? base.before), collected_amount: cur?.collected_amount ?? null };
          if (now.status !== base.before) return { changed: now.status };
          if (agrees(now, outcome, base.collectedAmount)) return { agrees: true };
          await raiseMismatch(t, orderId, now, base.gatewayStatus, base.collectedAmount);
          return { mismatch: now };
        }, sql);
        if ('changed' in flagged) {
          done('unchanged', `Changed while checking (now ${flagged.changed}). Run the check again to compare.`, flagged.changed);
          continue;
        }
        if ('agrees' in flagged) {
          // Money recorded earlier but never taken by the cart is still owed:
          // say so again and bring its alert back into view.
          const kind = await unappliedKind(sql, orderId, base.transactionId);
          if (kind) {
            await alertOps(sql, kind === 'duplicate' ? 'duplicate_collection' : 'late_collection', orderId, base.transactionId, { refreshAfterHours: 24 });
            done('needs_refund', 'x-bridge agrees, and this money was never taken by the cart. Still to refund or reconcile; flagged in Needs attention.');
          } else {
            done('unchanged', 'x-bridge agrees.');
          }
        } else {
          const amountNote = r.status === 'partial' && outcome === 'short'
            ? ` (we recorded ${money(r.collected_amount) ?? '?'}, x-bridge says ${base.collectedAmount ?? '?'})` : '';
          // Raised above under the lock. BS165: ours failed but x-bridge says
          // money came in, on a pay-in-full cart → a person may accept it.
          base.acceptable = base.before === 'failed' && (outcome === 'successful' || outcome === 'short')
            && Number(base.collectedAmount) > 0 && r.schedule_n == null && cartType !== 'table_share';
          done('mismatch', `We have ${base.before}, x-bridge says ${OUTCOME_WORDS[outcome]}${amountNote}. Nothing changed automatically; flagged in Needs attention.`);
        }
        continue;
      }

      done('skipped', `Status ${base.before} is not one this check handles.`);
    } catch (e) {
      console.error('gateway check: apply failed', base.transactionId, (e as Error)?.message);
      done('error', `Read x-bridge (${base.gatewayStatus ?? '?'}) but couldn't apply it: ${sanitizeGatewayError(e)}`,
        await nowStatus().catch(() => base.before));
    }
  }

  const [after] = await sql`select status from "order" where id = ${orderId}::uuid`;
  const count = (v: AttemptVerdict) => attempts.filter((a) => a.verdict === v).length;
  return {
    orderId,
    orderStatusBefore: statusBefore,
    orderStatusAfter: String(after?.status ?? statusBefore),
    checkedAt: new Date().toISOString(),
    attempts,
    notChecked: Math.max(0, total - rows.length),
    updated: count('updated'),
    mismatches: count('mismatch'),
    needsRefund: count('needs_refund'),
    errors: count('error'),
  };
}
