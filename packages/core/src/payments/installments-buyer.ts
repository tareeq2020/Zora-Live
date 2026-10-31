/* BS134 (F7 / A5 / DD5): buyer-facing installment reads.

   - installmentOffer / installmentOffers — the light "is it offered, and what's the
     hint" read for the event page and event cards ("or 3 × TSh 20,000").
   - installmentQuote — the schedule a buyer WOULD get for a cart, priced exactly
     like createGaVipOrder (current price_version, fee only on 'passed' lines) and
     built by the same buildSchedule maths the order snapshot uses. Read-only.
   - installmentPayView — the /pay/<orderId> page model (event, lines, plan, next
     due). Contains amounts + the buyer phone: the API only serves it to the buyer
     (checkout cookie or a verified consumer session), never by order id alone.
   - customerInstallments — the signed-in buyer's plans (my passes).

   The zp_installments flag is NOT checked here (core has no settings store); the
   API edge checks it before calling any of these. */
import {
  buildSchedule, configCoversCart, eatToday, finalDueFor,
  type InstallmentFrequency, type ScheduleRow, type ScheduleRejection,
} from '../installments';
import { readInstallmentConfig, eventInstallmentContext, installmentSummary, type InstallmentSummary } from './installments';

type Sql = any;

/* ── offer + hint ─────────────────────────────────────────────────────────── */

export interface InstallmentOfferView {
  eventId: string;
  count: number;
  frequency: InstallmentFrequency;
  finalDue: string;
  graceDays: number;
  /** Tier ids the offer covers; empty = every tier. */
  tiers: string[];
  currency: string;
  /** Cheapest offered tier price (one pass). */
  fromPrice: number;
  /** The hint figure: fromPrice / count, rounded up to whole TSh. */
  perPayment: number;
}

/** The event's offer as a buyer sees it, or null when there is nothing to offer
    today (no config, disabled, no offered tier on sale, or the schedule no longer
    fits before the final due date). */
export async function installmentOffer(sql: Sql, eventId: string, today: string = eatToday()): Promise<InstallmentOfferView | null> {
  const config = await readInstallmentConfig(sql, eventId);
  if (!config || !config.enabled) return null;
  const ctx = await eventInstallmentContext(sql, eventId);
  const finalDue = ctx.eventDate ? finalDueFor(ctx.eventDate, config.finalDueDaysBeforeEvent) : null;
  if (!finalDue) return null;
  const tiers = await sql`
    select pt.id, pv.price, pv.currency
      from product_tier pt
      join lateral (select price, currency from price_version
                     where tier_id = pt.id and effective_to is null
                     order by effective_from desc limit 1) pv on true
     where pt.event_id = ${eventId} and pt.disabled = false`;
  const offered = tiers.filter((t: any) => configCoversCart(config, [t.id]) && Number(t.price) > 0);
  if (!offered.length) return null;
  const cheapest = offered.reduce((a: any, b: any) => (Number(b.price) < Number(a.price) ? b : a));
  const price = Number(cheapest.price);
  const s = buildSchedule({
    total: price, depositPct: config.depositPct, depositAmount: config.depositAmount,
    count: config.count, frequency: config.frequency, today, finalDue,
  });
  if (!s.ok) return null;
  return {
    eventId, count: config.count, frequency: config.frequency, finalDue, graceDays: config.graceDays,
    tiers: config.tiers, currency: cheapest.currency || 'TZS', fromPrice: price,
    perPayment: Math.ceil(price / config.count),
  };
}

/* ── quote ────────────────────────────────────────────────────────────────── */

export interface QuoteLine { tier: string; quantity: number }

export type InstallmentQuoteResult =
  | {
      ok: true; eventId: string; currency: string; subtotal: number; fee: number; total: number;
      deposit: number; count: number; frequency: InstallmentFrequency; finalDue: string; graceDays: number;
      schedule: ScheduleRow[];
    }
  | { ok: false; reason: 'not_offered' }
  | { ok: false; reason: 'unknown_tier'; tier: string }
  | { ok: false; reason: 'schedule_rejected'; code: ScheduleRejection; message: string };

/** What paying this cart in installments would look like today. Mirrors
    createGaVipOrder's pricing so the quote and the placed order agree. */
