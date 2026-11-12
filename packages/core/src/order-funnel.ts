/* BS153: the cart funnel, read side. PURE (no DB): the admin API reads rows and
   hands them here, so the stage rules and the timeline merge are unit-tested
   without a database (packages/core/test/order-funnel.test.mjs). */
import { wasEverPaid } from './order-status';

/** The funnel, in order. The first two are aggregate-only (no person). */
export const FUNNEL_STAGES = [
  'event_views', 'checkout_opened', 'carts_created', 'payment_started',
  'gateway_accepted', 'paid', 'passes_delivered', 'checked_in',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/** The furthest stage ONE order reached (from carts_created on). */
export const ORDER_STAGES = ['cart_created', 'payment_started', 'gateway_accepted', 'paid', 'passes_delivered', 'checked_in'] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

export const STEP_LABELS: Record<string, string> = {
  cart_created: 'Cart created',
  pay_requested: 'Payment requested',
  gateway_accepted: 'Gateway accepted',
  gateway_rejected: 'Gateway rejected',
  callback_received: 'Gateway callback',
  status_changed: 'Status changed',
  paid: 'Paid',
  short: 'Short payment',
  failed: 'Payment failed',
  expired: 'Cart expired',
  hold_released: 'Hold released',
  refunded: 'Refunded',
  passes_issued: 'Passes issued',
  buyer_notified: 'Buyer notified',
  checked_in: 'Checked in',
  admin_push_requested: 'Admin sent a payment prompt',
  admin_push_refused: 'Admin payment prompt refused',
  gateway_checked: 'Checked with x-bridge',
  gateway_answer_accepted: "Admin accepted x-bridge's answer",
};

/** Rank for tie-breaking steps logged in the same instant. */
const STEP_RANK: Record<string, number> = {
  cart_created: 0, admin_push_refused: 1, admin_push_requested: 1, pay_requested: 1, gateway_rejected: 2, gateway_accepted: 2, callback_received: 3,
  status_changed: 4, short: 5, failed: 5, paid: 5, hold_released: 6, expired: 7, passes_issued: 8,
  buyer_notified: 9, checked_in: 10, refunded: 11, gateway_checked: 12, gateway_answer_accepted: 4,
};

export interface AttemptLike {
  status: string;
  orderReference?: string | null;
  billPayNumber?: string | null;
  error?: string | null;
  /** BS159: set when the gateway accepted the attempt. */
  acceptedAt?: string | Date | null;
}

/** Did the gateway take this attempt (a push/control number/card page went out)? */
export function attemptAccepted(a: AttemptLike): boolean {
  if (a.acceptedAt || a.orderReference || a.billPayNumber) return true;
  if (['pending', 'processing', 'successful', 'partial'].includes(a.status)) return true;
  return a.status === 'failed' && !a.error;
}

export interface StageInput {
  status: string;
  attempts: AttemptLike[];
  notified: boolean;
  checkedIn: boolean;
  /** Steps present in the order's log, if read. */
  steps?: Iterable<string>;
}

export function orderStageReached(o: StageInput): OrderStage {
  const steps = new Set(o.steps ?? []);
  if (o.checkedIn || steps.has('checked_in')) return 'checked_in';
  if (o.notified || steps.has('buyer_notified')) return 'passes_delivered';
  if (wasEverPaid(o.status) || steps.has('paid')) return 'paid';
  if (o.attempts.some(attemptAccepted) || steps.has('gateway_accepted')) return 'gateway_accepted';
  if (o.attempts.length || steps.has('pay_requested')) return 'payment_started';
  return 'cart_created';
}

export interface TimelineEntry {
  at: string;
  step: string;
  label: string;
  detail: Record<string, unknown>;
  source: 'logged' | 'derived';
  transactionId: string | null;
  /** ms since the previous entry (null for the first). */
  sincePrevMs: number | null;
}

export type RawEntry = Omit<TimelineEntry, 'label' | 'sincePrevMs' | 'source'> & { label?: string };

const keyOf = (e: RawEntry) => `${e.step}|${e.transactionId ?? ''}|${String((e.detail as any)?.publicRef ?? '')}`;

/** Merge logged events with ones derived from the tables. A derived entry is
    dropped when the log already has the same step (for the same attempt / pass). */
export function buildTimeline(logged: RawEntry[], derived: RawEntry[]): TimelineEntry[] {
  // BS164: an attempt the cart did not take (logged status_changed with
  // `unapplied`) never gets a Paid / Short step derived from its row status.
  const unapplied = new Set(logged.filter((e) => e.step === 'status_changed' && (e.detail as any)?.unapplied && e.transactionId).map((e) => e.transactionId));
  derived = derived.filter((e) => !(e.transactionId && unapplied.has(e.transactionId) && (e.step === 'paid' || e.step === 'short')));
  const seen = new Set(logged.map(keyOf));
  const loggedSteps = new Set(logged.map((e) => e.step));
  const all: Omit<TimelineEntry, 'sincePrevMs'>[] = [
    ...logged.map((e) => ({ ...e, label: e.label ?? STEP_LABELS[e.step] ?? e.step, source: 'logged' as const })),
    ...derived
      // A step with no attempt (cart, passes, notify, expiry) is logged once per order.
      .filter((e) => !seen.has(keyOf(e)) && !(e.transactionId == null && !(e.detail as any)?.publicRef && loggedSteps.has(e.step)))
      .map((e) => ({ ...e, label: e.label ?? STEP_LABELS[e.step] ?? e.step, source: 'derived' as const })),
  ];
  all.sort((a, b) => {
    const d = Date.parse(a.at) - Date.parse(b.at);
    return d !== 0 ? d : (STEP_RANK[a.step] ?? 50) - (STEP_RANK[b.step] ?? 50);
  });
  let prev: number | null = null;
  return all.map((e) => {
    const t = Date.parse(e.at);
    const sincePrevMs = prev == null || Number.isNaN(t) ? null : Math.max(0, t - prev);
    if (!Number.isNaN(t)) prev = t;
    return { ...e, sincePrevMs };
  });
}

/** Time between the first occurrence of key milestones, in ms (null if either is missing). */
export function timelineDurations(t: TimelineEntry[]): Record<string, number | null> {
  const first = (step: string) => {
    const e = t.find((x) => x.step === step);
    return e ? Date.parse(e.at) : null;
  };
  const span = (a: string, b: string) => {
    const x = first(a), y = first(b);
    return x == null || y == null ? null : Math.max(0, y - x);
  };
  return {
    cartToPayRequest: span('cart_created', 'pay_requested'),
    payRequestToGateway: span('pay_requested', 'gateway_accepted'),
    gatewayToPaid: span('gateway_accepted', 'paid'),
    paidToNotified: span('paid', 'buyer_notified'),
    cartToPaid: span('cart_created', 'paid'),
    paidToCheckIn: span('paid', 'checked_in'),
  };
}

/** Counts per stage → ordered stages with drop-off from the previous stage. */
export function funnelWithDropoff(counts: Record<FunnelStage, number>): { stage: FunnelStage; count: number; fromPrev: number | null; dropPct: number | null }[] {
  return FUNNEL_STAGES.map((stage, i) => {
    const count = Number(counts[stage] ?? 0);
    if (i === 0) return { stage, count, fromPrev: null, dropPct: null };
    const prev = Number(counts[FUNNEL_STAGES[i - 1]] ?? 0);
    const dropPct = prev > 0 ? Math.round(((prev - count) / prev) * 1000) / 10 : null;
    return { stage, count, fromPrev: prev, dropPct };
  });
}
