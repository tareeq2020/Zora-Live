/* BS135 installment jobs harness — reminders + locked default close (A18).
   Runs @zora/core against the throwaway Postgres from installments-jobs.e2e.sh
   (XBRIDGE_MOCK=true, SMS/email mock). Time is simulated by passing `now`.

   Offer: 30% deposit, 3 weekly payments, grace 2 days. Bought 2026-11-01 →
   due 11-01 (deposit) / 11-08 / 11-15; row 2 is past grace from 11-11.

   Proves: deposit → 2nd → final → passes (with a double pay-now refused);
   reminders 3 days before / on the day / once on miss, one per order per day,
   quiet hours, idempotent re-runs; miss + grace → closing → defaulted with
   reservation + seats back, refund owed = paid − service fee recorded and
   alerted, buyer told once, late money → excess; a payment in flight while the
   default runs holds the close, paying it reopens the plan, failing it defaults,
   and a close stuck past 24h finishes anyway. */
'use strict';
const path = require('path');
const core = require(path.join(__dirname, '..', '..', 'packages', 'core', 'dist', 'index.js'));
const {
  db, createInstallmentOrder, readInstallmentConfig, initiatePayment, reconcile, applyOutcome, readOrderMoney,
  sendInstallmentReminders, closeDefaultedPlans, runInstallmentJobs, recordInstallmentRefund, cancelStalePendingPlans,
  sweepExpiredHolds, DEFAULT_FSP_ROUTE_MAP, __setMockCollectionStatus, InstallmentAttemptRefused,
} = core;

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { console.error('  ✗ FAIL: ' + msg); failures++; }
}
const one = async (q) => (await q)[0];
const status = async (sql, id) => (await one(sql`select status from "order" where id = ${id}`)).status;
const plan = async (sql, id) => one(sql`select * from installment_plan where order_id = ${id}`);
const pool = async (sql) => {
  const r = await one(sql`select available_count a, sold_count s, reserved_count r from inventory_pool where product_tier_id = 't-job'`);
  return { available: Number(r.a), sold: Number(r.s), reserved: Number(r.r) };
};
const at = (date, hourEat = 10) => new Date(`${date}T${String(hourEat - 3).padStart(2, '0')}:00:00Z`);
const pay = (sql, orderId, extra = {}) => initiatePayment(sql, {
  orderId, method: 'billpay', payerPhone: '0700000088', callbackUrl: 'http://x', routeMap: DEFAULT_FSP_ROUTE_MAP, ...extra,
});
async function settle(sql, txId, outcome = 'COMPLETED') {
  const [t] = await sql`select amount from payment_transaction where transaction_id = ${txId}`;
  __setMockCollectionStatus(txId, outcome === 'COMPLETED'
    ? { status: 'COMPLETED', amount: String(t.amount), collectedAmount: String(t.amount) }
    : { status: outcome });
  return reconcile(sql, txId);
}
async function refused(p) {
  try { await p; return null; } catch (e) { return e instanceof InstallmentAttemptRefused ? e.code : 'other:' + e.message; }
}
async function newActive(sql, phone, cart = [{ tier: 't-job', quantity: 1 }]) {
  const config = await readInstallmentConfig(sql, 'e-job');
  const r = await createInstallmentOrder(sql, {
    phone, email: phone + '@b.tz', cart, feeRate: 0.05, holdTtl: 900, commissionRate: 0.05,
    config, eventDate: '2027-01-31', orgHandle: 'job-org', today: '2026-11-01',
  });
  if (!r.ok) throw new Error(JSON.stringify(r));
  const d = await pay(sql, r.orderId);
  await settle(sql, d.transactionId);
  return r;
}
const reminderCount = async (sql, orderId) => Number((await one(sql`
  select count(*)::int n from webhook_event where provider = 'installment-reminder' and dedup_key like ${'row:' + orderId + '%'}`)).n);

