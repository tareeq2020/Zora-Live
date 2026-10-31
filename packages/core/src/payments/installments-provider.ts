/* BS133 (F7 / A4 / A20): the installment provider adapter — ONE function surface
   for everything installments need from a payment rail:

     createReceivable(sql, orderId)   open (idempotently) the provider-side record
                                      the installments are paid against
     payInstallment(sql, attempt)     send one installment attempt out
     parseWebhook(rawBody, headers)   verify + decode a receivable webhook

   Rails, chosen by env at call time:
     'collection'  (default)  — the /collection/* mobile / bill-pay / card API that
                    works today: one ordinary collection per installment, exactly
                    the pay-in-full code (collectViaCollectionApi). No receivable.
     'xbridge_v1'  (XBRIDGE_V1=1) — x-bridge /v1/payments/receivables (x-bridge R3,
                    ≈ 21 Nov). One receivable per order: amount = order total,
                    amountType 'flexible', expiry = final due + grace,
                    notifications 'none' (Zora sends reminders). Each installment
                    is POST /v1/payments/receivables/:id/pay {method, amount} with
                    Idempotency-Key = our transaction id, so a retried call returns
                    the first result and the webhook names our attempt.
   Both honour XBRIDGE_MOCK (no HTTP; deterministic responses) — the "mock" rail.

   Contract status: the /v1 request/response field names below follow the x-bridge
   contract notes (docs/plans/web-premium-v1.md); the sandbox does not exist yet,
   so anything marked TODO(xbridge-v1) must be checked against it before the flag
   is turned on for a real organizer. */
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { alertOps } from '../ops';
import { xbridgeConfig, xbridgeRequest, normalizeMsisdn, XbridgeHttpError } from './xbridge';
import { collectViaCollectionApi, applyOutcome, notifyOrderPaid, type CollectAttemptInput, type CollectAttemptResult } from './service';
import { InstallmentAttemptRefused } from './installments';

type Sql = any;

export type InstallmentRail = 'collection' | 'xbridge_v1';

/** Which rail installment attempts use right now. */
export function installmentRail(env: NodeJS.ProcessEnv = process.env): InstallmentRail {
  return env.XBRIDGE_V1 === '1' || env.XBRIDGE_V1 === 'true' ? 'xbridge_v1' : 'collection';
}

/** payment_transaction.provider for a new installment attempt (NULL = /collection/*). */
export function installmentProviderName(env: NodeJS.ProcessEnv = process.env): string | null {
  return installmentRail(env) === 'xbridge_v1' ? 'xbridge_v1' : null;
}

/* ── createReceivable ─────────────────────────────────────────────────────── */

/**
 * Ensure the order's receivable exists and return its id (null on the
 * 'collection' rail, which has no receivable). Idempotent twice over: a stored
 * receivable_id short-circuits, and the create call carries
 * Idempotency-Key 'zora-rcv-<orderId>' so a lost response can be retried safely.
 */
export async function createReceivable(sql: Sql, orderId: string): Promise<string | null> {
  if (installmentRail() !== 'xbridge_v1') return null;
  const [plan] = await sql`
    select receivable_id, total, currency, to_char(final_due + grace_days, 'YYYY-MM-DD') as expires_on
      from installment_plan where order_id = ${orderId}::uuid`;
  if (!plan) throw new InstallmentAttemptRefused('not_installment_order');
  if (plan.receivable_id) return plan.receivable_id;

  const cfg = xbridgeConfig();
  let receivableId: string;
  if (cfg.mock) {
    receivableId = `MOCK-RCV-${orderId}`;
  } else {
    // TODO(xbridge-v1): confirm field names against the R3 sandbox.
    const json = await xbridgeRequest('/v1/payments/receivables', {
      method: 'POST',
      headers: { 'Idempotency-Key': `zora-rcv-${orderId}` },
      body: {
        reference: orderId,
        amount: Number(plan.total),
        currency: plan.currency,
        amountType: 'flexible',
        expiresAt: `${plan.expires_on}T23:59:59+03:00`,
        notifications: 'none',
      },
    }, cfg);
    receivableId = String(json.id ?? json.receivableId ?? '');
    if (!receivableId) throw new Error('x-bridge receivable create returned no id');
  }
  // First writer wins; a concurrent create with the same idempotency key returned
  // the same id anyway.
  const [row] = await sql`
    update installment_plan set receivable_id = coalesce(receivable_id, ${receivableId})
     where order_id = ${orderId}::uuid returning receivable_id`;
  return row.receivable_id;
}

