/* BS132 installments harness — the money proof for installment orders.
   Runs @zora/core against the throwaway Postgres booted by installments.e2e.sh,
   XBRIDGE_MOCK=true so collection status is steerable per transaction.

   Covers: plan snapshot + schedule maths on a real order; schedule rejection +
   tier gating (whole order rolled back); deposit charges ONLY the deposit (A16);
   double "pay now" refused; deposit → installment_active + held → reserved (A3)
   + NO credentials (A5); out-of-order refused; earnings = collected − fee, net
   (A2); duplicate success on a paid row → excess, never double counted; short on
   a row; final → reserved → sold, passes, notify; failed deposit + retry;
   late deposit after the hold sweep (A17); seats reserved → sold; a pay-in-full
   order is untouched by scheduleN. */
'use strict';
const path = require('path');
const core = require(path.join(__dirname, '..', '..', 'packages', 'core', 'dist', 'index.js'));
const {
  db, createInstallmentOrder, readInstallmentConfig, initiatePayment, reconcile, applyOutcome,
  createGaVipOrder, readOrderMoney, sweepExpiredHolds, installmentSummary, DEFAULT_FSP_ROUTE_MAP,
  __setMockCollectionStatus, InstallmentAttemptRefused,
} = core;

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { console.error('  ✗ FAIL: ' + msg); failures++; }
}
const CALLBACK = 'http://localhost/api/webhooks/xbridge';
const ROUTE = DEFAULT_FSP_ROUTE_MAP;
const TODAY = '2026-11-01';
const EVENT_DATE = '2027-02-20'; // final due = 2027-02-13 (7 days before)

const one = async (sql, q) => (await q)[0];
const status = async (sql, id) => (await sql`select status from "order" where id = ${id}`)[0].status;
const planStatus = async (sql, id) => (await sql`select status from installment_plan where order_id = ${id}`)[0].status;
const creds = async (sql, id) => Number((await sql`select count(*)::int n from credential where order_item_id in (select id from order_item where order_id = ${id})`)[0].n);
const pool = async (sql, tier) => {
  const r = (await sql`select available_count a, sold_count s, reserved_count r from inventory_pool where product_tier_id = ${tier}`)[0];
  return { available: Number(r.a), sold: Number(r.s), reserved: Number(r.r) };
};
const complete = (tx, amount) => __setMockCollectionStatus(tx, { status: 'COMPLETED', amount: String(amount), collectedAmount: String(amount) });
const pay = (sql, orderId, extra = {}) => initiatePayment(sql, { orderId, method: 'mobile', payerPhone: '0700000009', callbackUrl: CALLBACK, routeMap: ROUTE, ...extra });
async function refused(p) {
  try { await p; return null; } catch (e) { return e instanceof InstallmentAttemptRefused ? e.code : 'other:' + e.message; }
}
async function create(sql, config, cart, phone, extra = {}) {
  return createInstallmentOrder(sql, {
    phone, email: phone + '@buyer.tz', cart, feeRate: 0.05, holdTtl: 900, commissionRate: 0.05,
    config, eventDate: EVENT_DATE, orgHandle: 'inst-org', today: TODAY, ...extra,
  });
}

