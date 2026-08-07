import { Injectable } from '@nestjs/common';
import { db, poolSnapshots, resolveCommissionRate, readOrderMoney } from '@zora/core';
import type { OrderMoney } from '@zora/core';
import { OrgScopeService } from './org-scope.service';
import { OrganizerRepo } from '../storage/organizer-repo';

/* OrgSalesService (MT3) — read-only org sales / reporting. Every read is scoped
   to the acting org through OrgScopeService.ownedEventIds (C3): event ownership
   lives ONLY in the collection_store 'events' blob (event.organizer_id is NULL
   post-seed), so we NEVER JOIN on organizerHandle — we compute an owned id-set
   from the blob and scope relational reads with `event_id = ANY(ownedIds)`.

   Correctness invariants:
   - Revenue (paid-only) is the UNION of two sources, because a table split has no
     order_item at all (0006: shares are payment-only) and used to be counted as
     ZERO — organizers were shown less money than they had actually taken:
       a) line-item orders: SUM(order_item.unit_price*quantity)
       b) split seats:      split_share.amount for settled shares
     Both exclude the platform fee (order.target_value, never summed here). Money
     under the flagged statuses paid_unseatable / payment_short is surfaced
     SEPARATELY (flaggedRevenue) and never folded into the paid number.
     BS38: that union now lives in @zora/core (`readOrderMoney`) because the
     PAYOUT balance has to be computed from exactly the same rows — an organizer
     must never be shown one number here and allowed to withdraw another.
   - Commission (BS35 / #6) is POINT-IN-TIME: net comes from the rate STAMPED on
     each order at pay time (`order.commission_rate`), never from the org's live
     rate. Editing an organizer's commission today must not rewrite what they
     earned last month. Rounding happens once per order, via @zora/core netOf.
   - Refunds (BS35 / OV1) are a DEBIT: `order.refunded_amount` comes off the gross
     before netting, and a fully refunded order (status='refunded') stops counting
     as a paid order. Refunded money is not withdrawable money.
   - Sold (C2): from inventory_pool.sold_count via core poolSnapshots — NEVER
     capacity−available (that would count holds/reserved as sold).
   - Currency (I7): revenue is grouped/labelled by currency (from price_version);
     mixed currencies are never summed into one scalar.
   - PII (I4): buyer phone/email masked (last 3 chars); credentials expose
     public_ref, never the raw code.
   - Event name/status come from the events blob (a blob, not a table), joined in
     memory by id. */

const PAID = 'paid';
const FLAGGED = ['paid_unseatable', 'payment_short'];
const DEFAULT_CURRENCY = 'TZS';

/** Revenue + net + counts for one (event, currency) bucket. */
interface Bucket {
  revenue: number;
  netRevenue: number;
  refunded: number;
  orders: number;
  weighted: number; // Σ(gross × rate) — for the blended display rate
  rates: Set<number>;
}

function emptyBucket(): Bucket {
  return { revenue: 0, netRevenue: 0, refunded: 0, orders: 0, weighted: 0, rates: new Set() };
}

/** The commission rate to DISPLAY for a bucket. When every order in it carries
    the same stamped rate (the normal case) that exact rate is shown; when rates
    differ (a rate change mid-life, or a per-event override) it is the
    revenue-weighted blend, rounded to the column's numeric(6,5) precision. An
    empty bucket falls back to the org's current rate — nothing has been stamped
    yet, so that is what the next sale will use. */
function displayRate(b: Bucket, fallback: number): number {
  if (b.revenue <= 0 || b.rates.size === 0) return fallback;
  if (b.rates.size === 1) return [...b.rates][0];
  return Math.round((b.weighted / b.revenue) * 1e5) / 1e5;
}

