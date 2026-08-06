/* Payouts (BS38 / plan #7) — the withdrawal ledger and, more importantly, the
   ONE place an organizer's withdrawable balance is decided.

   ── The money model ────────────────────────────────────────────────────────
     available(currency) = Σ stamped net of paid orders          (earnings.ts)
                         − Σ refunded                            (already netted there)
                         − Σ payouts NOT rejected                (this file)
   Both terms are server-authoritative: the client sends an amount, never a
   balance, and the amount is re-checked against a freshly computed balance
   inside the same transaction that writes the row.

   ── ARCH-2: why the lock exists ────────────────────────────────────────────
   Read-then-write is the classic double-spend. Two withdrawal requests that both
   read a 100,000 balance and then both insert 100,000 leave the organizer
   200,000 overdrawn, and the money is already gone by the time anyone notices.
   `requestPayout` therefore does BOTH steps in one transaction that opens with a
   per-organizer advisory lock, so the second request blocks until the first has
   committed and then sees the reduced balance. A `requested` payout RESERVES its
   amount (it is subtracted by `nonRejectedByCurrency`) — the reservation is what
   the second request runs into.

   The lock is per ORGANIZER, not global: two different organizers withdraw
   concurrently with no contention. It is an xact lock, so it is released by
   COMMIT/ROLLBACK — there is no path that leaks it.

   ── OV7: currency ──────────────────────────────────────────────────────────
   Balances are per currency and never summed. A payout is single-currency. If
   the settlement currency differs from the balance currency the admin records
   the rate they actually used as free text at confirm time (`fx_note`) — Zora
   does not convert and does not pretend to know a rate.

   ── CQ3: typed rejection codes ─────────────────────────────────────────────
   Every refusal is a machine-readable code plus a human message, so the UI never
   has to string-match and the copy lives in one place (`payoutErrorMessage`). */
import { tx } from './db';
import { netEarningsByCurrency, readOrderMoney } from './earnings';

type Sql = any;

// ── types ────────────────────────────────────────────────────────────────────

export type PayoutStatus = 'requested' | 'approved' | 'rejected';

/** Statuses that still hold money against the balance: a pending request is
    reserved, an approved payout has already been paid out. Only 'rejected'
    returns the amount to available. */
export const PAYOUT_HOLDING_STATUSES: PayoutStatus[] = ['requested', 'approved'];

/** CQ3 — the closed set of reasons a withdrawal request can be refused. */
export type PayoutErrorCode =
  | 'insufficient_balance'
  | 'not_verified'
  | 'amount_invalid'
  | 'duplicate_request'
  | 'unsupported_currency';

/** Reasons an admin decision can be refused (separate surface, separate codes). */
export type PayoutDecisionErrorCode =
  | 'not_found'
  | 'already_decided'
  | 'reference_required'
  | 'reason_required'
  | 'invalid_decision';

export interface PayoutRecord {
  id: string;
  organizerHandle: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  reference: string | null;
  fxNote: string | null;
  note: string | null;
  reason: string | null;
}

/** One currency's ledger line. Every field is shown to the organizer — "why did
    my balance drop" must be answerable without asking support (DESIGN.md 5). */
export interface PayoutBalance {
  currency: string;
  /** Σ net of paid orders, already net of commission AND of refunds. */
  earned: number;
  /** Σ of `requested` payouts — reserved, not yet paid. */
  reserved: number;
  /** Σ of `approved` payouts — money that has actually left. */
  paidOut: number;
  /** earned − reserved − paidOut, floored at 0 (OV1). */
  available: number;
  /** The smallest amount that may be requested in this currency. */
  minimum: number;
}

/** What the balance/request math needs about the acting organizer. Ownership of
    events lives in the events blob, so the CALLER resolves it (this module never
    joins on organizerHandle — same rule as org-sales, C3). */
export interface PayoutOrgContext {
  handle: string;
  ownedEventIds: string[];
  /** The org's live commission rate — used ONLY for orders with no stamp. */
  fallbackRate: number;
}

// ── minimums ─────────────────────────────────────────────────────────────────

/* A settlement floor exists so ops is not wiring 500 TZS by hand. TZS is the only
   currency Zora settles in today, so it is the only one with a real floor; any
   other currency is positivity-checked only rather than inheriting a number that
   would mean something wildly different (10,000 USD is not a minimum, it is a
   fortune). Add a row here when a new settlement currency goes live. */
const PAYOUT_MINIMUMS: Record<string, number> = { TZS: 10000 };
export const DEFAULT_PAYOUT_MINIMUM = 1;

export function payoutMinimum(currency: string): number {
  return PAYOUT_MINIMUMS[String(currency || '').toUpperCase()] ?? DEFAULT_PAYOUT_MINIMUM;
}

