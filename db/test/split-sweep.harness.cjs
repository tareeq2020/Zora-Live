/* PR-BS3 harness — bill-split expiry safety (OV3). Proves:
   (A) an UNPAID split past its window is cleanly released by splitAwareExpirySweep;
   (B) a PARTLY-PAID split past its window is NOT released — the generic
       sweepExpiredReservations() skips ref_type='split', and splitAwareExpirySweep
       flags it refund_pending with inventory kept LOCKED (money never stranded
       without a held table). Runs @zora/core dist against the throwaway PG booted
       by split-sweep.e2e.sh. Env: DATABASE_URL, TICKET_SIGNING_KEY. */
'use strict';
const path = require('path');
const core = require(path.join(__dirname, '..', '..', 'packages', 'core', 'dist', 'index.js'));
const { db, createTableSplit, splitAwareExpirySweep, sweepExpiredReservations, closeDb } = core;

let failures = 0;
function ok(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { console.error('  ✗ FAIL: ' + msg); failures++; } }

async function avail(sql) { return Number((await sql`select available_count a from inventory_pool where product_tier_id='t-tbl'`)[0].a); }
async function splitStatus(sql, id) { return (await sql`select status from table_split where id=${id}`)[0].status; }
async function resState(sql, id) { const r = await sql`select state from inventory_reservation where ref_type='split' and ref_id=${id}`; return r[0]?.state; }
async function expirePast(sql, id) {
  await sql`update table_split set window_expires_at = now() - interval '2 min' where id=${id}`;
  await sql`update inventory_reservation set expires_at = now() - interval '2 min' where ref_type='split' and ref_id=${id}`;
}

async function main() {
  const sql = db();

  // ── Scenario A: unpaid split expires → clean release ──────────────────────
  console.log('== (A) unpaid split expires -> clean release ==');
  const startA = await avail(sql);
  const a = await createTableSplit(sql, { hostPhone: '255700000001', tierId: 't-tbl', capacityN: 3, feeRate: 0 });
  ok(a.ok === true, '(A) createTableSplit ok');
  ok(await avail(sql) === startA - 1, '(A) one table reserved (available -1)');
  await expirePast(sql, a.splitId);

  const genA = await sweepExpiredReservations(sql);
  ok(genA === 0, '(A) generic reservation-sweep skips the split reservation (0 released)');
  ok(await resState(sql, a.splitId) === 'reserved', '(A) split reservation still reserved after generic sweep');

  const sweptA = await splitAwareExpirySweep(sql);
  ok(sweptA.released === 1 && sweptA.flagged === 0, '(A) split-sweep releases 1, flags 0');
  ok(await splitStatus(sql, a.splitId) === 'expired', '(A) split status = expired');
  ok(await resState(sql, a.splitId) === 'released', '(A) reservation released');
  ok(await avail(sql) === startA, '(A) inventory restored to available');

  // ── Scenario B: partly-paid split expires → refund_pending, LOCKED ────────
  console.log('== (B) partly-paid split expires -> refund_pending, inventory locked ==');
  const startB = await avail(sql);
  const b = await createTableSplit(sql, { hostPhone: '255700000002', tierId: 't-tbl', capacityN: 4, feeRate: 0 });
  ok(b.ok === true, '(B) createTableSplit ok');
  await sql`update split_share set state='paid', paid_at=now() where split_id=${b.splitId} and share_index=1`;
  await expirePast(sql, b.splitId);

  const genB = await sweepExpiredReservations(sql);
  ok(genB === 0, '(B) generic reservation-sweep skips the split (0 released)');

  const sweptB = await splitAwareExpirySweep(sql);
  ok(sweptB.released === 0 && sweptB.flagged === 1, '(B) split-sweep releases 0, flags 1');
  ok(await splitStatus(sql, b.splitId) === 'refund_pending', '(B) split status = refund_pending');
  ok(await resState(sql, b.splitId) === 'reserved', '(B) reservation STILL reserved (inventory LOCKED, OV3)');
  ok(await avail(sql) === startB - 1, '(B) inventory NOT restored (still held for refund)');
  const alerts = Number((await sql`select count(*)::int n from webhook_event where provider='ops-alert' and dedup_key like ${'split_expired_unfilled:' + b.splitId + ':%'}`)[0].n);
  ok(alerts === 1, '(B) a split_expired_unfilled ops-alert row exists');

  await closeDb();
  if (failures) { console.error(`\n${failures} assertion(s) failed`); process.exit(1); }
  console.log('\n  all split-sweep assertions hold');
}
main().catch((e) => { console.error(e); process.exit(1); });
