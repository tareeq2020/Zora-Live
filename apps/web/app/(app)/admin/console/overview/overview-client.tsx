'use client';

/* PR-BS72 · Lane C — super-admin Overview, on the Control-Room v2 primitives.
   The all-orgs counterpart to the organizer Overview: the ①②③ hierarchy from
   the plan's "Admin Overview" — ① platform GMV + take → ② GMV over time →
   ③ the attention queue.

   BS73 — WIRED: ① + ② now read GET /api/admin/analytics?range=… (Lane D · BS70,
   the platform-wide all-orgs variant; platform take = revenue − netRevenue).
   Mapped straight to what that endpoint returns — no invented org/event counts.

   BS152 — ③ reads GET /api/admin/attention: every queue where an admin has to
   act (money taken but not delivered, stuck payments, ops alerts, payouts,
   installment refunds, KYC, unnotified buyers), severity first, oldest first. */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  KPIRow,
  KPITile,
  HeroChart,
  DataTable,
  StatusPill,
  type ChartPoint,
  type ChartRange,
  type Column,
  type PillTone,
} from '@/app/components/cr';
import { adminApi, ageLabel, useAdminResource, useNow } from '../admin-kit';
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

// ── /api/admin/attention response (BS152) ────────────────────────────────────
type Severity = 'critical' | 'high' | 'normal';
type AttentionItem = {
  id: string;
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
  organizerHandle: string | null;
  organizerName: string | null;
  eventName: string | null;
  amount: number | null;
  currency: string | null;
  since: string;
  href: string;
};
type Attention = { generatedAt: string; counts: Record<string, number>; items: AttentionItem[] };

const SEVERITY_TONE: Record<Severity, PillTone> = { critical: 'failed', high: 'pending', normal: 'neutral' };
/** Count chips, in severity order. */
const KIND_LABEL: [string, string, Severity][] = [
  ['paid_unseatable', 'Paid, unseatable', 'critical'],
  ['payment_short', 'Under-paid', 'critical'],
  ['paid_no_passes', 'Paid, no tickets', 'critical'],
  ['payment_stuck', 'Payment stuck', 'high'],
  ['ops_alert', 'Ops alerts', 'high'],
  ['payout_request', 'Payouts', 'high'],
  ['installment_refund', 'Installment refunds', 'high'],
  ['kyc_review', 'KYC', 'normal'],
  ['org_signup', 'Sign-ups', 'normal'],
  ['buyer_not_notified', 'Not notified', 'normal'],
];
const loadAttention = () => adminApi<Attention>('/api/admin/attention');

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

  const now = useNow();
  const att = useAdminResource<Attention>(loadAttention);
  const attItems = att.data?.items ?? [];
  const attCounts = att.data?.counts ?? {};
  const attTotal = Object.values(attCounts).reduce((a, n) => a + (Number(n) || 0), 0);
  const attentionCols: Column<AttentionItem>[] = [
    {
      key: 'severity',
      header: 'Severity',
      render: (r) => <StatusPill tone={SEVERITY_TONE[r.severity] ?? 'neutral'} label={r.severity} />,
    },
    {
      key: 'title',
      header: 'Item',
      primary: true,
      render: (r) => (
        <Link href={r.href} className="attn-link">
          <span className="attn-title">{r.title}</span>
          <span className="attn-detail">{r.eventName ? `${r.eventName} · ${r.detail}` : r.detail}</span>
        </Link>
      ),
    },
    { key: 'org', header: 'Organizer', render: (r) => r.organizerName ?? '—' },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      render: (r) => (r.amount != null ? `${fmt(r.amount)} ${r.currency || DEFAULT_CURRENCY}` : '—'),
    },
    { key: 'age', header: 'Age', numeric: true, render: (r) => ageLabel(r.since, now).text },
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

        {/* ③ attention queue — GET /api/admin/attention */}
        <section className="cr-panel">
          <style>{`
            .attn-counts { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 0 0 12px; padding: 0; list-style: none; }
            .attn-counts li { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--cr-ink2); }
            .attn-counts b { font-family: var(--cr-mono); font-weight: 600; color: var(--cr-ink); }
            .attn-link { display: flex; flex-direction: column; gap: 2px; color: inherit; text-decoration: none; }
            .attn-link:hover .attn-title, .attn-link:focus-visible .attn-title { text-decoration: underline; }
            .attn-title { font-weight: 600; }
            .attn-detail { font-size: 12px; color: var(--cr-ink2); }
          `}</style>
          <div className="cr-panel-head">
            <h2 className="cr-section-h">Needs attention{att.data ? ` · ${fmt(attTotal)}` : ''}</h2>
          </div>
          {att.data && attTotal > 0 ? (
            <ul className="attn-counts" aria-label="Open items by type">
              {KIND_LABEL.filter(([kind]) => (attCounts[kind] ?? 0) > 0).map(([kind, label, sev]) => (
                <li key={kind}>
                  <StatusPill tone={SEVERITY_TONE[sev]} label={sev} />
                  <span>
                    <b>{fmt(attCounts[kind])}</b> {label}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <DataTable
            columns={attentionCols}
            rows={attItems}
            rowKey={(r) => r.id}
            loading={att.status === 'loading' && !att.loaded}
            error={att.status === 'error' ? att.error || 'Attention queue unavailable' : null}
            onRetry={att.reload}
            skeletonRows={4}
            caption="Items needing attention"
            emptyTitle="All clear"
            emptyBody={<span>Nothing needs an admin right now.</span>}
          />
          {att.data && attTotal > attItems.length ? (
            <p className="attn-detail" style={{ marginTop: 8 }}>
              Showing the {attItems.length} most urgent of {fmt(attTotal)}.
            </p>
          ) : null}
        </section>
      </div>
    </AdminConsoleShell>
  );
}
