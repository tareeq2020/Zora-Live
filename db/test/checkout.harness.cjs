/* PR-7 order-path harness — exercises @zora/core's payments service against the
   throwaway Postgres booted by checkout.e2e.sh. Required env: DATABASE_URL,
   TICKET_SIGNING_KEY. Loads the built dist by absolute path. */
'use strict';
const path = require('path');
const core = require(path.join(__dirname, '..', '..', 'packages', 'core', 'dist', 'index.js'));
const { db, createGaVipOrder, issueCredentials, convertHolds, releaseHolds, tryRehold, closeDb } = core;

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log('  ✓ ' + msg); }
  else { console.error('  ✗ FAIL: ' + msg); failures++; }
}

(async () => {
  const sql = db();

  // ── 1) happy path: qty 1 ──────────────────────────────────────────────────
  const r1 = await createGaVipOrder(sql, {
    phone: '255700000001', email: 'a@buyer.tz',
    cart: [{ tier: 't-ga', quantity: 1 }], feeRate: 0.05, holdTtl: 900,
  });
  ok(r1.ok === true, 'qty 1 -> ok:true');
  ok(r1.subtotal === 65000, 'subtotal = 65000');
  ok(r1.fee === 3250, 'fee = round(65000*0.05) = 3250');
  ok(r1.total === 68250, 'total = 68250');

  const ord1 = (await sql`select status, target_value from "order" where id = ${r1.orderId}`)[0];
  ok(ord1.status === 'pending', 'order.status = pending');
  ok(Number(ord1.target_value) === 68250, 'order.target_value = total');

  const holds = await sql`select quantity from inventory_hold where order_id = ${r1.orderId} and state = 'held'`;
  ok(holds.length === 1, 'one live hold exists for the order');

  const availAfter1 = Number((await sql`select available_count from inventory_pool where product_tier_id = 't-ga'`)[0].available_count);
  ok(availAfter1 === 1, 'available 2 -> 1 after the hold');

  const oi = (await sql`select price_version_id, unit_price, quantity from order_item where order_id = ${r1.orderId}`)[0];
  const pvId = Number((await sql`select id from price_version where tier_id = 't-ga' and effective_to is null order by effective_from desc limit 1`)[0].id);
  ok(Number(oi.price_version_id) === pvId, 'order_item pinned to the active price_version');
  ok(Number(oi.unit_price) === 65000, 'order_item.unit_price snapshotted = 65000');

  // ── 2) sold-out rollback: qty 3 > available 1 ─────────────────────────────
  const r2 = await createGaVipOrder(sql, {
    phone: '255700000002', email: 'b@buyer.tz',
    cart: [{ tier: 't-ga', quantity: 3 }], feeRate: 0.05, holdTtl: 900,
  });
  ok(r2.ok === false && r2.reason === 'sold_out' && r2.tier === 't-ga', 'qty 3 -> {ok:false, sold_out, t-ga}');

  const availAfter2 = Number((await sql`select available_count from inventory_pool where product_tier_id = 't-ga'`)[0].available_count);
  ok(availAfter2 === 1, 'available unchanged (1) — prior holds released on rollback');

  const orderCount = Number((await sql`select count(*)::int n from "order"`)[0].n);
  ok(orderCount === 1, 'failed order rolled back — only the first order persists');
  const itemCount = Number((await sql`select count(*)::int n from order_item`)[0].n);
  ok(itemCount === 1, 'no partial order_item left by the rolled-back attempt');

  // ── 3) idempotent credential issuance on a converted order ────────────────
  const converted = await convertHolds(sql, r1.orderId);
  ok(converted === 1, 'convert_order_holds -> 1');
  const issued1 = await issueCredentials(sql, r1.orderId);
  ok(issued1 === 1, 'issueCredentials (1st) -> 1 new credential');
  const issued2 = await issueCredentials(sql, r1.orderId);
  ok(issued2 === 0, 'issueCredentials (2nd) -> 0 (idempotent)');
  const credCount = Number((await sql`
    select count(*)::int n from credential
     where order_item_id in (select id from order_item where order_id = ${r1.orderId})`)[0].n);
  ok(credCount === 1, 'exactly one credential total after two runs');

  // ── 4) try_reacquire_order all-or-nothing ─────────────────────────────────
  // Pool now: cap 2, sold 1 (converted), available 1. Take a fresh order, then
  // release its holds (simulating a lapse) so reacquire can re-take the stock.
  const r3 = await createGaVipOrder(sql, {
    phone: '255700000003', email: 'c@buyer.tz',
    cart: [{ tier: 't-ga', quantity: 1 }], feeRate: 0.05, holdTtl: 900,
  });
  ok(r3.ok === true, 'r3 (qty 1) -> ok:true');
  await releaseHolds(sql, r3.orderId);
  const availReleased = Number((await sql`select available_count from inventory_pool where product_tier_id = 't-ga'`)[0].available_count);
  ok(availReleased === 1, 'holds released -> available back to 1');

  const reacqOk = (await sql`select try_reacquire_order(${r3.orderId}::uuid) as ok`)[0].ok;
  ok(reacqOk === true, 'try_reacquire_order -> true when stock available');
  const availReacq = Number((await sql`select available_count from inventory_pool where product_tier_id = 't-ga'`)[0].available_count);
  ok(availReacq === 0, 'available 1 -> 0 after reacquire');

  const reacqFail = (await sql`select try_reacquire_order(${r3.orderId}::uuid) as ok`)[0].ok;
  ok(reacqFail === false, 'try_reacquire_order -> false when exhausted (applies nothing)');

  // ── 5) BS56: a failed-payment RETRY re-HOLDS stock (held), never SELLS it ──
  // Regression for the phantom-sold bug: initiatePayment's failed-retry branch
  // used try_reacquire_order (available → SOLD) instead of a re-hold, so every
  // retry of a failed payment marked unpaid seats sold forever, with no hold to
  // release. try_rehold_order must move available → HELD and leave sold_count
  // untouched; seats become sold ONLY when the retry actually pays.
  await sql`insert into product_tier (id, event_id, name, capacity) values ('t-retry','e-chk','Retry GA',5) on conflict do nothing`;
  await sql`insert into price_version (tier_id, price, currency, fee_treatment) values ('t-retry', 50000, 'TZS', 'passed')`;
  await sql`insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-retry',5,5) on conflict do nothing`;

  const r4 = await createGaVipOrder(sql, {
    phone: '255700000004', email: 'd@buyer.tz',
    cart: [{ tier: 't-retry', quantity: 2 }], feeRate: 0, holdTtl: 900,
  });
  ok(r4.ok === true, 'r4 (qty 2 on t-retry) -> ok:true');

  // Simulate a failed payment: the checkout holds were released, order -> failed.
  await releaseHolds(sql, r4.orderId);
  await sql`update "order" set status='failed' where id = ${r4.orderId}`;
  const soldBefore = Number((await sql`select sold_count from inventory_pool where product_tier_id='t-retry'`)[0].sold_count);
  ok(soldBefore === 0, 'nothing sold yet — the payment failed');

  // The retry path (the fix) re-HOLDS: available -> held, sold UNCHANGED.
  const reheld = await tryRehold(sql, r4.orderId, 900);
  ok(reheld === true, 'tryRehold -> true when stock is available');
  const pr = (await sql`select sold_count, available_count from inventory_pool where product_tier_id='t-retry'`)[0];
  ok(Number(pr.sold_count) === 0, 'retry did NOT sell the seats (sold_count stays 0, not 2) — the phantom-sold bug');
  ok(Number(pr.available_count) === 3, 'retry moved 2 available -> held (5 -> 3)');
  const heldQty = Number((await sql`select coalesce(sum(quantity),0) n from inventory_hold where order_id = ${r4.orderId} and state='held'`)[0].n);
  ok(heldQty === 2, 'a fresh HELD hold exists for the retried order (so it can be released)');

  // The retry now actually pays: held -> sold. This is the ONLY path to sold.
  const conv4 = await convertHolds(sql, r4.orderId);
  ok(conv4 === 1, 'convert_order_holds on payment success -> 1');
  const pr2 = (await sql`select sold_count, available_count from inventory_pool where product_tier_id='t-retry'`)[0];
  ok(Number(pr2.sold_count) === 2, 'seats become sold ONLY after payment (sold 0 -> 2)');
  ok(Number(pr2.available_count) === 3, 'available stays 3 (held converted, not decremented twice)');

  await closeDb();
  if (failures) { console.error('\n' + failures + ' assertion(s) failed'); process.exit(1); }
  console.log('  all order-path assertions hold');
})().catch((e) => { console.error(e); process.exit(1); });