export async function installmentQuote(
  sql: Sql, eventId: string, lines: QuoteLine[], feeRate: number, today: string = eatToday(),
): Promise<InstallmentQuoteResult> {
  const config = await readInstallmentConfig(sql, eventId);
  if (!configCoversCart(config, lines.map((l) => l.tier))) return { ok: false, reason: 'not_offered' };
  let subtotal = 0;
  let passed = 0;
  let currency = 'TZS';
  for (const l of lines) {
    const [pv] = await sql`
      select pv.price, pv.fee_treatment, pv.currency from price_version pv
        join product_tier pt on pt.id = pv.tier_id
       where pv.tier_id = ${l.tier} and pt.event_id = ${eventId} and pv.effective_to is null and pt.disabled = false
       order by pv.effective_from desc limit 1`;
    if (!pv) return { ok: false, reason: 'unknown_tier', tier: l.tier };
    const line = Number(pv.price) * l.quantity;
    subtotal += line;
    if (pv.fee_treatment === 'passed') passed += line;
    currency = pv.currency || currency;
  }
  const fee = Math.round(passed * (Number.isFinite(feeRate) ? feeRate : 0));
  const total = subtotal + fee;
  const ctx = await eventInstallmentContext(sql, eventId);
  const finalDue = ctx.eventDate ? finalDueFor(ctx.eventDate, config!.finalDueDaysBeforeEvent) : null;
  if (!finalDue) return { ok: false, reason: 'schedule_rejected', code: 'bad_date', message: 'The event date is not set, so installments are not available.' };
  const s = buildSchedule({
    total, depositPct: config!.depositPct, depositAmount: config!.depositAmount,
    count: config!.count, frequency: config!.frequency, today, finalDue,
  });
  if (!s.ok) return { ok: false, reason: 'schedule_rejected', code: s.reason, message: s.message };
  return {
    ok: true, eventId, currency, subtotal, fee, total, deposit: s.deposit, count: config!.count,
    frequency: config!.frequency, finalDue: s.finalDue, graceDays: config!.graceDays, schedule: s.rows,
  };
}

/* ── the /pay/<orderId> page ──────────────────────────────────────────────── */

export interface InstallmentPayView {
  orderId: string;
  orderStatus: string;
  eventId: string;
  eventName: string;
  venue: string | null;
  dateLabel: string | null;
  eventDate: string | null;
  orgHandle: string | null;
  lines: { tier: string; name: string; quantity: number; seatLabels: string[] }[];
  passCount: number;
  serviceFee: number;
  refundDue: number;
  refundStatus: string;
  /** The schedule row the next PAY charges, or null when nothing is payable. */
  next: { n: number; dueDate: string; amount: number; status: string } | null;
  /** Last date the open row may still be paid (final due + grace). */
  graceUntil: string | null;
  /** The latest installment attempt (for the pay page's progress). */
  lastAttempt: { transactionId: string; n: number; status: string; createdAt: string } | null;
  plan: InstallmentSummary;
  /** Buyer phone (255…) — prefills the payer number. Buyer-only read. */
  phone: string | null;
  customerId: string | null;
}

/** Who owns the order (for the API's access check). Null = no such installment order. */
export async function installmentOrderOwner(sql: Sql, orderId: string): Promise<{ customerId: string; phone: string | null } | null> {
  const [r] = await sql`
    select o.customer_id, c.phone from installment_plan p
      join "order" o on o.id = p.order_id
      left join customer c on c.id = o.customer_id
     where p.order_id = ${orderId}::uuid`;
  return r ? { customerId: String(r.customer_id), phone: r.phone ?? null } : null;
}

