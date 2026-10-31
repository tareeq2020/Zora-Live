/* BS136 (F7 / DD5): organizer + admin read models for installments.

   - orgInstallmentList: the organizer "Installments" page — one row per plan the
     org owns (scoped by the caller's owned event ids, C3), KPIs and filter counts.
     NO buyer phone or email ever leaves this function: the buyer is a display
     name only ("Neema K."), and when the order has no name, "Buyer".
   - claimOrgReminder: the once-per-day-per-order latch for "Send reminder"
     (webhook_event provider 'installment-org-remind', the same once-latch the
     worker's reminders use).
   - pendingInstallmentRefunds: the admin manual-refund worklist (plans whose
     default left refund_status = 'pending'). Admin-only — it carries the phone
     ops needs to pay the buyer back.

   Status words (DD5), derived from the plan + its next unpaid row, EAT dates:
     on_track   active, next due more than 7 days away
     due_week   active (or closing), next due within the next 7 days (today included)
     overdue    active/closing, next due date already passed (grace running)
     paid       plan completed (passes issued)
     released   plan defaulted (booking released, refund owed/recorded)
   'pending' plans (deposit not cleared) and 'cancelled' ones are not listed. */
import { addDays, eatToday } from '../installments';

type Sql = any;

export const ORG_INSTALLMENT_STATUSES = ['on_track', 'due_week', 'overdue', 'paid', 'released'] as const;
export type OrgInstallmentStatus = (typeof ORG_INSTALLMENT_STATUSES)[number];

export interface OrgInstallmentRow {
  orderId: string;
  ref: string;
  eventId: string;
  eventName: string;
  buyer: string;
  passes: string;
  paidCount: number;
  count: number;
  paid: number;
  total: number;
  currency: string;
  nextDue: string | null;
  graceEnds: string | null;
  status: OrgInstallmentStatus;
  refundStatus: string;
  remindedToday: boolean;
}

export interface OrgInstallmentList {
  today: string;
  kpis: { collected: number; toCollect: number; openPlans: number; dueThisWeek: number; overdue: number; graceDays: number | null; currency: string };
  counts: Record<'all' | OrgInstallmentStatus, number>;
  rows: OrgInstallmentRow[];
}

/** "Neema Kileo" → "Neema K."; empty → "Buyer". Never a phone/email. */
export function buyerDisplayName(name: string | null | undefined): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Buyer';
  // A name that is really a phone or email is never shown.
  if (parts.some((p) => /@/.test(p) || /^\+?\d{6,}$/.test(p))) return 'Buyer';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export function orderRef(orderId: string): string {
  return 'ZP-' + String(orderId).replace(/-/g, '').slice(0, 8).toUpperCase();
}

function classify(planStatus: string, nextDue: string | null, today: string): OrgInstallmentStatus {
  if (planStatus === 'completed') return 'paid';
  if (planStatus === 'defaulted') return 'released';
  if (!nextDue) return 'paid';
  if (nextDue < today) return 'overdue';
  if (nextDue <= addDays(today, 7)) return 'due_week';
  return 'on_track';
}

export async function orgInstallmentList(
  sql: Sql, eventIds: string[], opts: { event?: string | null; status?: string | null; now?: Date } = {},
): Promise<OrgInstallmentList> {
  const today = eatToday(opts.now);
  const ids = opts.event ? eventIds.filter((e) => e === opts.event) : eventIds;
  const empty: OrgInstallmentList = {
    today,
    kpis: { collected: 0, toCollect: 0, openPlans: 0, dueThisWeek: 0, overdue: 0, graceDays: null, currency: 'TZS' },
    counts: { all: 0, on_track: 0, due_week: 0, overdue: 0, paid: 0, released: 0 },
    rows: [],
  };
  if (!ids.length) return empty;

  const plans = await sql`
    select p.order_id, p.event_id, p.status, p.total, p.currency, p.count, p.grace_days, p.refund_status, p.created_at,
           e.name as event_name, c.name as buyer_name,
           coalesce(agg.paid, 0)::bigint as paid, coalesce(agg.paid_count, 0)::int as paid_count,
           to_char(nx.due_date, 'YYYY-MM-DD') as next_due,
           (select string_agg(oi.quantity || ' × ' || upper(coalesce(pt.name, oi.product_tier_id)), ', ' order by pt.name)
              from order_item oi left join product_tier pt on pt.id = oi.product_tier_id
             where oi.order_id = p.order_id) as passes,
           exists (select 1 from webhook_event w
                    where w.provider = 'installment-org-remind' and w.dedup_key = p.order_id::text || ':' || ${today}) as reminded
      from installment_plan p
      join "order" o on o.id = p.order_id
      left join customer c on c.id = o.customer_id
      left join event e on e.id = p.event_id
      left join lateral (
        select sum(amount) filter (where status = 'paid') as paid, count(*) filter (where status = 'paid') as paid_count
          from installment_schedule s where s.order_id = p.order_id) agg on true
      left join lateral (
        select due_date from installment_schedule s
         where s.order_id = p.order_id and s.status <> 'paid' order by n limit 1) nx on true
     where p.event_id = any(${ids}) and p.status in ('active', 'closing', 'completed', 'defaulted')
     order by p.created_at desc
     limit 2000`;

  const out = empty;
  const graces = new Set<number>();
  const all: OrgInstallmentRow[] = [];
  for (const p of plans) {
    const status = classify(p.status, p.next_due, today);
    const paid = Number(p.paid);
    const total = Number(p.total);
    const open = p.status === 'active' || p.status === 'closing';
    out.kpis.currency = p.currency || out.kpis.currency;
    if (p.status !== 'defaulted') out.kpis.collected += paid;
    if (open) {
      out.kpis.toCollect += total - paid;
      out.kpis.openPlans += 1;
      graces.add(Number(p.grace_days));
    }
    if (status === 'due_week') out.kpis.dueThisWeek += 1;
    if (status === 'overdue') out.kpis.overdue += 1;
    out.counts.all += 1;
    out.counts[status] += 1;
    all.push({
      orderId: p.order_id,
      ref: orderRef(p.order_id),
      eventId: p.event_id,
      eventName: p.event_name ?? p.event_id,
      buyer: buyerDisplayName(p.buyer_name),
      passes: p.passes ?? '',
      paidCount: Number(p.paid_count),
      count: Number(p.count),
      paid,
      total,
      currency: p.currency || 'TZS',
      nextDue: open ? p.next_due : null,
      graceEnds: open && p.next_due && p.next_due < today ? addDays(p.next_due, Number(p.grace_days)) : null,
      status,
      refundStatus: p.refund_status,
      remindedToday: p.reminded === true,
    });
  }
  out.kpis.graceDays = graces.size === 1 ? [...graces][0] : null;
  const want = opts.status && (ORG_INSTALLMENT_STATUSES as readonly string[]).includes(opts.status) ? opts.status : null;
  // Most urgent first: overdue, due this week, on track, then closed plans.
  const rank: Record<OrgInstallmentStatus, number> = { overdue: 0, due_week: 1, on_track: 2, paid: 3, released: 4 };
  out.rows = (want ? all.filter((r) => r.status === want) : all)
    .sort((a, b) => rank[a.status] - rank[b.status] || String(a.nextDue ?? '9').localeCompare(String(b.nextDue ?? '9')));
  return out;
}