export interface OrgSummary {
  totals: {
    revenue: number;
    // BS31: the platform commission fraction + the organizer's NET take (revenue
    // after commission). Buyer price is unaffected — this is payout math.
    commissionRate: number;
    netRevenue: number;
    sold: number;
    orders: number;
    currency: string | null;
    // Present always for transparency; when the org's paid revenue spans multiple
    // currencies the scalar `revenue`/`currency` above report the largest bucket
    // and this array carries the full non-summed breakdown (I7).
    revenueByCurrency: { currency: string; revenue: number }[];
    // Money collected but NOT organizer-issuable (paid_unseatable/payment_short),
    // kept out of `revenue` on purpose.
    flaggedRevenue: number;
    flaggedOrders: number;
    // BS35 (OV1): money already given back to buyers. Already subtracted from
    // revenue/netRevenue above — surfaced so "why did my balance drop" is answerable.
    refundedRevenue: number;
  };
  events: OrgSummaryEvent[];
}

export interface OrgSummaryEvent {
  id: string;
  name: string | null;
  status: string;
  sold: number;
  capacity: number;
  revenue: number;
  netRevenue: number;    // BS31: revenue after commission (BS35: the STAMPED rate)
  commissionRate: number; // BS35: this event's effective (stamped) rate
  currency: string;
  flaggedRevenue: number;
  flaggedOrders: number;
  refundedRevenue: number; // BS35 (OV1)
}

export interface OrgOrderRow {
  orderId: string;
  eventId: string;
  eventName: string | null;
  tier: string;
  qty: number;
  amount: number;
  currency: string;
  status: string;
  buyer: { phone: string | null; email: string | null };
  credentials: string[];
  createdAt: string;
}

@Injectable()
export class OrgSalesService {
  constructor(private readonly scope: OrgScopeService, private readonly organizers: OrganizerRepo) {}

  /** BS31/BS35: the org's CURRENT commission — used only as the display fallback
      for an org with no stamped revenue yet (i.e. what the next sale will use).
      Earnings themselves never read this; they read the per-order stamp. */
  private async liveCommissionRateFor(handle: string): Promise<number> {
    return resolveCommissionRate(null, await this.organizers.byHandle(handle));
  }

  /** GET /api/org/splits — bill-split status for the org's events: tables still
      forming, and the REFUND WORKLIST (refund_pending splits that took money but
      didn't fill; A5/OV3/D8). Ops refunds each within 24h, then releases. */
  async splits(actingHandle: string): Promise<{
    forming: any[]; refundPending: any[];
  }> {
    const ownedIds = await this.scope.ownedEventIds(actingHandle);
    if (!ownedIds.length) return { forming: [], refundPending: [] };
    const rows = await db()`
      select ts.id, ts.event_id, ts.capacity_n, ts.status, ts.window_expires_at, ts.created_at,
             (select count(*) from split_share where split_id = ts.id and state = 'paid') as paid_count,
             (select coalesce(sum(amount), 0) from split_share where split_id = ts.id and state = 'paid') as collected,
             hc.name as host_name
        from table_split ts left join customer hc on hc.id = ts.host_customer_id
       where ts.event_id = any(${ownedIds}) and ts.status in ('forming', 'refund_pending')
       order by ts.created_at desc`;
    const forming: any[] = [], refundPending: any[] = [];
    for (const r of rows) {
      const item = {
        id: r.id, eventId: r.event_id, capacityN: r.capacity_n, paidCount: Number(r.paid_count),
        collected: Number(r.collected), hostName: r.host_name ? String(r.host_name).split(/\s+/)[0] : null,
        windowExpiresAt: r.window_expires_at,
      };
      (r.status === 'refund_pending' ? refundPending : forming).push(item);
    }
    return { forming, refundPending };
  }