/* ── payInstallment ───────────────────────────────────────────────────────── */

export interface PayInstallmentInput extends CollectAttemptInput {
  scheduleN: number;
}

/** A definitive refusal from the rail (HTTP 4xx): nothing was collected, so the
    attempt row is closed as failed and the buyer can retry. */
function isDefinitiveRefusal(e: unknown): boolean {
  if (e instanceof XbridgeHttpError) return e.status >= 400 && e.status < 500;
  const m = /failed: (\d{3})/.exec(String((e as any)?.message ?? ''));
  return !!m && Number(m[1]) >= 400 && Number(m[1]) < 500;
}

/**
 * Send one installment attempt (its payment_transaction row already exists,
 * bound to its schedule row). On a definitive refusal the row is marked failed
 * and InstallmentAttemptRefused('provider_refused') is thrown. On a transport
 * failure the row is LEFT in 'created': the provider may have accepted it, and
 * marking it failed could orphan a real collection (the in-flight guard keeps
 * the buyer from being pushed twice; reconcilePending expires it).
 */
export async function payInstallment(sql: Sql, input: PayInstallmentInput): Promise<CollectAttemptResult> {
  try {
    if (installmentRail() === 'collection') return await collectViaCollectionApi(sql, input);
    return await payReceivable(sql, input);
  } catch (e) {
    if (isDefinitiveRefusal(e)) {
      await sql`update payment_transaction set status = 'failed', updated_at = now()
                 where transaction_id = ${input.transactionId} and status = 'created'`;
      throw new InstallmentAttemptRefused('provider_refused', 'the payment provider refused this payment — try again or use another method');
    }
    throw e;
  }
}

async function payReceivable(sql: Sql, input: PayInstallmentInput): Promise<CollectAttemptResult> {
  const receivableId = await createReceivable(sql, input.orderId);
  if (!receivableId) throw new Error('no receivable for installment order');
  const cfg = xbridgeConfig();
  if (cfg.mock) {
    return {
      orderReference: `MOCK-PAY-${input.transactionId}`,
      billPayNumber: input.method === 'billpay' ? 'MOCK-CN' : undefined,
      redirectUrl: input.method === 'card' ? 'https://mock/checkout' : undefined,
    };
  }
  // TODO(xbridge-v1): method names + response fields per the R3 sandbox.
  const json = await xbridgeRequest(`/v1/payments/receivables/${encodeURIComponent(receivableId)}/pay`, {
    method: 'POST',
    headers: { 'Idempotency-Key': input.transactionId },
    body: {
      method: input.method === 'billpay' ? 'bank' : input.method,
      amount: input.amount,
      payer: { phone: normalizeMsisdn(input.payerPhone), name: input.payerName ?? undefined },
      fspId: input.fspId,
      reference: input.transactionId,
      callbackUrl: input.callbackUrl,
    },
  }, cfg);
  return {
    orderReference: json.paymentId ?? json.id ?? undefined,
    billPayNumber: json.controlNumber ?? json.billPayNumber ?? undefined,
    redirectUrl: json.checkoutUrl ?? json.redirectUrl ?? undefined,
  };
}

/* ── parseWebhook ─────────────────────────────────────────────────────────── */

export const RECEIVABLE_EVENTS = [
  'receivable.partially_paid', 'receivable.paid', 'receivable.overpaid', 'receivable.expired',
] as const;
export type ReceivableEventType = (typeof RECEIVABLE_EVENTS)[number];

export interface ReceivableEvent {
  /** Provider event id (dedup), or null when absent (body hash is used then). */
  id: string | null;
  type: ReceivableEventType;
  receivableId: string;
  /** Our order id when x-bridge echoes the receivable reference. */
  reference: string | null;
  /** The payment that triggered the event (absent on expired). */
  payment: { id: string | null; idempotencyKey: string | null; amount: number } | null;
  /** Receivable totals after the event, when sent. */
  receivableAmount: number | null;
  paidAmount: number | null;
}