(async () => {
  const sql = db();
  const config = await readInstallmentConfig(sql, 'e-inst');
  ok(config && config.enabled && config.count === 3 && config.depositPct === 30, 'config row read (30% deposit, 3 monthly payments, grace 3)');

  // ── creation + snapshot ────────────────────────────────────────────────────
  console.log('— create: plan + schedule snapshot (A19)');
  const A = await create(sql, config, [{ tier: 't-inst', quantity: 2 }], '255700000101');
  ok(A.ok === true, 'createInstallmentOrder qty 2 → ok');
  // 2 × 50000 = 100000 subtotal, fee 5% passed = 5000 → total 105000; deposit 31500; rest 73500 / 2
  ok(A.total === 105000 && A.fee === 5000, 'total 105000 = 100000 + fee 5000');
  ok(JSON.stringify(A.schedule.map((r) => r.amount)) === JSON.stringify([31500, 36750, 36750]), 'schedule 31500 / 36750 / 36750 (Σ = total)');
  ok(A.schedule.map((r) => r.dueDate).join(',') === '2026-11-01,2026-12-01,2027-01-01', 'due dates monthly from purchase');
  ok((await status(sql, A.orderId)) === 'pending', 'order stays pending until the deposit clears');
  ok((await planStatus(sql, A.orderId)) === 'pending', 'plan pending');
  const pl = await one(sql, sql`select total, service_fee, deposit, count, frequency, to_char(final_due,'YYYY-MM-DD') fd, grace_days from installment_plan where order_id = ${A.orderId}`);
  ok(Number(pl.total) === 105000 && Number(pl.service_fee) === 5000 && pl.fd === '2027-02-13' && Number(pl.grace_days) === 3, 'plan snapshot: total, service fee, final due, grace');
  let p = await pool(sql, 't-inst');
  ok(p.available === 8 && p.reserved === 0 && p.sold === 0, 'inventory HELD (available 10 → 8), nothing reserved yet');

  // config edits never touch a placed plan
  await sql`update installment_config set count = 2, deposit_pct = 50 where event_id = 'e-inst'`;
  const rows = await sql`select amount from installment_schedule where order_id = ${A.orderId} order by n`;
  ok(rows.length === 3 && Number(rows[0].amount) === 31500, 'later config edit leaves the placed schedule unchanged');
  await sql`update installment_config set count = 3, deposit_pct = 30 where event_id = 'e-inst'`;

  // ── rejection + gating roll back the whole order ──────────────────────────
  console.log('— rejection + tier gating');
  const before = Number((await one(sql, sql`select count(*)::int n from "order"`)).n);
  const late = await create(sql, config, [{ tier: 't-inst', quantity: 1 }], '255700000102', { eventDate: '2026-12-20' }); // final due 12-13 < 01-01
  ok(late.ok === false && late.reason === 'schedule_rejected' && late.code === 'does_not_fit', 'schedule past the final due date → schedule_rejected/does_not_fit');
  ok(/after the last payment date/.test(late.message || ''), 'rejection carries a readable message');
  const notOffered = await create(sql, config, [{ tier: 't-other', quantity: 1 }], '255700000103');
  ok(notOffered.ok === false && notOffered.reason === 'not_offered', 'tier outside the offer → not_offered');
  const after = Number((await one(sql, sql`select count(*)::int n from "order"`)).n);
  p = await pool(sql, 't-inst');
  ok(after === before && p.available === 8, 'rejected orders rolled back: no order row, no hold');

  // ── deposit: charges ONLY the deposit (A16) ───────────────────────────────
  console.log('— deposit (A16) + double pay-now');
  const d1 = await pay(sql, A.orderId);
  const t1 = await one(sql, sql`select amount, schedule_n from payment_transaction where transaction_id = ${d1.transactionId}`);
  ok(Number(t1.amount) === 31500 && Number(t1.schedule_n) === 1, 'deposit attempt amount 31500 bound to row 1 (NOT target 105000)');
  ok((await refused(pay(sql, A.orderId))) === 'installment_attempt_in_flight', 'second "pay now" while the first is in flight → refused');
  ok((await refused(pay(sql, A.orderId, { scheduleN: 2 }))) === 'installment_out_of_order', 'paying row 2 before the deposit → out_of_order');
  const nTx = Number((await one(sql, sql`select count(*)::int n from payment_transaction where order_id = ${A.orderId}`)).n);
  ok(nTx === 1, 'refusals wrote no attempt rows');

  complete(d1.transactionId, 31500);
  ok((await reconcile(sql, d1.transactionId)) === 'successful', 'deposit reconcile → successful');
  ok((await status(sql, A.orderId)) === 'installment_active', 'order → installment_active');
  ok((await planStatus(sql, A.orderId)) === 'active', 'plan → active');
  ok((await creds(sql, A.orderId)) === 0, 'NO credentials before full payment (A5)');
  p = await pool(sql, 't-inst');
  ok(p.available === 8 && p.reserved === 2 && p.sold === 0, 'held → RESERVED (reserved 2, sold 0) (A3)');
  const res = await one(sql, sql`select state, quantity, to_char(expires_at at time zone 'Africa/Dar_es_Salaam','YYYY-MM-DD') e from inventory_reservation where ref_type='installment' and ref_id=${A.orderId}`);
  ok(res && res.state === 'reserved' && Number(res.quantity) === 2 && res.e === '2027-02-18', 'reservation row, expires final due + grace + 1 day (safety net)');
  const hold = await one(sql, sql`select state from inventory_hold where order_id = ${A.orderId}`);
  ok(hold.state === 'reserved', 'hold row left the hold ledger (state reserved) — the hold sweep can never release it');
  const dupDeposit = await applyOutcome(sql, d1.transactionId, 'successful', 31500);
  ok(dupDeposit === null, 'replaying the deposit outcome is a no-op (txn-level guard)');

  // ── earnings = collected − fee, net (A2) ─────────────────────────────────
  console.log('— earnings by collected money (A2)');
  let money = (await readOrderMoney(sql, ['e-inst'], 0.05)).find((m) => m.orderId === A.orderId);
  ok(money && money.gross === 26500 && money.net === 25175, 'after deposit: gross = 31500 − fee 5000 = 26500, net 25175 @5%');

  // ── 2nd installment ──────────────────────────────────────────────────────
  console.log('— 2nd installment + duplicate + short');
  const d2 = await pay(sql, A.orderId);
  const t2 = await one(sql, sql`select amount, schedule_n from payment_transaction where transaction_id = ${d2.transactionId}`);
  ok(Number(t2.amount) === 36750 && Number(t2.schedule_n) === 2, '2nd attempt amount 36750 bound to row 2');
  complete(d2.transactionId, 36750);
  await reconcile(sql, d2.transactionId);
  ok((await status(sql, A.orderId)) === 'installment_active', 'still installment_active after 2 of 3');
  money = (await readOrderMoney(sql, ['e-inst'], 0.05)).find((m) => m.orderId === A.orderId);
  ok(money.gross === 63250, 'gross = 68250 collected − 5000 fee = 63250 (never the 105000 total)');

  // A second success landing on the already-paid row 2 (e.g. a control number paid twice)
  await sql`insert into payment_transaction (order_id, transaction_id, method, fsp_id, amount, status, schedule_n)
            values (${A.orderId}, 'DUP-ROW2', 'billpay', 'CLICKPESA', 36750, 'pending', 2)`;
  const dupSt = await applyOutcome(sql, 'DUP-ROW2', 'successful', 36750);
  ok(dupSt === 'installment_active', 'duplicate success on a paid row → status unchanged');
  const ex = await one(sql, sql`select excess_collected from installment_plan where order_id = ${A.orderId}`);
  ok(Number(ex.excess_collected) === 36750, 'duplicate recorded as excess owed back (36750)');
  const alert = await one(sql, sql`select count(*)::int n from webhook_event where provider='ops-alert' and dedup_key like ${'installment_duplicate_collection:' + A.orderId + '%'}`);
  ok(Number(alert.n) === 1, 'ops alerted: installment_duplicate_collection');
  money = (await readOrderMoney(sql, ['e-inst'], 0.05)).find((m) => m.orderId === A.orderId);
  ok(money.gross === 63250, 'excess is NOT organizer money (gross unchanged)');

  // short on row 3
  const d3s = await pay(sql, A.orderId);
  __setMockCollectionStatus(d3s.transactionId, { status: 'COMPLETED', amount: '36750', collectedAmount: '20000' });
  await reconcile(sql, d3s.transactionId);
  const r3 = await one(sql, sql`select status from installment_schedule where order_id = ${A.orderId} and n = 3`);
  ok(r3.status === 'due' && (await status(sql, A.orderId)) === 'installment_active', 'short payment on row 3 → row stays due, order still active');
  // a "successful" echo with a lower collected amount is ALSO short (amount echo not trusted)
  await sql`insert into payment_transaction (order_id, transaction_id, method, fsp_id, amount, status, schedule_n)
            values (${A.orderId}, 'LOW-ROW3', 'mobile', 'CLICKPESA', 36750, 'pending', 3)`;
  await applyOutcome(sql, 'LOW-ROW3', 'successful', 1000);
  const low = await one(sql, sql`select status from payment_transaction where transaction_id = 'LOW-ROW3'`);
  ok(low.status === 'partial', 'successful with collected 1000 < 36750 → partial, row not paid');

  // ── final installment ────────────────────────────────────────────────────
  console.log('— final installment → paid + passes');
  const d3 = await pay(sql, A.orderId, { scheduleN: 3, method: 'billpay' }); // 4th mobile push would hit the BS133 cap
  complete(d3.transactionId, 36750);
  await reconcile(sql, d3.transactionId);
  ok((await status(sql, A.orderId)) === 'paid', 'final cleared → order paid');
  ok((await planStatus(sql, A.orderId)) === 'completed', 'plan completed');
  ok((await creds(sql, A.orderId)) === 2, '2 credentials issued');
  p = await pool(sql, 't-inst');
  ok(p.reserved === 0 && p.sold === 2 && p.available === 8, 'reserved → SOLD (sold 2, reserved 0)');
  const notified = await one(sql, sql`select notified_at from "order" where id = ${A.orderId}`);
  ok(!!notified.notified_at, 'buyer notified like a normal paid order (notified_at set)');
  money = (await readOrderMoney(sql, ['e-inst'], 0.05)).find((m) => m.orderId === A.orderId);
  ok(money.gross === 100000 && money.status === 'paid', 'paid order reads via line items: gross 100000 (= collected − fee, no jump)');
  ok((await refused(pay(sql, A.orderId))) === 'other:order not payable (status paid)', 'paid installment order is not payable');
  const sum = await installmentSummary(sql, A.orderId);
  ok(sum.paidCount === 3 && sum.outstanding === 0, 'summary: 3 of 3 paid, 0 outstanding');

  // ── failed deposit + retry ───────────────────────────────────────────────
  console.log('— failed deposit + retry');
  const B = await create(sql, config, [{ tier: 't-inst', quantity: 1 }], '255700000104');
  const b1 = await pay(sql, B.orderId);
  __setMockCollectionStatus(b1.transactionId, { status: 'FAILED' });
  await reconcile(sql, b1.transactionId);
  ok((await status(sql, B.orderId)) === 'failed', 'failed deposit → order failed');
  p = await pool(sql, 't-inst');
  ok(p.available === 8, 'failed deposit released its hold (available back to 8)');
  const b2 = await pay(sql, B.orderId);
  const bt2 = await one(sql, sql`select amount, schedule_n from payment_transaction where transaction_id = ${b2.transactionId}`);
  ok(Number(bt2.schedule_n) === 1 && (await status(sql, B.orderId)) === 'pending', 'retry re-holds and re-binds row 1');
  complete(b2.transactionId, Number(bt2.amount));
  await reconcile(sql, b2.transactionId);
  ok((await status(sql, B.orderId)) === 'installment_active', 'retry deposit → installment_active');

  // ── late deposit after hold sweep (A17) ──────────────────────────────────
  console.log('— late deposit after the hold sweep (A17)');
  const C = await create(sql, config, [{ tier: 't-inst', quantity: 1 }], '255700000105');
  const c1 = await pay(sql, C.orderId);
  await sql`update inventory_hold set expires_at = now() - interval '1 minute' where order_id = ${C.orderId}`;
  await sweepExpiredHolds(sql);
  ok((await status(sql, C.orderId)) === 'expired', 'hold swept → order expired');
  const pc = await pool(sql, 't-inst');
  complete(c1.transactionId, Number((await one(sql, sql`select amount from payment_transaction where transaction_id=${c1.transactionId}`)).amount));
  await reconcile(sql, c1.transactionId);
  ok((await status(sql, C.orderId)) === 'installment_active', 'late deposit re-reserved stock → installment_active');
  const pc2 = await pool(sql, 't-inst');
  ok(pc2.available === pc.available - 1 && pc2.reserved === pc.reserved + 1, 'available → reserved for the late deposit');

  // late deposit when the stock is gone → paid_unseatable, nothing resold
  const D = await create(sql, config, [{ tier: 't-tiny', quantity: 1 }], '255700000106');
  const dd = await pay(sql, D.orderId);
  await sql`update inventory_hold set expires_at = now() - interval '1 minute' where order_id = ${D.orderId}`;
  await sweepExpiredHolds(sql);
  const E = await createGaVipOrder(sql, { phone: '255700000107', email: 'e@b.tz', cart: [{ tier: 't-tiny', quantity: 1 }], feeRate: 0, holdTtl: 900 });
  ok(E.ok, 'someone else bought the last t-tiny');
  complete(dd.transactionId, Number((await one(sql, sql`select amount from payment_transaction where transaction_id=${dd.transactionId}`)).amount));
  await reconcile(sql, dd.transactionId);
  ok((await status(sql, D.orderId)) === 'paid_unseatable', 'late deposit with stock gone → paid_unseatable (ops refund), never oversold');
  ok((await planStatus(sql, D.orderId)) === 'cancelled', 'its plan cancelled');

  // ── seats ────────────────────────────────────────────────────────────────
  console.log('— seats: held → reserved → sold');
  const S = await create(sql, config, [{ tier: 't-seat', quantity: 1, seatIds: ['z1-A1', 'z1-A2'] }], '255700000108');
  ok(S.ok === true, 'seated installment order ok');
  const s1 = await pay(sql, S.orderId);
  complete(s1.transactionId, S.deposit);
  await reconcile(sql, s1.transactionId);
  let seats = await sql`select seat_id, state, hold_order_id, sold_order_id from seat_inventory where hold_order_id = ${S.orderId} or sold_order_id = ${S.orderId} order by seat_id`;
  ok(seats.length === 2 && seats.every((x) => x.state === 'reserved' && x.hold_order_id === S.orderId), 'deposit → both seats reserved for the order');
  await sql`update seat_inventory set hold_expires_at = now() - interval '1 hour' where hold_order_id = ${S.orderId}`;
  await sweepExpiredHolds(sql);
  seats = await sql`select state from seat_inventory where hold_order_id = ${S.orderId}`;
  ok(seats.length === 2 && seats.every((x) => x.state === 'reserved'), 'the seat-hold sweep never releases a reserved seat');
  for (const n of [2, 3]) {
    const a = await pay(sql, S.orderId);
    complete(a.transactionId, Number((await one(sql, sql`select amount from payment_transaction where transaction_id=${a.transactionId}`)).amount));
    await reconcile(sql, a.transactionId);
  }
  seats = await sql`select state, sold_order_id from seat_inventory where sold_order_id = ${S.orderId}`;
  ok((await status(sql, S.orderId)) === 'paid' && seats.length === 2 && seats.every((x) => x.state === 'sold'), 'final → order paid, seats sold');
  const sc = await sql`select seat_id from credential where order_item_id in (select id from order_item where order_id = ${S.orderId}) order by seat_id`;
  ok(sc.length === 2 && sc[0].seat_id === 'z1-A1', 'credentials name their seats');

  // ── pay-in-full is untouched ─────────────────────────────────────────────
  console.log('— pay-in-full order unaffected');
  const F = await createGaVipOrder(sql, { phone: '255700000109', email: 'f@b.tz', cart: [{ tier: 't-inst', quantity: 1 }], feeRate: 0.05, holdTtl: 900 });
  ok((await refused(pay(sql, F.orderId, { scheduleN: 1 }))) === 'not_installment_order', 'scheduleN on a pay-in-full order → refused');
  const f1 = await pay(sql, F.orderId);
  const ft = await one(sql, sql`select amount, schedule_n from payment_transaction where transaction_id = ${f1.transactionId}`);
  ok(Number(ft.amount) === 52500 && ft.schedule_n === null, 'pay-in-full attempt charges target_value 52500, no schedule_n');
  complete(f1.transactionId, 52500);
  await reconcile(sql, f1.transactionId);
  ok((await status(sql, F.orderId)) === 'paid' && (await creds(sql, F.orderId)) === 1, 'pay-in-full → paid + 1 credential');

  await sql.end({ timeout: 5 });
  if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nBS132 INSTALLMENTS HARNESS: PASS');
})().catch((e) => { console.error(e); process.exit(1); });
