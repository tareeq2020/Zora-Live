import { Injectable } from '@nestjs/common';
import { db } from '@zora/core';
import { OrgScopeService } from '../org/org-scope.service';
import { OrganizerRepo } from '../storage/organizer-repo';

/* AdminOrdersService (BS43 / plan #3) — the SUPPORT view of every order in
   every state.

   ── The problem it solves ───────────────────────────────────────────────────
   Every existing order read is paid-only. When someone calls in saying "I tried
   to buy two VIP and it failed", support could see nothing: the pending/failed/
   expired cart and its line items were invisible. This read includes them all.

   ── OV8: split orders have NO order_item ────────────────────────────────────
   The trap this API is built around. A `table_share` order is payment-only
   (0006): its money lives in `split_share.amount` and it has no order_item at
   all. A naive `join order_item` — the shape every other order read uses —
   returns nothing for it, so a "see the full cart" feature would render an
   EMPTY cart for exactly the orders support is most often asked about. Split
   seats are therefore read from `split_share`/`table_split` alongside the line
   items, and the sibling seats of the same table come with them so support can
   see who else on that table has paid.

   ── PERF-1: paginated, recent-window by default ─────────────────────────────
   Pending and failed carts are the majority of rows and grow fastest. The read
   is keyset-paginated on (created_at, id) and applies a recent window unless
   the caller explicitly asks for more — an unbounded scan of every abandoned
   cart ever created is not a support tool, it is an outage.

   ── OV8: time-boxed PII ─────────────────────────────────────────────────────
   Admin sees full buyer contact — that IS the point of the feature. But a cart
   that NEVER paid is a stranger who typed their number into a form and left;
   keeping that reachable forever is a liability with no support value. Contact
   on a never-paid order older than NEVER_PAID_PII_DAYS is masked, and the row
   says so rather than silently showing blanks. */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Default recency window. 90 days covers every live support question; older
    carts are reachable by asking for them explicitly. */
export const DEFAULT_WINDOW_DAYS = 90;
export const MAX_WINDOW_DAYS = 1095;
/** OV8 — after this long, a cart that never paid stops showing contact details. */
export const NEVER_PAID_PII_DAYS = 90;

/** Order states in which money actually arrived. Anything else is an attempt. */
const PAID_STATES = new Set(['paid', 'paid_unseatable', 'payment_short', 'refunded']);

/** Every state the view can filter by — published so the UI never hard-codes a
    list that drifts from the database. */
export const ORDER_STATES = [
  'pending', 'paid', 'payment_short', 'paid_unseatable', 'failed', 'expired', 'cancelled', 'refunded',
] as const;

const DEFAULT_CURRENCY = 'TZS';

export interface AdminOrderLine {
  tierId: string;
  tier: string;
  qty: number;
  unitPrice: number;
  amount: number;
  currency: string;
}

export interface AdminOrderSeat {
  shareIndex: number;
  amount: number;
  state: string;
  isHost: boolean;
  paidAt: string | null;
  /** true for the seat THIS order paid for; the others are table-mates. */
  isThisOrder: boolean;
}

export interface AdminOrderSplit {
  splitId: string;
  tier: string | null;
  capacity: number;
  status: string;
  targetValue: number;
  currency: string;
  paidCount: number;
  seats: AdminOrderSeat[];
}