export type ParseWebhookResult =
  | { ok: true; event: ReceivableEvent }
  | { ok: false; reason: 'no_secret' | 'bad_signature' | 'bad_body' | 'unknown_type' };

/** The webhook signing secret (env, read at call time). */
export function receivableWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.XBRIDGE_WEBHOOK_SECRET || null;
}

/** Sign a raw body the way parseWebhook verifies it — `v1=<hex>`. Test seam and
    the reference for the x-bridge side. */
export function signReceivableWebhook(rawBody: string, secret: string): string {
  return 'v1=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/* TODO(xbridge-v1): the X-Bridge-Signature v1 scheme is NOT final. Implemented:
   HMAC-SHA256 over the exact raw body with XBRIDGE_WEBHOOK_SECRET, hex, in a
   header of the form "v1=<hex>" (a "t=<ts>,v1=<hex>" list is accepted and its
   v1 element compared). If x-bridge signs "<t>.<body>" or adds a replay window,
   change ONLY verifySignature. */
function verifySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const parts = String(header).split(',').map((p) => p.trim());
  const v1 = parts.map((p) => /^v1=([0-9a-fA-F]{64})$/.exec(p)?.[1]).find(Boolean);
  if (!v1) return false;
  const want = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  const got = Buffer.from(v1, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Verify the signature (fail-closed: no secret configured → refused) and decode. */
export function parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): ParseWebhookResult {
  const secret = receivableWebhookSecret();
  if (!secret) return { ok: false, reason: 'no_secret' };
  const h = headers['x-bridge-signature'] ?? headers['X-Bridge-Signature'];
  if (!verifySignature(rawBody, Array.isArray(h) ? h[0] : h, secret)) return { ok: false, reason: 'bad_signature' };
  let j: any;
  try { j = JSON.parse(rawBody); } catch { return { ok: false, reason: 'bad_body' }; }
  const type = String(j?.type ?? j?.event ?? '');
  if (!(RECEIVABLE_EVENTS as readonly string[]).includes(type)) return { ok: false, reason: 'unknown_type' };
  // TODO(xbridge-v1): field paths per the R3 sandbox; both nested (data.*) and flat shapes accepted.
  const d = j.data ?? j;
  const rcv = d.receivable ?? d;
  const pay = d.payment ?? null;
  const receivableId = String(rcv.id ?? d.receivableId ?? '');
  if (!receivableId) return { ok: false, reason: 'bad_body' };
  const payAmount = pay ? num(pay.amount) : null;
  return {
    ok: true,
    event: {
      id: j.id ? String(j.id) : null,
      type: type as ReceivableEventType,
      receivableId,
      reference: rcv.reference ? String(rcv.reference) : null,
      payment: pay && payAmount != null
        ? { id: pay.id ? String(pay.id) : null, idempotencyKey: pay.idempotencyKey ? String(pay.idempotencyKey) : (pay.reference ? String(pay.reference) : null), amount: payAmount }
        : null,
      receivableAmount: num(rcv.amount),
      paidAmount: num(rcv.paidAmount ?? rcv.amountPaid),
    },
  };
}

/* ── webhook → allocation ─────────────────────────────────────────────────── */

export interface ReceivableWebhookResult {
  http: number;
  body: Record<string, unknown>;
}

/**
 * POST /api/webhooks/xbridge/receivables, framework-free. Verify → dedup →
 * allocate through applyOutcome (the same exactly-once allocator as polling).
 *
 * - Signature missing/invalid → 401; no secret configured → 503 (fail-closed).
 * - Dedup on the provider event id (else sha256 of the body) in webhook_event.
 *   A delivery whose processing threw is NOT marked applied, so the provider's
 *   retry reprocesses it (applyOutcome is idempotent per transaction).
 * - The payment's Idempotency-Key is our transaction id. A payment Zora did not
 *   initiate (a bank control number paid directly) is bound to the next unpaid
 *   row; with no unpaid row left the money is recorded as excess owed back.
 * - receivable.overpaid → ops alert (the allocator has already recorded the
 *   excess on the plan); receivable.expired → ops alert (the BS135 default job
 *   owns the plan's fate).
 * Processing errors → 500, so x-bridge retries; this rail has no polling backstop.
 */
export async function handleReceivableWebhook(
  sql: Sql, rawBody: string, headers: Record<string, string | string[] | undefined>,
): Promise<ReceivableWebhookResult> {
  const parsed = parseWebhook(rawBody, headers);
  if (!parsed.ok) {
    const http = parsed.reason === 'no_secret' ? 503 : parsed.reason === 'bad_signature' ? 401 : 400;
    return { http, body: { error: parsed.reason } };
  }
  const ev = parsed.event;
  const dedupKey = ev.id ? `evt:${ev.id}` : `sha:${createHash('sha256').update(rawBody).digest('hex')}`;
  let [row] = await sql`
    insert into webhook_event (provider, dedup_key, transaction_id)
    values ('xbridge-receivable', ${dedupKey}, ${ev.payment?.idempotencyKey ?? null})
    on conflict (provider, dedup_key) do nothing returning id`;
  if (!row) {
    const [prev] = await sql`select id, applied from webhook_event where provider = 'xbridge-receivable' and dedup_key = ${dedupKey}`;
    if (prev?.applied) return { http: 200, body: { received: true, deduped: true } };
    row = prev; // an earlier delivery failed mid-way — reprocess
  }
  const done = async (body: Record<string, unknown>): Promise<ReceivableWebhookResult> => {
    await sql`update webhook_event set applied = true where id = ${row.id}`;
    return { http: 200, body: { received: true, ...body } };
  };

  const [plan] = await sql`select order_id from installment_plan where receivable_id = ${ev.receivableId}`;
  if (!plan) {
    await alertOps(sql, 'receivable_unknown', 'none', ev.receivableId);
    return done({ ignored: 'unknown_receivable' });
  }
  const orderId: string = plan.order_id;

  if (ev.type === 'receivable.expired') {
    await alertOps(sql, 'installment_receivable_expired', orderId, ev.receivableId);
    return done({ type: ev.type });
  }
  if (!ev.payment) return done({ type: ev.type, ignored: 'no_payment' });

  let txId: string | null = null;
  if (ev.payment.idempotencyKey) {
    const [t] = await sql`select transaction_id from payment_transaction
                           where transaction_id = ${ev.payment.idempotencyKey} and order_id = ${orderId}::uuid`;
    txId = t?.transaction_id ?? null;
  }
  if (!txId) {
    // Not initiated by Zora: bind it to the next unpaid row (amount = that row;
    // the allocator records any surplus as excess, any shortfall as short).
    const [next] = await sql`select n, amount from installment_schedule
                              where order_id = ${orderId}::uuid and status <> 'paid' order by n limit 1`;
    if (!next) {
      await sql`update installment_plan set excess_collected = excess_collected + ${Math.max(0, ev.payment.amount)}
                 where order_id = ${orderId}::uuid`;
      await alertOps(sql, 'installment_excess_unmatched', orderId, ev.payment.id ?? dedupKey);
      return done({ type: ev.type, excess: ev.payment.amount });
    }
    txId = `ZORA-RCV-${ev.payment.id ?? dedupKey}`.slice(0, 200);
    await sql`
      insert into payment_transaction (order_id, transaction_id, method, fsp_id, amount, status, schedule_n, provider)
      values (${orderId}::uuid, ${txId}, 'billpay', null, ${Number(next.amount)}, 'pending', ${Number(next.n)}, 'xbridge_v1')
      on conflict (transaction_id) do nothing`;
  }

  const status = await applyOutcome(sql, txId, 'successful', ev.payment.amount);
  if (ev.type === 'receivable.overpaid') {
    await alertOps(sql, 'installment_receivable_overpaid', orderId, `${ev.paidAmount ?? '?'}/${ev.receivableAmount ?? '?'}`);
  }
  const res = await done({ type: ev.type, transactionId: txId, orderStatus: status });
  if (status === 'paid') await notifyOrderPaid(sql, orderId);
  return res;
}
