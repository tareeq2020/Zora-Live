/* BS133 installment provider harness. Runs @zora/core against the throwaway
   Postgres from installments-provider.e2e.sh (XBRIDGE_MOCK=true). The rail is
   switched per section by setting process.env.XBRIDGE_V1 (read at call time).

   Proves: webhook signature (good / bad / missing secret); collection rail +
   push rate limit (3 per order per 10 min); v1 rail: receivable created once
   (idempotent), attempts tagged xbridge_v1 and never polled, signed webhooks
   allocate per installment, replay deduped, a failed delivery is reprocessed,
   unmatched control-number payment bound to the next row, overpaid → excess +
   alert, payment after completion → excess, expired → alert; a provider 4xx
   refusal closes the attempt so the buyer can retry. */
'use strict';
const path = require('path');
const core = require(path.join(__dirname, '..', '..', 'packages', 'core', 'dist', 'index.js'));
const {
  db, createInstallmentOrder, readInstallmentConfig, initiatePayment, reconcile, createReceivable,
  parseWebhook, signReceivableWebhook, handleReceivableWebhook, DEFAULT_FSP_ROUTE_MAP,
  __setMockCollectionStatus, InstallmentAttemptRefused,
} = core;

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { console.error('  ✗ FAIL: ' + msg); failures++; }
}
const SECRET = process.env.XBRIDGE_WEBHOOK_SECRET;
const one = async (q) => (await q)[0];
const status = async (sql, id) => (await one(sql`select status from "order" where id = ${id}`)).status;
const pay = (sql, orderId, extra = {}) => initiatePayment(sql, {
  orderId, method: 'mobile', payerPhone: '0700000077', callbackUrl: 'http://x', routeMap: DEFAULT_FSP_ROUTE_MAP, ...extra,
});
async function refused(p) {
  try { await p; return null; } catch (e) { return e instanceof InstallmentAttemptRefused ? e.code : 'other:' + e.message; }
}
let seq = 0;
async function newOrder(sql, phone) {
  const config = await readInstallmentConfig(sql, 'e-prov');
  const r = await createInstallmentOrder(sql, {
    phone, email: phone + '@b.tz', cart: [{ tier: 't-prov', quantity: 1 }], feeRate: 0, holdTtl: 900, commissionRate: 0.05,
    config, eventDate: '2027-03-01', orgHandle: 'prov-org', today: '2026-11-01',
  });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r;
}
function hook(sql, body, sig) {
  const raw = JSON.stringify(body);
  return handleReceivableWebhook(sql, raw, { 'x-bridge-signature': sig === undefined ? signReceivableWebhook(raw, SECRET) : sig });
}
const evt = (type, receivableId, payment, extra = {}) => ({
  id: 'evt_' + (++seq), type,
  data: { receivable: { id: receivableId, reference: null, amount: 60000, paidAmount: extra.paidAmount ?? null }, ...(payment ? { payment } : {}) },
});