// ── the per-organizer lock (ARCH-2) ──────────────────────────────────────────

/** Namespace for every Zora payout advisory lock, so a key can never collide
    with another feature's lock on the same database. */
const PAYOUT_LOCK_NAMESPACE = 0x5a50; // 'ZP'

/** Deterministic 32-bit signed key for an organizer handle (FNV-1a). Computed in
    JS rather than with Postgres `hashtext` so the value is stable across server
    versions and visible in a test. */
export function payoutLockKey(handle: string): number {
  let h = 0x811c9dc5;
  const s = String(handle || '').toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0; // to signed int32, which is what pg_advisory_xact_lock takes
}

/** Take the per-organizer lock for the rest of the CURRENT transaction. Every
    path that changes the payout ledger for an org goes through here first. */
async function lockOrg(t: Sql, handle: string): Promise<void> {
  await t`select pg_advisory_xact_lock(${PAYOUT_LOCK_NAMESPACE}::int, ${payoutLockKey(handle)}::int)`;
}

// ── row mapping ──────────────────────────────────────────────────────────────

type PayoutRow = {
  id: string; organizer_handle: string; amount: string | number; currency: string;
  status: string; requested_at: Date | string; decided_at: Date | string | null;
  decided_by: string | null; reference: string | null; fx_note: string | null;
  note: string | null; reason: string | null;
};

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

function toRecord(r: PayoutRow): PayoutRecord {
  return {
    id: r.id,
    organizerHandle: r.organizer_handle,
    amount: Number(r.amount ?? 0),
    currency: r.currency,
    status: r.status as PayoutStatus,
    requestedAt: iso(r.requested_at) as string,
    decidedAt: iso(r.decided_at),
    decidedBy: r.decided_by,
    reference: r.reference,
    fxNote: r.fx_note,
    note: r.note,
    reason: r.reason,
  };
}

const PAYOUT_COLUMNS = `id, organizer_handle, amount, currency, status, requested_at,
                        decided_at, decided_by, reference, fx_note, note, reason`;

// ── balance ──────────────────────────────────────────────────────────────────

/** Σ amount of every payout that still holds money, per currency. */
async function nonRejectedByCurrency(
  t: Sql,
  handle: string,
): Promise<Map<string, { reserved: number; paidOut: number }>> {
  const rows = (await t`
    select currency, status, sum(amount)::bigint as total
      from payout
     where organizer_handle = ${String(handle || '').toLowerCase()}
       and status = any(${PAYOUT_HOLDING_STATUSES})
     group by currency, status`) as { currency: string; status: string; total: string | number }[];

  const out = new Map<string, { reserved: number; paidOut: number }>();
  for (const r of rows) {
    const line = out.get(r.currency) ?? { reserved: 0, paidOut: 0 };
    if (r.status === 'requested') line.reserved += Number(r.total ?? 0);
    else line.paidOut += Number(r.total ?? 0);
    out.set(r.currency, line);
  }
  return out;
}

/** Compute every currency line. Runs on whatever handle it is given — inside
    `requestPayout` that is the LOCKED transaction, which is the whole point. */
async function computeBalances(t: Sql, org: PayoutOrgContext): Promise<PayoutBalance[]> {
  // Sequential on purpose — inside `requestPayout` this runs on the transaction's
  // single pinned connection.
  const money = await readOrderMoney(t, org.ownedEventIds, org.fallbackRate);
  const held = await nonRejectedByCurrency(t, org.handle);
  const earned = netEarningsByCurrency(money);

  // Union of both key sets: a currency can carry payouts after its earnings were
  // refunded away, and that line must still be visible rather than vanish.
  const currencies = new Set<string>([...earned.keys(), ...held.keys()]);

  return [...currencies]
    .map((currency) => {
      const e = earned.get(currency) ?? 0;
      const h = held.get(currency) ?? { reserved: 0, paidOut: 0 };
      return {
        currency,
        earned: e,
        reserved: h.reserved,
        paidOut: h.paidOut,
        // Floored at 0: a refund can legitimately push earnings below what has
        // already been paid out. That is a debt to chase by hand, never a
        // negative number an organizer can somehow "withdraw" (OV1).
        available: Math.max(0, e - h.reserved - h.paidOut),
        minimum: payoutMinimum(currency),
      };
    })
    .sort((a, b) => b.available - a.available || a.currency.localeCompare(b.currency));
}

/** Every currency the organizer holds a balance in. */
export async function availableBalances(sql: Sql, org: PayoutOrgContext): Promise<PayoutBalance[]> {
  return computeBalances(sql, org);
}

/** One currency's balance. A currency the org has never earned in reads as an
    all-zero line, so callers never have to handle `undefined`. */
