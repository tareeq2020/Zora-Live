/* BS166: x-bridge business webhooks (signed), POST /api/webhooks/xbridge/events.

   This is the endpoint registered in x-bridge's dashboard (Developers ›
   Webhooks, with payment.received switched on). Unlike the per-collection
   callback_url (sent once, unsigned, no retry; a Cloudflare 403 loses it),
   these deliveries are signed and retried for 72 h, and they can be replayed.

   Signature: X-Bridge-Signature: v1=hex(HMAC_SHA256(secret, ts + "." + rawBody)),
   with ts = X-Bridge-Timestamp (unix seconds). We refuse a timestamp more
   than 300 s old or 60 s in the future. Several v1= values can appear while
   x-bridge rotates the secret; any match is accepted. The secret is
   XBRIDGE_WEBHOOK_SECRET. Without it, the endpoint refuses (fail-closed).

   Events:
   - payment.received: money arrived for one collection. `reference` is our
     transactionId. It is sent once per payment, also when a FAILED or EXPIRED
     collection is paid late. It is settled through settleFromStatus, the
     same path as the poller and the admin check, so every guard applies (a
     cart that moved on, a second collection, seats gone). A late payment on
     an attempt we marked FAILED is accepted when it pays the full amount on
     a pay-in-full cart (BS165's reopen path). Anything else goes to Needs
     attention.
   - receivable.*: handed to the installment receivable handler (BS133).
   - refund.*: recorded (captured body) for the refunds build; no action yet.
   - anything else: acknowledged and ignored, as x-bridge asks.

   Dedup is on eventId. A delivery that throws is not marked applied, and we
   answer 500, so x-bridge retries it. */

import { createHash } from 'node:crypto';
import { verifyXbridgeSignature } from './xbridge-signature';
import { captureCallback } from '../gateway-capture';
import { logCallbackReceived } from '../order-events';
import { alertOps } from '../ops';
import { settleFromStatus } from './service';
import { handleReceivableWebhook } from './installments-provider';
import type { CollectionStatusResponse } from './xbridge';

type Sql = any;
type Headers = Record<string, string | string[] | undefined>;

export { verifyXbridgeSignature, signXbridgeWebhook, WEBHOOK_MAX_AGE_SECS, WEBHOOK_MAX_SKEW_SECS } from './xbridge-signature';
export type { SignatureCheck } from './xbridge-signature';

export function xbridgeWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.XBRIDGE_WEBHOOK_SECRET || null;
}

function header(headers: Headers, name: string): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

export interface XbridgeEventResult {
  http: number;
  body: Record<string, unknown>;
}

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

/** The amount a payment.received carries, in major units. */
export function receivedAmount(ev: any): { value: number | null; currency: string | null } {
  const a = ev?.amount;
  if (a && typeof a === 'object') {
    const v = a.value != null ? Number(a.value)
      : a.amountMinor != null ? Number(a.amountMinor) / 10 ** Number(a.exponent ?? 2) : NaN;
    return { value: Number.isFinite(v) ? v : null, currency: str(a.currency) };
  }
  const v = Number(a);
  return { value: Number.isFinite(v) ? v : null, currency: str(ev?.currency) };
}

/** Handle one delivery, framework-free. */
export async function handleXbridgeEvent(
  sql: Sql, rawBody: string, headers: Headers, nowMs: number = Date.now(),
): Promise<XbridgeEventResult> {
  const secret = xbridgeWebhookSecret();
  if (!secret) return { http: 503, body: { error: 'no_secret' } };
  const check = verifyXbridgeSignature(rawBody, headers, secret, nowMs);
  if (check !== 'ok') return { http: 401, body: { error: check } };

  let ev: any;
  try { ev = JSON.parse(rawBody); } catch { return { http: 400, body: { error: 'bad_body' } }; }
  const type = String(ev?.event ?? ev?.type ?? '');

  // Installment receivables keep their own handler (it verifies again and dedupes itself).
  if (type.startsWith('receivable.')) {
    const r = await handleReceivableWebhook(sql, rawBody, headers);
    return { http: r.http, body: r.body };
  }

  const eventId = str(ev?.eventId) ?? str(header(headers, 'x-bridge-event-id'));
  const dedupKey = eventId ? `evt:${eventId}` : `sha:${createHash('sha256').update(rawBody).digest('hex')}`;
  const reference = str(ev?.reference) ?? str(ev?.transactionId);

  let [row] = await sql`
    insert into webhook_event (provider, dedup_key, transaction_id)
    values ('xbridge-event', ${dedupKey}, ${reference})
    on conflict (provider, dedup_key) do nothing returning id`;
  if (!row) {
    const [prev] = await sql`select id, applied from webhook_event where provider = 'xbridge-event' and dedup_key = ${dedupKey}`;
    if (prev?.applied) return { http: 200, body: { received: true, deduped: true } };
    row = prev; // an earlier delivery failed part-way: process it again
  }
  await captureCallback(sql, row?.id, reference, rawBody); // BS157, best-effort

  let result: Record<string, unknown>;
  if (type === 'payment.received') result = await onPaymentReceived(sql, ev, eventId);
  else if (type.startsWith('refund.')) result = { type, recorded: true };
  else result = { type, ignored: 'unhandled_event' };

  await sql`update webhook_event set applied = true where id = ${row.id}`;
  return { http: 200, body: { received: true, ...result } };
}

