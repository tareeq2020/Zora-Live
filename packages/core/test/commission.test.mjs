/* BS35 tests: point-in-time commission math (pure, no DB).
   Build core first (`pnpm --filter "@zora/core..." build`) — we import dist.
   The stamping + earnings flows (order.commission_rate, the split union, refunds)
   are exercised by db/test/org-sales.e2e.sh against real Postgres.

   This is money: every branch of the fallback chain and every rounding boundary
   is pinned here, because these two functions are the ONLY place the platform's
   cut is decided and applied. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCommissionRate, netOf, isCommissionRate, DEFAULT_COMMISSION_RATE,
} from '../dist/index.js';

/* ── resolveCommissionRate: event override → org rate → platform default ───── */

test('resolveCommissionRate: platform default when nothing is set', () => {
  assert.equal(DEFAULT_COMMISSION_RATE, 0.05);
  assert.equal(resolveCommissionRate(null, null), 0.05);
  assert.equal(resolveCommissionRate(undefined, undefined), 0.05);
  assert.equal(resolveCommissionRate({}, {}), 0.05);
  assert.equal(resolveCommissionRate({ commissionRate: null }, { commissionRate: null }), 0.05);
});

test('resolveCommissionRate: org rate wins over the default', () => {
  assert.equal(resolveCommissionRate(null, { commissionRate: 0.12 }), 0.12);
  assert.equal(resolveCommissionRate({}, { commissionRate: 0.12 }), 0.12);
});

test('resolveCommissionRate: event override wins over the org rate', () => {
  assert.equal(resolveCommissionRate({ commissionRate: 0.02 }, { commissionRate: 0.12 }), 0.02);
});

test('resolveCommissionRate: an explicit ZERO is a real rate, not "absent"', () => {
  // The bug this pins: `event.commissionRate || org.commissionRate` would skip a
  // 0% deal and silently charge the org's rate on a free/commission-waived event.
  assert.equal(resolveCommissionRate({ commissionRate: 0 }, { commissionRate: 0.12 }), 0);
  assert.equal(resolveCommissionRate(null, { commissionRate: 0 }), 0);
});

test('resolveCommissionRate: 100% is allowed, above 100% is not a rate', () => {
  assert.equal(resolveCommissionRate({ commissionRate: 1 }, null), 1);
  assert.equal(resolveCommissionRate({ commissionRate: 1.0001 }, { commissionRate: 0.12 }), 0.12);
});

test('resolveCommissionRate: junk falls THROUGH to the next level, never zeroes a payout', () => {
  const org = { commissionRate: 0.12 };
  for (const bad of [NaN, Infinity, -Infinity, -0.01, 5, '0.10', true, {}, []]) {
    assert.equal(resolveCommissionRate({ commissionRate: bad }, org), 0.12, `event override ${String(bad)}`);
  }
  for (const bad of [NaN, Infinity, -0.01, 5, '0.10']) {
    assert.equal(resolveCommissionRate(null, { commissionRate: bad }), 0.05, `org rate ${String(bad)}`);
  }
});

test('isCommissionRate: the shared validity predicate', () => {
  assert.equal(isCommissionRate(0), true);
  assert.equal(isCommissionRate(0.05), true);
  assert.equal(isCommissionRate(1), true);
  assert.equal(isCommissionRate(-0.001), false);
  assert.equal(isCommissionRate(1.001), false);
  assert.equal(isCommissionRate(NaN), false);
  assert.equal(isCommissionRate(null), false);
  assert.equal(isCommissionRate(undefined), false);
  assert.equal(isCommissionRate('0.05'), false);
});

/* ── netOf: the ONE rounding rule ─────────────────────────────────────────── */

test('netOf: the ordinary case', () => {
  assert.equal(netOf(100000, 0.05), 95000);
  assert.equal(netOf(80000, 0.05), 76000);
  assert.equal(netOf(900000, 0.10), 810000);
});

test('netOf: the boundary rates', () => {
  assert.equal(netOf(100000, 0), 100000);   // 0% commission → the org keeps it all
  assert.equal(netOf(100000, 1), 0);        // 100% commission → nothing left
  assert.equal(netOf(0, 0.05), 0);
});

test('netOf: rounds half UP to whole units (money is bigint TZS)', () => {
  assert.equal(netOf(10, 0.05), 10);        // 9.5  → 10
  assert.equal(netOf(30, 0.05), 29);        // 28.5 → 29  (Math.round: .5 up)
  assert.equal(netOf(1, 0.5), 1);           // 0.5  → 1
  assert.equal(netOf(3, 0.5), 2);           // 1.5  → 2
  assert.equal(netOf(1, 0.05), 1);          // 0.95 → 1
  assert.equal(netOf(1, 0.9), 0);           // 0.1  → 0
});

test('netOf: the result is always a whole number', () => {
  for (const gross of [1, 7, 999, 50000, 65001, 1234567]) {
    for (const rate of [0, 0.01, 0.05, 0.075, 0.1, 0.333, 0.5, 1]) {
      const net = netOf(gross, rate);
      assert.ok(Number.isInteger(net), `netOf(${gross}, ${rate}) = ${net}`);
      assert.ok(net >= 0 && net <= gross, `netOf(${gross}, ${rate}) = ${net} out of range`);
    }
  }
});

test('netOf: an UNSTAMPED order (null/junk rate) reads as the platform default', () => {
  // Pre-BS35 rows have commission_rate NULL. They must net at 5%, never at 0%
  // (which would silently hand the platform's cut to the organizer) and never
  // throw.
  assert.equal(netOf(100000, null), 95000);
  assert.equal(netOf(100000, undefined), 95000);
  assert.equal(netOf(100000, NaN), 95000);
});

test('netOf: a non-numeric gross is 0, never NaN in a balance', () => {
  assert.equal(netOf(NaN, 0.05), 0);
  assert.equal(netOf(undefined, 0.05), 0);
});

test('netOf: per-order netting never drifts more than a unit per order', () => {
  // Why rounding is per ORDER: summing per-order nets can differ from netting the
  // total, and the ledger must be the sum of the orders (that is what gets paid).
  const orders = [33333, 33333, 33334];
  const rate = 0.05;
  const summed = orders.reduce((a, g) => a + netOf(g, rate), 0);
  const lump = netOf(orders.reduce((a, g) => a + g, 0), rate);
  assert.ok(Math.abs(summed - lump) <= orders.length, 'drift stays sub-unit per order');
});

test('netOf: a rate change does not retroactively alter an already-netted order', () => {
  // The whole point of stamping: the historical net is a function of the STAMPED
  // rate, so recomputing it later with a new org rate is a different number and
  // must never be what the ledger reads.
  const stamped = netOf(100000, 0.05);
  const liveLater = netOf(100000, 0.20);
  assert.equal(stamped, 95000);
  assert.equal(liveLater, 80000);
  assert.notEqual(stamped, liveLater);
});