export async function availableBalance(
  sql: Sql,
  org: PayoutOrgContext,
  currency: string,
): Promise<PayoutBalance> {
  const cur = String(currency || '').toUpperCase();
  const lines = await computeBalances(sql, org);
  return (
    lines.find((l) => l.currency === cur) ?? {
      currency: cur, earned: 0, reserved: 0, paidOut: 0, available: 0, minimum: payoutMinimum(cur),
    }
  );
}

// ── request (organizer) ──────────────────────────────────────────────────────

export interface RequestPayoutInput {
  org: PayoutOrgContext;
  amount: number;
  currency: string;
  /** #5 gate: only a verified (kycStatus 'approved') organizer may withdraw. */
  kycApproved: boolean;
  note?: string | null;
}

export type RequestPayoutResult =
  | { ok: true; payout: PayoutRecord; balance: PayoutBalance }
  | { ok: false; code: PayoutErrorCode; message: string; balance?: PayoutBalance };

/** CQ3 — the one place a rejection code becomes a sentence the organizer reads. */
export function payoutErrorMessage(code: PayoutErrorCode, ctx?: { minimum?: number; currency?: string; available?: number }): string {
  const cur = ctx?.currency ? ' ' + ctx.currency : '';
  switch (code) {
    case 'insufficient_balance':
      return `That's more than you have available${ctx?.available != null ? ` (${ctx.available.toLocaleString('en-US')}${cur})` : ''}. Pending requests are already held back.`;
    case 'not_verified':
      return 'Your organizer account is not verified yet. Withdrawals unlock once a Zora admin approves you.';
    case 'amount_invalid':
      return ctx?.minimum != null
        ? `Enter a whole amount of at least ${ctx.minimum.toLocaleString('en-US')}${cur}.`
        : 'Enter a whole amount greater than zero.';
    case 'duplicate_request':
      return 'You already have a withdrawal request pending. We’ll settle that one first.';
    case 'unsupported_currency':
      return `You have no balance in${cur || ' that currency'}. Withdrawals settle per currency.`;
    default:
      return 'That withdrawal could not be requested.';
  }
}

const fail = (code: PayoutErrorCode, ctx?: Parameters<typeof payoutErrorMessage>[1], balance?: PayoutBalance): RequestPayoutResult =>
  ({ ok: false, code, message: payoutErrorMessage(code, ctx), balance });

/**
 * Request a withdrawal. THE money-critical path.
 *
 * Balance and insert happen in ONE transaction under the per-organizer advisory
 * lock, so concurrent requests serialize and the second one sees the first one's
 * reservation. Never trust a client-supplied balance: `amount` is the only thing
 * the caller controls, and it is checked here against a freshly computed one.
 */
export async function requestPayout(sql: Sql, input: RequestPayoutInput): Promise<RequestPayoutResult> {
  const handle = String(input.org.handle || '').toLowerCase();
  const currency = String(input.currency || '').toUpperCase();
  const amount = Number(input.amount);

  // Cheap, currency-independent guards first — no reason to take a lock to tell
  // someone they typed "abc".
  if (!handle) return fail('amount_invalid');
  if (!/^[A-Z]{3}$/.test(currency)) return fail('unsupported_currency', { currency });
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    return fail('amount_invalid', { currency, minimum: payoutMinimum(currency) });
  }
  // #5 — verification gates withdrawal (plan #7 open decision (d): yes).
  if (!input.kycApproved) return fail('not_verified');

  return tx(async (t: Sql): Promise<RequestPayoutResult> => {
    // ── ARCH-2 ── everything below is serialized per organizer.
    await lockOrg(t, handle);

    const balances = await computeBalances(t, { ...input.org, handle });
    const line = balances.find((b) => b.currency === currency);

    // No earnings and no history in this currency at all → not a currency this
    // organizer settles in. Distinct from "you have earned here but spent it".
    if (!line) return fail('unsupported_currency', { currency });

    if (amount < line.minimum) {
      return fail('amount_invalid', { currency, minimum: line.minimum }, line);
    }

    // One open request per currency (plan #7 open decision (a)). Two pending
    // requests are ambiguous for ops and pointless for the organizer — the
    // reservation already ring-fences the money.
    const [pending] = (await t`
      select id from payout
       where organizer_handle = ${handle} and currency = ${currency} and status = 'requested'
       limit 1`) as { id: string }[];
    if (pending) return fail('duplicate_request', { currency }, line);

    if (amount > line.available) {
      return fail('insufficient_balance', { currency, available: line.available }, line);
    }

    const [row] = (await t`
      insert into payout (organizer_handle, amount, currency, status, note)
      values (${handle}, ${amount}, ${currency}, 'requested', ${input.note ?? null})
      returning ${t.unsafe(PAYOUT_COLUMNS)}`) as PayoutRow[];

    // The balance returned is post-reservation — what the organizer sees next.
    const after: PayoutBalance = {
      ...line,
      reserved: line.reserved + amount,
      available: Math.max(0, line.available - amount),
    };
    return { ok: true, payout: toRecord(row), balance: after };
  }, sql);
}