export interface AdminOrderAttempt {
  transactionId: string;
  method: string | null;
  fspId: string | null;
  status: string;
  amount: number | null;
  collectedAmount: number | null;
  currency: string | null;
  orderReference: string | null;
  billPayNumber: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface AdminOrderCredential {
  publicRef: string | null;
  state: string;
  tierId: string | null;
  seatIndex: number | null;
}

export interface AdminOrderRow {
  id: string;
  type: string;
  status: string;
  eventId: string;
  eventName: string | null;
  organizerHandle: string | null;
  organizerName: string | null;
  buyer: { customerId: string | null; name: string | null; phone: string | null; email: string | null };
  /** OV8 — contact masked because this cart never paid and is past the window. */
  piiRedacted: boolean;
  /** Line items (GA/VIP). EMPTY for a split share — see `split`. */
  lines: AdminOrderLine[];
  /** OV8 — the seat this order paid for, plus its table-mates. Null when the
      order is not part of a split. */
  split: AdminOrderSplit | null;
  /** Face value of what was in the cart: line items, or the split seat. */
  cartValue: number;
  /** What the gateway was asked to collect (subtotal + fee). */
  targetValue: number;
  currency: string;
  refundedAmount: number;
  refundedAt: string | null;
  commissionRate: number | null;
  method: string | null;
  fspId: string | null;
  attempts: AdminOrderAttempt[];
  credentials: AdminOrderCredential[];
  createdAt: string;
}

export interface AdminOrdersQuery {
  status?: string | null;
  eventId?: string | null;
  organizerHandle?: string | null;
  q?: string | null;
  limit?: number | null;
  cursor?: string | null;
  /** Recency window in days. 0 = no window (explicit opt-in to a full scan). */
  days?: number | null;
}

export interface AdminOrdersPage {
  orders: AdminOrderRow[];
  nextCursor: string | null;
  window: { days: number | null; from: string | null };
  /** Aggregate over the WINDOW (not the page) so the header can say how many
      carts are in each state without paging through them. */
  counts: { status: string; orders: number }[];
}

const iso = (v: Date | string | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

/** Keep the last 3 characters visible — enough for support to confirm a number
    a caller reads out, useless as a contact list (same rule as org-sales). */
function mask(value: string | null): string | null {
  if (value == null || value === '') return null;
  const s = String(value);
  return s.length <= 3 ? '*'.repeat(s.length) : '*'.repeat(s.length - 3) + s.slice(-3);
}

/** Keyset cursor over (created_at, id) — stable under inserts, unlike OFFSET,
    which silently repeats rows on a table this write-heavy. */
function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}
function decodeCursor(cursor: string | null | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [createdAt, id] = Buffer.from(String(cursor), 'base64url').toString('utf8').split('|');
    if (!createdAt || !id) return null;
    if (Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly scope: OrgScopeService,
    private readonly organizers: OrganizerRepo,
  ) {}

  /** The filter dropdowns: every event (with its organizer) and every organizer. */
  async filters() {
    const [events, orgs] = await Promise.all([this.scope.readEvents(), this.organizers.list()]);
    return {
      statuses: [...ORDER_STATES],
      events: events
        .filter(Boolean)
        .map((e) => ({ id: e.id as string, name: (e.name as string) ?? null, organizerHandle: (e.organizerHandle as string) ?? null })),
      organizers: orgs.map((o) => ({ handle: o.handle, name: o.name })),
      defaultDays: DEFAULT_WINDOW_DAYS,
      piiWindowDays: NEVER_PAID_PII_DAYS,
    };
  }

  async list(query: AdminOrdersQuery): Promise<AdminOrdersPage> {
    const sql = db();
    const events = await this.scope.readEvents();
    const eventById = new Map<string, any>(events.filter(Boolean).map((e) => [e.id as string, e]));

    // ── window (PERF-1) ──
    const rawDays = query.days == null ? DEFAULT_WINDOW_DAYS : Number(query.days);
    const days = !Number.isFinite(rawDays) ? DEFAULT_WINDOW_DAYS : Math.max(0, Math.min(Math.floor(rawDays), MAX_WINDOW_DAYS));
    const from = days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString() : null;

    // ── event scope ──
    // `organizer` resolves to that org's event ids through the events blob (C3),
    // exactly like every other org-scoped read. An organizer that owns nothing
    // yields an empty set and therefore an empty page — never everything.
    let eventIds: string[] | null = null;
    if (query.organizerHandle) {
      const handle = String(query.organizerHandle).toLowerCase();
      eventIds = events.filter((e) => e && String(e.organizerHandle ?? '').toLowerCase() === handle).map((e) => e.id as string);
      if (query.eventId) eventIds = eventIds.includes(query.eventId) ? [query.eventId] : [];
    } else if (query.eventId) {
      eventIds = [String(query.eventId)];
    }
    if (eventIds !== null && eventIds.length === 0) {
      return { orders: [], nextCursor: null, window: { days: days || null, from }, counts: [] };
    }

    const status = query.status ? String(query.status) : null;
    const limit = Math.max(1, Math.min(Number(query.limit) || DEFAULT_LIMIT, MAX_LIMIT));
    const cursor = decodeCursor(query.cursor);

    // ── search ──
    // Three shapes a support ticket carries: a phone (any punctuation), an email
    // fragment, or an order id. Each gets its own predicate; a null q disables
    // all three rather than becoming '%%' (which would defeat the index).
    const rawQ = query.q ? String(query.q).trim() : '';
    const qDigits = rawQ.replace(/\D/g, '');
    const qPhone = qDigits.length >= 6 ? `%${qDigits}%` : null;
    const qEmail = rawQ.includes('@') || /[a-z]/i.test(rawQ) ? `%${rawQ.toLowerCase()}%` : null;
    const qId = /^[0-9a-f-]{6,}$/i.test(rawQ) ? `${rawQ.toLowerCase()}%` : null;
    const hasQ = !!(qPhone || qEmail || qId);

    type Row = {
      id: string; event_id: string; type: string; status: string; target_value: string | number;
      created_at: Date; commission_rate: string | null; refunded_amount: string | number | null;
      refunded_at: Date | null; customer_id: string | null;
      phone: string | null; email: string | null; name: string | null;
    };

    const rows = (await sql`
      select o.id              as id,
             o.event_id        as event_id,
             o.type            as type,
             o.status          as status,
             o.target_value    as target_value,
             o.created_at      as created_at,
             o.commission_rate as commission_rate,
             o.refunded_amount as refunded_amount,
             o.refunded_at     as refunded_at,
             c.id              as customer_id,
             c.phone           as phone,
             c.email           as email,
             c.name            as name
        from "order" o
        left join customer c on c.id = o.customer_id
       where (${status}::text is null or o.status = ${status})
         and (${eventIds}::text[] is null or o.event_id = any(${eventIds}))
         and (${from}::timestamptz is null or o.created_at >= ${from}::timestamptz)
         and (${cursor ? cursor.createdAt : null}::timestamptz is null
              or (o.created_at, o.id) < (${cursor ? cursor.createdAt : null}::timestamptz,
                                         ${cursor ? cursor.id : null}::uuid))
         and (${!hasQ}
              or (${qPhone}::text is not null and c.phone like ${qPhone})
              or (${qEmail}::text is not null and lower(c.email) like ${qEmail})
              or (${qId}::text is not null and o.id::text like ${qId}))
       order by o.created_at desc, o.id desc
       limit ${limit + 1}`) as Row[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // Counts over the WINDOW, so the section header can show "142 pending · 9
    // failed" without paging. Cheap: it is the same predicate minus the cursor,
    // grouped, and it rides the (status, created_at) index from 0014.
    const countRows = (await sql`
      select o.status as status, count(*)::int as orders
        from "order" o
       where (${eventIds}::text[] is null or o.event_id = any(${eventIds}))
         and (${from}::timestamptz is null or o.created_at >= ${from}::timestamptz)
       group by o.status
       order by 2 desc`) as { status: string; orders: number }[];

    if (!page.length) {
      return {
        orders: [],
        nextCursor: null,
        window: { days: days || null, from },
        counts: countRows.map((r) => ({ status: r.status, orders: Number(r.orders) })),
      };
    }

    const orderIds = page.map((o) => o.id);
    const decorated = await this.decorate(sql, orderIds);

    const orgByHandle = new Map((await this.organizers.list()).map((o) => [o.handle, o.name]));
    const piiCutoff = Date.now() - NEVER_PAID_PII_DAYS * 86_400_000;

    const orders: AdminOrderRow[] = page.map((o) => {
      const ev = eventById.get(o.event_id);
      const orgHandle = (ev?.organizerHandle as string) ?? null;
      const lines = decorated.linesByOrder.get(o.id) ?? [];
      const split = decorated.splitByOrder.get(o.id) ?? null;
      const attempts = decorated.attemptsByOrder.get(o.id) ?? [];
      const latest = attempts.length ? attempts[attempts.length - 1] : null;

      // OV8 — a cart that never took money, past the window, loses its contact.
      const paidEver = PAID_STATES.has(o.status);
      const redact = !paidEver && new Date(o.created_at).getTime() < piiCutoff;

      const cartValue = split
        ? (split.seats.find((s) => s.isThisOrder)?.amount ?? 0)
        : lines.reduce((a, l) => a + l.amount, 0);
      const currency = lines[0]?.currency ?? split?.currency ?? DEFAULT_CURRENCY;

      return {
        id: o.id,
        type: o.type,
        status: o.status,
        eventId: o.event_id,
        eventName: (ev?.name as string) ?? null,
        organizerHandle: orgHandle,
        organizerName: orgHandle ? orgByHandle.get(orgHandle) ?? orgHandle : null,
        buyer: {
          customerId: o.customer_id,
          name: redact ? mask(o.name) : o.name,
          phone: redact ? mask(o.phone) : o.phone,
          email: redact ? mask(o.email) : o.email,
        },
        piiRedacted: redact,
        lines,
        split,
        cartValue,
        targetValue: Number(o.target_value ?? 0),
        currency,
        refundedAmount: Number(o.refunded_amount ?? 0),
        refundedAt: iso(o.refunded_at),
        commissionRate: o.commission_rate == null ? null : Number(o.commission_rate),
        method: latest?.method ?? null,
        fspId: latest?.fspId ?? null,
        attempts,
        credentials: decorated.credsByOrder.get(o.id) ?? [],
        createdAt: iso(o.created_at) as string,
      };
    });

    const last = page[page.length - 1];
    return {
      orders,
      nextCursor: hasMore ? encodeCursor(iso(last.created_at) as string, last.id) : null,
      window: { days: days || null, from },
      counts: countRows.map((r) => ({ status: r.status, orders: Number(r.orders) })),
    };
  }

  /** Line items, split seats, payment attempts and credentials for ONE page of
      orders. Five queries for the whole page, never per row. */
  private async decorate(sql: any, orderIds: string[]) {
    const itemRows = (await sql`
      select oi.order_id       as order_id,
             oi.product_tier_id as tier_id,
             pt.name           as tier_name,
             oi.quantity       as quantity,
             oi.unit_price     as unit_price,
             pv.currency       as currency
        from order_item    oi
        join product_tier  pt on pt.id = oi.product_tier_id
        join price_version pv on pv.id = oi.price_version_id
       where oi.order_id = any(${orderIds}::uuid[])
       order by oi.created_at asc`) as {
      order_id: string; tier_id: string; tier_name: string | null;
      quantity: number; unit_price: string | number; currency: string;
    }[];

    // ── OV8: the split cart ──
    // The seat THIS order paid for, and the table it belongs to. Without this
    // the drawer for a table_share order is blank.
    const shareRows = (await sql`
      select ss.order_id        as order_id,
             ss.split_id        as split_id,
             ss.share_index     as share_index,
             ss.amount          as amount,
             ss.state           as state,
             ss.is_host         as is_host,
             ss.paid_at         as paid_at,
             ts.capacity_n      as capacity,
             ts.status          as split_status,
             ts.target_value    as target_value,
             pt.name            as tier_name,
             pv.currency        as currency
        from split_share   ss
        join table_split   ts on ts.id = ss.split_id
        left join product_tier  pt on pt.id = ts.product_tier_id
        left join price_version pv on pv.id = ts.price_version_id
       where ss.order_id = any(${orderIds}::uuid[])`) as {
      order_id: string; split_id: string; share_index: number; amount: string | number; state: string;
      is_host: boolean; paid_at: Date | null; capacity: number; split_status: string;
      target_value: string | number; tier_name: string | null; currency: string | null;
    }[];

    const splitIds = [...new Set(shareRows.map((s) => s.split_id))];
    const siblingRows = splitIds.length
      ? ((await sql`
          select split_id, share_index, amount, state, is_host, paid_at, order_id
            from split_share
           where split_id = any(${splitIds}::uuid[])
           order by share_index asc`) as {
          split_id: string; share_index: number; amount: string | number; state: string;
          is_host: boolean; paid_at: Date | null; order_id: string | null;
        }[])
      : [];

    const attemptRows = (await sql`
      select order_id, transaction_id, method, fsp_id, amount, currency, status,
             order_reference, bill_pay_number, collected_amount, created_at, updated_at
        from payment_transaction
       where order_id = any(${orderIds}::uuid[])
       order by created_at asc`) as {
      order_id: string; transaction_id: string; method: string | null; fsp_id: string | null;
      amount: string | number | null; currency: string | null; status: string;
      order_reference: string | null; bill_pay_number: string | null;
      collected_amount: string | number | null; created_at: Date; updated_at: Date | null;
    }[];

    // Credentials reach an order two ways: through order_item (GA/VIP) and
    // through split_share (table seats). Both, or a paid split shows no ticket.
    const credRows = (await sql`
      select oi.order_id as order_id, c.public_ref as public_ref, c.state as state,
             c.tier_id as tier_id, c.seat_index as seat_index
        from credential c
        join order_item oi on oi.id = c.order_item_id
       where oi.order_id = any(${orderIds}::uuid[])
      union all
      select ss.order_id as order_id, c.public_ref as public_ref, c.state as state,
             c.tier_id as tier_id, c.seat_index as seat_index
        from credential c
        join split_share ss on ss.id = c.split_share_id
       where ss.order_id = any(${orderIds}::uuid[])`) as {
      order_id: string; public_ref: string | null; state: string; tier_id: string | null; seat_index: number | null;
    }[];

    const linesByOrder = new Map<string, AdminOrderLine[]>();
    for (const it of itemRows) {
      const arr = linesByOrder.get(it.order_id) ?? [];
      const unitPrice = Number(it.unit_price ?? 0);
      const qty = Number(it.quantity ?? 0);
      arr.push({
        tierId: it.tier_id,
        tier: it.tier_name || it.tier_id,
        qty,
        unitPrice,
        amount: unitPrice * qty,
        currency: it.currency,
      });
      linesByOrder.set(it.order_id, arr);
    }

    const seatsBySplit = new Map<string, { shareIndex: number; amount: number; state: string; isHost: boolean; paidAt: string | null; orderId: string | null }[]>();
    for (const s of siblingRows) {
      const arr = seatsBySplit.get(s.split_id) ?? [];
      arr.push({
        shareIndex: s.share_index,
        amount: Number(s.amount ?? 0),
        state: s.state,
        isHost: !!s.is_host,
        paidAt: iso(s.paid_at),
        orderId: s.order_id,
      });
      seatsBySplit.set(s.split_id, arr);
    }

    const splitByOrder = new Map<string, AdminOrderSplit>();
    for (const s of shareRows) {
      const seats = seatsBySplit.get(s.split_id) ?? [];
      splitByOrder.set(s.order_id, {
        splitId: s.split_id,
        tier: s.tier_name,
        capacity: Number(s.capacity ?? 0),
        status: s.split_status,
        targetValue: Number(s.target_value ?? 0),
        currency: s.currency ?? DEFAULT_CURRENCY,
        paidCount: seats.filter((x) => x.state === 'paid').length,
        seats: seats.map((x) => ({
          shareIndex: x.shareIndex,
          amount: x.amount,
          state: x.state,
          isHost: x.isHost,
          paidAt: x.paidAt,
          isThisOrder: x.orderId === s.order_id,
        })),
      });
    }

    const attemptsByOrder = new Map<string, AdminOrderAttempt[]>();
    for (const a of attemptRows) {
      const arr = attemptsByOrder.get(a.order_id) ?? [];
      arr.push({
        transactionId: a.transaction_id,
        method: a.method,
        fspId: a.fsp_id,
        status: a.status,
        amount: a.amount == null ? null : Number(a.amount),
        collectedAmount: a.collected_amount == null ? null : Number(a.collected_amount),
        currency: a.currency,
        orderReference: a.order_reference,
        billPayNumber: a.bill_pay_number,
        createdAt: iso(a.created_at) as string,
        updatedAt: iso(a.updated_at),
      });
      attemptsByOrder.set(a.order_id, arr);
    }

    const credsByOrder = new Map<string, AdminOrderCredential[]>();
    for (const c of credRows) {
      const arr = credsByOrder.get(c.order_id) ?? [];
      arr.push({ publicRef: c.public_ref, state: c.state, tierId: c.tier_id, seatIndex: c.seat_index });
      credsByOrder.set(c.order_id, arr);
    }

    return { linesByOrder, splitByOrder, attemptsByOrder, credsByOrder };
  }
}