  /** GET /api/org/summary payload for the acting handle. */
  async summary(actingHandle: string): Promise<OrgSummary> {
    const events = await this.scope.readEvents();
    const owned = events.filter((e) => e && e.organizerHandle === actingHandle);
    const ownedIds = owned.map((e) => e.id);
    // The org's LIVE rate — only a display fallback for events with no stamped
    // revenue yet. Earnings below come from each order's own stamp (BS35).
    const liveRate = await this.liveCommissionRateFor(actingHandle);

    const empty: OrgSummary = {
      totals: {
        revenue: 0, commissionRate: liveRate, netRevenue: 0, sold: 0, orders: 0, currency: null,
        revenueByCurrency: [], flaggedRevenue: 0, flaggedOrders: 0, refundedRevenue: 0,
      },
      events: [],
    };
    if (!ownedIds.length) return empty;

    const sql = db();

    // Every money-bearing order (line items UNION split seats), each already
    // netted at its OWN stamped rate and with its refund subtracted. BS38: this
    // read lives in @zora/core and is the SAME one the payout balance uses — the
    // number on this screen and the number an organizer can withdraw cannot drift.
    const money: OrderMoney[] = await readOrderMoney(sql, ownedIds, liveRate);

    // Flagged money (collected but not organizer revenue), per event.
    const flaggedRows = await sql<
      { event_id: string; revenue: number; orders: number }[]
    >`
      select o.event_id                        as event_id,
             sum(oi.unit_price * oi.quantity)::bigint as revenue,
             count(distinct o.id)::int         as orders
        from "order" o
        join order_item oi on oi.order_id = o.id
       where o.event_id = any(${ownedIds})
         and o.status = any(${FLAGGED})
       group by o.event_id`;

    // Per-event fallback currency (for events with no paid orders yet), from the
    // current price_version rows of the event's tiers. Single-currency per event
    // is asserted on writes (I7); if several appear we take the first.
    const currencyRows = await sql<{ event_id: string; currency: string }[]>`
      select distinct pt.event_id as event_id, pv.currency as currency
        from product_tier   pt
        join price_version  pv on pv.tier_id = pt.id
       where pt.event_id = any(${ownedIds})`;

    // Sold + capacity per event, from inventory_pool.sold_count (C2), never
    // capacity−available. poolSnapshots is the core read; map tier→event here.
    const tierRows = await sql<{ id: string; event_id: string }[]>`
      select id, event_id from product_tier where event_id = any(${ownedIds})`;
    const snaps = await poolSnapshots(sql);
    const tierToEvent = new Map(tierRows.map((t) => [t.id, t.event_id]));

    const soldByEvent = new Map<string, number>();
    const capByEvent = new Map<string, number>();
    for (const s of snaps) {
      const ev = tierToEvent.get(s.tierId);
      if (!ev) continue; // tier of an event this org doesn't own — skip.
      soldByEvent.set(ev, (soldByEvent.get(ev) ?? 0) + (s.sold ?? 0));
      capByEvent.set(ev, (capByEvent.get(ev) ?? 0) + (s.capacity ?? 0));
    }

    // Fold the per-order money into (event → currency → bucket). Net is summed
    // from the per-order values — never recomputed from an event total, so a rate
    // change or a refund on ONE order can never smear across the others.
    const byEvent = new Map<string, Map<string, Bucket>>();
    for (const m of money) {
      let byCurrency = byEvent.get(m.eventId);
      if (!byCurrency) { byCurrency = new Map(); byEvent.set(m.eventId, byCurrency); }
      let b = byCurrency.get(m.currency);
      if (!b) { b = emptyBucket(); byCurrency.set(m.currency, b); }
      b.revenue += m.gross;
      b.netRevenue += m.net;
      b.refunded += m.refunded;
      b.weighted += m.gross * m.rate;
      if (m.gross > 0) b.rates.add(m.rate);
      // A fully refunded order is no longer a paid order (its gross is 0 too).
      if (m.status === PAID) b.orders += 1;
    }

    // Single-currency per event expected; if an event somehow has multiple, keep
    // the largest bucket for its scalar and never sum across (I7).
    const paidByEvent = new Map<string, { currency: string; bucket: Bucket }>();
    for (const [eventId, byCurrency] of byEvent) {
      let best: { currency: string; bucket: Bucket } | null = null;
      for (const [currency, bucket] of byCurrency) {
        if (!best || bucket.revenue > best.bucket.revenue) best = { currency, bucket };
      }
      if (best) paidByEvent.set(eventId, best);
    }

    const flaggedByEvent = new Map<string, { revenue: number; orders: number }>();
    for (const r of flaggedRows) flaggedByEvent.set(r.event_id, { revenue: r.revenue, orders: r.orders });

    const fallbackCurrency = new Map<string, string>();
    for (const r of currencyRows) if (!fallbackCurrency.has(r.event_id)) fallbackCurrency.set(r.event_id, r.currency);

    const eventsOut: OrgSummaryEvent[] = owned.map((e) => {
      const paid = paidByEvent.get(e.id);
      const flagged = flaggedByEvent.get(e.id);
      const bucket = paid?.bucket;
      return {
        id: e.id,
        name: e.name ?? null,
        // Blob events may predate the status field; missing → 'published' (C5).
        status: e.status ?? 'published',
        sold: soldByEvent.get(e.id) ?? 0,
        capacity: capByEvent.get(e.id) ?? 0,
        revenue: bucket?.revenue ?? 0,
        netRevenue: bucket?.netRevenue ?? 0,
        commissionRate: displayRate(bucket ?? emptyBucket(), liveRate),
        currency: paid?.currency ?? fallbackCurrency.get(e.id) ?? DEFAULT_CURRENCY,
        flaggedRevenue: flagged?.revenue ?? 0,
        flaggedOrders: flagged?.orders ?? 0,
        refundedRevenue: bucket?.refunded ?? 0,
      };
    });

    // Org totals. Sold/orders are currency-agnostic counts; revenue is grouped by
    // currency and NEVER summed across currencies.
    const orgByCurrency = new Map<string, Bucket>();
    for (const m of money) {
      let b = orgByCurrency.get(m.currency);
      if (!b) { b = emptyBucket(); orgByCurrency.set(m.currency, b); }
      b.revenue += m.gross;
      b.netRevenue += m.net;
      b.refunded += m.refunded;
      b.weighted += m.gross * m.rate;
      if (m.gross > 0) b.rates.add(m.rate);
      if (m.status === PAID) b.orders += 1;
    }

    const revenueByCurrency = [...orgByCurrency.entries()]
      .map(([currency, b]) => ({ currency, revenue: b.revenue }))
      .sort((a, b) => b.revenue - a.revenue);

    const uniform = revenueByCurrency.length <= 1;
    const headline = revenueByCurrency[0] ?? null;
    const headlineBucket = headline ? (orgByCurrency.get(headline.currency) ?? emptyBucket()) : emptyBucket();

    const totalSold = [...soldByEvent.values()].reduce((a, b) => a + b, 0);
    const flaggedRevenue = flaggedRows.reduce((a, r) => a + r.revenue, 0);
    const flaggedOrders = flaggedRows.reduce((a, r) => a + r.orders, 0);

    return {
      totals: {
        // Scalar revenue is well-defined only when uniform; when mixed we report
        // the largest currency bucket as the headline and expose the full split.
        revenue: headline?.revenue ?? 0,
        // BS31/BS35: the effective (stamped) rate behind netRevenue — the exact
        // rate when uniform, the revenue-weighted blend when it isn't.
        commissionRate: displayRate(headlineBucket, liveRate),
        netRevenue: headlineBucket.netRevenue,
        sold: totalSold,
        orders: headlineBucket.orders,
        currency: uniform
          ? (headline?.currency ?? this.orgUniformCurrency(fallbackCurrency))
          : (headline?.currency ?? null),
        revenueByCurrency,
        flaggedRevenue,
        flaggedOrders,
        refundedRevenue: headlineBucket.refunded,
      },
      events: eventsOut,
    };
  }

