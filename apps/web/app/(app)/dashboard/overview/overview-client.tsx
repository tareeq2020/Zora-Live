'use client';

/* BS69 · Lane A — organizer Overview, on the Control-Room v2 primitives.
   KPI row → hero revenue chart → recent orders + your events (the ①②③ hierarchy
   from the plan's "Org Home"). Everything is theme-driven via the CR token set;
   the top-bar toggle flips light↔dark and persists.

   BS73 — WIRED to the real backend (mock seam removed):
     · KPIs + hero chart  ← GET /api/org/analytics?range=7D|14D|30D|ALL (Lane D)
     · Recent orders      ← GET /api/org/orders?limit=5           (BS58)
     · Your events        ← GET /api/org/summary                  (MT3)
   Each block keeps its own loading / empty / error state via the primitives. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CrShell,
  CrPromptBar,
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
// BS73 — the shared <CrShell> now carries the ≤900px focus-trapped hamburger
// drawer (folded in from Lane B), so every org surface uses it + the shared nav.
import { ORG_NAV } from '../components/org-nav';

const ORG_BRAND = { name: (<>z<span className="cr-o">o</span>ra</>), sublabel: 'Organizer' };

// ── Response shapes (Lane D contract — do NOT invent backend) ────────────────
type AnalyticsKpis = {
  revenue: number;
  netRevenue: number;
  ticketsSold: number;
  orders: number;
  avgOrderValue: number;
  conversionRate: number; // 0..1
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

type OrderRow = {
  orderId: string;
  eventName: string;
  tier: string;
  qty: number;
  amount: number;
  currency: string;
  status: string;
  buyer: { phone?: string; email?: string };
  createdAt: string;
};
type SummaryEvent = { id: string; name: string; status: string; sold: number; capacity: number; revenue: number; currency: string };

const DEFAULT_CURRENCY = 'TZS';
const fmt = (n: number) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US') : '—');

export default function OverviewClient() {
  const [range, setRange] = useState<ChartRange>('7D');

  // ① + ② analytics (KPIs + hero chart) — refetched per range ─────────────────
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [aLoading, setALoading] = useState(true);
  const [aError, setAError] = useState(false);

  const loadAnalytics = useCallback(async () => {
    setALoading(true);
    setAError(false);
    try {
      const res = await fetch(`/api/org/analytics?range=${encodeURIComponent(range)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAnalytics((await res.json()) as Analytics);
    } catch {
      setAError(true);
      setAnalytics(null);
    } finally {
      setALoading(false);
    }
  }, [range]);
  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  // ③ recent orders ───────────────────────────────────────────────────────────
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [oLoading, setOLoading] = useState(true);
  const [oError, setOError] = useState(false);

  const loadOrders = useCallback(async () => {
    setOLoading(true);
    setOError(false);
    try {
      const res = await fetch('/api/org/orders?limit=5', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rows?: OrderRow[] };
      setOrders(Array.isArray(data.rows) ? data.rows : []);
    } catch {
      setOError(true);
      setOrders(null);
    } finally {
      setOLoading(false);
    }
  }, []);
  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // ③ your events (from the sales summary) ─────────────────────────────────────
  const [events, setEvents] = useState<SummaryEvent[] | null>(null);
  const [eLoading, setELoading] = useState(true);
  const [eError, setEError] = useState(false);

  const loadEvents = useCallback(async () => {
    setELoading(true);
    setEError(false);
    try {
      const res = await fetch('/api/org/summary', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { events?: SummaryEvent[] };
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch {
      setEError(true);
      setEvents(null);
    } finally {
      setELoading(false);
    }
  }, []);
  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // ④ org identity — the topbar store label (BS74 #6: was hardcoded "The Brunch
  // City"). GET /api/org/me returns { name } for the logged-in organizer.
  const [orgName, setOrgName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/org/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && typeof d.name === 'string') setOrgName(d.name); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const currency = analytics?.currency || DEFAULT_CURRENCY;
  const k = analytics?.kpis;

  const chartData: ChartPoint[] = useMemo(
    () => (analytics?.series ?? []).map((p) => ({ label: p.date.slice(5), value: p.revenue })),
    [analytics],
  );

  const orderCols: Column<OrderRow>[] = [
    { key: 'buyer', header: 'Buyer', primary: true, render: (r) => r.buyer?.phone || r.buyer?.email || 'Unknown' },
    { key: 'event', header: 'Event', render: (r) => r.eventName },
    { key: 'tier', header: 'Tier', render: (r) => `${r.tier}${r.qty > 1 ? ` × ${r.qty}` : ''}` },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusPill tone={toneForStatus(r.status)} label={r.status} />,
    },
    { key: 'amount', header: 'Amount', numeric: true, render: (r) => `${fmt(r.amount)} ${r.currency || currency}` },
  ];

  const eventCols: Column<SummaryEvent>[] = [
    { key: 'name', header: 'Event', primary: true, render: (r) => r.name },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusPill tone={toneForStatus(r.status)} label={r.status === 'published' ? 'live' : r.status} />,
    },
    { key: 'sold', header: 'Sold', numeric: true, render: (r) => `${fmt(r.sold)}/${fmt(r.capacity)}` },
  ];

  return (
    <CrShell
      nav={ORG_NAV}
      brand={ORG_BRAND}
      topbarTitle="Home"
      topbarExtra={<span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: 'var(--cr-ink2)' }}>{orgName || ' '}</span>}
      footer={
        <>
          <a href="/dashboard/onboarding">GET STARTED</a> &middot; <a href="/">ZORA.COM</a>
        </>
      }
    >
      <div className="cr-stack">
        {/* ① Share prompt bar — the growth lever, above the KPIs (BS86 · IA Pass 1) */}
        <CrPromptBar />

        {/* ② KPI row — revenue first (DESIGN Control-Room v2) */}
        <KPIRow>
          <KPITile label="Revenue" tint="blue" value={k ? fmt(k.revenue) : null} unit={currency} loading={aLoading} error={aError} onRetry={loadAnalytics} />
          <KPITile label="Net" tint="green" value={k ? fmt(k.netRevenue) : null} unit={currency} loading={aLoading} error={aError} onRetry={loadAnalytics} />
          <KPITile label="Tickets sold" tint="cyan" value={k ? fmt(k.ticketsSold) : null} loading={aLoading} error={aError} onRetry={loadAnalytics} />
          <KPITile label="Avg order" tint="neutral" value={k ? fmt(Math.round(k.avgOrderValue)) : null} unit={currency} loading={aLoading} error={aError} onRetry={loadAnalytics} />
          <KPITile label="Conversion" tint="amber" value={k ? Math.round(k.conversionRate * 100) : null} unit="%" loading={aLoading} error={aError} onRetry={loadAnalytics} />
        </KPIRow>

        {/* ② hero revenue chart */}
        <HeroChart
          title="Revenue over time"
          data={chartData}
          total={k ? fmt(k.revenue) : undefined}
          totalUnit={currency}
          range={range}
          onRangeChange={setRange}
          loading={aLoading}
          error={aError ? 'Chart unavailable' : null}
          onRetry={loadAnalytics}
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
              rows={orders ?? []}
              rowKey={(r) => r.orderId}
              loading={oLoading}
              error={oError ? 'Could not load orders.' : null}
              onRetry={loadOrders}
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
              rows={events ?? []}
              rowKey={(r) => r.id}
              collapseAt={1120}
              loading={eLoading}
              error={eError ? 'Could not load events.' : null}
              onRetry={loadEvents}
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
