'use client';

/* BS69 · Lane A — organizer Overview, on the Control-Room v2 primitives.
   Proof-of-concept: KPI row → hero revenue chart → recent orders + your events
   (the ①②③ hierarchy from the plan's "Org Home"). Everything is theme-driven
   via the CR token set; the top-bar toggle flips light↔dark and persists.

   ┌─────────────────────────── SEAM (Lane D) ───────────────────────────┐
   │ The data below is MOCK. Lane D builds GET /api/org/analytics (funnel  │
   │ + revenue-over-time + counts, reusing earnings.ts). To go live:       │
   │   1. replace `useMockAnalytics()` with a real fetch of that endpoint  │
   │      (mirror dashboard-client.tsx's Async<T> + fetchJson pattern);    │
   │   2. keep the same shape (see the `Analytics` type) so the JSX below   │
   │      is untouched; the primitives already render loading/empty/error. │
   └──────────────────────────────────────────────────────────────────────┘ */

import { useMemo, useState } from 'react';
import {
  CrShell,
  KPIRow,
  KPITile,
  HeroChart,
  DataTable,
  StatusPill,
  toneForStatus,
  type CrNavItem,
  type ChartPoint,
  type ChartRange,
  type Column,
} from '@/app/components/cr';

// ── Contract the real endpoint should satisfy (Lane D fills it) ──────────────
type Order = {
  id: string;
  buyer: string;
  event: string;
  tier: string;
  method: string;
  amount: number;
  currency: string;
  status: string;
};
type EventRow = { id: string; name: string; date: string; status: string; sold: number; capacity: number };
type Analytics = {
  currency: string;
  kpis: { revenue: number; net: number; sold: number; avgOrder: number; conversion: number };
  deltas: { revenue: string; sold: string; avgOrder: string; conversion: string };
  seriesByRange: Record<ChartRange, ChartPoint[]>;
  orders: Order[];
  events: EventRow[];
};

const CURRENCY = 'TZS';

function series(days: number, base: number, amp: number): ChartPoint[] {
  const out: ChartPoint[] = [];
  const now = new Date('2026-08-19');
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const wobble = Math.sin(i / 2.3) * amp + Math.cos(i / 5) * amp * 0.4;
    const value = Math.max(0, Math.round(base + wobble + (days - i) * (base * 0.012)));
    out.push({ label: d.toISOString().slice(5, 10), value });
  }
  return out;
}

// ── SEAM: swap this hook for a fetch of /api/org/analytics (Lane D) ──────────
function useMockAnalytics(): Analytics {
  return useMemo(
    () => ({
      currency: CURRENCY,
      kpis: { revenue: 4820500, net: 4098425, sold: 214, avgOrder: 22526, conversion: 38 },
      deltas: { revenue: '12% WoW', sold: '8% WoW', avgOrder: '3% WoW', conversion: '2pt WoW' },
      seriesByRange: {
        '7D': series(7, 520000, 140000),
        '14D': series(14, 430000, 150000),
        '30D': series(30, 360000, 160000),
        ALL: series(30, 200000, 180000),
      },
      orders: [
        { id: 'o_9f21', buyer: 'Amina K.', event: 'Apricot Crush', tier: 'GA', method: 'M-Pesa', amount: 25000, currency: CURRENCY, status: 'paid' },
        { id: 'o_9f18', buyer: 'Joseph M.', event: 'Apricot Crush', tier: 'VIP Table', method: 'Card', amount: 180000, currency: CURRENCY, status: 'paid' },
        { id: 'o_9f14', buyer: 'Neema S.', event: 'Apricot Crush', tier: 'GA', method: 'Airtel', amount: 25000, currency: CURRENCY, status: 'pending' },
        { id: 'o_9f0e', buyer: 'David O.', event: 'Sundown Sessions', tier: 'Early', method: 'M-Pesa', amount: 18000, currency: CURRENCY, status: 'paid' },
        { id: 'o_9f07', buyer: 'Grace T.', event: 'Sundown Sessions', tier: 'Early', method: 'Card', amount: 18000, currency: CURRENCY, status: 'failed' },
      ],
      events: [
        { id: 'e_apr', name: 'Apricot Crush', date: 'Aug 30', status: 'published', sold: 168, capacity: 300 },
        { id: 'e_sun', name: 'Sundown Sessions', date: 'Sep 13', status: 'published', sold: 46, capacity: 200 },
        { id: 'e_nye', name: 'NYE Rooftop', date: 'Dec 31', status: 'draft', sold: 0, capacity: 400 },
      ],
    }),
    [],
  );
}

