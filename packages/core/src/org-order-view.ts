/* BS160: the organizer's lighter view of one cart. PURE (no DB).

   Admins see every attempt, gateway error and callback body. Organizers see
   what they can act on: the outcome in plain words, the buyer-side reason, and
   a short timeline. Nothing here names a transaction, a reference, a gateway
   error or an admin action. The rules come from cart-outcome.ts and
   order-funnel.ts; this file only picks what an organizer may see and words it
   for them (unit tests: packages/core/test/org-order-view.test.mjs). */
import {
  cartOutcome, explainOutcome, outcomeLabel, DETAIL_LABELS,
  type OutcomeAttempt, type OutcomeResult,
} from './cart-outcome';
import { STEP_LABELS, type OrderStage, type TimelineEntry } from './order-funnel';

/** The organizer chip for a system error: not the buyer, and no internals. */
export const ORG_SYSTEM_ERROR_LABEL = "Payment didn't go through (not the buyer; ZoraPass is on it)";

/** Words an organizer explanation must never carry. */
const PLUMBING = /gateway|x-bridge|xbridge|integration|callback|reference|\bops\b|error|admin/i;

/* Explanations whose core wording talks about our plumbing. */
const ORG_EXPLAIN: Record<string, string> = {
  system_error: "The payment didn't go through on our side. It wasn't the buyer; ZoraPass is on it.",
  'buyer_didnt_complete:timed_out': 'The buyer got a payment prompt but did not approve it in time.',
  'buyer_didnt_complete:declined': "The buyer's payment was declined.",
  'buyer_didnt_complete:unknown': "The buyer's payment didn't complete. No reason was given.",
  recovered: 'This cart never paid, but the same buyer paid for this event in another cart within 24 hours. Not a lost sale.',
  underpaid: 'Less than the cart total was paid. ZoraPass is following up.',
  paid_unseatable: 'The money arrived after the seats were gone, so no pass was issued. ZoraPass will refund or reseat the buyer.',
};
const ORG_EXPLAIN_FALLBACK = "The payment didn't complete.";

export interface OrgOutcome {
  outcome: string;
  outcomeLabel: string;
  /** Buyer-side sub-reason only (e.g. payer_cancelled); null for system errors. */
  outcomeDetail: string | null;
}

/** An outcome as an organizer sees it. System errors lose their sub-reason;
    a recovered or abandoned cart loses its internal detail. */
export function organizerOutcome(r: Pick<OutcomeResult, 'outcome' | 'outcomeDetail'>): OrgOutcome {
  const outcome = r.outcome;
  if (outcome === 'system_error') return { outcome, outcomeLabel: ORG_SYSTEM_ERROR_LABEL, outcomeDetail: null };
  const keep = outcome === 'buyer_didnt_complete' || (outcome === 'paid' && r.outcomeDetail === 'installment');
  const outcomeDetail = keep ? r.outcomeDetail ?? null : null;
  return { outcome, outcomeLabel: outcomeLabel(outcome, outcomeDetail), outcomeDetail };
}

/** One plain line for the organizer detail page. Never quotes the gateway. */
export function organizerExplanation(r: Pick<OutcomeResult, 'outcome' | 'outcomeDetail'>, attempts: OutcomeAttempt[] = []): string {
  const v = organizerOutcome(r);
  const own = ORG_EXPLAIN[`${v.outcome}:${v.outcomeDetail ?? ''}`] ?? ORG_EXPLAIN[v.outcome];
  if (own) return own;
  // reasonRaw left out on purpose: core would quote x-bridge's raw text.
  const text = explainOutcome({ outcome: v.outcome, outcomeDetail: v.outcomeDetail, reasonRaw: null }, attempts);
  if (!text || PLUMBING.test(text)) {
    return v.outcome === 'buyer_didnt_complete' ? ORG_EXPLAIN['buyer_didnt_complete:unknown'] : ORG_EXPLAIN_FALLBACK;
  }
  return text;
}

/** Org funnel stages: the admin funnel without gateway_accepted. */
export const ORG_FUNNEL_STAGES = [
  'event_views', 'checkout_opened', 'carts_created', 'payment_started', 'paid', 'passes_delivered', 'checked_in',
] as const;

/** An order's stage for organizers: gateway_accepted reads as payment_started. */
export function organizerStage(s: OrderStage): OrderStage {
  return s === 'gateway_accepted' ? 'payment_started' : s;
}

