/* Analytics — the date-bucketed revenue series + KPI aggregates behind the
   organizer/admin dashboards (Lane D, dashboard-redesign #8, "thin funnel").

   This file is PURE (no DB, no HTTP): the service reads the rows (net revenue
   via @zora/core `readOrderMoney`, so the commission math is NEVER re-derived
   here — a dashboard number and a payout number cannot drift), then hands the
   already-netted per-order money + timing to `buildAnalytics`, which buckets and
   aggregates. Keeping it pure is what lets the two critical failure-modes be
   tested without a database:
     · no paid orders          → empty funnel (zeroed KPIs, empty ALL series)
     · a date range with no data → a FLAT baseline (every bucket present at 0),
       never a gap the chart would misdraw.

   Currency invariant (I7, mirrors org-sales): revenue is NEVER summed across
   currencies. The scalar KPIs + the series are scoped to the largest-revenue
   currency (the "headline"); the full split is surfaced in `revenueByCurrency`. */

/** The ranges the hero chart offers. ALL = the org's whole history. */
export type AnalyticsRange = '7D' | '14D' | '30D' | 'ALL';
export const ANALYTICS_RANGES: AnalyticsRange[] = ['7D', '14D', '30D', 'ALL'];

const DAY_MS = 86_400_000;

/** Days in a fixed range; null for ALL (open-ended, derived from the data). */
export function rangeDays(range: AnalyticsRange): number | null {
  switch (range) {
    case '7D': return 7;
    case '14D': return 14;
    case '30D': return 30;
    case 'ALL': return null;
  }
}

/** Coerce an untrusted query param to a valid range (defaults to 30D). */
export function normalizeRange(raw: string | null | undefined): AnalyticsRange {
  const up = String(raw ?? '').trim().toUpperCase();
  return (ANALYTICS_RANGES as string[]).includes(up) ? (up as AnalyticsRange) : '30D';
}

/** UTC day key (YYYY-MM-DD) — ISO date strings sort lexicographically, so the
    key doubles as an orderable bucket id and window bound. */
function dayKey(iso: string): string {
  return String(iso ?? '').slice(0, 10);
}
function keyOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function keyToMs(key: string): number {
  return new Date(`${key}T00:00:00.000Z`).getTime();
}

/** One money-bearing order (paid/refunded) with the timing + seat metadata the
    series needs. `gross`/`net` come straight from OrderMoney (net-of-refund face
    and net-of-commission take respectively); `tickets` is the seat count. */
export interface AnalyticsOrder {
  orderId: string;
  createdAt: string; // ISO (UTC)
  status: string;    // 'paid' | 'refunded' | …
  currency: string;
  gross: number;
  net: number;
  tickets: number;
}

export interface AnalyticsInput {
  /** Earning orders (paid/refunded) — the revenue side, already netted. */
  money: AnalyticsOrder[];
  /** created_at of EVERY started order (any status) — the conversion denominator. */
  startedAt: string[];
  /** Live checked-in credential count for the scope's events (door redemptions). */
  checkedIn: number;
  range: AnalyticsRange;
  /** Injectable clock so the window is testable; defaults to now. */
  now?: Date;
}

export interface RevenuePoint {
  date: string;       // YYYY-MM-DD
  revenue: number;    // gross (net-of-refund) in the headline currency
  netRevenue: number; // net-of-commission
  orders: number;     // paid orders that day
  tickets: number;    // seats sold that day
}

export interface AnalyticsKpis {
  revenue: number;        // gross, headline currency
  netRevenue: number;     // net-of-commission (the organizer's take)
  ticketsSold: number;
  orders: number;         // paid orders
  avgOrderValue: number;  // gross / paid orders
  conversionRate: number; // paid orders / started orders, 0..1
  checkedIn: number;
  currency: string | null;
}

export interface AnalyticsResult {
  range: AnalyticsRange;
  currency: string | null;
  series: RevenuePoint[];
  kpis: AnalyticsKpis;
  revenueByCurrency: { currency: string; revenue: number }[];
}

/** The zero result — an org (or scope) with nothing yet. ALL yields an empty
    series (the "empty funnel"); a fixed range still yields a flat baseline. */
function zeroResult(range: AnalyticsRange, now: Date): AnalyticsResult {
  const days = rangeDays(range);
  const series = days == null ? [] : flatBaseline(days, now);
  return {
    range,
    currency: null,
    series,
    kpis: {
      revenue: 0, netRevenue: 0, ticketsSold: 0, orders: 0,
      avgOrderValue: 0, conversionRate: 0, checkedIn: 0, currency: null,
    },
    revenueByCurrency: [],
  };
}

