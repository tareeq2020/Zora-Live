/* Earnings — the ONE read of "how much money does this organizer have, netted".
   (BS38, extracted verbatim from org-sales.service.ts.)

   Why it moved here: the sales screen and the payout balance MUST be the same
   number. If the balance query lived next to the payout code it would drift from
   the summary query the first time one of them was fixed, and an organizer could
   be shown 152,000 on one screen and allowed to withdraw a different amount on
   the next. Both now call `readOrderMoney` — same union, same refund handling,
   same rounding.

   The invariants (unchanged from BS35):
   - Revenue is the UNION of two sources, because a table split has NO order_item
     (0006: shares are payment-only): line-item orders + settled `split_share`
     rows. There is no double count — the item query INNER JOINs order_item, which
     share orders do not have.
   - Commission is POINT-IN-TIME: each order nets at the rate STAMPED on it at pay
     time (`order.commission_rate`), never the org's live rate.
   - Refunds are a DEBIT: `order.refunded_amount` comes off the gross BEFORE
     netting, so refunded money is never withdrawable (eng review OV1).
   - Currencies are never summed together (I7). */
import { netOf, resolveCommissionRate } from './commission';

type Sql = any;

/** Statuses that still hold organizer money. 'refunded' is included so the debit
    is APPLIED (its refunded_amount cancels its gross); leaving it out would drop
    the refund instead of subtracting it. */
export const EARNING_STATUSES = ['paid', 'refunded'] as const;
/** A settled seat, and a seat whose money was repaid (read so it nets to zero). */
export const SETTLED_SHARE_STATES = ['paid', 'refunded'] as const;

/** One order's money in one currency — the unit every earnings figure is built
    from. `rate` is the STAMPED commission; net is rounded once, here, per order. */
export interface OrderMoney {
  orderId: string;
  eventId: string;
  status: string;
  currency: string;
  gross: number;    // face value collected, net of refunds
  refunded: number; // how much of it was given back
  rate: number;     // the point-in-time commission rate
  net: number;      // gross after commission
}

/**
 * Every order holding this org's money, as one row per (order, currency).
 *
 * @param ownedEventIds the acting org's event ids (ownership lives in the events
 *        blob, so the caller resolves it — this never joins on organizerHandle).
 * @param fallbackRate  rate for an order with NO stamp (pre-BS35 rows migration
 *        0010 could not reach); normally the org's current rate.
 */
export async function readOrderMoney(
  sql: Sql,
  ownedEventIds: string[],
  fallbackRate: number,
): Promise<OrderMoney[]> {
  if (!ownedEventIds.length) return [];

  type Row = {
    order_id: string; event_id: string; status: string;
    commission_rate: string | null; currency: string;
    gross: string | number; refunded: string | number;
  };

  const earning = [...EARNING_STATUSES];
  const shareStates = [...SETTLED_SHARE_STATES];

  // Sequential, not Promise.all: this runs inside the payout transaction too, and
  // a transaction is one pinned connection — queries there are queued anyway, so
  // the "parallel" version buys nothing and only adds a pipelining edge case.
  const itemRows = (await sql`
      select o.id                                as order_id,
             o.event_id                          as event_id,
             o.status                            as status,
             o.commission_rate                   as commission_rate,
             pv.currency                         as currency,
             sum(oi.unit_price * oi.quantity)::bigint as gross,
             max(coalesce(o.refunded_amount, 0))::bigint as refunded
        from "order" o
        join order_item    oi on oi.order_id = o.id
        join price_version pv on pv.id = oi.price_version_id
       where o.event_id = any(${ownedEventIds})
         and o.status = any(${earning})
       group by o.id, o.event_id, o.status, o.commission_rate, pv.currency`) as Row[];

  const shareRows = (await sql`
      select o.id                                as order_id,
             o.event_id                          as event_id,
             o.status                            as status,
             o.commission_rate                   as commission_rate,
             pv.currency                         as currency,
             ss.amount::bigint                   as gross,
             coalesce(o.refunded_amount, 0)::bigint as refunded
        from split_share  ss
        join "order"      o  on o.id  = ss.order_id
        join table_split  ts on ts.id = ss.split_id
        join price_version pv on pv.id = ts.price_version_id
       where o.event_id = any(${ownedEventIds})
         and ss.state = any(${shareStates})
         and o.status = any(${earning})`) as Row[];

  // A refund is booked once per ORDER; if an order somehow spans two currency
  // rows we must not subtract it twice.
  const refundApplied = new Set<string>();
  const toMoney = (r: Row): OrderMoney => {
    const grossRaw = Number(r.gross ?? 0);
    const refunded = refundApplied.has(r.order_id) ? 0 : Number(r.refunded ?? 0);
    refundApplied.add(r.order_id);
    const gross = Math.max(0, grossRaw - refunded);
    // The STAMP wins. An un-stamped (pre-BS35) order falls back to the org's
    // current rate, then the platform default.
    const stamped = r.commission_rate == null ? null : Number(r.commission_rate);
    const rate = resolveCommissionRate({ commissionRate: stamped }, { commissionRate: fallbackRate });
    return {
      orderId: r.order_id, eventId: r.event_id, status: r.status,
      currency: r.currency, gross, refunded, rate,
      net: netOf(gross, rate), // single rounding rule, once per order
    };
  };

  return [...itemRows.map(toMoney), ...shareRows.map(toMoney)];
}

/** Net earnings per currency — the CREDIT side of the payout balance. Summed
    from the per-order nets so a rate change or a refund on ONE order can never
    smear across the others, and never across currencies (I7). */
export function netEarningsByCurrency(money: OrderMoney[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of money) out.set(m.currency, (out.get(m.currency) ?? 0) + m.net);
  return out;
}

/** Per-(currency) money bucket used to build the organizer sales headline. */
export interface CurrencyBucket {
  revenue: number;
  netRevenue: number;
  refunded: number;
  orders: number;   // paid orders only (a fully refunded order has status 'refunded')
  weighted: number; // Σ(gross × rate) — feeds the blended display commission rate
  rates: Set<number>; // distinct stamped rates seen on revenue-bearing rows
}

/**
 * Fold per-order money into `currency → bucket`, OPTIONALLY skipping any order
 * whose event is in `excludeEventIds`.
 *
 * This is the ONE place the "which events count toward the headline" decision is
 * applied. The sales summary passes the org's ARCHIVED event ids so archived
 * money never inflates "total sales" (D1:A). The payout balance reads the SAME
 * `OrderMoney` rows but WITHOUT an exclude set, so archived money stays earned
 * and withdrawable — the two numbers are allowed to differ ONLY by exactly the
 * archived events, and by nothing else.
 */
export function foldMoneyByCurrency(
  money: OrderMoney[],
  excludeEventIds?: ReadonlySet<string>,
): Map<string, CurrencyBucket> {
  const out = new Map<string, CurrencyBucket>();
  for (const m of money) {
    if (excludeEventIds?.has(m.eventId)) continue;
    let b = out.get(m.currency);
    if (!b) {
      b = { revenue: 0, netRevenue: 0, refunded: 0, orders: 0, weighted: 0, rates: new Set() };
      out.set(m.currency, b);
    }
    b.revenue += m.gross;
    b.netRevenue += m.net;
    b.refunded += m.refunded;
    b.weighted += m.gross * m.rate;
    if (m.gross > 0) b.rates.add(m.rate);
    if (m.status === 'paid') b.orders += 1;
  }
  return out;
}
