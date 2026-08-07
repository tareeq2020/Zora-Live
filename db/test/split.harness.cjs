/* PR-BS4 harness — the bill-split money flow + failure matrix, end to end against
   the throwaway Postgres booted by split.e2e.sh. XBRIDGE_MOCK=true steers each
   share's collection status. Proves: shares are payment-only (no double-book), the
   table converts + issues per-payer credentials ONCE only when ALL shares settle,
   claim is idempotent, a short share is re-mintable (OV2), a duplicate settlement
   is a no-op, and an expired partly-paid split locks + flags refund (OV3).
   Env: DATABASE_URL, TICKET_SIGNING_KEY, SESSION_SECRET, XBRIDGE_MOCK=true. */
'use strict';
const path = require('path');
const core = require(path.join(__dirname, '..', '..', 'packages', 'core', 'dist', 'index.js'));
const {
  db, createTableSplit, claimShare, createShareOrder, initiatePayment, reconcile,
  splitAwareExpirySweep, signShareToken, DEFAULT_FSP_ROUTE_MAP,
  __setMockCollectionStatus, closeDb,
} = core;

let failures = 0;
function ok(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { console.error('  ✗ FAIL: ' + msg); failures++; } }
const CALLBACK = 'http://localhost/api/webhooks/xbridge';
const ROUTE = DEFAULT_FSP_ROUTE_MAP;

async function shares(sql, splitId) { return sql`select id, share_index, is_host, state, claim_token from split_share where split_id=${splitId} order by share_index`; }
async function splitStatus(sql, id) { return (await sql`select status from table_split where id=${id}`)[0].status; }
async function paidCount(sql, id) { return Number((await sql`select count(*)::int n from split_share where split_id=${id} and state='paid'`)[0].n); }
async function credInfo(sql, id) { const r = (await sql`select count(*)::int total, count(split_share_id)::int linked from credential where split_id=${id}`)[0]; return { total: Number(r.total), linked: Number(r.linked) }; }
async function pool(sql) { const r = (await sql`select available_count a, reserved_count r, sold_count s from inventory_pool where product_tier_id='t-tbl'`)[0]; return { a: Number(r.a), r: Number(r.r), s: Number(r.s) }; }

async function payShare(sql, shareId, phone, opts = {}) {
  const co = await createShareOrder(sql, shareId, phone);
  if (!co.ok) throw new Error('createShareOrder failed: ' + co.reason);
  const r = await initiatePayment(sql, { orderId: co.orderId, method: 'mobile', payerPhone: phone, callbackUrl: CALLBACK, routeMap: ROUTE });
  const amt = co.amount;
  if (opts.short) __setMockCollectionStatus(r.transactionId, { status: 'PARTIAL', amount: String(amt), collectedAmount: String(Math.floor(amt / 2)) });
  else __setMockCollectionStatus(r.transactionId, { status: 'COMPLETED', amount: String(amt), collectedAmount: String(amt) });
  await reconcile(sql, r.transactionId);
  return { orderId: co.orderId, transactionId: r.transactionId, amount: amt };
}

