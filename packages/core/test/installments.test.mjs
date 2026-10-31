/* BS132 (A19): installment schedule maths. Pure — build core first
   (`pnpm --filter @zora/core build`); we import dist. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as core from '../dist/index.js';

const { buildSchedule, depositFor, dueDateFor, addMonths, finalDueFor, eatToday, sanitizeInstallmentConfig, configCoversCart } = core;

const base = { depositPct: 30, depositAmount: null, count: 3, frequency: 'monthly', today: '2026-11-01', finalDue: '2027-03-01' };
const sum = (rows) => rows.reduce((s, r) => s + r.amount, 0);

test('deposit first, remainder even, rounding remainder on the LAST payment', () => {
  const r = buildSchedule({ ...base, total: 100_000 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map((x) => x.amount), [30_000, 35_000, 35_000]);
  const odd = buildSchedule({ ...base, total: 100_001, count: 4 });
  // deposit round(30000.3)=30000; rest 70001 / 3 = 23333 r 2 → last 23335
  assert.deepEqual(odd.rows.map((x) => x.amount), [30_000, 23_333, 23_333, 23_335]);
  assert.equal(odd.rows[0].n, 1);
  assert.equal(odd.rows[0].dueDate, '2026-11-01');
});

test('sum === total for every total / count / deposit combination (integers only)', () => {
  for (const total of [2, 7, 999, 65_000, 100_001, 1_234_567, 9_999_999]) {
    for (let count = 2; count <= 6; count++) {
      for (const dep of [{ depositPct: 10, depositAmount: null }, { depositPct: 33.33, depositAmount: null }, { depositPct: null, depositAmount: 1 }]) {
        const r = buildSchedule({ ...base, ...dep, total, count, frequency: 'weekly' });
        if (!r.ok) { assert.ok(['bad_deposit', 'amount_too_small'].includes(r.reason), `${total}/${count}: ${r.reason}`); continue; }
        assert.equal(sum(r.rows), total, `${total}/${count}`);
        assert.equal(r.rows.length, count);
        for (const row of r.rows) { assert.ok(Number.isInteger(row.amount) && row.amount > 0); }
        // only the last may differ from the even share
        const mids = r.rows.slice(1, -1).map((x) => x.amount);
        assert.ok(mids.every((a) => a === mids[0] || mids.length === 0));
      }
    }
  }
});

test('frequencies: weekly / biweekly / monthly due dates (month-end clamps)', () => {
  assert.equal(dueDateFor('2026-11-01', 2, 'weekly'), '2026-11-08');
  assert.equal(dueDateFor('2026-11-01', 3, 'biweekly'), '2026-11-29');
  assert.equal(dueDateFor('2026-11-01', 4, 'monthly'), '2027-02-01');
  assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
});

test('rejects a schedule that does not fit before the final due date', () => {
  const r = buildSchedule({ ...base, total: 90_000, count: 6, finalDue: '2027-01-15' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'does_not_fit');
  assert.match(r.message, /after the last payment date/);
  // the last payment exactly ON the final due date fits
  const edge = buildSchedule({ ...base, total: 90_000, count: 3, finalDue: '2027-01-01' });
  assert.equal(edge.ok, true);
});

test('rejects past final due, bad count, bad deposit, tiny totals, bad dates', () => {
  assert.equal(buildSchedule({ ...base, total: 1000, finalDue: '2026-10-31' }).reason, 'final_due_passed');
  assert.equal(buildSchedule({ ...base, total: 1000, count: 1 }).reason, 'bad_count');
  assert.equal(buildSchedule({ ...base, total: 1000, count: 7 }).reason, 'bad_count');
  assert.equal(buildSchedule({ ...base, total: 1000, depositPct: null, depositAmount: 1000 }).reason, 'bad_deposit');
  assert.equal(buildSchedule({ ...base, total: 1000.5 }).reason, 'bad_total');
  assert.equal(buildSchedule({ ...base, total: 1000, today: '2026-02-30' }).reason, 'bad_date');
  assert.equal(buildSchedule({ ...base, total: 3, count: 3, depositPct: 50 }).reason, 'bad_deposit'); // dep 2 leaves 1 for 2 payments
});

test('depositFor leaves at least 1 TSh per remaining payment', () => {
  assert.equal(depositFor(3, 50, null, 3), null);
  assert.equal(depositFor(4, 50, null, 3), 2);
  assert.equal(depositFor(100, null, 99, 2), 99);
  assert.equal(depositFor(100, null, 100, 2), null);
  assert.equal(depositFor(100, 0, null, 2), null);
});

test('finalDueFor + eatToday', () => {
  assert.equal(finalDueFor('2026-12-20', 7), '2026-12-13');
  assert.equal(finalDueFor('nope', 7), null);
  assert.equal(eatToday(new Date('2026-10-31T20:59:00Z')), '2026-10-31');
  assert.equal(eatToday(new Date('2026-10-31T21:00:00Z')), '2026-11-01'); // midnight EAT
});

test('sanitizeInstallmentConfig validates the offer; configCoversCart gates tiers', () => {
  const ok = sanitizeInstallmentConfig('e1', { enabled: true, depositPct: '25', count: 3, frequency: 'weekly', finalDueDaysBeforeEvent: 5, graceDays: 2, tiers: ['t1', 't1', 7] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.config.tiers, ['t1']);
  assert.equal(ok.config.depositPct, 25);
  const bad = sanitizeInstallmentConfig('e1', { depositPct: 10, depositAmount: 5, count: 9, frequency: 'daily', finalDueDaysBeforeEvent: -1, graceDays: 99 });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.sort(), ['count_range', 'deposit_one_of_pct_or_amount', 'final_due_days_range', 'frequency_invalid', 'grace_days_range'].sort());
  assert.equal(configCoversCart(ok.config, ['t1']), true);
  assert.equal(configCoversCart(ok.config, ['t1', 't2']), false);
  assert.equal(configCoversCart({ ...ok.config, tiers: [] }, ['t9']), true);
  assert.equal(configCoversCart({ ...ok.config, enabled: false }, ['t1']), false);
  assert.equal(configCoversCart(null, ['t1']), false);
});