(async () => {
  const sql = db();

  // ── signature ─────────────────────────────────────────────────────────────
  console.log('— webhook signature (HMAC-SHA256 over the raw body, v1=)');
  const raw = JSON.stringify({ id: 'e1', type: 'receivable.paid', data: { receivable: { id: 'R1' } } });
  ok(parseWebhook(raw, { 'x-bridge-signature': signReceivableWebhook(raw, SECRET) }).ok === true, 'valid signature → parsed');
  ok(parseWebhook(raw, { 'x-bridge-signature': 't=123,' + signReceivableWebhook(raw, SECRET) }).ok === true, '"t=…,v1=…" list accepted');
  ok(parseWebhook(raw, { 'x-bridge-signature': signReceivableWebhook(raw, 'wrong') }).reason === 'bad_signature', 'wrong secret → bad_signature');
  ok(parseWebhook(raw + ' ', { 'x-bridge-signature': signReceivableWebhook(raw, SECRET) }).reason === 'bad_signature', 'body changed by one byte → bad_signature');
  ok(parseWebhook(raw, {}).reason === 'bad_signature', 'no header → bad_signature');
  const saved = process.env.XBRIDGE_WEBHOOK_SECRET; delete process.env.XBRIDGE_WEBHOOK_SECRET;
  ok(parseWebhook(raw, { 'x-bridge-signature': signReceivableWebhook(raw, SECRET) }).reason === 'no_secret', 'no secret configured → refused (fail-closed)');
  process.env.XBRIDGE_WEBHOOK_SECRET = saved;
  const unk = JSON.stringify({ type: 'receivable.refunded', data: { receivable: { id: 'R1' } } });
  ok(parseWebhook(unk, { 'x-bridge-signature': signReceivableWebhook(unk, SECRET) }).reason === 'unknown_type', 'unknown event type → refused');

  // ── collection rail + push rate limit ────────────────────────────────────
  console.log('— collection rail (default) + push rate limit');
  delete process.env.XBRIDGE_V1;
  const A = await newOrder(sql, '255700000201');
  for (let i = 1; i <= 3; i++) {
    const a = await pay(sql, A.orderId);
    const t = await one(sql`select provider, amount from payment_transaction where transaction_id = ${a.transactionId}`);
    if (i === 1) ok(t.provider === null && Number(t.amount) === A.deposit, 'collection rail: provider NULL, amount = deposit');
    __setMockCollectionStatus(a.transactionId, { status: 'FAILED' });
    await reconcile(sql, a.transactionId);
  }
  ok((await refused(pay(sql, A.orderId))) === 'push_rate_limited', '4th mobile push inside 10 min → push_rate_limited');
  try { await pay(sql, A.orderId); } catch (e) { ok(e.retryAfterSecs > 0 && e.retryAfterSecs <= 600, `refusal carries retryAfter (${e.retryAfterSecs}s)`); }
  const bp = await pay(sql, A.orderId, { method: 'billpay' });
  ok(!!bp.billPayNumber, 'control number (billpay) is still allowed — the cap is on mobile pushes');
  await sql`update payment_transaction set created_at = now() - interval '11 minutes' where order_id = ${A.orderId} and method = 'mobile'`;
  __setMockCollectionStatus(bp.transactionId, { status: 'FAILED' });
  await reconcile(sql, bp.transactionId);
  ok((await refused(pay(sql, A.orderId))) === null, 'after the 10-minute window a push is allowed again');

  // ── v1 rail ─────────────────────────────────────────────────────────────
  console.log('— x-bridge /v1 receivables rail (XBRIDGE_V1=1, mock)');
  process.env.XBRIDGE_V1 = '1';
  const B = await newOrder(sql, '255700000202');
  const b1 = await pay(sql, B.orderId);
  const bt1 = await one(sql`select provider, amount, order_reference from payment_transaction where transaction_id = ${b1.transactionId}`);
  ok(bt1.provider === 'xbridge_v1' && Number(bt1.amount) === B.deposit, 'v1 attempt tagged xbridge_v1, amount = deposit');
  ok(bt1.order_reference === 'MOCK-PAY-' + b1.transactionId, 'pay went to the receivable (mock payment id stored)');
  const rcv = (await one(sql`select receivable_id from installment_plan where order_id = ${B.orderId}`)).receivable_id;
  ok(rcv === 'MOCK-RCV-' + B.orderId, 'receivable created and stored on the plan');
  ok((await createReceivable(sql, B.orderId)) === rcv, 'createReceivable is idempotent (same id)');
  ok((await reconcile(sql, b1.transactionId)) === 'pending' && (await status(sql, B.orderId)) === 'pending', 'v1 attempts are never polled via /collection/status');

  const e1 = evt('receivable.partially_paid', rcv, { id: 'pay_1', idempotencyKey: b1.transactionId, amount: B.deposit });
  let r = await hook(sql, e1);
  ok(r.http === 200 && (await status(sql, B.orderId)) === 'installment_active', 'signed partially_paid webhook → deposit allocated → installment_active');
  r = await hook(sql, e1);
  ok(r.http === 200 && r.body.deduped === true, 'replayed webhook → deduped');
  r = await hook(sql, evt('receivable.partially_paid', rcv, { id: 'pay_x', idempotencyKey: b1.transactionId, amount: 1 }), 'v1=' + '0'.repeat(64));
  ok(r.http === 401, 'bad signature → 401, nothing applied');

  // a delivery that failed mid-way (row exists, applied=false) is reprocessed
  const b2 = await pay(sql, B.orderId);
  const e2 = evt('receivable.partially_paid', rcv, { id: 'pay_2', idempotencyKey: b2.transactionId, amount: B.schedule[1].amount });
  await sql`insert into webhook_event (provider, dedup_key, transaction_id, applied) values ('xbridge-receivable', ${'evt:' + e2.id}, ${b2.transactionId}, false)`;
  r = await hook(sql, e2);
  ok(r.http === 200 && !r.body.deduped, 'an un-applied earlier delivery is reprocessed, not deduped');
  const row2 = await one(sql`select status from installment_schedule where order_id = ${B.orderId} and n = 2`);
  ok(row2.status === 'paid', 'row 2 paid');

  // final row paid by a control number Zora did not initiate, overpaying by 500
  const last = B.schedule[2].amount;
  r = await hook(sql, evt('receivable.overpaid', rcv, { id: 'pay_bank', idempotencyKey: null, amount: last + 500 }, { paidAmount: 60500 }));
  ok(r.http === 200 && (await status(sql, B.orderId)) === 'paid', 'unmatched control-number payment bound to the last row → order paid');
  const pl = await one(sql`select status, excess_collected from installment_plan where order_id = ${B.orderId}`);
  ok(pl.status === 'completed' && Number(pl.excess_collected) === 500, 'overpaid: 500 recorded as excess owed back');
  const alerts = (await sql`select dedup_key from webhook_event where provider='ops-alert' and dedup_key like ${'%' + B.orderId + '%'}`).map((x) => x.dedup_key.split(':')[0]);
  ok(alerts.includes('installment_receivable_overpaid') && alerts.includes('installment_overpaid'), 'ops alerted: receivable overpaid');
  ok(!!(await one(sql`select notified_at from "order" where id = ${B.orderId}`)).notified_at, 'buyer notified on completion via webhook');
  ok(Number((await one(sql`select count(*)::int n from credential where order_item_id in (select id from order_item where order_id = ${B.orderId})`)).n) === 1, 'pass issued');

  r = await hook(sql, evt('receivable.partially_paid', rcv, { id: 'pay_after', idempotencyKey: null, amount: 7000 }));
  const pl2 = await one(sql`select excess_collected from installment_plan where order_id = ${B.orderId}`);
  ok(r.http === 200 && Number(pl2.excess_collected) === 7500, 'payment after completion → whole amount recorded as excess');
  r = await hook(sql, evt('receivable.expired', rcv, null));
  ok(r.http === 200, 'expired → 200');
  const exp = await one(sql`select count(*)::int n from webhook_event where provider='ops-alert' and dedup_key like ${'installment_receivable_expired:' + B.orderId + '%'}`);
  ok(Number(exp.n) === 1, 'expired → ops alert');
  r = await hook(sql, evt('receivable.paid', 'NOPE', { id: 'p', idempotencyKey: null, amount: 1 }));
  ok(r.http === 200 && r.body.ignored === 'unknown_receivable', 'unknown receivable → acknowledged + alerted, nothing allocated');

  // provider 4xx refusal closes the attempt so the buyer can retry
  console.log('— provider refusal');
  delete process.env.XBRIDGE_V1;
  const C = await newOrder(sql, '255700000203');
  const realFetch = global.fetch;
  process.env.XBRIDGE_MOCK = 'false'; process.env.XBRIDGE_KEY_ID = 'k'; process.env.XBRIDGE_SECRET = 's';
  global.fetch = async (url) => String(url).endsWith('/generate-token')
    ? new Response(JSON.stringify({ token: 't', expiresAt: new Date(Date.now() + 3600e3).toISOString() }), { status: 200 })
    : new Response('{"error":"payer_blocked"}', { status: 422 });
  ok((await refused(pay(sql, C.orderId))) === 'provider_refused', 'gateway 422 → provider_refused');
  const ct = await one(sql`select status from payment_transaction where order_id = ${C.orderId} order by created_at desc limit 1`);
  ok(ct.status === 'failed', 'refused attempt closed as failed (not left in flight)');
  global.fetch = async (url) => String(url).endsWith('/generate-token')
    ? new Response(JSON.stringify({ token: 't', expiresAt: new Date(Date.now() + 3600e3).toISOString() }), { status: 200 })
    : (() => { throw new Error('ECONNRESET'); })();
  ok((await refused(pay(sql, C.orderId))).startsWith('other:'), 'transport failure → error surfaced');
  const ct2 = await one(sql`select status from payment_transaction where order_id = ${C.orderId} order by created_at desc limit 1`);
  ok(ct2.status === 'created', 'transport failure leaves the attempt in flight (it may have reached the provider)');
  ok((await refused(pay(sql, C.orderId))) === 'installment_attempt_in_flight', '…so a second push is refused rather than risking a double charge');
  global.fetch = realFetch; process.env.XBRIDGE_MOCK = 'true';

  await sql.end({ timeout: 5 });
  if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nBS133 PROVIDER HARNESS: PASS');
})().catch((e) => { console.error(e); process.exit(1); });