async function main() {
  const sql = db();

  // ── Happy path: create N=3 (uneven price), pay all → complete + 3 passes ──
  console.log('== happy: 3-way split settles → table converts + per-payer passes ==');
  const p0 = await pool(sql);
  const a = await createTableSplit(sql, { hostPhone: '255700000001', tierId: 't-tbl', capacityN: 3, feeRate: 0 });
  ok(a.ok, 'createTableSplit ok');
  ok(a.hostShare + a.inviteeShare * 2 === a.target, `shares sum to target (${a.hostShare}+2×${a.inviteeShare}=${a.target})`);
  ok((await pool(sql)).r === p0.r + 1 && (await pool(sql)).a === p0.a - 1, 'one table reserved (available -1, reserved +1)');
  const sh = await shares(sql, a.splitId);

  // claim invitee share #1 by token — idempotent
  const c1 = await claimShare(sql, sh[1].claim_token, '255700000012', null, 'Ama');
  ok(c1.ok && c1.shareId === sh[1].id, 'claimShare by token resolves the share');
  const c1b = await claimShare(sql, sh[1].claim_token, '255700000012');
  ok(c1b.ok && c1b.shareId === sh[1].id, 'claimShare is idempotent (re-claim → same share)');

  await payShare(sql, sh[0].id, '255700000001');            // host
  ok(await splitStatus(sql, a.splitId) === 'forming', 'after 1 paid: still forming');
  ok((await credInfo(sql, a.splitId)).total === 0, 'after 1 paid: 0 credentials');
  await payShare(sql, sh[1].id, '255700000012');            // invitee 1
  ok(await paidCount(sql, a.splitId) === 2 && await splitStatus(sql, a.splitId) === 'forming', 'after 2 paid: forming, waiting on last');
  const last = await payShare(sql, sh[2].id, '255700000013'); // invitee 2 → completes
  ok(await splitStatus(sql, a.splitId) === 'complete', 'last share completes the table');
  const ci = await credInfo(sql, a.splitId);
  ok(ci.total === 3 && ci.linked === 3, 'exactly 3 per-payer credentials issued (all split_share-linked)');
  ok((await pool(sql)).s === p0.s + 1, 'reservation converted → sold +1 (one table)');
  ok((await pool(sql)).r === p0.r, 'reserved bucket back to baseline');

  // duplicate settlement of the completing txn → no-op (terminal guard)
  __setMockCollectionStatus(last.transactionId, { status: 'COMPLETED', amount: String(last.amount), collectedAmount: String(last.amount) });
  await reconcile(sql, last.transactionId);
  ok((await credInfo(sql, a.splitId)).total === 3, 'duplicate settlement issues NO extra credential');

  // ── Short share is re-mintable (OV2) ─────────────────────────────────────
  console.log('== short: a short share voids + re-mints, does not brick the split ==');
  const b = await createTableSplit(sql, { hostPhone: '255700000002', tierId: 't-tbl', capacityN: 2, feeRate: 0 });
  const shb = await shares(sql, b.splitId);
  await payShare(sql, shb[1].id, '255700000022', { short: true });
  const shortShare = (await sql`select state, order_id from split_share where id=${shb[1].id}`)[0];
  ok(shortShare.state === 'claimed' && shortShare.order_id === null, 'short share reset to re-payable (claimed, order detached)');
  ok(await splitStatus(sql, b.splitId) === 'forming', 'split still forming (not bricked) after a short share');
  await payShare(sql, shb[0].id, '255700000002');   // host
  await payShare(sql, shb[1].id, '255700000022');   // invitee re-pays in full → completes
  ok(await splitStatus(sql, b.splitId) === 'complete', 're-paid short share completes the table');
  ok((await credInfo(sql, b.splitId)).total === 2, 'completed split issues 2 passes');

  // ── Expired, partly-paid split → refund_pending + locked (OV3) ───────────
  console.log('== expired: partly-paid split locks inventory + flags refund ==');
  const before = await pool(sql);
  const d = await createTableSplit(sql, { hostPhone: '255700000003', tierId: 't-tbl', capacityN: 3, feeRate: 0 });
  const shd = await shares(sql, d.splitId);
  await payShare(sql, shd[0].id, '255700000003'); // 1 of 3 paid
  await sql`update table_split set window_expires_at = now() - interval '2 min' where id=${d.splitId}`;
  await sql`update inventory_reservation set expires_at = now() - interval '2 min' where ref_type='split' and ref_id=${d.splitId}`;
  const swept = await splitAwareExpirySweep(sql);
  ok(swept.flagged === 1 && swept.released === 0, 'expiry sweep flags the partly-paid split');
  ok(await splitStatus(sql, d.splitId) === 'refund_pending', 'split → refund_pending');
  ok((await pool(sql)).a === before.a - 1, 'inventory kept LOCKED (available not restored)');

  await closeDb();
  if (failures) { console.error(`\n${failures} assertion(s) failed`); process.exit(1); }
  console.log('\n  all bill-split flow + failure-matrix assertions hold');
}
main().catch((e) => { console.error(e); process.exit(1); });
