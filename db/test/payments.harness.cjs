/* PR-9 payment state-machine harness — the apply-exactly-once correctness proof.
   Runs @zora/core's payment service against the throwaway Postgres booted by
   payments.e2e.sh, with XBRIDGE_MOCK=true so collection status is steerable via
   __setMockCollectionStatus. Required env: DATABASE_URL, TICKET_SIGNING_KEY,
   XBRIDGE_MOCK=true. Loads the built dist by absolute path.

   The full payment failure matrix (see the plan): happy, terminal-guard duplicate,
   duplicate-collection by a different txn, short, failed, paid_unseatable, and
   webhook dedup. Pool cap = 3. */
'use strict';
const path = require('path');
const { createHash } = require('crypto');
const core = require(path.join(__dirname, '..', '..', 'packages', 'core', 'dist', 'index.js'));
const {
  db, createGaVipOrder, initiatePayment, reconcile, applyOutcome, resolveTransactionId,
  convertHolds, releaseHolds, DEFAULT_FSP_ROUTE_MAP,
  __setMockCollectionStatus, __clearMockCollectionStatus, closeDb,
} = core;

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log('  ✓ ' + msg); }
  else { console.error('  ✗ FAIL: ' + msg); failures++; }
}

const CALLBACK = 'http://localhost/api/webhooks/xbridge';
const ROUTE = DEFAULT_FSP_ROUTE_MAP;

async function targetValue(sql, orderId) {
  return Number((await sql`select target_value from "order" where id = ${orderId}`)[0].target_value);
}
async function orderStatus(sql, orderId) {
  return (await sql`select status from "order" where id = ${orderId}`)[0].status;
}
async function credCount(sql, orderId) {
  return Number((await sql`
    select count(*)::int n from credential
     where order_item_id in (select id from order_item where order_id = ${orderId})`)[0].n);
}
async function pool(sql) {
  const r = (await sql`select available_count a, sold_count s, blocked_count b from inventory_pool where product_tier_id = 't-ga'`)[0];
  return { available: Number(r.a), sold: Number(r.s) };
}
function forceCompleted(txId, amount) {
  __setMockCollectionStatus(txId, { status: 'COMPLETED', amount: String(amount), collectedAmount: String(amount) });
}

/** Faithful mirror of the /api/webhooks/xbridge handler dedup path. */
async function applyWebhook(sql, rawBody) {
  const dedupKey = createHash('sha256').update(rawBody).digest('hex');
  const transactionId = await resolveTransactionId(sql, rawBody);
  const [inserted] = await sql`
    insert into webhook_event (provider, dedup_key, transaction_id)
    values ('bridge', ${dedupKey}, ${transactionId})
    on conflict (provider, dedup_key) do nothing returning id`;
  if (!inserted) return { deduped: true };
  if (transactionId) await reconcile(sql, transactionId);
  await sql`update webhook_event set applied = true where id = ${inserted.id}`;
  return { deduped: false };
}

