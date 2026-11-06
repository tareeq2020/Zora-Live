/* BS157: what happened to ONE cart, in words an admin can act on.

   The raw order status lumps different stories together: "failed" can be the
   buyer cancelling the PIN prompt, our gateway setup refusing the push, or a
   buyer who then paid in a second cart. This module turns an order + its
   attempts into one outcome. PURE (no DB): the admin API reads rows and hands
   them here (unit tests: packages/core/test/cart-outcome.test.mjs).

   The admin API also has the same rules in SQL (admin-orders/outcome-sql.ts) for
   the ?outcome= filter and the funnel counts; db/test/cart-outcomes.e2e.sh
   proves the two agree. Change both together. */
import { earnsCollected, issuesPasses } from './order-status';

export const CART_OUTCOMES = [
  'paid', 'paid_after_retry', 'recovered', 'in_progress', 'abandoned', 'system_error',
  'buyer_didnt_complete', 'underpaid', 'paid_unseatable', 'refunded', 'comp', 'door_sale',
] as const;
export type CartOutcome = (typeof CART_OUTCOMES)[number];

export function isCartOutcome(s: unknown): s is CartOutcome {
  return typeof s === 'string' && (CART_OUTCOMES as readonly string[]).includes(s);
}

/** Outcomes of a cart that never paid; only these can become `recovered`. */
export const UNPAID_OUTCOMES: readonly CartOutcome[] = ['in_progress', 'abandoned', 'system_error', 'buyer_didnt_complete'];

export const OUTCOME_LABELS: Record<CartOutcome, string> = {
  paid: 'Paid',
  paid_after_retry: 'Paid after retry',
  recovered: 'Recovered: paid in another cart',
  in_progress: 'In progress',
  abandoned: 'Abandoned before paying',
  system_error: 'System error (not the buyer)',
  buyer_didnt_complete: "Buyer didn't complete",
  underpaid: 'Underpaid',
  paid_unseatable: 'Paid, no seat',
  refunded: 'Refunded',
  comp: 'Comp',
  door_sale: 'Door sale',
};

/** x-bridge's `failureReason` on a FAILED collection (status read + callback).
    It may add values: anything else maps to 'unknown' (the raw value is kept). */
export const FAILURE_REASONS = [
  'payer_no_response', 'payer_cancelled', 'insufficient_funds', 'wrong_pin', 'invalid_number', 'provider_error', 'unknown',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

/** A stored failure_reason → one of FAILURE_REASONS, or null when there is none. */
export function mapFailureReason(raw: string | null | undefined): FailureReason | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return null;
  return (FAILURE_REASONS as readonly string[]).includes(v) ? (v as FailureReason) : 'unknown';
}

/** A `created` attempt younger than this may still be on its way out. */
export const ATTEMPT_SEND_GRACE_MS = 5 * 60_000;
/** A pending cart younger than this is still open (the default hold TTL). */
export const CART_OPEN_GRACE_MS = 15 * 60_000;
/** A paid cart by the same buyer within this long after a failed one recovers it. */
export const RECOVERY_WINDOW_MS = 24 * 3600_000;

/** BS159: from this time on we know whether the gateway took each attempt
    (order_event 'gateway_accepted' since BS153, then payment_transaction.accepted_at).
    BS153 started logging at about 12:06 UTC on 6 Nov; this sits a little after,
    so every attempt from here on was logged. Older attempts with no reference
    keep the legacy guess and an honest "not recorded" reason. */
export const ACCEPT_TRACKED_SINCE = '2026-11-06T12:30:00Z';
export const ACCEPT_TRACKED_SINCE_MS = Date.parse(ACCEPT_TRACKED_SINCE);

export interface OutcomeAttempt {
  status: string;
  orderReference?: string | null;
  billPayNumber?: string | null;
  error?: string | null;
  failureReason?: string | null;
  createdAt?: string | Date | null;
  /** BS159: when the gateway took the attempt (accepted_at, or the logged gateway_accepted step). */
  acceptedAt?: string | Date | null;
  /** BS159: 'mobile' | 'billpay' | 'card' (names the legacy refusal reason). */
  method?: string | null;
}

export type AttemptKind = 'paid' | 'short' | 'in_flight' | 'refused' | 'declined' | 'timed_out';

const ms = (v: string | Date | null | undefined): number | null => {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
};

/** What one attempt says. `refused` = the gateway never took it: it has an
    error, or it never got a gateway reference (nor an accepted_at) and stayed
    `created` past the send grace or was expired by reconcile. An attempt the
    gateway accepted is never refused: a later expiry is `timed_out`. */
