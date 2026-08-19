'use client';

/* PR-BS72 · Lane C — super-admin Overview, on the Control-Room v2 primitives.
   The all-orgs counterpart to the organizer Overview: the ①②③ hierarchy from
   the plan's "Admin Overview" — ① platform GMV + take → ② GMV over time →
   ③ the attention queue (pending carts + verifications waiting).

   BS73 — WIRED: ① + ② now read GET /api/admin/analytics?range=… (Lane D · BS70,
   the platform-wide all-orgs variant; platform take = revenue − netRevenue).
   Mapped straight to what that endpoint returns — no invented org/event counts.

   ┌──────────────────────── SEAM (attention queue) ─────────────────────────┐
   │ ③ "Needs attention" is NOT part of the analytics contract and there is   │
   │ no single admin "attention" endpoint. It stays a typed seam (mock below).│
   │ TODO(admin-attention): assemble it from /api/admin/orders?status=pending │
   │ + the KYC/verification queue once a combined read exists.                │
   └──────────────────────────────────────────────────────────────────────────┘ */

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { adminApi, useAdminResource } from '../../dashboard/admin-kit';
import { AdminConsoleShell } from '../console-shell';

// ── /api/admin/analytics response (Lane D contract — same shape as org) ──────
type AnalyticsKpis = {
  revenue: number;
  netRevenue: number;
  ticketsSold: number;
  orders: number;
  avgOrderValue: number;
  conversionRate: number;
  checkedIn: number;
  currency: string | null;
};
type SeriesPoint = { date: string; revenue: number; netRevenue: number; orders: number; tickets: number };
type Analytics = {
  range: ChartRange;
  currency: string | null;
  series: SeriesPoint[];
  kpis: AnalyticsKpis;
  revenueByCurrency: { currency: string; revenue: number }[];
};

// ── SEAM: attention queue (no endpoint yet — see header) ─────────────────────
type AttentionRow = {
  id: string;
  kind: 'cart' | 'verification';
  label: string;
  org: string;
  status: string;
  age: string;
};
function useMockAttention(): AttentionRow[] {
  return useMemo(
    () => [
      { id: 'c_7731', kind: 'cart', label: 'Cart · 2× VIP Table', org: 'The Brunch City', status: 'pending', age: '6m' },
      { id: 'c_7728', kind: 'cart', label: 'Cart · GA', org: 'The Weekendar', status: 'failed', age: '18m' },
      { id: 'v_1042', kind: 'verification', label: 'KYC · ID submission', org: 'Neon Nights TZ', status: 'pending', age: '3h' },
      { id: 'c_7719', kind: 'cart', label: 'Cart · Early bird', org: 'Sundown Sessions', status: 'expired', age: '5h' },
      { id: 'v_1039', kind: 'verification', label: 'Organizer sign-up', org: 'Coastline Co.', status: 'pending', age: '1d' },
    ],
    [],
  );
}

const DEFAULT_CURRENCY = 'TZS';
const fmt = (n: number) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US') : '—');

export default function AdminOverviewClient() {
  const [range, setRange] = useState<ChartRange>('7D');

  const load = useCallback(() => adminApi<Analytics>(`/api/admin/analytics?range=${encodeURIComponent(range)}`), [range]);
  const res = useAdminResource<Analytics>(load);
  const analytics = res.data;
  const aLoading = res.status === 'loading' && !res.loaded;
  const aError = res.status === 'error';

  const currency = analytics?.currency || DEFAULT_CURRENCY;
  const k = analytics?.kpis;
  const take = k ? Math.max(0, k.revenue - k.netRevenue) : null;

  const chartData: ChartPoint[] = useMemo(
    () => (analytics?.series ?? []).map((p) => ({ label: p.date.slice(5), value: p.revenue })),
    [analytics],
  );

  const attention = useMockAttention();
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
          <KPITile label="Platform GMV" tint="blue" value={k ? fmt(k.revenue) : null} unit={currency} loading={aLoading} error={aError} onRetry={res.reload} />
          <KPITile label="Platform take" tint="green" value={take != null ? fmt(take) : null} unit={currency} loading={aLoading} error={aError} onRetry={res.reload} />
          <KPITile label="Tickets sold" tint="cyan" value={k ? fmt(k.ticketsSold) : null} loading={aLoading} error={aError} onRetry={res.reload} />
          <KPITile label="Orders" tint="neutral" value={k ? fmt(k.orders) : null} loading={aLoading} error={aError} onRetry={res.reload} />
          <KPITile label="Checked in" tint="amber" value={k ? fmt(k.checkedIn) : null} loading={aLoading} error={aError} onRetry={res.reload} />
        </KPIRow>

        {/* ② platform GMV over time */}
        <HeroChart
          title="Platform GMV over time"
          data={chartData}
          total={k ? fmt(k.revenue) : undefined}
          totalUnit={currency}
          range={range}
          onRangeChange={setRange}
          loading={aLoading}
          error={aError ? 'Chart unavailable' : null}
          onRetry={res.reload}
          onExport={() => {
            /* TODO(Lane D): wire to a CSV export of the platform analytics series */
          }}
        />

        {/* ③ attention queue — pending carts + verifications waiting (SEAM) */}
        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h">Needs attention</h2>
          </div>
          <DataTable
            columns={attentionCols}
            rows={attention}
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