/** Steps an organizer timeline may show. */
export const ORG_TIMELINE_STEPS = [
  'cart_created', 'pay_requested', 'paid', 'failed', 'expired', 'passes_issued', 'buyer_notified', 'checked_in', 'refunded',
] as const;

export interface OrgTimelineEntry {
  at: string;
  step: (typeof ORG_TIMELINE_STEPS)[number];
  label: string;
}

const ORG_STEP_LABELS: Record<string, string> = {
  pay_requested: 'Payment started',
  passes_issued: 'Passes sent',
};
const stepLabel = (step: string) => ORG_STEP_LABELS[step] ?? STEP_LABELS[step] ?? step;

/** Why ONE attempt failed, for an organizer: the buyer-side reason words, or
    the generic system line. Uses the cart rules on that attempt alone. */
export function attemptFailureLabel(a: OutcomeAttempt, now = Date.now(), acceptTrackedSinceMs?: number): string {
  const r = cartOutcome({ status: 'failed', attempts: [a], createdAt: a.createdAt ?? null, now, acceptTrackedSinceMs });
  if (r.outcome !== 'buyer_didnt_complete') return ORG_SYSTEM_ERROR_LABEL;
  const d = r.outcomeDetail ? DETAIL_LABELS[r.outcomeDetail] : null;
  return d ? `${STEP_LABELS.failed}: ${d}` : STEP_LABELS.failed;
}

export interface OrgTimelineAttempt extends OutcomeAttempt {
  transactionId: string;
}

/** The merged admin timeline (buildTimeline) → the organizer's short one.
    Only ORG_TIMELINE_STEPS; no detail, no ids. Repeated attempts collapse into
    one "Payment tried N times" line; failures before a payment that went
    through are dropped, otherwise only the last failure is kept. A refused or
    timed-out attempt reads as a failure with the organizer wording. */
export function organizerTimeline(
  t: TimelineEntry[], attempts: OrgTimelineAttempt[], now = Date.now(), acceptTrackedSinceMs?: number,
): OrgTimelineEntry[] {
  const byTx = new Map(attempts.map((a) => [a.transactionId, a]));
  const failLabel = (tx: string | null) => {
    const a = tx ? byTx.get(tx) : undefined;
    return a ? attemptFailureLabel(a, now, acceptTrackedSinceMs) : STEP_LABELS.failed;
  };
  const picked: OrgTimelineEntry[] = [];
  const failedTx = new Set<string>();
  for (const e of t) {
    let step = e.step;
    // An attempt that never went out, or ran out of time, is a failed payment.
    if (step === 'gateway_rejected' || (step === 'status_changed' && e.transactionId && (e.detail as any)?.to === 'expired')) step = 'failed';
    if (!(ORG_TIMELINE_STEPS as readonly string[]).includes(step)) continue;
    if (step === 'failed') {
      if (e.transactionId && failedTx.has(e.transactionId)) continue; // one failure per attempt
      if (e.transactionId) failedTx.add(e.transactionId);
      picked.push({ at: e.at, step: 'failed', label: failLabel(e.transactionId) });
      continue;
    }
    picked.push({ at: e.at, step: step as OrgTimelineEntry['step'], label: stepLabel(step) });
  }

  const tries = picked.filter((e) => e.step === 'pay_requested').length;
  const paidIdx = picked.map((e) => e.step).lastIndexOf('paid');
  const lastFail = picked.map((e) => e.step).lastIndexOf('failed');
  const out: OrgTimelineEntry[] = [];
  const once = new Set<string>();
  picked.forEach((e, i) => {
    if (e.step === 'pay_requested') {
      if (once.has('pay_requested')) return;
      once.add('pay_requested');
      out.push({ ...e, label: tries > 1 ? `Payment tried ${tries} times` : e.label });
      return;
    }
    if (e.step === 'failed' && (paidIdx > i || i !== lastFail)) return;
    if (['cart_created', 'paid', 'passes_issued', 'buyer_notified', 'expired', 'refunded'].includes(e.step)) {
      if (once.has(e.step)) return;
      once.add(e.step);
    }
    if (e.step === 'checked_in') {
      if (once.has('checked_in')) return;
      once.add('checked_in');
      const n = picked.filter((x) => x.step === 'checked_in').length;
      out.push({ ...e, label: n > 1 ? `${e.label} (${n} passes)` : e.label });
      return;
    }
    out.push(e);
  });
  return out;
}