(async () => {
  const sql = db();

  // ── happy: qty 2 → COMPLETED (collected == target) → order paid ────────────
  const H = await createGaVipOrder(sql, {
    phone: '255700000001', email: 'h@buyer.tz',
    cart: [{ tier: 't-ga', quantity: 2 }], feeRate: 0.05, holdTtl: 900,
  });
  ok(H.ok === true, 'happy: createGaVipOrder qty 2 -> ok');
  const hTarget = await targetValue(sql, H.orderId);
  const hInit = await initiatePayment(sql, { orderId: H.orderId, method: 'mobile', payerPhone: '0700000001', callbackUrl: CALLBACK, routeMap: ROUTE });
  ok(hInit.status === 'pending', 'happy: initiatePayment -> pending');
  ok(/^ZORA-.*-1$/.test(hInit.transactionId), 'happy: transactionId = ZORA-<order>-1 (first attempt)');

  forceCompleted(hInit.transactionId, hTarget);
  const hOutcome = await reconcile(sql, hInit.transactionId);
  ok(hOutcome === 'successful', 'happy: reconcile -> successful');
  ok((await orderStatus(sql, H.orderId)) === 'paid', 'happy: order.status = paid');
  ok((await credCount(sql, H.orderId)) === 2, 'happy: 2 credentials issued');
  let p = await pool(sql);
  ok(p.sold === 2 && p.available === 1, 'happy: holds converted -> sold 2 / available 1');
  const hCollected = Number((await sql`select collected_amount from payment_transaction where transaction_id = ${hInit.transactionId}`)[0].collected_amount);
  ok(hCollected === hTarget, 'happy: collected_amount recorded = target');

  // ── (a) terminal guard: applyOutcome again on the SAME txn -> no-op ─────────
  const aRes = await applyOutcome(sql, hInit.transactionId, 'successful', hTarget);
  ok(aRes === null, '(a) applyOutcome on already-terminal txn -> null (no-op)');
  ok((await credCount(sql, H.orderId)) === 2, '(a) still exactly 2 credentials (no reissue)');
  ok((await orderStatus(sql, H.orderId)) === 'paid', '(a) order stays paid');

  // ── (b) duplicate collection: a SECOND different txn COMPLETED on paid order ─
  const tx2 = `ZORA-${H.orderId}-DUP`;
  await sql`insert into payment_transaction (order_id, transaction_id, method, fsp_id, amount, status)
            values (${H.orderId}, ${tx2}, 'billpay', 'CLICKPESA', ${hTarget}, 'pending')`;
  forceCompleted(tx2, hTarget);
  await reconcile(sql, tx2);
  ok((await orderStatus(sql, H.orderId)) === 'paid', '(b) order stays paid after 2nd settlement');
  ok((await credCount(sql, H.orderId)) === 2, '(b) NO reissue (still 2 credentials)');
  const dupAlert = Number((await sql`select count(*)::int n from webhook_event
    where provider = 'ops-alert' and dedup_key like ${'duplicate_collection:' + H.orderId + ':%'}`)[0].n);
  ok(dupAlert === 1, "(b) a 'duplicate_collection' ops-alert row exists");
  const tx2status = (await sql`select status from payment_transaction where transaction_id = ${tx2}`)[0].status;
  ok(tx2status === 'successful', '(b) the duplicate txn itself is marked successful (for refund)');

  // ── (c) short: collected < target on a fresh order -> payment_short ─────────
  const C = await createGaVipOrder(sql, {
    phone: '255700000003', email: 'c@buyer.tz',
    cart: [{ tier: 't-ga', quantity: 1 }], feeRate: 0.05, holdTtl: 900,
  });
  ok(C.ok === true, '(c) fresh order qty 1 -> ok');
  const cTarget = await targetValue(sql, C.orderId);
  const cInit = await initiatePayment(sql, { orderId: C.orderId, method: 'mobile', payerPhone: '0700000003', callbackUrl: CALLBACK, routeMap: ROUTE });
  __setMockCollectionStatus(cInit.transactionId, { status: 'COMPLETED', amount: String(cTarget), collectedAmount: String(cTarget - 1000) });
  const cOutcome = await reconcile(sql, cInit.transactionId);
  ok(cOutcome === 'short', '(c) reconcile -> short (collected < target)');
  ok((await orderStatus(sql, C.orderId)) === 'payment_short', '(c) order.status = payment_short');
  ok((await credCount(sql, C.orderId)) === 0, '(c) 0 credentials');
  const shortAlert = Number((await sql`select count(*)::int n from webhook_event
    where provider = 'ops-alert' and dedup_key like ${'payment_short:' + C.orderId + ':%'}`)[0].n);
  ok(shortAlert === 1, "(c) a 'payment_short' ops-alert row exists");
  // reset stock: release the short order's hold so the next cases have a unit.
  await releaseHolds(sql, C.orderId);

  // ── (d) failed: on a fresh order -> order failed, holds released ────────────
  const availBeforeD = (await pool(sql)).available;
  const D = await createGaVipOrder(sql, {
    phone: '255700000004', email: 'd@buyer.tz',
    cart: [{ tier: 't-ga', quantity: 1 }], feeRate: 0.05, holdTtl: 900,
  });
  ok(D.ok === true, '(d) fresh order qty 1 -> ok');
  ok((await pool(sql)).available === availBeforeD - 1, '(d) hold placed -> available -1');
  const dInit = await initiatePayment(sql, { orderId: D.orderId, method: 'mobile', payerPhone: '0700000004', callbackUrl: CALLBACK, routeMap: ROUTE });
  __setMockCollectionStatus(dInit.transactionId, { status: 'FAILED' });
  const dOutcome = await reconcile(sql, dInit.transactionId);
  ok(dOutcome === 'failed', '(d) reconcile -> failed');
  ok((await orderStatus(sql, D.orderId)) === 'failed', '(d) order.status = failed');
  ok((await pool(sql)).available === availBeforeD, '(d) holds released -> available restored');
  ok((await credCount(sql, D.orderId)) === 0, '(d) 0 credentials');

  // ── (e) paid_unseatable: holds released + stock exhausted, then COMPLETED ───
  const E = await createGaVipOrder(sql, {
    phone: '255700000005', email: 'e@buyer.tz',
    cart: [{ tier: 't-ga', quantity: 1 }], feeRate: 0.05, holdTtl: 900,
  });
  ok(E.ok === true, '(e) fresh order qty 1 -> ok');
  const eTarget = await targetValue(sql, E.orderId);
  const eInit = await initiatePayment(sql, { orderId: E.orderId, method: 'mobile', payerPhone: '0700000005', callbackUrl: CALLBACK, routeMap: ROUTE });
  // Simulate the checkout hold lapsing BEFORE settlement.
  await releaseHolds(sql, E.orderId);
  // Exhaust the remaining stock so try_reacquire cannot re-take it (a blocker order).
  const B = await createGaVipOrder(sql, {
    phone: '255700000009', email: 'blocker@buyer.tz',
    cart: [{ tier: 't-ga', quantity: 1 }], feeRate: 0.05, holdTtl: 900,
  });
  ok(B.ok === true, '(e) blocker order takes the last unit');
  const bConv = await convertHolds(sql, B.orderId);
  ok(bConv === 1, '(e) blocker converted -> stock exhausted');
  ok((await pool(sql)).available === 0, '(e) available now 0 (reacquire will fail)');

  forceCompleted(eInit.transactionId, eTarget);
  const eOutcome = await reconcile(sql, eInit.transactionId);
  ok(eOutcome === 'successful', '(e) reconcile maps -> successful (gateway collected)');
  ok((await orderStatus(sql, E.orderId)) === 'paid_unseatable', '(e) order.status = paid_unseatable');
  ok((await credCount(sql, E.orderId)) === 0, '(e) 0 credentials issued (anti-oversell)');
  const unseatAlert = Number((await sql`select count(*)::int n from webhook_event
    where provider = 'ops-alert' and dedup_key like ${'paid_unseatable:' + E.orderId + ':%'}`)[0].n);
  ok(unseatAlert === 1, "(e) a 'paid_unseatable' ops-alert row exists");

  // ── (f) webhook dedup: same rawBody applied twice -> second is deduped ──────
  const rawBody = JSON.stringify({ transid: hInit.transactionId, status: 'COMPLETED' });
  const first = await applyWebhook(sql, rawBody);
  ok(first.deduped === false, '(f) first webhook delivery applies (not deduped)');
  const second = await applyWebhook(sql, rawBody);
  ok(second.deduped === true, '(f) identical second delivery is deduped (no second reconcile)');
  const bridgeRows = Number((await sql`select count(*)::int n from webhook_event
    where provider = 'bridge' and dedup_key = ${createHash('sha256').update(rawBody).digest('hex')}`)[0].n);
  ok(bridgeRows === 1, '(f) exactly one bridge webhook_event row for the dedup key');

  __clearMockCollectionStatus();
  await closeDb();
  if (failures) { console.error('\n' + failures + ' assertion(s) failed'); process.exit(1); }
  console.log('\n  all payment failure-matrix assertions hold');
})().catch((e) => { console.error(e); process.exit(1); });
