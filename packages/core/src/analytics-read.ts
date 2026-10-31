/* BS128/BS129: storefront analytics reads for the organizer and admin consoles.
   Traffic comes from the first-party aggregates (analytics_daily, BS123);
   purchases and passes come from orders (the DB stays the source of truth for
   money). Counts only — no visitor-level data leaves. */

import { SOLD_STATUSES } from './order-status';

type Sql = any;

export type AnalyticsRangeDays = 7 | 30 | 90;
export function storefrontRangeDays(range: unknown): AnalyticsRangeDays {
  const r = String(range ?? '').toUpperCase();
  if (r === '7D') return 7;
  if (r === '90D') return 90;
  return 30;
}

export interface StorefrontAnalytics {
  days: number;
  kpis: {
    storefrontVisits: number;
    visitors: number;          // sum of daily unique visitors (storefront + event pages)
    pageViews: number;         // storefront + event page views
    eventViews: number;
    purchases: number;         // paid orders in range
    passesSold: number;
    conversion: number;        // purchases ÷ visitors, 0..1
  };
  series: { date: string; visits: number; eventViews: number }[];
  sources: { source: string; views: number }[];
  topEvents: { eventId: string; views: number; visitors: number; purchases: number; passes: number; conversion: number }[];
  funnel: { visitors: number; eventViewers: number; checkoutsStarted: number; purchases: number };
}

/** orgs/events = null means platform-wide. events filters both traffic and orders. */
export async function readStorefrontAnalytics(
  sql: Sql,
  opts: { orgs: string[] | null; events: string[] | null; days: number; now?: Date },
): Promise<StorefrontAnalytics> {
  const now = opts.now ?? new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - (opts.days - 1) * 86400000);
  const from = fromDate.toISOString().slice(0, 10);
  const orgs = opts.orgs;
  const events = opts.events;
  const orgF = orgs ? sql`and org_handle = any(${orgs})` : sql``;
  const evF = events ? sql`and (event_id = '' or event_id = any(${events}))` : sql``;

  const series = await sql`
    with d as (select generate_series(${from}::date, ${to}::date, interval '1 day')::date as day)
    select to_char(d.day, 'YYYY-MM-DD') as date,
           coalesce(sum(a.views) filter (where a.kind = 'storefront'), 0)::int as visits,
           coalesce(sum(a.views) filter (where a.kind = 'event'), 0)::int as event_views
      from d left join analytics_daily a on a.day = d.day ${orgF} ${evF}
     group by d.day order by d.day`;

  const [tot] = await sql`
    select coalesce(sum(views) filter (where kind = 'storefront'), 0)::int as storefront_visits,
           coalesce(sum(views) filter (where kind = 'event'), 0)::int as event_views,
           coalesce(sum(views), 0)::int as page_views,
           coalesce(sum(visitors), 0)::int as visitors,
           coalesce(sum(visitors) filter (where kind = 'event'), 0)::int as event_viewers
      from analytics_daily where day between ${from} and ${to} ${orgF} ${evF}`;

  const sources = await sql`
    select source, sum(views)::int as views from analytics_daily
     where day between ${from} and ${to} ${orgF} ${evF}
     group by source order by views desc`;

  const trafficByEvent = await sql`
    select event_id, sum(views)::int as views, sum(visitors)::int as visitors from analytics_daily
     where kind = 'event' and day between ${from} and ${to} ${orgF} ${evF}
     group by event_id`;

  // Orders: scoped to the given events (org scope is resolved by the caller into events).
  const ordEv = events ? sql`and o.event_id = any(${events})` : sql``;
  const orders = await sql`
    select o.event_id,
           count(distinct o.id) filter (where o.status = any(${SOLD_STATUSES}))::int as purchases,
           coalesce(sum(oi.quantity) filter (where o.status = any(${SOLD_STATUSES})), 0)::int as passes,
           count(distinct o.id)::int as started
      from "order" o left join order_item oi on oi.order_id = o.id
     where o.created_at >= ${from}::date and o.created_at < (${to}::date + 1) ${ordEv}
     group by o.event_id`;

  const byEvent = new Map<string, { views: number; visitors: number; purchases: number; passes: number }>();
  for (const t of trafficByEvent) byEvent.set(t.event_id, { views: t.views, visitors: t.visitors, purchases: 0, passes: 0 });
  let purchases = 0, passesSold = 0, started = 0;
  for (const o of orders) {
    purchases += o.purchases; passesSold += o.passes; started += o.started;
    if (!o.event_id) continue;
    const cur = byEvent.get(o.event_id) ?? { views: 0, visitors: 0, purchases: 0, passes: 0 };
    cur.purchases += o.purchases; cur.passes += o.passes;
    byEvent.set(o.event_id, cur);
  }
  const ratio = (a: number, b: number) => (b > 0 ? Math.min(1, a / b) : 0);
  const topEvents = Array.from(byEvent.entries())
    .map(([eventId, v]) => ({ eventId, ...v, conversion: ratio(v.purchases, v.visitors) }))
    .sort((a, b) => b.views - a.views || b.purchases - a.purchases)
    .slice(0, 20);

  return {
    days: opts.days,
    kpis: {
      storefrontVisits: tot.storefront_visits,
      visitors: tot.visitors,
      pageViews: tot.page_views,
      eventViews: tot.event_views,
      purchases,
      passesSold,
      conversion: ratio(purchases, tot.visitors),
    },
    series: series.map((r: any) => ({ date: r.date, visits: r.visits, eventViews: r.event_views })),
    sources: sources.map((r: any) => ({ source: r.source, views: r.views })),
    topEvents,
    funnel: { visitors: tot.visitors, eventViewers: tot.event_viewers, checkoutsStarted: started, purchases },
  };
}