  /** If the org has no paid revenue yet, still label totals.currency when every
      owned event shares one currency; else null. */
  private orgUniformCurrency(fallback: Map<string, string>): string | null {
    const set = new Set(fallback.values());
    if (set.size === 1) return [...set][0];
    if (set.size === 0) return DEFAULT_CURRENCY;
    return null;
  }

  /** GET /api/org/orders payload. `eventId` (if given) is intersected with the
      owned id-set: a foreign/absent id yields [] (no leak). */
  async orders(actingHandle: string, eventId: string | undefined, limit: number): Promise<OrgOrderRow[]> {
    const events = await this.scope.readEvents();
    const owned = events.filter((e) => e && e.organizerHandle === actingHandle);
    const ownedIds = owned.map((e) => e.id);
    const nameById = new Map(owned.map((e) => [e.id, (e.name ?? null) as string | null]));

    // Intersect any requested eventId with owned ids (C3). Foreign id → empty.
    let scopeIds = ownedIds;
    if (eventId != null && eventId !== '') {
      scopeIds = ownedIds.includes(eventId) ? [eventId] : [];
    }
    if (!scopeIds.length) return [];

    type ItemRow = { order_id: string; tier_name: string; quantity: number; unit_price: number; currency: string };
    const sql = db();
    const cappedLimit = Math.max(1, Math.min(limit || 50, 200));

    const orderRows = await sql<
      { order_id: string; event_id: string; status: string; created_at: Date; phone: string | null; email: string | null }[]
    >`
      select o.id         as order_id,
             o.event_id   as event_id,
             o.status     as status,
             o.created_at as created_at,
             cu.phone     as phone,
             cu.email     as email
        from "order" o
        left join customer cu on cu.id = o.customer_id
       where o.event_id = any(${scopeIds})
       order by o.created_at desc
       limit ${cappedLimit}`;

    if (!orderRows.length) return [];
    const orderIds = orderRows.map((o) => o.order_id);

    // Line items (tier name, qty, amount, currency) for the page of orders.
    const itemRows = await sql<ItemRow[]>`
      select oi.order_id      as order_id,
             pt.name          as tier_name,
             oi.quantity      as quantity,
             oi.unit_price    as unit_price,
             pv.currency      as currency
        from order_item     oi
        join product_tier   pt on pt.id = oi.product_tier_id
        join price_version  pv on pv.id = oi.price_version_id
       where oi.order_id = any(${orderIds})`;

    // Issued credentials — public_ref only (I4), never the raw code.
    const credRows = await sql<{ order_id: string; public_ref: string | null }[]>`
      select oi.order_id as order_id, c.public_ref as public_ref
        from credential c
        join order_item oi on oi.id = c.order_item_id
       where oi.order_id = any(${orderIds})`;

    const itemsByOrder = new Map<string, ItemRow[]>();
    for (const it of itemRows) {
      const arr = itemsByOrder.get(it.order_id) ?? [];
      arr.push(it);
      itemsByOrder.set(it.order_id, arr);
    }
    const credsByOrder = new Map<string, string[]>();
    for (const c of credRows) {
      if (!c.public_ref) continue;
      const arr = credsByOrder.get(c.order_id) ?? [];
      arr.push(c.public_ref);
      credsByOrder.set(c.order_id, arr);
    }

    return orderRows.map((o) => {
      const items = itemsByOrder.get(o.order_id) ?? [];
      const qty = items.reduce((a, it) => a + it.quantity, 0);
      const amount = items.reduce((a, it) => a + it.unit_price * it.quantity, 0);
      const tierNames = [...new Set(items.map((it) => it.tier_name))];
      // Single-currency per event (I7); if items diverge we still never sum across.
      const currency = items[0]?.currency ?? DEFAULT_CURRENCY;
      return {
        orderId: o.order_id,
        eventId: o.event_id,
        eventName: nameById.get(o.event_id) ?? null,
        tier: tierNames.join(', '),
        qty,
        amount,
        currency,
        status: o.status,
        // Full buyer contacts — an organizer owns their attendee list (scoped to
      // their own paid orders). Was masked (I4); organizers now see the real
      // phone/email so they can reach their guests.
      buyer: { phone: o.phone, email: o.email },
        credentials: credsByOrder.get(o.order_id) ?? [],
        createdAt: o.created_at instanceof Date ? o.created_at.toISOString() : String(o.created_at),
      };
    });
  }
}

/** Mask PII keeping the last 3 chars visible (I4). Preserves length via '*'. */
export function maskPii(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const s = String(value);
  if (s.length <= 3) return '*'.repeat(s.length);
  return '*'.repeat(s.length - 3) + s.slice(-3);
}
