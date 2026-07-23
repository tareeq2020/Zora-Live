import { Injectable } from '@nestjs/common';
import { db, poolSnapshots } from '@zora/core';
import { OrgScopeService } from './org-scope.service';

/* OrgSalesService (MT3) — read-only org sales / reporting. Every read is scoped
   to the acting org through OrgScopeService.ownedEventIds (C3): event ownership
   lives ONLY in the collection_store 'events' blob (event.organizer_id is NULL
   post-seed), so we NEVER JOIN on organizerHandle — we compute an owned id-set
   from the blob and scope relational reads with `event_id = ANY(ownedIds)`.

   Correctness invariants:
   - Revenue (paid-only): SUM(order_item.unit_price*quantity) for order.status='paid'
     ONLY. This is organizer revenue and excludes the platform fee (which lives in
     order.target_value, never summed here). Money collected under the flagged
     statuses paid_unseatable / payment_short is surfaced SEPARATELY (flaggedRevenue)
     and never folded into the paid number.
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

export interface OrgSummary {
  totals: {
    revenue: number;
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
  currency: string;
  flaggedRevenue: number;
  flaggedOrders: number;
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
  buyerMasked: { phone: string | null; email: string | null };
  credentials: string[];
  createdAt: string;
}

@Injectable()
export class OrgSalesService {
  constructor(private readonly scope: OrgScopeService) {}

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

    const empty: OrgSummary = {
      totals: {
        revenue: 0, sold: 0, orders: 0, currency: null,
        revenueByCurrency: [], flaggedRevenue: 0, flaggedOrders: 0,
      },
      events: [],
    };
    if (!ownedIds.length) return empty;

    const sql = db();

    // Revenue per (event, currency), paid-only. Fee is in order.target_value and
    // is deliberately never summed here.
    const paidRows = await sql<
      { event_id: string; currency: string; revenue: number; orders: number }[]
    >`
      select o.event_id                        as event_id,
             pv.currency                       as currency,
             sum(oi.unit_price * oi.quantity)::bigint as revenue,
             count(distinct o.id)::int         as orders
        from "order" o
        join order_item   oi on oi.order_id = o.id
        join price_version pv on pv.id = oi.price_version_id
       where o.event_id = any(${ownedIds})
         and o.status = ${PAID}
       group by o.event_id, pv.currency`;

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

    // Paid revenue/currency per event. Single-currency per event expected; if an
    // event somehow has multiple, keep the largest bucket for its scalar and never
    // sum across (I7).
    const paidByEvent = new Map<string, { revenue: number; currency: string; orders: number }>();
    for (const r of paidRows) {
      const cur = paidByEvent.get(r.event_id);
      if (!cur || r.revenue > cur.revenue) {
        paidByEvent.set(r.event_id, { revenue: r.revenue, currency: r.currency, orders: r.orders });
      }
    }
    const flaggedByEvent = new Map<string, { revenue: number; orders: number }>();
    for (const r of flaggedRows) flaggedByEvent.set(r.event_id, { revenue: r.revenue, orders: r.orders });

    const fallbackCurrency = new Map<string, string>();
    for (const r of currencyRows) if (!fallbackCurrency.has(r.event_id)) fallbackCurrency.set(r.event_id, r.currency);

    const eventsOut: OrgSummaryEvent[] = owned.map((e) => {
      const paid = paidByEvent.get(e.id);
      const flagged = flaggedByEvent.get(e.id);
      return {
        id: e.id,
        name: e.name ?? null,
        // Blob events may predate the status field; missing → 'published' (C5).
        status: e.status ?? 'published',
        sold: soldByEvent.get(e.id) ?? 0,
        capacity: capByEvent.get(e.id) ?? 0,
        revenue: paid?.revenue ?? 0,
        currency: paid?.currency ?? fallbackCurrency.get(e.id) ?? DEFAULT_CURRENCY,
        flaggedRevenue: flagged?.revenue ?? 0,
        flaggedOrders: flagged?.orders ?? 0,
      };
    });

    // Org totals. Sold/orders are currency-agnostic counts; revenue is grouped by
    // currency and NEVER summed across currencies.
    const revenueByCurrencyMap = new Map<string, number>();
    let totalOrders = 0;
    for (const r of paidRows) {
      revenueByCurrencyMap.set(r.currency, (revenueByCurrencyMap.get(r.currency) ?? 0) + r.revenue);
    }
    // Distinct paid orders across the org (an order belongs to one event/currency).
    for (const [, v] of paidByEvent) totalOrders += v.orders;

    const revenueByCurrency = [...revenueByCurrencyMap.entries()]
      .map(([currency, revenue]) => ({ currency, revenue }))
      .sort((a, b) => b.revenue - a.revenue);

    const uniform = revenueByCurrency.length <= 1;
    const headline = revenueByCurrency[0] ?? null;

    const totalSold = [...soldByEvent.values()].reduce((a, b) => a + b, 0);
    const flaggedRevenue = flaggedRows.reduce((a, r) => a + r.revenue, 0);
    const flaggedOrders = flaggedRows.reduce((a, r) => a + r.orders, 0);

    return {
      totals: {
        // Scalar revenue is well-defined only when uniform; when mixed we report
        // the largest currency bucket as the headline and expose the full split.
        revenue: headline?.revenue ?? 0,
        sold: totalSold,
        orders: totalOrders,
        currency: uniform
          ? (headline?.currency ?? this.orgUniformCurrency(fallbackCurrency))
          : (headline?.currency ?? null),
        revenueByCurrency,
        flaggedRevenue,
        flaggedOrders,
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
        buyerMasked: { phone: maskPii(o.phone), email: maskPii(o.email) },
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