// ── decide (admin) ───────────────────────────────────────────────────────────

export interface DecidePayoutInput {
  id: string;
  decision: 'approve' | 'reject';
  decidedBy: string;
  /** approve: the bank/momo transfer reference (required — proof money moved). */
  reference?: string | null;
  /** approve: free-text FX note when settlement currency ≠ balance currency (OV7). */
  fxNote?: string | null;
  /** reject: why (required — the organizer sees it). */
  reason?: string | null;
}

export type DecidePayoutResult =
  | { ok: true; payout: PayoutRecord }
  | { ok: false; code: PayoutDecisionErrorCode; message: string };

const DECISION_MESSAGE: Record<PayoutDecisionErrorCode, string> = {
  not_found: 'That payout no longer exists.',
  already_decided: 'That payout has already been decided — decisions are final because the money has moved.',
  reference_required: 'Enter the bank or mobile-money reference for the transfer you made.',
  reason_required: 'Enter a reason — the organizer sees it.',
  invalid_decision: 'A payout can only be approved or rejected.',
};
const decisionFail = (code: PayoutDecisionErrorCode): DecidePayoutResult =>
  ({ ok: false, code, message: DECISION_MESSAGE[code] });

/**
 * Approve (= paid, out-of-band, with a reference) or reject (returns the amount
 * to available) one payout. Also runs under the org lock and re-reads the row
 * FOR UPDATE, so two admins clicking at once cannot both decide it.
 */
export async function decidePayout(sql: Sql, input: DecidePayoutInput): Promise<DecidePayoutResult> {
  if (input.decision !== 'approve' && input.decision !== 'reject') return decisionFail('invalid_decision');
  const reference = (input.reference ?? '').trim();
  const reason = (input.reason ?? '').trim();
  if (input.decision === 'approve' && !reference) return decisionFail('reference_required');
  if (input.decision === 'reject' && !reason) return decisionFail('reason_required');

  return tx(async (t: Sql): Promise<DecidePayoutResult> => {
    const [existing] = (await t`
      select id, organizer_handle, status from payout where id = ${input.id}`) as
      { id: string; organizer_handle: string; status: string }[];
    if (!existing) return decisionFail('not_found');

    // Same lock the request path takes, so a decision and a new request for the
    // same organizer can never interleave mid-balance.
    await lockOrg(t, existing.organizer_handle);

    const [locked] = (await t`
      select id, status from payout where id = ${input.id} for update`) as { id: string; status: string }[];
    if (!locked) return decisionFail('not_found');
    if (locked.status !== 'requested') return decisionFail('already_decided');

    const [row] = (await t`
      update payout
         set status     = ${input.decision === 'approve' ? 'approved' : 'rejected'},
             decided_at = now(),
             decided_by = ${input.decidedBy || 'admin'},
             reference  = ${input.decision === 'approve' ? reference : null},
             fx_note    = ${input.decision === 'approve' ? ((input.fxNote ?? '').trim() || null) : null},
             reason     = ${input.decision === 'reject' ? reason : null}
       where id = ${input.id} and status = 'requested'
      returning ${t.unsafe(PAYOUT_COLUMNS)}`) as PayoutRow[];
    if (!row) return decisionFail('already_decided');

    return { ok: true, payout: toRecord(row) };
  }, sql);
}

// ── reads ────────────────────────────────────────────────────────────────────

export interface ListPayoutsFilter {
  /** Scope to ONE organizer. The organizer surface ALWAYS passes this — it is
      what makes cross-org access impossible rather than merely unlikely. */
  handle?: string | null;
  status?: PayoutStatus | null;
  limit?: number;
}

export async function listPayouts(sql: Sql, filter: ListPayoutsFilter = {}): Promise<PayoutRecord[]> {
  const handle = filter.handle == null ? null : String(filter.handle).toLowerCase();
  const status = filter.status ?? null;
  const limit = Math.max(1, Math.min(Number(filter.limit) || 100, 500));
  const rows = (await sql`
    select ${sql.unsafe(PAYOUT_COLUMNS)}
      from payout
     where (${handle}::text is null or organizer_handle = ${handle})
       and (${status}::text is null or status = ${status})
     order by requested_at desc
     limit ${limit}`) as PayoutRow[];
  return rows.map(toRecord);
}

export async function getPayout(sql: Sql, id: string): Promise<PayoutRecord | null> {
  const rows = (await sql`
    select ${sql.unsafe(PAYOUT_COLUMNS)} from payout where id = ${id}`) as PayoutRow[];
  return rows.length ? toRecord(rows[0]) : null;
}
