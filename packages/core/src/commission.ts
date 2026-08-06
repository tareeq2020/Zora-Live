/* Commission math — the ONE place the platform's cut is resolved and applied.
   (Eng review CQ1: no duplication. org-sales, checkout and the split flow all
   call these; nothing else may re-derive a rate or re-implement the rounding.)

   Resolution order (plan #6): event override → organizer rate → platform default.
   The resolved rate is STAMPED on the order at pay time (`order.commission_rate`),
   so changing an organizer's rate later never rewrites historical earnings. */

/** Platform default commission when neither the event nor the org sets one. */
export const DEFAULT_COMMISSION_RATE = 0.05;

/** Anything carrying an optional commission override (an events-blob entry). */
export interface CommissionEventLike {
  commissionRate?: number | null;
}

/** Anything carrying an organizer's commission rate (an `organizer` row/record). */
export interface CommissionOrgLike {
  commissionRate?: number | null;
}

/** A usable rate is a finite fraction in [0, 1]. Anything else (null, NaN, a
    percentage like 5, a negative) is NOT a rate and falls through to the next
    level — a garbage override must never silently zero an organizer's payout. */
export function isCommissionRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Resolve the commission rate that applies to a purchase:
 *   per-event override → organizer rate → DEFAULT_COMMISSION_RATE.
 * Both arguments are optional/nullable so callers never need their own guards.
 */
export function resolveCommissionRate(
  event?: CommissionEventLike | null,
  org?: CommissionOrgLike | null,
): number {
  const override = event?.commissionRate;
  if (isCommissionRate(override)) return override;
  const orgRate = org?.commissionRate;
  if (isCommissionRate(orgRate)) return orgRate;
  return DEFAULT_COMMISSION_RATE;
}

/**
 * The organizer's NET take from a gross amount, after commission.
 * SINGLE rounding rule for the whole platform: round HALF-UP to whole units
 * (money is bigint whole TZS), applied once per ORDER — never per line and never
 * again on an already-netted subtotal.
 */
export function netOf(gross: number, rate: number): number {
  const g = Number(gross);
  if (!Number.isFinite(g)) return 0;
  const r = isCommissionRate(rate) ? rate : DEFAULT_COMMISSION_RATE;
  return Math.round(g * (1 - r));
}
