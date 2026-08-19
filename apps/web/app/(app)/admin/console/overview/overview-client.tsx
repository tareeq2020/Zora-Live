'use client';

/* PR-BS72 · Lane C — super-admin Overview, on the Control-Room v2 primitives.
   The all-orgs counterpart to the organizer Overview: the ①②③ hierarchy from
   the plan's "Admin Overview" — ① platform GMV + take → ② GMV over time →
   ③ the attention queue (pending carts + verifications waiting).

   ┌─────────────────────────── SEAM (Lane D) ───────────────────────────┐
   │ The platform analytics below are MOCK. Lane D (PR-BS70) builds        │
   │ GET /api/admin/analytics (all-orgs GMV + take + counts + the funnel,  │
   │ reusing earnings.ts). To go live:                                     │
   │   1. replace `useMockAdminAnalytics()` with a real fetch of that      │
   │      endpoint (mirror admin-kit's useAdminResource / adminApi);       │
   │   2. keep the `AdminAnalytics` shape so the JSX is untouched — the     │
   │      primitives already render loading / empty / error.               │
   └──────────────────────────────────────────────────────────────────────┘ */

import { useMemo, useState } from 'react';
import {
  KPIRow,
  KPITile,
  HeroChart,
  DataTable,
  StatusPill,
  toneForStatus,
  type ChartPoint,
  type ChartRange,
  type Column,
} from '@/app/components/cr';
import { AdminConsoleShell } from '../console-shell';

// ── Contract the real endpoint should satisfy (Lane D fills it) ──────────────
type AttentionRow = {
  id: string;
  kind: 'cart' | 'verification';
  label: string;
  org: string;
  status: string;
  age: string;
};
type AdminAnalytics = {
  currency: string;
  kpis: { gmv: number; take: number; organizers: number; events: number; tickets: number };
  deltas: { gmv: string; take: string; tickets: string };
  seriesByRange: Record<ChartRange, ChartPoint[]>;
  attention: AttentionRow[];
};

const CURRENCY = 'TZS';
const fmt = (n: number) => n.toLocaleString('en-US');

function series(days: number, base: number, amp: number): ChartPoint[] {
  const out: ChartPoint[] = [];
  const now = new Date('2026-08-19');
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const wobble = Math.sin(i / 2.1) * amp + Math.cos(i / 4.3) * amp * 0.5;
    const value = Math.max(0, Math.round(base + wobble + (days - i) * (base * 0.014)));
    out.push({ label: d.toISOString().slice(5, 10), value });
  }
  return out;
}

// ── SEAM: swap this hook for a fetch of /api/admin/analytics (Lane D) ────────
function useMockAdminAnalytics(): AdminAnalytics {
  return useMemo(
    () => ({
      currency: CURRENCY,
      kpis: { gmv: 38420900, take: 3457881, organizers: 24, events: 61, tickets: 4820 },
      deltas: { gmv: '9% WoW', take: '9% WoW', tickets: '11% WoW' },
      seriesByRange: {
        '7D': series(7, 3900000, 900000),
        '14D': series(14, 3200000, 950000),
        '30D': series(30, 2600000, 1100000),
        ALL: series(30, 1400000, 1200000),
      },
      attention: [
        { id: 'c_7731', kind: 'cart', label: 'Cart · 2× VIP Table', org: 'The Brunch City', status: 'pending', age: '6m' },
        { id: 'c_7728', kind: 'cart', label: 'Cart · GA', org: 'The Weekendar', status: 'failed', age: '18m' },
        { id: 'v_1042', kind: 'verification', label: 'KYC · ID submission', org: 'Neon Nights TZ', status: 'pending', age: '3h' },
        { id: 'c_7719', kind: 'cart', label: 'Cart · Early bird', org: 'Sundown Sessions', status: 'expired', age: '5h' },
        { id: 'v_1039', kind: 'verification', label: 'Organizer sign-up', org: 'Coastline Co.', status: 'pending', age: '1d' },
      ],
    }),
    [],
  );
}

export default function AdminOverviewClient() {
  const a = useMockAdminAnalytics();
  const [range, setRange] = useState<ChartRange>('7D');

  const chartData = a.seriesByRange[range];
  const rangeTotal = useMemo(() => chartData.reduce((s, p) => s + p.value, 0), [chartData]);

  const attentionCols: Column<AttentionRow>[] = [
    { key: 'label', header: 'Item', primary: true, render: (r) => r.label },
    { key: 'org', header: 'Organizer', render: (r) => r.org },
    {
      key: 'kind',
      header: 'Type',
      render: (r) => <StatusPill tone="neutral" label={r.kind === 'cart' ? 'cart' : 'kyc'} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusPill tone={toneForStatus(r.status)} label={r.status} />,
    },
    { key: 'age', header: 'Age', numeric: true, render: (r) => r.age },
  ];

  return (
    <AdminConsoleShell title="Overview">
      <div className="cr-stack">
        {/* ① platform GMV + take (revenue first) — all-orgs scope */}
        <KPIRow>
          <KPITile label="Platform GMV" tint="blue" value={fmt(a.kpis.gmv)} unit={CURRENCY} delta={{ dir: 'up', label: a.deltas.gmv }} />
          <KPITile label="Platform take" tint="green" value={fmt(a.kpis.take)} unit={CURRENCY} delta={{ dir: 'up', label: a.deltas.take }} />
          <KPITile label="Organizers" tint="cyan" value={fmt(a.kpis.organizers)} />
          <KPITile label="Events" tint="neutral" value={fmt(a.kpis.events)} />
          <KPITile label="Tickets sold" tint="amber" value={fmt(a.kpis.tickets)} delta={{ dir: 'up', label: a.deltas.tickets }} />
        </KPIRow>

        {/* ② platform GMV over time */}
        <HeroChart
          title="Platform GMV over time"
          data={chartData}
          total={fmt(rangeTotal)}
          totalUnit={CURRENCY}
          range={range}
          onRangeChange={setRange}
          onExport={() => {
            /* TODO(Lane D): wire to a CSV export of the platform analytics series */
          }}
        />

        {/* ③ attention queue — pending carts + verifications waiting */}
        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h">Needs attention</h2>
          </div>
          <DataTable
            columns={attentionCols}
            rows={a.attention}
            rowKey={(r) => r.id}
            caption="Items needing attention"
            emptyTitle="All clear"
            emptyBody={<span>No pending carts or verifications waiting right now.</span>}
          />
        </section>
      </div>
    </AdminConsoleShell>
  );
}