export function classifyAttempt(a: OutcomeAttempt, now = Date.now()): AttemptKind {
  const taken = !!(a.orderReference || a.billPayNumber || a.acceptedAt);
  if (a.status === 'successful') return 'paid';
  if (a.status === 'partial') return 'short';
  if (a.error && !a.acceptedAt) return 'refused';
  if (a.status === 'pending' || a.status === 'processing') return 'in_flight';
  if (a.status === 'created') {
    if (taken) return 'in_flight';
    const t = ms(a.createdAt);
    return t != null && now - t < ATTEMPT_SEND_GRACE_MS ? 'in_flight' : 'refused';
  }
  if (a.status === 'expired') return taken ? 'timed_out' : 'refused';
  return 'declined'; // 'failed' (and anything unknown): the gateway took it, then said no
}

/** BS159: system_error sub-reasons for a cart the gateway never took. */
export const REFUSAL_REASONS = [
  'gateway_refused', 'card_unavailable', 'method_unavailable', 'no_gateway_reference', 'not_recorded',
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/** x-bridge's "no provider on this account for that method" (422). */
export const NO_PROVIDER_ERROR = 'NO_PROVIDER_FOR_METHOD';

/** Why a REFUSED attempt was refused (same rules as outcome-sql.ts):
    NO_PROVIDER_FOR_METHOD error → card_unavailable (card) | method_unavailable;
    other error → gateway_refused; no error and created after the cut-over →
    no_gateway_reference (we logged no acceptance, so it truly never got through);
    older: card → card_unavailable (x-bridge never had a card provider for us),
    else not_recorded (the reason was not stored before 6 Nov). */
export function refusalReason(a: OutcomeAttempt, cutoverMs = ACCEPT_TRACKED_SINCE_MS): RefusalReason {
  const card = String(a.method ?? '').toLowerCase() === 'card';
  if (a.error) {
    if (a.error.toUpperCase().includes(NO_PROVIDER_ERROR)) return card ? 'card_unavailable' : 'method_unavailable';
    return 'gateway_refused';
  }
  const t = ms(a.createdAt);
  if (t != null && t >= cutoverMs) return 'no_gateway_reference';
  return card ? 'card_unavailable' : 'not_recorded';
}

export interface OutcomeInput {
  status: string;
  type?: string | null;
  channel?: string | null;
  createdAt?: string | Date | null;
  /** In created order (oldest first). */
  attempts: OutcomeAttempt[];
  /** A held inventory/seat hold that has not expired. */
  holdLive?: boolean;
  /** Another order of the same buyer that paid for the same event (matchRecoveries). */
  recoveredBy?: string | null;
  now?: number;
  /** BS159: attempts created at/after this are "acceptance tracked" (default ACCEPT_TRACKED_SINCE). */
  acceptTrackedSinceMs?: number;
}

export interface OutcomeResult {
  outcome: CartOutcome;
  /** Sub-reason: abandoned → order status; system_error → a RefusalReason
      (gateway_refused | card_unavailable | method_unavailable |
      no_gateway_reference | not_recorded) or provider_error; buyer_didnt_complete → the mapped
      x-bridge failureReason when one was captured (payer_no_response,
      payer_cancelled, insufficient_funds, wrong_pin, invalid_number, unknown),
      else declined | timed_out | installment_defaulted; recovered → the outcome
      it had before the other cart paid; paid → installment. */
  outcomeDetail: string | null;
  recoveredBy: string | null;
  /** The raw stored reason behind outcomeDetail, when there was one. */
  reasonRaw: string | null;
}

/* Precedence, first match wins:
   comp > door_sale > refunded > paid_unseatable > underpaid > paid / paid_after_retry
   > (unpaid: in_progress > installment default > abandoned > system_error >
   buyer_didnt_complete), and any unpaid outcome becomes `recovered` when the
   same buyer paid for the event in another cart. x-bridge's `provider_error`
   (network or provider problem) counts as system_error: the buyer did nothing
   wrong and a retry may work, which is the action system_error asks for.
   `invalid_number` stays with the buyer: it is their data. Money states come first because
   they need action whatever the attempts say; who-was-at-fault only matters
   for carts that never paid. */
export function cartOutcome(o: OutcomeInput): OutcomeResult {
  const now = o.now ?? Date.now();
  const done = (outcome: CartOutcome, outcomeDetail: string | null = null): OutcomeResult =>
    ({ outcome, outcomeDetail, recoveredBy: null, reasonRaw: null });

  if (o.type === 'comp') return done('comp');
  if (String(o.channel ?? 'online').startsWith('gate')) return done('door_sale');
  if (o.status === 'refunded') return done('refunded');
  if (o.status === 'paid_unseatable') return done('paid_unseatable');
  if (o.status === 'payment_short') return done('underpaid');

  const kinds = o.attempts.map((a) => classifyAttempt(a, now));
  if (issuesPasses(o.status) || earnsCollected(o.status)) {
    const retried = kinds.some((k) => k === 'refused' || k === 'declined' || k === 'timed_out');
    return done(retried ? 'paid_after_retry' : 'paid', o.status === 'installment_active' ? 'installment' : null);
  }

  const base = unpaidOutcome(o, kinds, now);
  if (o.recoveredBy && UNPAID_OUTCOMES.includes(base.outcome)) {
    return { outcome: 'recovered', outcomeDetail: base.outcome, recoveredBy: o.recoveredBy, reasonRaw: base.reasonRaw };
  }
  return base;
}

function unpaidOutcome(o: OutcomeInput, kinds: AttemptKind[], now: number): OutcomeResult {
  const done = (outcome: CartOutcome, outcomeDetail: string | null = null): OutcomeResult =>
    ({ outcome, outcomeDetail, recoveredBy: null, reasonRaw: null });
  if (o.status === 'pending') {
    const created = ms(o.createdAt);
    const young = created != null && now - created < CART_OPEN_GRACE_MS;
    if (o.holdLive || kinds.includes('in_flight') || young) return done('in_progress');
  }
  if (o.status === 'installment_defaulted') return done('buyer_didnt_complete', 'installment_defaulted');
  if (!o.attempts.length) return done('abandoned', o.status);
  if (kinds.every((k) => k === 'refused')) {
    // The newest attempt says why.
    return done('system_error', refusalReason(o.attempts[o.attempts.length - 1], o.acceptTrackedSinceMs));
  }
  // The gateway took at least one attempt; the newest one it took says why.
  let i = kinds.length - 1;
  while (i >= 0 && kinds[i] === 'refused') i--;
  const raw = String(o.attempts[i]?.failureReason ?? '').trim();
  const code = mapFailureReason(raw);
  const r = (outcome: CartOutcome, detail: string): OutcomeResult => ({ outcome, outcomeDetail: detail, recoveredBy: null, reasonRaw: raw || null });
  if (code === 'provider_error') return r('system_error', 'provider_error');
  return r('buyer_didnt_complete', code ?? (kinds[i] === 'declined' ? 'declined' : 'timed_out'));
}

/** Sub-reason words after "Buyer didn't complete: " / "System error: ". */
export const DETAIL_LABELS: Record<string, string> = {
  gateway_refused: 'x-bridge refused the request',
  card_unavailable: "card isn't available at x-bridge",
  method_unavailable: "this payment method isn't available at x-bridge",
  no_gateway_reference: 'request never reached x-bridge',
  not_recorded: "didn't reach x-bridge; the reason wasn't recorded before 6 Nov",
  payer_no_response: 'timed out: no approval',
  payer_cancelled: 'cancelled by buyer',
  insufficient_funds: 'not enough balance',
  wrong_pin: 'wrong PIN',
  invalid_number: "number can't receive mobile money",
  unknown: 'declined: no reason given',
  timed_out: 'timed out',
  declined: 'declined',
  installment_defaulted: 'installments not finished',
  provider_error: 'network/provider problem (not the buyer)',
};

const SYSTEM_ERROR_DETAILS = new Set<string>([...REFUSAL_REASONS, 'provider_error']);

/** The chip text: "Buyer didn't complete: timed out", "Paid", … */
export function outcomeLabel(outcome: string, detail?: string | null): string {
  const base = (OUTCOME_LABELS as Record<string, string>)[outcome] ?? outcome;
  if (outcome === 'system_error' && detail && SYSTEM_ERROR_DETAILS.has(detail)) return `System error: ${DETAIL_LABELS[detail]}`;
  if (outcome !== 'buyer_didnt_complete') return base;
  const d = detail ? DETAIL_LABELS[detail] ?? detail : '';
  return d ? `${base}: ${d}` : base;
}

/** One plain line for the detail page. */
export function explainOutcome(
  r: { outcome: string; outcomeDetail?: string | null; reasonRaw?: string | null }, attempts: OutcomeAttempt[] = [],
): string {
  const raw = r.reasonRaw && mapFailureReason(r.reasonRaw) === 'unknown' && r.reasonRaw.trim().toLowerCase() !== 'unknown'
    ? ` x-bridge said "${r.reasonRaw.trim()}".` : '';
  const bad = attempts.filter((a) => ['refused', 'declined', 'timed_out'].includes(classifyAttempt(a))).length;
  switch (r.outcome) {
    case 'paid': return r.outcomeDetail === 'installment' ? 'Booked on installments; payments are coming in.' : 'Paid on the first try.';
    case 'paid_after_retry': return `Paid after ${bad} failed attempt${bad === 1 ? '' : 's'} on this cart.`;
    case 'recovered': return `This cart never paid (${outcomeLabel(r.outcomeDetail ?? '', null).toLowerCase()}), but the same buyer paid for this event in another cart within 24 hours. Not a lost sale.`;
    case 'in_progress': return 'Still open: the hold is live or a payment is on its way.';
    case 'abandoned': return 'The buyer made a cart but never started a payment.';
    case 'system_error':
      switch (r.outcomeDetail) {
        case 'provider_error': return 'x-bridge reported a network or provider problem. Not the buyer; a retry may work.';
        case 'gateway_refused': return 'The gateway refused every payment request. This is our integration, not the buyer.';
        case 'card_unavailable': return "Card isn't available at x-bridge: our account has no card provider, so card requests never went through. Not the buyer.";
        case 'method_unavailable': return "x-bridge has no provider for this payment method on our account. Not the buyer.";
        case 'not_recorded': return "The payment request didn't reach x-bridge. Before 6 Nov we didn't store why, so the exact reason isn't known. Not the buyer.";
        default: return 'Payment requests never reached the gateway (it did not accept them and no reference came back). This is our integration, not the buyer.';
      }
    case 'buyer_didnt_complete':
      switch (r.outcomeDetail) {
        case 'timed_out': return 'The gateway sent the request, but it was not approved before we stopped waiting.';
        case 'declined': return 'The gateway sent the request, then reported it failed (declined, cancelled or timed out).';
        case 'installment_defaulted': return 'The installment plan closed before it was paid in full.';
        case 'payer_no_response': return 'The buyer got the prompt but did not approve it in time.';
        case 'payer_cancelled': return 'The buyer cancelled the payment prompt.';
        case 'insufficient_funds': return 'The buyer did not have enough balance.';
        case 'wrong_pin': return 'The buyer entered a wrong PIN.';
        case 'invalid_number': return "The number given can't receive mobile money. Ask the buyer for another number.";
        default: return `The gateway sent the request, then it failed with no reason given.${raw}`;
      }
    case 'underpaid': return 'The gateway collected less than the cart total. Ops was alerted.';
    case 'paid_unseatable': return 'Money arrived after the seats were gone. No pass was issued; refund or reseat.';
    case 'refunded': return 'Paid, then fully refunded.';
    case 'comp': return 'A complimentary pass, issued by the organizer.';
    case 'door_sale': return 'Sold at the gate.';
    default: return '';
  }
}

/* ── recovery: a failed cart whose buyer paid in another ─────────────────── */

/** Tanzanian number → "255…" digits, or null when it is not a phone. Same rule
    as the SQL in outcome-sql.ts. */
export function normalizeBuyerPhone(p: string | null | undefined): string | null {
  if (!p || /^comp:/i.test(p)) return null;
  let d = String(p).replace(/\D/g, '');
  if (d.startsWith('0')) d = '255' + d.slice(1);
  else if (d.length === 9) d = '255' + d;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

export interface RecoveryOrder {
  id: string;
  eventId: string;
  createdAt: string | Date;
  customerId?: string | null;
  phone?: string | null;
}

/** For each cart, the earliest paid order by the same buyer (same customer or
    same normalized phone) for the same event, created within 24h after it.
    `paid` must hold only paid orders (no comps). */
export function matchRecoveries(carts: RecoveryOrder[], paid: RecoveryOrder[]): Map<string, string> {
  const out = new Map<string, string>();
  const sorted = [...paid]
    .map((p) => ({ ...p, t: ms(p.createdAt) ?? 0, ph: normalizeBuyerPhone(p.phone) }))
    .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const c of carts) {
    const t = ms(c.createdAt);
    if (t == null) continue;
    const ph = normalizeBuyerPhone(c.phone);
    const hit = sorted.find((p) =>
      p.id !== c.id && p.eventId === c.eventId && p.t >= t && p.t <= t + RECOVERY_WINDOW_MS &&
      ((!!c.customerId && p.customerId === c.customerId) || (!!ph && p.ph === ph)));
    if (hit) out.set(c.id, hit.id);
  }
  return out;
}