(async () => {
  const sql = db();

  // ── full flow ──────────────────────────────────────────────────────────────
  console.log('— deposit → 2nd → final → passes');
  const A = await newActive(sql, '255700000301');
  ok((await status(sql, A.orderId)) === 'installment_active', 'deposit → installment_active');
  const a2 = await pay(sql, A.orderId);
  await settle(sql, a2.transactionId);
  const a3 = await pay(sql, A.orderId);
  ok((await refused(pay(sql, A.orderId))) === 'installment_attempt_in_flight', 'double "pay now" on the final installment → refused');
  await settle(sql, a3.transactionId);
  ok((await status(sql, A.orderId)) === 'paid', 'final → paid');
  ok(Number((await one(sql`select count(*)::int n from credential where order_item_id in (select id from order_item where order_id = ${A.orderId})`)).n) === 1, 'pass issued');

  // ── reminders ─────────────────────────────────────────────────────────────
  console.log('— reminders (3 days before, on the day, once on miss; ≤1/order/day)');
  const B = await newActive(sql, '255700000302');
  // Other plans exist (C, D below are created later); count per order B.
  let n = await sendInstallmentReminders(sql, at('2026-11-05'));
  ok((await reminderCount(sql, B.orderId)) === 1, '11-05 (3 days before row 2) → 1 reminder');
  await sendInstallmentReminders(sql, at('2026-11-05', 15));
  ok((await reminderCount(sql, B.orderId)) === 1, 'same day again → none (idempotent)');
  await sendInstallmentReminders(sql, at('2026-11-06'));
  ok((await reminderCount(sql, B.orderId)) === 1, '11-06 → none (nothing due)');
  await sendInstallmentReminders(sql, at('2026-11-08', 22));
  ok((await reminderCount(sql, B.orderId)) === 1, '11-08 22:00 EAT → none (quiet hours)');
  await sendInstallmentReminders(sql, at('2026-11-08'));
  ok((await reminderCount(sql, B.orderId)) === 2, '11-08 (due date) → due-day nudge');
  await sendInstallmentReminders(sql, at('2026-11-09'));
  ok((await reminderCount(sql, B.orderId)) === 3, '11-09 → missed reminder');
  const r2 = await one(sql`select status from installment_schedule where order_id = ${B.orderId} and n = 2`);
  ok(r2.status === 'missed', 'row 2 marked missed (still payable in grace)');
  await sendInstallmentReminders(sql, at('2026-11-10'));
  ok((await reminderCount(sql, B.orderId)) === 3, '11-10 → none (missed is reminded once)');
  const b2 = await pay(sql, B.orderId);
  ok(!!b2.transactionId, 'a missed row can still be paid during grace');
  await settle(sql, b2.transactionId);
  await sendInstallmentReminders(sql, at('2026-11-12'));
  ok((await reminderCount(sql, B.orderId)) === 4, '11-12 → row 3 reminder (3 days before 11-15) — row 2 history does not block it');
  const day = Number((await one(sql`select count(*)::int n from webhook_event where provider='installment-reminder' and dedup_key like ${'day:' + B.orderId + '%'}`)).n);
  ok(day === 4, 'one day-latch per reminder day (never two reminders on one day)');

  // ── default close ─────────────────────────────────────────────────────────
  console.log('— miss + grace → locked default close');
  const p0 = await pool(sql);
  const C = await newActive(sql, '255700000303', [{ tier: 't-job', quantity: 1, seatIds: ['s-1'] }]);
  const p1 = await pool(sql);
  ok(p1.reserved === p0.reserved + 1, 'C reserved 1 unit');
  let res = await closeDefaultedPlans(sql, at('2026-11-10'));
  ok((await plan(sql, C.orderId)).status === 'active', '11-10: row 2 inside grace (11-08 + 2) → still active');
  res = await closeDefaultedPlans(sql, at('2026-11-11'));
  const pc = await plan(sql, C.orderId);
  ok(pc.status === 'defaulted' && (await status(sql, C.orderId)) === 'installment_defaulted', '11-11: past grace → plan defaulted, order installment_defaulted');
  const p2 = await pool(sql);
  ok(p2.reserved === p0.reserved && p2.available === p0.available, 'reservation released: inventory back to available');
  const seat = await one(sql`select state, hold_order_id from seat_inventory where seat_id = 's-1'`);
  ok(seat.state === 'available' && seat.hold_order_id === null, 'seat back on the map');
  const dep = (await one(sql`select amount from installment_schedule where order_id = ${C.orderId} and n = 1`)).amount;
  ok(Number(pc.refund_due) === Number(dep) - Number(pc.service_fee) && pc.refund_status === 'pending',
    `refund owed = paid ${dep} − service fee ${pc.service_fee} = ${pc.refund_due}, refund_status pending`);
  const alerts = (await sql`select dedup_key from webhook_event where provider='ops-alert' and dedup_key like ${'%' + C.orderId + '%'}`).map((x) => x.dedup_key.split(':')[0]);
  ok(alerts.includes('installment_refund_pending') && alerts.includes('installment_defaulted'), 'ops alerted: defaulted + refund pending (manual refund worklist)');
  ok(Number((await one(sql`select count(*)::int n from webhook_event where provider='installment-reminder' and dedup_key = ${'default:' + C.orderId}`)).n) === 1, 'buyer told once');
  res = await closeDefaultedPlans(sql, at('2026-11-12'));
  ok((await plan(sql, C.orderId)).status === 'defaulted' && Number((await plan(sql, C.orderId)).refund_due) === Number(pc.refund_due), 're-run is a no-op (exactly once)');
  ok((await refused(pay(sql, C.orderId))) === 'other:order not payable (status installment_defaulted)', 'defaulted order is not payable');
  const money = (await readOrderMoney(sql, ['e-job'], 0.05)).find((m) => m.orderId === C.orderId);
  ok(!money, 'defaulted order earns the organizer nothing (money is owed back)');
  // late money after the close → excess, never re-activates
  await sql`insert into payment_transaction (order_id, transaction_id, method, amount, status, schedule_n) values (${C.orderId}, 'LATE-C', 'billpay', 1, 'pending', 2)`;
  await applyOutcome(sql, 'LATE-C', 'successful', 20000);
  const pcl = await plan(sql, C.orderId);
  ok(Number(pcl.excess_collected) === 20000 && (await status(sql, C.orderId)) === 'installment_defaulted', 'payment after default → recorded as excess, order stays defaulted');
  const rr = await recordInstallmentRefund(sql, C.orderId, 'MPESA-REF-1');
  const ord = await one(sql`select refunded_amount from "order" where id = ${C.orderId}`);
  ok(rr.ok && (await plan(sql, C.orderId)).refund_status === 'recorded' && Number(ord.refunded_amount) === Number(pc.refund_due), 'ops records the refund → refund_status recorded, order.refunded_amount booked');
  ok((await recordInstallmentRefund(sql, C.orderId, 'again')).ok === false, 'refund cannot be recorded twice');

  // ── payment pending while the default runs ───────────────────────────────
  console.log('— payment in flight while the default runs');
  const D = await newActive(sql, '255700000304');
  const d2 = await pay(sql, D.orderId);
  __setMockCollectionStatus(d2.transactionId, { status: 'PENDING' });
  res = await closeDefaultedPlans(sql, at('2026-11-11'));
  ok((await plan(sql, D.orderId)).status === 'closing' && res.waiting >= 1, 'in-flight attempt → plan held in closing (not defaulted)');
  ok((await status(sql, D.orderId)) === 'installment_active', 'order untouched while closing');
  ok((await refused(pay(sql, D.orderId))) === 'plan_closing', 'no new collection opens while closing (plan_closing)');
  const d2amt = String((await one(sql`select amount from payment_transaction where transaction_id = ${d2.transactionId}`)).amount);
  __setMockCollectionStatus(d2.transactionId, { status: 'COMPLETED', amount: d2amt, collectedAmount: d2amt });
  res = await closeDefaultedPlans(sql, at('2026-11-11'));
  ok((await plan(sql, D.orderId)).status === 'active' && res.reopened >= 1, 'the overdue row got paid during the close → plan reopened (active)');
  ok((await one(sql`select status from installment_schedule where order_id = ${D.orderId} and n = 2`)).status === 'paid', 'row 2 paid by the reconciled attempt');

  const E = await newActive(sql, '255700000305');
  const e2 = await pay(sql, E.orderId);
  __setMockCollectionStatus(e2.transactionId, { status: 'PENDING' });
  await closeDefaultedPlans(sql, at('2026-11-11'));
  ok((await plan(sql, E.orderId)).status === 'closing', 'E closing with attempt in flight');
  __setMockCollectionStatus(e2.transactionId, { status: 'FAILED' });
  await closeDefaultedPlans(sql, at('2026-11-11'));
  ok((await plan(sql, E.orderId)).status === 'defaulted', 'attempt failed → default completes');

  const F = await newActive(sql, '255700000306');
  const f2 = await pay(sql, F.orderId);
  __setMockCollectionStatus(f2.transactionId, { status: 'PENDING' });
  await closeDefaultedPlans(sql, at('2026-11-11'));
  await sql`update installment_plan set closing_at = now() - interval '25 hours' where order_id = ${F.orderId}`;
  await closeDefaultedPlans(sql, at('2026-11-12'));
  ok((await plan(sql, F.orderId)).status === 'defaulted', 'attempt stuck in flight > 24h → close finishes anyway');
  await settle(sql, f2.transactionId);
  ok(Number((await plan(sql, F.orderId)).excess_collected) > 0 && (await status(sql, F.orderId)) === 'installment_defaulted', '…and its late settlement becomes excess owed back');

  // a final installment that completes the plan during closing
  console.log('— completion during the close');
  const G = await newActive(sql, '255700000307');
  const g2 = await pay(sql, G.orderId);
  await settle(sql, g2.transactionId);
  const g3 = await pay(sql, G.orderId);
  __setMockCollectionStatus(g3.transactionId, { status: 'PENDING' });
  await closeDefaultedPlans(sql, at('2026-11-18')); // row 3 (11-15) past grace
  ok((await plan(sql, G.orderId)).status === 'closing', 'G closing with the final attempt in flight');
  await settle(sql, g3.transactionId);
  res = await closeDefaultedPlans(sql, at('2026-11-18'));
  ok((await plan(sql, G.orderId)).status === 'completed' && (await status(sql, G.orderId)) === 'paid', 'final paid while closing → completed + paid (passes), never defaulted');

  // ── housekeeping + the worker entry point ────────────────────────────────
  console.log('— housekeeping');
  const config = await readInstallmentConfig(sql, 'e-job');
  const H = await createInstallmentOrder(sql, { phone: '255700000308', email: 'h@b.tz', cart: [{ tier: 't-job', quantity: 1 }], feeRate: 0, holdTtl: 900, config, eventDate: '2027-01-31', today: '2026-11-01' });
  await sql`update inventory_hold set expires_at = now() - interval '1 minute' where order_id = ${H.orderId}`;
  await sweepExpiredHolds(sql);
  ok((await cancelStalePendingPlans(sql)) >= 1 && (await plan(sql, H.orderId)).status === 'cancelled', 'plan of an expired, never-paid order → cancelled');
  ok(typeof (await runInstallmentJobs(sql, at('2026-11-20'))) === 'number', 'runInstallmentJobs (worker tick) runs end to end');

  await sql.end({ timeout: 5 });
  if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nBS135 INSTALLMENT JOBS HARNESS: PASS');
})().catch((e) => { console.error(e); process.exit(1); });
