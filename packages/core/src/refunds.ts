/* Refunds (eng review OV1) — the DEBIT side of the money model.

   Before this, money that had been paid back to a buyer stayed in the organizer's
   earnings forever, so it could still be withdrawn: a real leak. A refund is
   recorded on the ORDER (`status='refunded'`, `refunded_amount`), which is the
   same row org-sales reads, so earnings drop the moment the refund lands.

   Split shares (type='table_share') carry no order_item — their money lives in
   `split_share.amount`. A refunded share is flipped to state='refunded' in the
   SAME transaction as its order, so the split union in org-sales can never see a
   refunded seat as live revenue. This is the path for the `refund_pending` splits
   ops settles by hand (0006/0007): the money leaves the books when it is repaid.

   Deliberately NOT here: gateway/automated reversal and any UI. Recording the
   refund is what the money math needs; who pushes the button is an admin concern. */
import { tx } from './db';
import { releaseOrderInventory } from './inventory';

type Sql = any;

/** Order statuses that hold collected money and can therefore be refunded. */
export const REFUNDABLE_ORDER_STATUSES = ['paid', 'paid_unseatable', 'payment_short'] as const;

export type RefundOrderResult =
  | { ok: true; orderId: string; refunded: number; gross: number; fullyRefunded: boolean }
  | { ok: false; reason: 'not_found' | 'not_refundable' | 'bad_amount' | 'exceeds_gross' };

/** Gross money collected on an order: line items when it has them, else (a split
    share order) its own target_value. Mirrors the org-sales revenue union. */
async function orderGross(t: Sql, orderId: string, targetValue: number): Promise<number> {
  const [row] = await t`
    select coalesce(sum(oi.unit_price * oi.quantity), 0)::bigint as gross
      from order_item oi where oi.order_id = ${orderId}`;
  const items = Number(row?.gross ?? 0);
  return items > 0 ? items : Number(targetValue ?? 0);
}

/**
 * Record a refund against an order. Idempotent-ish and monotonic: refunds
 * accumulate up to the order's gross and a fully refunded order lands on
 * status='refunded' (partials stay 'paid' with a non-zero refunded_amount, so
 * they keep counting as an order while their money is netted out).
 *
 * @param amount whole units to refund; omitted/null = the full remaining gross.
 */
export async function refundOrder(sql: Sql, orderId: string, amount?: number | null): Promise<RefundOrderResult> {
  if (amount != null && (!Number.isFinite(amount) || amount <= 0)) return { ok: false, reason: 'bad_amount' };
  return tx(async (t: Sql): Promise<RefundOrderResult> => {
    const [ord] = await t`
      select id, type, status, target_value, coalesce(refunded_amount, 0)::bigint as refunded_amount
        from "order" where id = ${orderId} for update`;
    if (!ord) return { ok: false, reason: 'not_found' };
    if (!REFUNDABLE_ORDER_STATUSES.includes(ord.status)) return { ok: false, reason: 'not_refundable' };

    const gross = await orderGross(t, orderId, ord.target_value);
    const already = Number(ord.refunded_amount);
    const remaining = gross - already;
    if (remaining <= 0) return { ok: false, reason: 'not_refundable' };

    const delta = amount == null ? remaining : Math.round(amount);
    if (delta > remaining) return { ok: false, reason: 'exceeds_gross' };

    const refunded = already + delta;
    const fullyRefunded = refunded >= gross;
    await t`
      update "order"
         set refunded_amount = ${refunded},
             status = ${fullyRefunded ? 'refunded' : ord.status},
             refunded_at = ${fullyRefunded ? new Date() : null}
       where id = ${orderId}`;

    // Split seat: keep split_share in lockstep so the split union never counts a
    // repaid seat. Only a FULL refund voids the seat.
    if (fullyRefunded) {
      await t`
        update split_share set state = 'refunded', refunded_at = now()
         where order_id = ${orderId} and state = 'paid'`;
      // BS62: return the seat to inventory too — sold_count was never decremented
      // on refund, so "sold" over-counted and the seat could never be resold. Same
      // transaction as the money side. No-op for split orders (no order_item).
      await releaseOrderInventory(t, orderId);
    }

    return { ok: true, orderId, refunded, gross, fullyRefunded };
  }, sql);
}