export async function installmentPayView(sql: Sql, orderId: string): Promise<InstallmentPayView | null> {
  const plan = await installmentSummary(sql, orderId);
  if (!plan) return null;
  const [o] = await sql`
    select o.status, o.event_id, o.customer_id, c.phone, e.name as event_name, e.venue, e.date_label,
           p.org_handle, p.service_fee, p.refund_due, p.refund_status
      from "order" o
      join installment_plan p on p.order_id = o.id
      left join customer c on c.id = o.customer_id
      left join event e on e.id = o.event_id
     where o.id = ${orderId}::uuid`;
  if (!o) return null;
  const items = await sql`
    select oi.product_tier_id as tier, pt.name, sum(oi.quantity)::int as qty
      from order_item oi left join product_tier pt on pt.id = oi.product_tier_id
     where oi.order_id = ${orderId}::uuid
     group by oi.product_tier_id, pt.name order by pt.name`;
  let seats: any[] = [];
  try {
    seats = await sql`select tier_id, label from seat_inventory where hold_order_id = ${orderId}::uuid order by label`;
  } catch { seats = []; }
  const lines = items.map((r: any) => ({
    tier: r.tier, name: r.name || r.tier, quantity: Number(r.qty),
    seatLabels: seats.filter((s: any) => s.tier_id === r.tier).map((s: any) => String(s.label)),
  }));
  const open = plan.schedule.find((r) => r.status !== 'paid') || null;
  const payable = !!open && (
    (open.n === 1 && (o.status === 'pending' || o.status === 'failed')) ||
    (open.n > 1 && o.status === 'installment_active' && plan.status === 'active')
  );
  const [att] = await sql`
    select transaction_id, schedule_n, status, created_at from payment_transaction
     where order_id = ${orderId}::uuid and schedule_n is not null
     order by created_at desc limit 1`;
  const ctx = await eventInstallmentContext(sql, String(o.event_id));
  const graceUntil = plan.finalDue ? addDaysIso(plan.finalDue, plan.graceDays) : null;
  return {
    orderId, orderStatus: o.status, eventId: String(o.event_id), eventName: o.event_name || 'Your event',
    venue: o.venue ?? null, dateLabel: o.date_label ?? null, eventDate: ctx.eventDate, orgHandle: o.org_handle ?? ctx.orgHandle,
    lines, passCount: lines.reduce((n: number, l: any) => n + l.quantity, 0),
    serviceFee: Number(o.service_fee), refundDue: Number(o.refund_due), refundStatus: o.refund_status,
    next: payable && open ? { n: open.n, dueDate: open.dueDate, amount: open.amount, status: open.status } : null,
    graceUntil,
    lastAttempt: att ? {
      transactionId: att.transaction_id, n: Number(att.schedule_n), status: att.status,
      createdAt: new Date(att.created_at).toISOString(),
    } : null,
    plan, phone: o.phone ?? null, customerId: o.customer_id ? String(o.customer_id) : null,
  };
}

function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/* ── my passes ────────────────────────────────────────────────────────────── */

export interface CustomerInstallmentRow {
  orderId: string;
  eventId: string;
  eventName: string;
  dateLabel: string | null;
  venue: string | null;
  status: string;
  paidCount: number;
  count: number;
  total: number;
  paid: number;
  currency: string;
  nextDue: string | null;
  nextAmount: number | null;
}

/** The buyer's installment plans that are still in flight or recently closed
    (completed plans already have passes in /me/tickets; they are listed too so
    "my passes" can show the plan history). Cancelled (never-paid) plans are hidden. */
export async function customerInstallments(sql: Sql, customerId: string): Promise<CustomerInstallmentRow[]> {
  const rows = await sql`
    select p.order_id, p.event_id, p.status, p.count, p.total, p.currency, e.name as event_name, e.date_label, e.venue,
           coalesce(sum(s.amount) filter (where s.status = 'paid'), 0)::bigint as paid,
           count(*) filter (where s.status = 'paid')::int as paid_count,
           min(to_char(s.due_date, 'YYYY-MM-DD')) filter (where s.status <> 'paid') as next_due,
           (array_agg(s.amount order by s.n) filter (where s.status <> 'paid'))[1] as next_amount
      from installment_plan p
      join "order" o on o.id = p.order_id
      left join event e on e.id = p.event_id
      left join installment_schedule s on s.order_id = p.order_id
     where o.customer_id = ${customerId} and p.status not in ('cancelled', 'pending')
     group by p.order_id, p.event_id, p.status, p.count, p.total, p.currency, e.name, e.date_label, e.venue, p.created_at
     order by p.created_at desc
     limit 50`;
  return rows.map((r: any) => ({
    orderId: String(r.order_id), eventId: r.event_id, eventName: r.event_name || 'Your event',
    dateLabel: r.date_label ?? null, venue: r.venue ?? null, status: r.status,
    paidCount: Number(r.paid_count), count: Number(r.count), total: Number(r.total), paid: Number(r.paid),
    currency: r.currency, nextDue: r.next_due ?? null, nextAmount: r.next_amount == null ? null : Number(r.next_amount),
  }));
}