/** The event id of a plan (for org ownership checks), or null. */
export async function installmentPlanEvent(sql: Sql, orderId: string): Promise<{ eventId: string; status: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  const [p] = await sql`select event_id, status from installment_plan where order_id = ${orderId}::uuid`;
  return p ? { eventId: p.event_id, status: p.status } : null;
}

/** Seconds until the next EAT midnight (the reminder latch's day boundary). */
export function secondsUntilEatMidnight(now: Date = new Date()): number {
  const eat = new Date(now.getTime() + 3 * 3_600_000);
  const next = Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate() + 1);
  return Math.max(60, Math.ceil((next - eat.getTime()) / 1000));
}

/** Claim today's organizer reminder for this order. True = first claim today. */
export async function claimOrgReminder(sql: Sql, orderId: string, now: Date = new Date()): Promise<boolean> {
  const key = `${orderId}:${eatToday(now)}`;
  const [r] = await sql`
    insert into webhook_event (provider, dedup_key, transaction_id, applied)
    values ('installment-org-remind', ${key}, null, true)
    on conflict (provider, dedup_key) do nothing returning id`;
  return !!r;
}

/** Undo a claim (delivery could not even start — let the organizer retry). */
export async function releaseOrgReminder(sql: Sql, orderId: string, now: Date = new Date()): Promise<void> {
  await sql`delete from webhook_event where provider = 'installment-org-remind' and dedup_key = ${`${orderId}:${eatToday(now)}`}`;
}

export interface PendingInstallmentRefund {
  orderId: string;
  ref: string;
  eventId: string;
  eventName: string;
  orgHandle: string | null;
  buyerPhone: string | null;
  buyerName: string | null;
  paid: number;
  serviceFee: number;
  refundDue: number;
  currency: string;
  closedAt: string | null;
}

/** Admin worklist: defaulted plans whose refund is still to be paid back. */
export async function pendingInstallmentRefunds(sql: Sql): Promise<PendingInstallmentRefund[]> {
  const rows = await sql`
    select p.order_id, p.event_id, p.org_handle, p.service_fee, p.refund_due, p.currency, p.closed_at,
           e.name as event_name, c.phone, c.name,
           coalesce((select sum(amount) from installment_schedule s where s.order_id = p.order_id and s.status = 'paid'), 0)::bigint as paid
      from installment_plan p
      join "order" o on o.id = p.order_id
      left join customer c on c.id = o.customer_id
      left join event e on e.id = p.event_id
     where p.refund_status = 'pending'
     order by p.closed_at nulls last, p.created_at
     limit 500`;
  return rows.map((r: any) => ({
    orderId: r.order_id,
    ref: orderRef(r.order_id),
    eventId: r.event_id,
    eventName: r.event_name ?? r.event_id,
    orgHandle: r.org_handle ?? null,
    buyerPhone: r.phone && /^\+?\d{9,15}$/.test(String(r.phone)) ? String(r.phone) : null,
    buyerName: r.name ?? null,
    paid: Number(r.paid),
    serviceFee: Number(r.service_fee),
    refundDue: Number(r.refund_due),
    currency: r.currency || 'TZS',
    closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
  }));
}
