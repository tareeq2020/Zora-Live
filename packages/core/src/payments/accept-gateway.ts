/* BS165: an admin accepts x-bridge's answer for an attempt we recorded as
   FAILED but x-bridge reports as paid (COMPLETED, or PARTIAL). The gateway
   check (BS164) flags this as a mismatch and never changes it on its own; this
   is the person's decision, made from the cart page.

   What it does, in order:
   1. reads x-bridge again now and refuses unless it still says paid with the
      amount the admin confirmed;
   Pay-in-full carts only (GA/VIP and tables): split seats and installment
   rows have their own money rules, so those are refused (not_supported).

   2. settles the attempt through the payment state machine with reopenFailed:
      under applyOutcome's lock the attempt must still be 'failed' (a second
      click, or another admin, is refused), and the reopen, the
      gateway_answer_accepted log and the settlement commit together or not at
      all. Settling is the path any late answer takes: stock taken again,
      passes issued, buyer notified; paid_unseatable if the seats are gone; a
      cart that moved on (refunded, paid by another attempt) gets the money
      recorded and flagged for refund instead (GUARD 2 / GUARD 3);
   3. clears the gateway_mismatch alert for this attempt, and reports the
      cart's other attempts that may still be payable at x-bridge (a second
      approval there would be a second collection, which GUARD 2 flags). */
import { type CollectionStatusResponse, collectionStatus } from './xbridge';
import { settleFromStatus, mapStatus, collectedFromStatus, type PaymentOutcome } from './service';
import { readWithTimeout, type StatusReader } from './gateway-check';
import { captureStatusRead } from '../gateway-capture';
import { sanitizeGatewayError } from '../order-events';

type Sql = any; // postgres.js Sql | tx handle

export type AcceptGatewayCode =
  | 'order_not_found' | 'attempt_not_found' | 'not_failed' | 'not_supported'
  | 'gateway_unreachable' | 'gateway_not_paid' | 'amount_changed';

const HTTP: Record<AcceptGatewayCode, number> = {
  order_not_found: 404, attempt_not_found: 404, not_failed: 409, not_supported: 409,
  gateway_unreachable: 502, gateway_not_paid: 409, amount_changed: 409,
};

export class AcceptGatewayRefused extends Error {
  readonly httpStatus: number;
  constructor(public readonly code: AcceptGatewayCode, message: string) {
    super(message);
    this.name = 'AcceptGatewayRefused';
    this.httpStatus = HTTP[code];
  }
}

export interface AcceptGatewayInput {
  orderId: string;
  transactionId: string;
  admin: { id: string; name: string };
  /** The amount the admin saw and confirmed (required); refused if x-bridge now says otherwise. */
  expectedCollected: number;
  note?: string | null;
  /** Test seam. */
  statusReader?: StatusReader;
}

export interface AcceptGatewayResult {
  transactionId: string;
  outcome: PaymentOutcome;
  collected: number | null;
  attemptStatus: string;
  orderStatusBefore: string;
  orderStatusAfter: string;
  /** 'late' | 'duplicate' when the cart could not take the money (flagged for refund). */
  unapplied: string | null;
  /** The cart's other attempts that may still be payable at x-bridge (open, or
      timed out on our side only). */
  otherOpenAttempts: string[];
  /** Valid passes on the cart after the accept (null for a table: it holds a reservation). */
  passesOnCart: number | null;
  /** The note as stored (trimmed), or null. */
  note: string | null;
}

const READ_TIMEOUT_MS = 15_000;

/** Accept x-bridge's paid answer for a FAILED attempt (rules in the header).
    Throws AcceptGatewayRefused for every refusal; nothing is changed then. */