/** payment.received → settle the attempt it names. */
async function onPaymentReceived(sql: Sql, ev: any, eventId: string | null): Promise<Record<string, unknown>> {
  const type = 'payment.received';
  const reference = str(ev?.reference) ?? str(ev?.transactionId);
  const orderReference = str(ev?.orderReference);
  const { value, currency } = receivedAmount(ev);

  const [txr] = reference || orderReference ? await sql`
    select transaction_id, order_id, method, status, amount, currency, provider, schedule_n, collected_amount
      from payment_transaction
     where transaction_id = ${reference ?? ''}
        or (${orderReference}::text is not null and order_reference = ${orderReference})
     order by (transaction_id = ${reference ?? ''}) desc
     limit 1` : [];
  if (!txr) {
    // Money x-bridge took for a reference we don't know. A person must look.
    await alertOps(sql, 'gateway_unknown_payment', 'none', `${reference ?? '?'}|${orderReference ?? '?'}|${value ?? '?'}`);
    return { type, ignored: 'unknown_payment' };
  }
  const tx: string = txr.transaction_id;
  // An installment receivable payment is settled by its receivable.* event.
  if (txr.provider === 'xbridge_v1') return { type, transactionId: tx, ignored: 'receivable_payment' };
  if (value == null) {
    await alertOps(sql, 'gateway_mismatch', txr.order_id, tx);
    return { type, transactionId: tx, mismatch: 'no_amount' };
  }
  if (currency && txr.currency && currency !== txr.currency) {
    await alertOps(sql, 'gateway_mismatch', txr.order_id, tx);
    return { type, transactionId: tx, mismatch: 'currency' };
  }

  await logCallbackReceived(sql, tx, { provider: 'xbridge-event', type, eventId });
  if (txr.status === 'successful' || (txr.status === 'partial' && Number(txr.collected_amount ?? 0) >= value)) {
    return { type, transactionId: tx, already: txr.status };
  }

  const status: CollectionStatusResponse = {
    transactionId: tx,
    status: 'COMPLETED',
    amount: String(txr.amount),
    collectedAmount: String(value),
    orderReference: orderReference ?? undefined,
    failureReason: null,
  };

  if (txr.status === 'failed') {
    // A late success on an attempt we closed as failed (mobile money can do
    // this). Accept it only when it pays the whole amount on a pay-in-full
    // cart; applyOutcome refuses splits and installment rows itself.
    if (value < Number(txr.amount)) {
      await alertOps(sql, 'gateway_mismatch', txr.order_id, tx);
      return { type, transactionId: tx, mismatch: 'late_partial_on_failed' };
    }
    const r = await settleFromStatus(sql, tx, txr, status, {
      reopenFailed: { source: 'payment.received', eventId, amount: value, by: 'x-bridge webhook' },
    });
    if (r.reopenRefused) {
      await alertOps(sql, 'gateway_mismatch', txr.order_id, tx);
      return { type, transactionId: tx, mismatch: 'failed_attempt_not_reopened' };
    }
    return { type, transactionId: tx, orderStatus: r.orderStatus, unapplied: r.unapplied, lateOnFailed: true };
  }

  // Open, or expired by our own window (not final: settles as normal).
  const r = await settleFromStatus(sql, tx, txr, status);
  return { type, transactionId: tx, orderStatus: r.orderStatus, unapplied: r.unapplied };
}