const NAV: CrNavItem[] = [
  { href: '/dashboard/overview', label: 'Overview' },
  { href: '/dashboard', label: 'Home (legacy)', exact: true },
  { href: '/dashboard/sales', label: 'Sales' },
  { href: '/dashboard/events/new', label: 'Events' },
  { href: '/dashboard/payouts', label: 'Payouts' },
  { href: '/dashboard/storefront/studio', label: 'Storefront' },
  { href: '/help', label: 'Help & Support' },
];

const fmt = (n: number) => n.toLocaleString('en-US');

export default function OverviewClient() {
  const a = useMockAnalytics();
  const [range, setRange] = useState<ChartRange>('7D');

  const chartData = a.seriesByRange[range];
  const rangeTotal = useMemo(() => chartData.reduce((s, p) => s + p.value, 0), [chartData]);

  const orderCols: Column<Order>[] = [
    { key: 'buyer', header: 'Buyer', primary: true, render: (r) => r.buyer },
    { key: 'event', header: 'Event', render: (r) => r.event },
    { key: 'tier', header: 'Tier', render: (r) => r.tier },
    { key: 'method', header: 'Method', render: (r) => r.method },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusPill tone={toneForStatus(r.status)} label={r.status} />,
    },
    { key: 'amount', header: `Amount (${CURRENCY})`, numeric: true, render: (r) => fmt(r.amount) },
  ];

  const eventCols: Column<EventRow>[] = [
    { key: 'name', header: 'Event', primary: true, render: (r) => r.name },
    { key: 'date', header: 'Date', render: (r) => r.date },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusPill tone={toneForStatus(r.status)} label={r.status === 'published' ? 'live' : r.status} />,
    },
    { key: 'sold', header: 'Sold', numeric: true, render: (r) => `${fmt(r.sold)}/${fmt(r.capacity)}` },
  ];

  return (
    <CrShell
      nav={NAV}
      brand={{ name: <>z<span className="cr-o">o</span>ra</>, sublabel: 'Organizer' }}
      topbarTitle="Overview"
      topbarExtra={<span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: 'var(--cr-ink2)' }}>The Brunch City</span>}
      footer={
        <>
          <a href="/dashboard/onboarding">GET STARTED</a> &middot; <a href="/">ZORA.COM</a>
        </>
      }
    >
      <div className="cr-stack">
        {/* ① KPI row — revenue first (DESIGN Control-Room v2) */}
        <KPIRow>
          <KPITile label="Revenue" tint="blue" value={fmt(a.kpis.revenue)} unit={CURRENCY} delta={{ dir: 'up', label: a.deltas.revenue }} />
          <KPITile label="Net" tint="green" value={fmt(a.kpis.net)} unit={CURRENCY} />
          <KPITile label="Tickets sold" tint="cyan" value={fmt(a.kpis.sold)} delta={{ dir: 'up', label: a.deltas.sold }} />
          <KPITile label="Avg order" tint="neutral" value={fmt(a.kpis.avgOrder)} unit={CURRENCY} delta={{ dir: 'up', label: a.deltas.avgOrder }} />
          <KPITile label="Conversion" tint="amber" value={a.kpis.conversion} unit="%" delta={{ dir: 'flat', label: a.deltas.conversion }} />
        </KPIRow>

        {/* ② hero revenue chart */}
        <HeroChart
          title="Revenue over time"
          data={chartData}
          total={fmt(rangeTotal)}
          totalUnit={CURRENCY}
          range={range}
          onRangeChange={setRange}
          onExport={() => {
            /* SEAM(Lane D): wire to a CSV export of the analytics series */
          }}
        />

        {/* ③ recent orders + your events */}
        <div className="cr-two-col">
          <section className="cr-panel">
            <div className="cr-panel-head">
              <h2 className="cr-section-h">Recent orders</h2>
            </div>
            <DataTable
              columns={orderCols}
              rows={a.orders}
              rowKey={(r) => r.id}
              caption="Recent orders"
              emptyTitle="No orders yet"
              emptyBody={<span>Share your storefront to make your first sale.</span>}
            />
          </section>

          <section className="cr-panel">
            <div className="cr-panel-head">
              <h2 className="cr-section-h">Your events</h2>
            </div>
            <DataTable
              columns={eventCols}
              rows={a.events}
              rowKey={(r) => r.id}
              collapseAt={1120}
              caption="Your events"
              emptyTitle="No events yet"
              emptyBody={<span>Create your first drop to start selling.</span>}
            />
          </section>
        </div>
      </div>
    </CrShell>
  );
}
