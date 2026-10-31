/* BS116 (plan A1): the order-status truth table. Pure, no DB — build core first
   (`pnpm --filter @zora/core build`); we import dist.

   Every status × every predicate is pinned here. Adding a status (installments
   did) must add a row, i.e. decide each question explicitly — the "exactly the
   statuses in the table" test fails otherwise. The rows for the eight
   pre-installment statuses reproduce the behaviour of the hand-synced lists this
   module replaced (PAID_STATES ×2, PAID/FLAGGED, EARNING_STATUSES,
   REFUNDABLE_ORDER_STATUSES, BROADCAST_AUDIENCE_STATUSES, bare 'paid' literals). */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as core from '../dist/index.js';

const T = true, F = false;
const COLS = ['countsAsSold', 'countsAsRevenue', 'isFlaggedMoney', 'issuesPasses', 'isPayable',
  'holdsBuyerMoney', 'wasEverPaid', 'isRefundable', 'isBroadcastAudience'];

// status                  sold rev  flag pass pay  held ever refund bcast
const TABLE = {
  pending:               [F,   F,   F,   F,   T,   F,   F,   F,     F],
  paid:                  [T,   T,   F,   T,   F,   T,   T,   T,     T],
  payment_short:         [F,   F,   T,   F,   F,   T,   T,   T,     T],
  paid_unseatable:       [F,   F,   T,   F,   F,   T,   T,   T,     T],
  failed:                [F,   F,   F,   F,   T,   F,   F,   F,     F],
  expired:               [F,   F,   F,   F,   F,   F,   F,   F,     F],
  cancelled:             [F,   F,   F,   F,   F,   F,   F,   F,     F],
  refunded:              [F,   T,   F,   F,   F,   F,   T,   F,     F],
  installment_active:    [T,   F,   F,   F,   T,   T,   T,   F,     T],
  installment_defaulted: [T,   F,   F,   F,   F,   T,   T,   F,     F],
};

test('ORDER_STATUSES is exactly the statuses in the truth table', () => {
  assert.deepEqual([...core.ORDER_STATUSES].sort(), Object.keys(TABLE).sort());
});

test('ORDER_STATUS constants match the status list', () => {
  assert.deepEqual(Object.values(core.ORDER_STATUS).sort(), [...core.ORDER_STATUSES].sort());
});

for (const [status, row] of Object.entries(TABLE)) {
  test(`predicates for '${status}'`, () => {
    COLS.forEach((col, i) => {
      assert.equal(core[col](status), row[i], `${col}('${status}')`);
    });
  });
}

test('unknown / missing status answers false to every predicate', () => {
  for (const s of ['', 'PAID', 'partially_refunded', null, undefined]) {
    assert.equal(core.isOrderStatus(s), false);
    for (const col of COLS) assert.equal(core[col](s), false, `${col}(${s})`);
  }
});

test('SQL arrays are derived from the predicates', () => {
  const pairs = {
    SOLD_STATUSES: 'countsAsSold', REVENUE_STATUSES: 'countsAsRevenue',
    FLAGGED_MONEY_STATUSES: 'isFlaggedMoney', PASS_ISSUING_STATUSES: 'issuesPasses',
    PAYABLE_STATUSES: 'isPayable', BUYER_MONEY_STATUSES: 'holdsBuyerMoney',
    EVER_PAID_STATUSES: 'wasEverPaid', REFUNDABLE_STATUSES: 'isRefundable',
    BROADCAST_STATUSES: 'isBroadcastAudience',
  };
  for (const [arr, pred] of Object.entries(pairs)) {
    assert.deepEqual([...core[arr]].sort(), core.ORDER_STATUSES.filter(core[pred]).sort(), arr);
  }
});

test('regression: the replaced hand-synced lists, for pre-installment statuses', () => {
  const legacy = (arr) => arr.filter((s) => !s.startsWith('installment_')).sort();
  // earnings.ts EARNING_STATUSES (and org-sales metaRows)
  assert.deepEqual(legacy(core.EARNING_STATUSES), ['paid', 'refunded']);
  assert.deepEqual(legacy(core.REVENUE_STATUSES), ['paid', 'refunded']);
  // org-events PAID_STATES (event archive guard)
  assert.deepEqual(legacy(core.BUYER_MONEY_STATUSES), ['paid', 'paid_unseatable', 'payment_short']);
  // refunds.ts REFUNDABLE_ORDER_STATUSES
  assert.deepEqual(legacy(core.REFUNDABLE_ORDER_STATUSES), ['paid', 'paid_unseatable', 'payment_short']);
  // broadcasts.ts BROADCAST_AUDIENCE_STATUSES
  assert.deepEqual(legacy(core.BROADCAST_AUDIENCE_STATUSES), ['paid', 'paid_unseatable', 'payment_short']);
  // org-sales FLAGGED
  assert.deepEqual(legacy(core.FLAGGED_MONEY_STATUSES), ['paid_unseatable', 'payment_short']);
  // admin-orders PAID_STATES (paidEver)
  assert.deepEqual(legacy(core.EVER_PAID_STATUSES), ['paid', 'paid_unseatable', 'payment_short', 'refunded']);
  // initiatePayment: pending | failed
  assert.deepEqual(legacy(core.PAYABLE_STATUSES), ['failed', 'pending']);
  // resend / notify / payer auto-verify: 'paid' only
  assert.deepEqual(legacy(core.PASS_ISSUING_STATUSES), ['paid']);
  // order counts (earnings fold, org-sales, analytics): 'paid' only
  assert.deepEqual(legacy(core.SOLD_STATUSES), ['paid']);
});

test('installments: seats count as sold, revenue does not, no passes', () => {
  for (const s of ['installment_active', 'installment_defaulted']) {
    assert.equal(core.countsAsSold(s), true);
    assert.equal(core.countsAsRevenue(s), false);
    assert.equal(core.issuesPasses(s), false);
  }
  assert.equal(core.isPayable('installment_active'), true);
  assert.equal(core.isPayable('installment_defaulted'), false);
});