/** N consecutive daily buckets ending today, all zero (the flat baseline a
    no-data fixed range must still draw). */
function flatBaseline(days: number, now: Date): RevenuePoint[] {
  const todayMs = keyToMs(now.toISOString().slice(0, 10));
  const out: RevenuePoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push({ date: keyOf(todayMs - i * DAY_MS), revenue: 0, netRevenue: 0, orders: 0, tickets: 0 });
  }
  return out;
}

/**
 * Bucket + aggregate. Reuses the already-netted OrderMoney figures — this never
 * touches a commission rate. Scoped to the headline currency (largest revenue);
 * the full currency split rides `revenueByCurrency`.
 */
export function buildAnalytics(input: AnalyticsInput): AnalyticsResult {
  const now = input.now ?? new Date();
  const range = input.range;
  const days = rangeDays(range);

  // Window bound (inclusive of `startKey`). ALL → no lower bound.
  const todayMs = keyToMs(now.toISOString().slice(0, 10));
  const startKey = days == null ? null : keyOf(todayMs - (days - 1) * DAY_MS);
  const inWindow = (iso: string) => startKey == null || dayKey(iso) >= startKey;

  const moneyInRange = input.money.filter((m) => inWindow(m.createdAt));

  // Currency split (never summed together). Headline = largest revenue bucket.
  const byCurrency = new Map<string, number>();
  for (const m of moneyInRange) byCurrency.set(m.currency, (byCurrency.get(m.currency) ?? 0) + m.gross);
  const revenueByCurrency = [...byCurrency.entries()]
    .map(([currency, revenue]) => ({ currency, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  if (revenueByCurrency.length === 0) {
    // Nothing in range: empty funnel (ALL) or flat baseline (fixed range).
    return { ...zeroResult(range, now), revenueByCurrency: [] };
  }

  const headline = revenueByCurrency[0].currency;
  const scoped = moneyInRange.filter((m) => m.currency === headline);

  // Fold per-day. Paid orders drive the counts/tickets; a refunded order still
  // adjusts revenue (its gross is already net-of-refund) but is not a "sale".
  const buckets = new Map<string, RevenuePoint>();
  let revenue = 0, netRevenue = 0, paidRevenue = 0, ticketsSold = 0, orders = 0;
  for (const m of scoped) {
    const key = dayKey(m.createdAt);
    let b = buckets.get(key);
    if (!b) { b = { date: key, revenue: 0, netRevenue: 0, orders: 0, tickets: 0 }; buckets.set(key, b); }
    b.revenue += m.gross;
    b.netRevenue += m.net;
    revenue += m.gross;
    netRevenue += m.net;
    if (m.status === 'paid') {
      b.orders += 1;
      b.tickets += m.tickets;
      orders += 1;
      ticketsSold += m.tickets;
      paidRevenue += m.gross;
    }
  }

  // Bucket keys: fixed range → every day present (flat where empty); ALL → from
  // the earliest scoped sale to today.
  let keys: string[];
  if (days != null) {
    keys = [];
    for (let i = days - 1; i >= 0; i--) keys.push(keyOf(todayMs - i * DAY_MS));
  } else {
    const first = scoped.reduce((min, m) => {
      const k = dayKey(m.createdAt);
      return min == null || k < min ? k : min;
    }, null as string | null);
    keys = [];
    if (first != null) {
      for (let ms = keyToMs(first); ms <= todayMs; ms += DAY_MS) keys.push(keyOf(ms));
    }
  }
  const series: RevenuePoint[] = keys.map(
    (k) => buckets.get(k) ?? { date: k, revenue: 0, netRevenue: 0, orders: 0, tickets: 0 },
  );

  const started = input.startedAt.filter((iso) => inWindow(iso)).length;
  const conversionRate = started > 0 ? Math.round((orders / started) * 1e4) / 1e4 : 0;
  const avgOrderValue = orders > 0 ? Math.round(paidRevenue / orders) : 0;

  return {
    range,
    currency: headline,
    series,
    kpis: {
      revenue,
      netRevenue,
      ticketsSold,
      orders,
      avgOrderValue,
      conversionRate,
      checkedIn: input.checkedIn,
      currency: headline,
    },
    revenueByCurrency,
  };
}
