/* BS70 (dashboard #8) — analytics bucketing/aggregation guard. Pure, no DB:
   build core first (`pnpm --filter "@zora/core..." build`); we import dist.

   `buildAnalytics` is the ONE place the dashboard's revenue series + KPIs are
   shaped from the already-netted OrderMoney (it never re-derives commission).
   Two of its behaviours are the plan's critical analytics failure-modes:
     · no paid orders            → an EMPTY funnel (zeroed KPIs, empty ALL series)
     · a fixed range with no data → a FLAT baseline (every day present at 0) */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAnalytics, normalizeRange, rangeDays } from '../dist/index.js';

const NOW = new Date('2026-08-19T12:00:00.000Z'); // today = 2026-08-19 (UTC)

function order(createdAt, { status = 'paid', currency = 'TZS', gross, net, tickets = 1 } = {}) {
  return { orderId: createdAt + currency, createdAt, status, currency, gross, net, tickets };
}

test('range coercion: valid passes, garbage → 30D', () => {
  assert.equal(normalizeRange('7D'), '7D');
  assert.equal(normalizeRange('all'), 'ALL');
  assert.equal(normalizeRange('nonsense'), '30D');
  assert.equal(normalizeRange(undefined), '30D');
  assert.equal(rangeDays('14D'), 14);
  assert.equal(rangeDays('ALL'), null);
});

// ── FAILURE MODE 1: no paid orders → empty funnel ────────────────────────────
test('no paid orders → empty funnel (ALL): zeroed KPIs, empty series, null currency', () => {
  const r = buildAnalytics({
    money: [],
    startedAt: ['2026-08-19T09:00:00Z', '2026-08-18T09:00:00Z'], // pending carts only
    checkedIn: 0,
    range: 'ALL',
    now: NOW,
  });
  assert.deepEqual(r.series, []);                 // ALL with no sales → no baseline to draw
  assert.equal(r.currency, null);
  assert.deepEqual(r.revenueByCurrency, []);
  assert.equal(r.kpis.revenue, 0);
  assert.equal(r.kpis.netRevenue, 0);
  assert.equal(r.kpis.ticketsSold, 0);
  assert.equal(r.kpis.orders, 0);
  assert.equal(r.kpis.avgOrderValue, 0);          // no divide-by-zero
  assert.equal(r.kpis.conversionRate, 0);         // 0 paid / 2 started
});

// ── FAILURE MODE 2: a fixed range with no data → flat baseline ───────────────
test('fixed range with no data → flat baseline (every day present at 0)', () => {
  const r = buildAnalytics({ money: [], startedAt: [], checkedIn: 0, range: '7D', now: NOW });
  assert.equal(r.series.length, 7);                       // NOT an empty/gappy chart
  assert.ok(r.series.every((p) => p.revenue === 0 && p.orders === 0 && p.tickets === 0));
  assert.equal(r.series[0].date, '2026-08-13');           // window start
  assert.equal(r.series[6].date, '2026-08-19');           // today
  assert.equal(r.kpis.revenue, 0);
  assert.equal(r.kpis.conversionRate, 0);
});

// ── healthy account ──────────────────────────────────────────────────────────
test('healthy: buckets fill, KPIs aggregate, conversion + AOV computed', () => {
  const money = [
    order('2026-08-19T10:00:00Z', { gross: 100_000, net: 95_000, tickets: 2 }),
    order('2026-08-18T10:00:00Z', { gross: 50_000, net: 47_500, tickets: 1 }),
    order('2026-08-01T10:00:00Z', { gross: 30_000, net: 28_500, tickets: 1 }), // outside 7D
  ];
  const startedAt = [
    '2026-08-19T10:00:00Z', '2026-08-18T10:00:00Z', '2026-08-01T10:00:00Z',
    '2026-08-19T09:00:00Z', '2026-08-17T09:00:00Z', // 2 pending carts in the 7D window
  ];

  const w = buildAnalytics({ money, startedAt, checkedIn: 3, range: '7D', now: NOW });
  assert.equal(w.currency, 'TZS');
  assert.equal(w.kpis.revenue, 150_000);          // 08-01 excluded by the window
  assert.equal(w.kpis.netRevenue, 142_500);
  assert.equal(w.kpis.ticketsSold, 3);
  assert.equal(w.kpis.orders, 2);
  assert.equal(w.kpis.avgOrderValue, 75_000);     // 150000 / 2
  assert.equal(w.kpis.conversionRate, 0.5);       // 2 paid / 4 started in-range
  assert.equal(w.kpis.checkedIn, 3);
  assert.equal(w.series.length, 7);
  assert.equal(w.series.find((p) => p.date === '2026-08-19').revenue, 100_000);
  assert.equal(w.series.find((p) => p.date === '2026-08-18').revenue, 50_000);
  assert.equal(w.series.find((p) => p.date === '2026-08-17').revenue, 0); // flat where empty

  // ALL widens the window to the earliest sale (08-01).
  const all = buildAnalytics({ money, startedAt, checkedIn: 3, range: 'ALL', now: NOW });
  assert.equal(all.kpis.revenue, 180_000);
  assert.equal(all.kpis.orders, 3);
  assert.equal(all.series[0].date, '2026-08-01');
  assert.equal(all.series[all.series.length - 1].date, '2026-08-19');
});

// ── currency isolation (I7): never sum across currencies ─────────────────────
test('multi-currency: scalars scoped to the headline, full split surfaced', () => {
  const money = [
    order('2026-08-19T10:00:00Z', { currency: 'TZS', gross: 150_000, net: 142_500, tickets: 2 }),
    order('2026-08-19T11:00:00Z', { currency: 'USD', gross: 200, net: 190, tickets: 1 }),
  ];
  const r = buildAnalytics({ money, startedAt: [], checkedIn: 0, range: '7D', now: NOW });
  assert.equal(r.currency, 'TZS');                // largest revenue bucket
  assert.equal(r.kpis.revenue, 150_000);          // USD NOT summed in
  assert.equal(r.kpis.ticketsSold, 2);            // only the headline currency's seats
  assert.deepEqual(r.revenueByCurrency, [
    { currency: 'TZS', revenue: 150_000 },
    { currency: 'USD', revenue: 200 },
  ]);
});

// ── refunds: a refunded order adjusts revenue but is not a sale ──────────────
test('refunded order (gross already net-of-refund) is not counted as a paid order', () => {
  const money = [
    order('2026-08-19T10:00:00Z', { gross: 100_000, net: 95_000, tickets: 2 }),
    order('2026-08-19T11:00:00Z', { status: 'refunded', gross: 0, net: 0, tickets: 0 }),
  ];
  const r = buildAnalytics({ money, startedAt: [], checkedIn: 0, range: '7D', now: NOW });
  assert.equal(r.kpis.orders, 1);                 // refunded order not a sale
  assert.equal(r.kpis.ticketsSold, 2);
  assert.equal(r.kpis.revenue, 100_000);
});