export async function acceptGatewayAnswer(sql: Sql, input: AcceptGatewayInput): Promise<AcceptGatewayResult> {
  const { orderId, transactionId, admin } = input;
  const note = input.note == null ? null : String(input.note).trim().slice(0, 280) || null;
  const read: StatusReader = input.statusReader ?? ((id, signal) => collectionStatus(id, undefined, signal));

  const [order] = await sql`select status, type from "order" where id = ${orderId}::uuid`;
  if (!order) throw new AcceptGatewayRefused('order_not_found', 'Order not found.');
  const [att] = await sql`
    select transaction_id, status, provider, method, schedule_n from payment_transaction
     where transaction_id = ${transactionId} and order_id = ${orderId}::uuid`;
  if (!att) throw new AcceptGatewayRefused('attempt_not_found', 'That attempt is not on this cart.');
  // Pay-in-full carts only: split seats and installment rows keep their own
  // money rules (late / duplicate handling) that this path does not cover.
  if (att.provider === 'xbridge_v1' || att.schedule_n != null || order.type === 'table_share') {
    throw new AcceptGatewayRefused('not_supported', 'Only pay-in-full carts can be accepted here. Split seats and installments need a person to settle by hand.');
  }
  if (att.status !== 'failed') {
    throw new AcceptGatewayRefused('not_failed', `This attempt is ${att.status}, not failed. Run the check again.`);
  }

  // 1. Ask x-bridge again, now.
  let status: CollectionStatusResponse;
  try {
    status = await readWithTimeout(read, transactionId, READ_TIMEOUT_MS);
  } catch (e) {
    throw new AcceptGatewayRefused('gateway_unreachable', `Couldn't read x-bridge: ${sanitizeGatewayError(e)}`);
  }
  await captureStatusRead(sql, transactionId, status); // BS157, best-effort
  const outcome = mapStatus(status);
  const collected = collectedFromStatus(status, outcome);
  if ((outcome !== 'successful' && outcome !== 'short') || !(Number(collected) > 0)) {
    throw new AcceptGatewayRefused('gateway_not_paid', `x-bridge now says ${String(status.status ?? 'unknown')}, not paid. Nothing changed.`);
  }
  if (Number(input.expectedCollected) !== collected) {
    throw new AcceptGatewayRefused('amount_changed', `x-bridge now says ${collected ?? '?'} was collected, not ${input.expectedCollected}. Run the check again.`);
  }

  // 2. Reopen + settle, atomically, only if still failed.
  const s = await settleFromStatus(sql, transactionId, { order_id: orderId, method: att.method ?? null }, status, {
    reopenFailed: { by: 'admin', adminId: admin.id, adminName: admin.name, note, from: 'failed', gatewayStatus: String(status.status ?? ''), collected },
  });
  if (s.reopenRefused) throw new AcceptGatewayRefused('not_failed', 'This attempt was just changed by someone else. Run the check again.');

  // 3. The disagreement is resolved by this decision (prefix match, no LIKE wildcards).
  const prefix = `gateway_mismatch:${orderId}:${transactionId} `;
  await sql`
    delete from webhook_event
     where provider = 'ops-alert' and left(dedup_key, ${prefix.length}) = ${prefix}`
    .catch((e: unknown) => console.error('gateway_mismatch clear skipped', (e as Error)?.message));

  const [others, [after], [now], [passes]] = await Promise.all([
    sql`
      select transaction_id from payment_transaction
       where order_id = ${orderId}::uuid and transaction_id <> ${transactionId}
         and error is null and status in ('created', 'pending', 'processing', 'expired')
       order by created_at`,
    sql`select status from "order" where id = ${orderId}::uuid`,
    sql`select status from payment_transaction where transaction_id = ${transactionId}`,
    order.type === 'table'
      ? Promise.resolve([{ n: null }]) // a table holds a reservation, not per-item passes
      : sql`
          select count(*)::int as n from credential c join order_item oi on oi.id = c.order_item_id
           where oi.order_id = ${orderId}::uuid and c.state <> 'revoked'`,
  ]);
  return {
    transactionId,
    outcome,
    collected,
    attemptStatus: String(now?.status ?? 'failed'),
    orderStatusBefore: String(order.status),
    orderStatusAfter: String(after?.status ?? order.status),
    unapplied: s.unapplied === 'late' || s.unapplied === 'duplicate' ? s.unapplied : null,
    otherOpenAttempts: others.map((o: any) => String(o.transaction_id)),
    passesOnCart: passes?.n == null ? null : Number(passes.n),
    note,
  };
}
