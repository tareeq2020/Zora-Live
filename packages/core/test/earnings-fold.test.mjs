/* D1:A regression: archived events must NOT count toward the organizer sales
   headline, while the payout balance (which reads the same money WITHOUT the
   exclude set) still counts them. Pure, no DB — build core first
   (`pnpm --filter "@zora/core..." build`); we import dist.

   `foldMoneyByCurrency` is the ONE place that decision is applied, so the guard
   lives here: the SAME money folded with vs. without the archived id-set must
   differ by EXACTLY the archived event's money, and by nothing else. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { foldMoneyByCurrency } from '../dist/index.js';

/** One OrderMoney row (net = gross for a 0% rate keeps the arithmetic obvious). */
function order(orderId, eventId, gross, { status = 'paid', currency = 'TZS', rate = 0, refunded = 0 } = {}) {
  return { orderId, eventId, status, currency, gross, refunded, rate, net: Math.round(gross * (1 - rate)) };
}

const money = [
  order('o1', 'live-1', 100_000),
  order('o2', 'live-1', 50_000),
  order('o3', 'archived-1', 40_000), // ← must be excluded from the headline
];

test('foldMoneyByCurrency: no exclude set counts every event (the payout-balance read)', () => {
  const byCur = foldMoneyByCurrency(money);
  const tzs = byCur.get('TZS');
  assert.equal(tzs.revenue, 190_000); // 100k + 50k + 40k archived
  assert.equal(tzs.orders, 3);
});

test('foldMoneyByCurrency: excluding the archived event drops exactly its money (the headline)', () => {
  const byCur = foldMoneyByCurrency(money, new Set(['archived-1']));
  const tzs = byCur.get('TZS');
  assert.equal(tzs.revenue, 150_000); // archived 40k gone
  assert.equal(tzs.orders, 2);        // archived order no longer counted
});

test('headline vs. balance differ by EXACTLY the archived money, nothing else', () => {
  const balance = foldMoneyByCurrency(money).get('TZS');
  const headline = foldMoneyByCurrency(money, new Set(['archived-1'])).get('TZS');
  assert.equal(balance.revenue - headline.revenue, 40_000);
  assert.equal(balance.orders - headline.orders, 1);
  assert.equal(balance.netRevenue - headline.netRevenue, 40_000);
});

test('a fully-refunded archived order was never in the headline anyway (status !== paid)', () => {
  const withRefunded = [...money, order('o4', 'archived-1', 0, { status: 'refunded' })];
  const headline = foldMoneyByCurrency(withRefunded, new Set(['archived-1'])).get('TZS');
  assert.equal(headline.revenue, 150_000);
  assert.equal(headline.orders, 2); // refunded order never increments paid-order count
});

test('excluding a non-existent id changes nothing', () => {
  const a = foldMoneyByCurrency(money).get('TZS');
  const b = foldMoneyByCurrency(money, new Set(['ghost'])).get('TZS');
  assert.deepEqual({ r: a.revenue, o: a.orders }, { r: b.revenue, o: b.orders });
});
