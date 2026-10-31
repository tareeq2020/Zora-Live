'use client';

/* BS128/BS129: storefront analytics view, shared by the organizer console
   (/dashboard/analytics) and the super-admin console (/admin/console/analytics).
   Story order (DD7): KPI row → visits over time → visit-to-pass funnel →
   where visitors came from → most viewed events (→ organizers, admin only).
   Counts only: no visitor names, numbers or emails exist to show. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { KPIRow, KPITile, HeroChart, DataTable, type ChartPoint, type ChartRange, type Column } from '@/app/components/cr';

type TopEvent = { eventId: string; name: string; org?: string; views: number; visitors: number; purchases: number; passes: number; conversion: number };
type OrgRow = { org: string; visits: number; eventViews: number; visitors: number; purchases: number; passes: number; gmv: number; conversion: number };
type Data = {
  days: number;
  kpis: { storefrontVisits: number; visitors: number; pageViews: number; eventViews: number; purchases: number; passesSold: number; conversion: number };
  series: { date: string; visits: number; eventViews: number }[];
  sources: { source: string; views: number }[];
  topEvents: TopEvent[];
  funnel: { visitors: number; eventViewers: number; checkoutsStarted: number; purchases: number };
  organizers?: OrgRow[];
};

const fmt = (n: number | undefined) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US') : '—');
const pct = (r: number | undefined) => (typeof r === 'number' && isFinite(r) ? (r * 100).toFixed(1) : '—');
const SOURCE_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook', google: 'Google', tiktok: 'TikTok', x: 'X', direct: 'Direct / typed', other: 'Other',
};
// HeroChart ranges are 7D/14D/30D/ALL; the analytics API takes 7D/30D/90D.
const API_RANGE: Record<ChartRange, string> = { '7D': '7D', '14D': '30D', '30D': '30D', ALL: '90D' };

export default function StorefrontAnalyticsView({ endpoint, admin = false }: { endpoint: string; admin?: boolean }) {
  const [range, setRange] = useState<ChartRange>('30D');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`${endpoint}?range=${API_RANGE[range]}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Data);
    } catch {
      setError(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [endpoint, range]);
  useEffect(() => { load(); }, [load]);

  const k = data?.kpis;
  const chart: ChartPoint[] = useMemo(() => (data?.series ?? []).map((p) => ({ label: p.date.slice(5), value: p.visits })), [data]);
  const f = data?.funnel;
  const funnel = f
    ? [
        { label: 'Visitors', value: f.visitors },
        { label: 'Viewed an event', value: f.eventViewers },
        { label: 'Started checkout', value: f.checkoutsStarted },
        { label: 'Bought passes', value: f.purchases },
      ]
    : [];
  const top = Math.max(1, ...funnel.map((s) => s.value));
  const sourceTotal = Math.max(1, (data?.sources ?? []).reduce((n, s) => n + s.views, 0));

  const eventCols: Column<TopEvent>[] = [
    { key: 'name', header: 'Event', primary: true, render: (r) => r.name },
    ...(admin ? [{ key: 'org', header: 'Organizer', render: (r: TopEvent) => r.org || '—' }] : []),
    { key: 'views', header: 'Page views', numeric: true, render: (r) => fmt(r.views) },
    { key: 'visitors', header: 'Visitors', numeric: true, render: (r) => fmt(r.visitors) },
    { key: 'passes', header: 'Passes sold', numeric: true, render: (r) => fmt(r.passes) },
    { key: 'conv', header: 'Conversion', numeric: true, render: (r) => `${pct(r.conversion)}%` },
  ];
  const orgCols: Column<OrgRow>[] = [
    { key: 'org', header: 'Organizer', primary: true, render: (r) => r.org },
    { key: 'visits', header: 'Visits', numeric: true, render: (r) => fmt(r.visits) },
    { key: 'ev', header: 'Event views', numeric: true, render: (r) => fmt(r.eventViews) },
    { key: 'passes', header: 'Passes', numeric: true, render: (r) => fmt(r.passes) },
    { key: 'conv', header: 'Conversion', numeric: true, render: (r) => `${pct(r.conversion)}%` },
    { key: 'gmv', header: 'Sales (TZS)', numeric: true, render: (r) => fmt(r.gmv) },
  ];

  return (
    <>
      <KPIRow>
        <KPITile label="Storefront visits" tint="blue" value={k ? fmt(k.storefrontVisits) : null} loading={loading} error={error} onRetry={load} />
        <KPITile label="Visitors (daily unique)" tint="neutral" value={k ? fmt(k.visitors) : null} loading={loading} error={error} onRetry={load} />
        <KPITile label="Event page views" tint="cyan" value={k ? fmt(k.eventViews) : null} loading={loading} error={error} onRetry={load} />
        <KPITile label="Passes sold" tint="green" value={k ? fmt(k.passesSold) : null} loading={loading} error={error} onRetry={load} />
        <KPITile label="Visit → purchase" tint="amber" value={k ? pct(k.conversion) : null} unit="%" loading={loading} error={error} onRetry={load} />
      </KPIRow>

      <HeroChart
        title="Storefront visits over time"
        data={chart}
        total={k ? fmt(k.storefrontVisits) : undefined}
        totalUnit="visits"
        range={range}
        onRangeChange={setRange}
        ranges={['7D', '30D', 'ALL']}
        loading={loading}
        error={error ? 'Chart unavailable' : null}
        onRetry={load}
        emptyText="No visits yet. Share your storefront link to start counting."
      />

      <div className="cr-two-col">
        <section className="cr-panel" aria-labelledby="sa-funnel">
          <div className="cr-panel-head"><h2 id="sa-funnel" className="cr-section-h">From visit to pass</h2></div>
          <ol style={{ listStyle: 'none', margin: 0, padding: '4px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {funnel.map((s, i) => (
              <li key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15 }}>
                  <span>{s.label}</span>
                  <span style={{ fontFamily: 'var(--cr-mono)' }}>{fmt(s.value)}</span>
                </span>
                <span aria-hidden="true" style={{ height: 10, borderRadius: 999, background: 'var(--cr-card2)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${Math.max(2, (s.value / top) * 100)}%`, background: i === funnel.length - 1 ? 'var(--zp-color-signal-yellow, #FFD21F)' : 'var(--cr-ink)', borderRadius: 999 }} />
                </span>
              </li>
            ))}
          </ol>
          <p style={{ fontSize: 13, color: 'var(--cr-ink2)', margin: '8px 0 0' }}>Passes sold come from your sales records, not tracking.</p>
        </section>

        <section className="cr-panel" aria-labelledby="sa-sources">
          <div className="cr-panel-head"><h2 id="sa-sources" className="cr-section-h">Where visitors came from</h2></div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {(data?.sources ?? []).map((s) => (
              <li key={s.source} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--cr-hair)', fontSize: 15 }}>
                <span style={{ fontWeight: 700 }}>{SOURCE_LABEL[s.source] ?? s.source}</span>
                <span style={{ fontFamily: 'var(--cr-mono)' }}>{Math.round((s.views / sourceTotal) * 100)}%</span>
              </li>
            ))}
            {!loading && (data?.sources ?? []).length === 0 && <li style={{ fontSize: 14, color: 'var(--cr-ink2)', padding: '10px 0' }}>No visits in this range yet.</li>}
          </ul>
        </section>
      </div>

      <section className="cr-panel" aria-labelledby="sa-events">
        <div className="cr-panel-head"><h2 id="sa-events" className="cr-section-h">Most viewed events</h2></div>
        <DataTable columns={eventCols} rows={data?.topEvents ?? []} rowKey={(r) => r.eventId} loading={loading} error={error ? 'Could not load events.' : null} onRetry={load} caption="Most viewed events" emptyTitle="No event views yet" emptyBody={<span>Views appear here as people open your event pages.</span>} />
      </section>

      {admin && (
        <section className="cr-panel" aria-labelledby="sa-orgs">
          <div className="cr-panel-head"><h2 id="sa-orgs" className="cr-section-h">Organizer performance</h2></div>
          <DataTable columns={orgCols} rows={data?.organizers ?? []} rowKey={(r) => r.org} loading={loading} error={error ? 'Could not load organizers.' : null} onRetry={load} caption="Organizer performance" emptyTitle="No organizer traffic yet" emptyBody={<span>Organizers appear as their storefronts get visits.</span>} />
        </section>
      )}

      <p style={{ fontSize: 13, color: 'var(--cr-ink2)' }}>Counts only. ZoraPass never shows visitors&apos; names, numbers or emails.</p>
    </>
  );
}
