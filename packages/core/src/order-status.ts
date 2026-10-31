/* Order status — the ONE owner of "what an order status means" (BS116, plan A1).

   `order.status` is free text in the schema (0004_orders.sql), so nothing in the
   database stops a new value appearing. Before this module every reader carried
   its own hand-copied list (PAID_STATES in two controllers, PAID / FLAGGED in the
   sales service, EARNING_STATUSES here in core, ~20 bare 'paid' literals). Adding
   a status meant finding all of them; missing one meant paying out uncollected
   money or under-counting a sale.

   Now: every status is a row in STATUS_TRAITS, and every row must answer every
   question. Adding a status is a compile error until each trait is decided, and
   packages/core/test/order-status.test.mjs pins the full table.

   Rules for callers:
   - READS that gate money, sales counts, passes or messaging use a predicate
     (or the SQL array derived from it).
   - WRITES (a state transition, e.g. `set status = 'paid'`) use a literal or
     ORDER_STATUS.x. Never derive a write target from a predicate.

   A partial refund leaves the order on 'paid' with a non-zero refunded_amount;
   only a FULL refund moves it to 'refunded' (refunds.ts). There is no separate
   partially-refunded status. */

export const ORDER_STATUS = {
  /** Created, awaiting a payment attempt (or one is in flight). */
  PENDING: 'pending',
  /** Paid in full; credentials issued. */
  PAID: 'paid',
  /** Last payment attempt failed; may be retried. */
  FAILED: 'failed',
  /** Hold swept before payment arrived. */
  EXPIRED: 'expired',
  /** Voided (gate-sale void). */
  CANCELLED: 'cancelled',
  /** Money arrived but the hold was gone — no credential issued, ops alerted. */
  PAID_UNSEATABLE: 'paid_unseatable',
  /** Gateway reported an under-payment — ops alerted. */
  PAYMENT_SHORT: 'payment_short',
  /** Fully refunded (refunded_amount = gross). */
  REFUNDED: 'refunded',
  /** Installment plan in progress (deposit paid, seats reserved). Not produced yet (F7). */
  INSTALLMENT_ACTIVE: 'installment_active',
  /** Installment plan defaulted. Not produced yet (F7). */
  INSTALLMENT_DEFAULTED: 'installment_defaulted',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

/** Every question a status must answer. */
export interface OrderStatusTraits {
  /** Counts as a sold order/tickets in sales + analytics order counts. */
  countsAsSold: boolean;
  /** Its order-item / split money is read into organizer earnings + payout
      balance (readOrderMoney). 'refunded' is in so its refund DEBIT is applied. */
  countsAsRevenue: boolean;
  /** Collected but held for ops — surfaced separately as flaggedRevenue, never
      folded into revenue. */
  isFlaggedMoney: boolean;
  /** Has live passes: tickets may be (re)delivered, the confirmation SMS sent,
      and the payer auto-verified. */
  issuesPasses: boolean;
  /** A new payment attempt may be started on it. */
  isPayable: boolean;
  /** Buyer money is currently held against the order — blocks archiving the event. */
  holdsBuyerMoney: boolean;
  /** Money ever arrived on this order (admin view: keeps contact details past
      the never-paid PII window). */
  wasEverPaid: boolean;
  /** An admin refund may be issued against it. */
  isRefundable: boolean;
  /** Included in organizer/admin broadcast audiences ("a buyer"). */
  isBroadcastAudience: boolean;
}

const STATUS_TRAITS: Record<OrderStatus, OrderStatusTraits> = {
  pending: {
    countsAsSold: false, countsAsRevenue: false, isFlaggedMoney: false, issuesPasses: false,
    isPayable: true, holdsBuyerMoney: false, wasEverPaid: false, isRefundable: false, isBroadcastAudience: false,
  },
  paid: {
    countsAsSold: true, countsAsRevenue: true, isFlaggedMoney: false, issuesPasses: true,
    isPayable: false, holdsBuyerMoney: true, wasEverPaid: true, isRefundable: true, isBroadcastAudience: true,
  },
  payment_short: {
    countsAsSold: false, countsAsRevenue: false, isFlaggedMoney: true, issuesPasses: false,
    isPayable: false, holdsBuyerMoney: true, wasEverPaid: true, isRefundable: true, isBroadcastAudience: true,
  },
  paid_unseatable: {
    countsAsSold: false, countsAsRevenue: false, isFlaggedMoney: true, issuesPasses: false,
    isPayable: false, holdsBuyerMoney: true, wasEverPaid: true, isRefundable: true, isBroadcastAudience: true,
  },
  failed: {
    countsAsSold: false, countsAsRevenue: false, isFlaggedMoney: false, issuesPasses: false,
    isPayable: true, holdsBuyerMoney: false, wasEverPaid: false, isRefundable: false, isBroadcastAudience: false,
  },
  expired: {
    countsAsSold: false, countsAsRevenue: false, isFlaggedMoney: false, issuesPasses: false,
    isPayable: false, holdsBuyerMoney: false, wasEverPaid: false, isRefundable: false, isBroadcastAudience: false,
  },
  cancelled: {
    countsAsSold: false, countsAsRevenue: false, isFlaggedMoney: false, issuesPasses: false,
    isPayable: false, holdsBuyerMoney: false, wasEverPaid: false, isRefundable: false, isBroadcastAudience: false,
  },
  refunded: {
    countsAsSold: false, countsAsRevenue: true, isFlaggedMoney: false, issuesPasses: false,
    isPayable: false, holdsBuyerMoney: false, wasEverPaid: true, isRefundable: false, isBroadcastAudience: false,
  },
  // Installments (F7). Seats are reserved, so they count as sold; revenue comes
  // from COLLECTED payment_transaction rows in BS132 (plan A2), never from the
  // order total, so countsAsRevenue is false. No pass before full payment (A5).
  // Refunds of collected installments are decided in F7 — not refundable here yet.
  installment_active: {
    countsAsSold: true, countsAsRevenue: false, isFlaggedMoney: false, issuesPasses: false,
    isPayable: true, holdsBuyerMoney: true, wasEverPaid: true, isRefundable: false, isBroadcastAudience: true,
  },
  installment_defaulted: {
    countsAsSold: true, countsAsRevenue: false, isFlaggedMoney: false, issuesPasses: false,
    isPayable: false, holdsBuyerMoney: true, wasEverPaid: true, isRefundable: false, isBroadcastAudience: false,
  },
};

/** Every order status, in the order the admin filter shows them. */
export const ORDER_STATUSES = Object.keys(STATUS_TRAITS) as OrderStatus[];

export function isOrderStatus(s: unknown): s is OrderStatus {
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(STATUS_TRAITS, s);
}

/** Traits of a status; an unknown status answers false to everything. */
export function orderStatusTraits(s: string | null | undefined): OrderStatusTraits | null {
  return isOrderStatus(s) ? STATUS_TRAITS[s] : null;
}

const trait = (k: keyof OrderStatusTraits) => (s: string | null | undefined): boolean =>
  orderStatusTraits(s)?.[k] ?? false;

export const countsAsSold = trait('countsAsSold');
export const countsAsRevenue = trait('countsAsRevenue');
export const isFlaggedMoney = trait('isFlaggedMoney');
export const issuesPasses = trait('issuesPasses');
export const isPayable = trait('isPayable');
export const holdsBuyerMoney = trait('holdsBuyerMoney');
export const wasEverPaid = trait('wasEverPaid');
export const isRefundable = trait('isRefundable');
export const isBroadcastAudience = trait('isBroadcastAudience');

const where = (p: (s: string) => boolean): OrderStatus[] => ORDER_STATUSES.filter(p);

/* SQL-friendly arrays for postgres.js (`status = any(${X})`). Derived from the
   predicates above — never hand-copy a list. Spread into a fresh array at the
   call site if a mutable string[] is needed. */
export const SOLD_STATUSES = where(countsAsSold);
export const REVENUE_STATUSES = where(countsAsRevenue);
export const FLAGGED_MONEY_STATUSES = where(isFlaggedMoney);
export const PASS_ISSUING_STATUSES = where(issuesPasses);
export const PAYABLE_STATUSES = where(isPayable);
export const BUYER_MONEY_STATUSES = where(holdsBuyerMoney);
export const EVER_PAID_STATUSES = where(wasEverPaid);
export const REFUNDABLE_STATUSES = where(isRefundable);
export const BROADCAST_STATUSES = where(isBroadcastAudience);
