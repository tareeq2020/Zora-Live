import { Injectable } from '@nestjs/common';
import { db, FLAGGED_MONEY_STATUSES } from '@zora/core';
import { OrgScopeService } from '../org/org-scope.service';
import { OrganizerRepo } from '../storage/organizer-repo';
import { EntityStore } from '../storage/entity-store';

/* BS152 — the admin "Needs attention" queue.

   One read over every queue where a person has to act, built from live data:
     critical  money taken, nothing delivered (flagged orders, paid without passes)
     high      payments stuck in flight, ops alerts, payouts, installment refunds,
               mobile prompts timing out far above normal (BS159)
     normal    KYC / sign-up reviews (high past 24h), paid buyers never notified

   Abandoned carts (pending, no attempt) are NOT here: that is funnel drop-off.
   Every query is bounded (status/time window + LIMIT) and rides an index; per-
   queue totals come from count(*) over() so `counts` stays exact past the cap. */

export type AttentionSeverity = 'critical' | 'high' | 'normal';

export type AttentionKind =
  | 'paid_unseatable'
  | 'payment_short'
  | 'paid_no_passes'
  | 'payment_stuck'
  | 'prompt_timeouts_high'
  | 'ops_alert'
  | 'payout_request'
  | 'installment_refund'
  | 'kyc_review'
  | 'org_signup'
  | 'buyer_not_notified';

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  organizerHandle: string | null;
  organizerName: string | null;
  eventName: string | null;
  amount: number | null;
  currency: string | null;
  since: string;
  href: string;
}

export interface AttentionResponse {
  generatedAt: string;
  counts: Record<AttentionKind, number>;
  items: AttentionItem[];
}

export const ATTENTION_KINDS: readonly AttentionKind[] = [
  'paid_unseatable', 'payment_short', 'paid_no_passes', 'payment_stuck', 'prompt_timeouts_high', 'ops_alert',
  'payout_request', 'installment_refund', 'kyc_review', 'org_signup', 'buyer_not_notified',
];

/** Items returned. Counts are never capped. */
export const MAX_ITEMS = 100;
/** Rows fetched per queue (enough to fill the cap after the merge sort). */
const PER_QUEUE = MAX_ITEMS;
/** A paid order gets this long to have passes issued / the buyer notified. */
const PAID_GRACE_MIN = 10;
/** A payment attempt in flight longer than this is stuck. */
const STUCK_MIN = 15;
/** Paid orders older than this are not re-checked (bounds the scan). */
const PAID_WINDOW_DAYS = 30;
/** Stuck attempts older than this are left to the expiry sweep. */
const STUCK_WINDOW_DAYS = 7;
const OPS_ALERT_HOURS = 72;
const OPS_ALERT_SCAN = 500;
const KYC_SLA_HOURS = 24;

/* BS159: "prompts are timing out". Over the last TIMEOUT_WINDOW_HOURS, of the
   mobile attempts the gateway accepted (accepted_at or a reference), the share
   that timed out (expired, or failureReason payer_no_response) must reach
   TIMEOUT_SHARE_MIN and be at least TIMEOUT_SPIKE_FACTOR × the share of the
   TIMEOUT_BASELINE_DAYS before the window. Needs TIMEOUT_MIN_ACCEPTED attempts. */
export const TIMEOUT_WINDOW_HOURS = 3;
export const TIMEOUT_MIN_ACCEPTED = 8;
export const TIMEOUT_SHARE_MIN = 0.5;
export const TIMEOUT_SPIKE_FACTOR = 2;
export const TIMEOUT_BASELINE_DAYS = 7;
const DEFAULT_CURRENCY = 'TZS';

const RANK: Record<AttentionSeverity, number> = { critical: 0, high: 1, normal: 2 };

/* Ops-alert kinds already shown by a dedicated queue (the order status or the
   installment refund list), or that only log a resolution. */
const OPS_ALERT_SKIP = new Set([
  'paid_unseatable', 'payment_short',
  'installment_defaulted', 'installment_refund_pending', 'installment_refund_recorded',
]);

/** BS164: alerts that stay open on a refunded cart (raised about money after it). */
const OPS_ALERT_AFTER_REFUND = new Set(['late_collection', 'gateway_mismatch']);

const OPS_ALERT_LABEL: Record<string, string> = {
  duplicate_collection: 'Duplicate collection — refund the extra payment',
  gateway_mismatch: 'x-bridge disagrees with a finished payment — check by hand',
  late_collection: 'Money collected that the cart can no longer take — refund or reconcile',
  split_late_share: 'Split seat paid after the table closed',
  split_unconvertible: 'Split table paid but could not be seated',
  split_share_short: 'Split seat under-paid',
  split_expired_unfilled: 'Split table expired with paid seats',
  receivable_unknown: 'Installment payment for an unknown receivable',
  installment_receivable_expired: 'Installment receivable expired',
  installment_excess_unmatched: 'Installment over-payment not matched',
  installment_receivable_overpaid: 'Installment receivable over-paid',
  installment_orphan_attempt: 'Installment payment with no schedule row',
  installment_short: 'Installment payment under-paid',
  installment_sum_mismatch: 'Installment totals do not add up',
  installment_close_found_paid: 'Installment plan found paid while closing',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (v: Date | string | null | undefined): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const fmtMoney = (n: number | null, cur: string | null) =>
  n == null ? '—' : `${n.toLocaleString('en-US')} ${cur || DEFAULT_CURRENCY}`;
const shortId = (id: string) => id.slice(0, 8).toUpperCase();
const orderHref = (id: string) => `/admin/console/orders/${id}`;

@Injectable()
export class AdminAttentionService {
  constructor(
    private readonly scope: OrgScopeService,
    private readonly organizers: OrganizerRepo,
    private readonly entities: EntityStore,
  ) {}

  async read(): Promise<AttentionResponse> {
    const sql: any = db();
    const now = Date.now();

    const [events, orgs, kycRecords] = await Promise.all([
      this.scope.readEvents(),
      this.organizers.list(),
      this.entities.read<any[]>('kyc', []),
    ]);
    const eventById = new Map<string, any>(events.filter(Boolean).map((e) => [String(e.id), e]));
    const orgByHandle = new Map(orgs.map((o) => [o.handle, o]));

    const counts = Object.fromEntries(ATTENTION_KINDS.map((k) => [k, 0])) as Record<AttentionKind, number>;
    const items: AttentionItem[] = [];

    const orgFields = (handle: string | null | undefined) => {
      const h = handle ? String(handle) : null;
      return { organizerHandle: h, organizerName: h ? orgByHandle.get(h)?.name ?? h : null };
    };
    const eventFields = (eventId: string | null | undefined) => {
      const ev = eventId ? eventById.get(String(eventId)) : null;
      return {
        eventName: (ev?.name as string) ?? (eventId ? String(eventId) : null),
        ...orgFields(ev?.organizerHandle ?? null),
      };
    };
    const total = (rows: any[]) => (rows.length ? Number(rows[0].total) : 0);

    const flagged = [...FLAGGED_MONEY_STATUSES] as string[];

    const [flaggedRows, flaggedCounts, noPassRows, unnotifiedRows, stuckRows, alertRows, payoutRows, refundRows, timeoutRows] =
      await Promise.all([
        // ── critical: flagged money (payment_short / paid_unseatable) ──
        sql`
          select o.id, o.event_id, o.status, o.target_value, o.created_at,
                 lt.collected_amount, lt.currency, lt.updated_at as tx_at
            from "order" o
            left join lateral (
              select collected_amount, currency, updated_at
                from payment_transaction pt
               where pt.order_id = o.id
               order by pt.created_at desc
               limit 1) lt on true
           where o.status = any(${flagged})
           order by o.created_at asc
           limit ${PER_QUEUE}`,
        sql`select status, count(*)::int as n from "order" where status = any(${flagged}) group by status`,

        // ── critical: paid, no passes after the grace period ──
        // Table orders and split seats get passes another way, so they are left out.
        sql`
          select o.id, o.event_id, o.target_value, p.paid_at, count(*) over() as total
            from "order" o
            cross join lateral (
              select coalesce(max(pt.updated_at) filter (where pt.status = 'successful'), o.created_at) as paid_at
                from payment_transaction pt where pt.order_id = o.id) p
           where o.status = 'paid'
             and o.type not in ('table', 'table_share')
             and o.created_at >= now() - make_interval(days => ${PAID_WINDOW_DAYS})
             and p.paid_at < now() - make_interval(mins => ${PAID_GRACE_MIN})
             and not exists (
               select 1 from order_item oi join credential c on c.order_item_id = oi.id
                where oi.order_id = o.id)
           order by p.paid_at asc
           limit ${PER_QUEUE}`,

        // ── normal: paid, passes issued, buyer never notified ──
        sql`
          select o.id, o.event_id, o.target_value, p.paid_at, count(*) over() as total
            from "order" o
            cross join lateral (
              select coalesce(max(pt.updated_at) filter (where pt.status = 'successful'), o.created_at) as paid_at
                from payment_transaction pt where pt.order_id = o.id) p
           where o.status = 'paid'
             and o.notified_at is null
             and o.created_at >= now() - make_interval(days => ${PAID_WINDOW_DAYS})
             and p.paid_at < now() - make_interval(mins => ${PAID_GRACE_MIN})
             and (exists (select 1 from order_item oi join credential c on c.order_item_id = oi.id where oi.order_id = o.id)
                  or exists (select 1 from split_share ss join credential c on c.split_share_id = ss.id where ss.order_id = o.id))
           order by p.paid_at asc
           limit ${PER_QUEUE}`,

        // ── high: the latest attempt on a pending order is still in flight ──
        sql`
          select s.*, count(*) over() as total from (
            select distinct on (pt.order_id)
                   pt.order_id, pt.transaction_id, pt.method, pt.amount, pt.currency, pt.status,
                   pt.created_at, o.event_id, o.target_value
              from payment_transaction pt
              join "order" o on o.id = pt.order_id
             where pt.status in ('created', 'pending', 'processing')
               and pt.created_at <  now() - make_interval(mins => ${STUCK_MIN})
               and pt.created_at >= now() - make_interval(days => ${STUCK_WINDOW_DAYS})
               and o.status = 'pending'
               and not exists (
                 select 1 from payment_transaction p2
                  where p2.order_id = pt.order_id and p2.created_at > pt.created_at)
             order by pt.order_id, pt.created_at desc) s
           order by s.created_at asc
           limit ${PER_QUEUE}`,

        // ── high: ops alerts (filtered + counted in JS; the window keeps it small) ──
        sql`
          select id, dedup_key, received_at
            from webhook_event
           where provider = 'ops-alert'
             and received_at >= now() - make_interval(hours => ${OPS_ALERT_HOURS})
           order by received_at asc
           limit ${OPS_ALERT_SCAN}`,

        // ── high: payout requests awaiting a decision ──
        sql`
          select id, organizer_handle, amount, currency, requested_at, count(*) over() as total
            from payout
           where status = 'requested'
           order by requested_at asc
           limit ${PER_QUEUE}`,

        // ── high: defaulted installment plans owed back to the buyer ──
        sql`
          select order_id, event_id, org_handle, refund_due, currency,
                 coalesce(closed_at, created_at) as since, count(*) over() as total
            from installment_plan
           where refund_status = 'pending'
           order by coalesce(closed_at, created_at) asc
           limit ${PER_QUEUE}`,

        // ── high: mobile prompts timing out (one aggregate row; payment_transaction_mobile_created) ──
        sql`
          select count(*) filter (where recent)::int as n,
                 count(*) filter (where recent and timed_out)::int as timed_out,
                 count(*) filter (where recent and provider_error)::int as provider_error,
                 min(created_at) filter (where recent) as since,
                 count(*) filter (where not recent)::int as base_n,
                 count(*) filter (where not recent and timed_out)::int as base_timed_out
            from (
              select pt.created_at,
                     pt.created_at >= now() - make_interval(hours => ${TIMEOUT_WINDOW_HOURS}) as recent,
                     (pt.status = 'expired' or lower(coalesce(pt.failure_reason, '')) = 'payer_no_response') as timed_out,
                     lower(coalesce(pt.failure_reason, '')) = 'provider_error' as provider_error
                from payment_transaction pt
               where pt.method = 'mobile'
                 and pt.created_at >= now() - make_interval(days => ${TIMEOUT_BASELINE_DAYS}, hours => ${TIMEOUT_WINDOW_HOURS})
                 and (pt.accepted_at is not null or pt.order_reference is not null or pt.bill_pay_number is not null)) s`,
      ]);

    // flagged money
    for (const r of flaggedCounts as any[]) {
      if (r.status === 'paid_unseatable' || r.status === 'payment_short') counts[r.status as AttentionKind] = Number(r.n);
    }
    for (const r of flaggedRows as any[]) {
      const short = r.status === 'payment_short';
      const target = num(r.target_value);
      const collected = num(r.collected_amount);
      const cur = r.currency || DEFAULT_CURRENCY;
      items.push({
        id: `${r.status}:${r.id}`,
        kind: short ? 'payment_short' : 'paid_unseatable',
        severity: 'critical',
        title: short ? `Under-paid order ${shortId(r.id)}` : `Paid but unseatable ${shortId(r.id)}`,
        detail: short
          ? `Collected ${fmtMoney(collected, cur)} of ${fmtMoney(target, cur)} — refund or top up`
          : `Payment arrived after the hold lapsed; no ticket issued — refund the buyer`,
        ...eventFields(r.event_id),
        amount: collected ?? target,
        currency: cur,
        since: iso(r.tx_at) ?? (iso(r.created_at) as string),
        href: orderHref(r.id),
      });
    }

    counts.paid_no_passes = total(noPassRows);
    for (const r of noPassRows as any[]) {
      items.push({
        id: `paid_no_passes:${r.id}`,
        kind: 'paid_no_passes',
        severity: 'critical',
        title: `Paid order ${shortId(r.id)} has no tickets`,
        detail: `No passes issued ${PAID_GRACE_MIN}+ min after payment`,
        ...eventFields(r.event_id),
        amount: num(r.target_value),
        currency: DEFAULT_CURRENCY,
        since: iso(r.paid_at) as string,
        href: orderHref(r.id),
      });
    }

    counts.buyer_not_notified = total(unnotifiedRows);
    for (const r of unnotifiedRows as any[]) {
      items.push({
        id: `buyer_not_notified:${r.id}`,
        kind: 'buyer_not_notified',
        severity: 'normal',
        title: `Buyer not notified · order ${shortId(r.id)}`,
        detail: 'Paid with tickets issued, but no confirmation SMS/email went out — resend tickets',
        ...eventFields(r.event_id),
        amount: num(r.target_value),
        currency: DEFAULT_CURRENCY,
        since: iso(r.paid_at) as string,
        href: orderHref(r.id),
      });
    }

    counts.payment_stuck = total(stuckRows);
    for (const r of stuckRows as any[]) {
      items.push({
        id: `payment_stuck:${r.transaction_id}`,
        kind: 'payment_stuck',
        severity: 'high',
        title: `Payment stuck · order ${shortId(r.order_id)}`,
        detail: `${r.method || 'payment'} attempt ${r.status} for ${STUCK_MIN}+ min — check with the gateway`,
        ...eventFields(r.event_id),
        amount: num(r.amount) ?? num(r.target_value),
        currency: r.currency || DEFAULT_CURRENCY,
        since: iso(r.created_at) as string,
        href: orderHref(r.order_id),
      });
    }

    const spike = promptTimeoutSpike((timeoutRows as any[])[0]);
    if (spike) {
      counts.prompt_timeouts_high = 1;
      items.push({
        id: 'prompt_timeouts_high',
        kind: 'prompt_timeouts_high',
        severity: 'high',
        title: spike.title,
        detail: spike.detail,
        organizerHandle: null,
        organizerName: null,
        eventName: null,
        amount: null,
        currency: null,
        since: iso(spike.since) ?? new Date(now).toISOString(),
        href: '/admin/console/orders?outcome=buyer_didnt_complete',
      });
    }

    // ops alerts: dedup_key = kind:orderId:detail (see alertOps in @zora/core)
    const alerts = (alertRows as any[])
      .map((r) => {
        const key = String(r.dedup_key ?? '');
        const i = key.indexOf(':');
        const kind = i < 0 ? key : key.slice(0, i);
        const rest = i < 0 ? '' : key.slice(i + 1);
        const j = rest.indexOf(':');
        const ref = j < 0 ? rest : rest.slice(0, j);
        const detail = j < 0 ? '' : rest.slice(j + 1);
        return { id: String(r.id), kind, ref, detail, at: iso(r.received_at) as string };
      })
      .filter((a) => !OPS_ALERT_SKIP.has(a.kind));
    const alertOrderIds = [...new Set(alerts.map((a) => a.ref).filter((x) => UUID.test(x)))];
    const alertOrders = alertOrderIds.length
      ? ((await sql`
          select id, event_id, status, target_value from "order" where id = any(${alertOrderIds}::uuid[])`) as any[])
      : [];
    const alertOrderById = new Map(alertOrders.map((o) => [String(o.id), o]));
    for (const a of alerts) {
      const ord = alertOrderById.get(a.ref) ?? null;
      // A refund resolves earlier alerts, not money or disagreements found after it.
      if (ord && ord.status === 'refunded' && !OPS_ALERT_AFTER_REFUND.has(a.kind)) continue;
      counts.ops_alert++;
      items.push({
        id: `ops_alert:${a.id}`,
        kind: 'ops_alert',
        severity: 'high',
        title: OPS_ALERT_LABEL[a.kind] ?? `Ops alert: ${a.kind.replace(/_/g, ' ')}`,
        detail: [ord ? `Order ${shortId(String(ord.id))}` : null, a.detail || null].filter(Boolean).join(' · ') || a.kind,
        ...(ord ? eventFields(ord.event_id) : { eventName: null, organizerHandle: null, organizerName: null }),
        amount: ord ? num(ord.target_value) : null,
        currency: ord ? DEFAULT_CURRENCY : null,
        since: a.at,
        href: ord ? orderHref(String(ord.id)) : '/admin/console/orders',
      });
    }

    counts.payout_request = total(payoutRows);
    for (const r of payoutRows as any[]) {
      const of = orgFields(r.organizer_handle);
      items.push({
        id: `payout_request:${r.id}`,
        kind: 'payout_request',
        severity: 'high',
        title: `Payout request · ${of.organizerName ?? r.organizer_handle}`,
        detail: 'Waiting for approve / reject',
        ...of,
        eventName: null,
        amount: num(r.amount),
        currency: r.currency || DEFAULT_CURRENCY,
        since: iso(r.requested_at) as string,
        href: '/admin/console/payouts',
      });
    }

    counts.installment_refund = total(refundRows);
    for (const r of refundRows as any[]) {
      const ev = eventFields(r.event_id);
      items.push({
        id: `installment_refund:${r.order_id}`,
        kind: 'installment_refund',
        severity: 'high',
        title: `Installment refund owed · order ${shortId(r.order_id)}`,
        detail: 'Plan defaulted — pay the buyer back and record the reference',
        ...ev,
        ...(r.org_handle ? orgFields(r.org_handle) : {}),
        amount: num(r.refund_due),
        currency: r.currency || DEFAULT_CURRENCY,
        since: iso(r.since) as string,
        href: '/admin/console/installments',
      });
    }

    // KYC identity submissions (collection 'kyc')
    const slaMs = KYC_SLA_HOURS * 3_600_000;
    for (const v of Array.isArray(kycRecords) ? kycRecords : []) {
      if (!v || (v.status !== 'submitted' && v.status !== 'in_review')) continue;
      const since = iso(v.submittedAt) ?? new Date(now).toISOString();
      counts.kyc_review++;
      items.push({
        id: `kyc_review:${v.id}`,
        kind: 'kyc_review',
        severity: now - Date.parse(since) > slaMs ? 'high' : 'normal',
        title: `KYC review · ${v.fullName || v.ref}`,
        detail: `${v.ref ?? ''} · ${v.idType ?? 'document'}${v.attempt > 1 ? ` · attempt ${v.attempt}` : ''}`.replace(/^ · /, ''),
        ...orgFields(v.organizerHandle ?? null),
        eventName: null,
        amount: null,
        currency: null,
        since,
        href: '/admin/console/verification',
      });
    }

    // self-signup organizers waiting for a first decision
    for (const o of orgs) {
      if (o.source !== 'self-signup' || o.kycStatus === 'approved' || o.kycStatus === 'rejected') continue;
      const since = o.createdAt ?? new Date(now).toISOString();
      counts.org_signup++;
      items.push({
        id: `org_signup:${o.id}`,
        kind: 'org_signup',
        severity: now - Date.parse(since) > slaMs ? 'high' : 'normal',
        title: `Organizer sign-up · ${o.name}`,
        detail: `@${o.handle} — verify before they can sell or withdraw`,
        organizerHandle: o.handle,
        organizerName: o.name,
        eventName: null,
        amount: null,
        currency: null,
        since,
        href: '/admin/console/verification',
      });
    }

    items.sort((a, b) => RANK[a.severity] - RANK[b.severity] || Date.parse(a.since) - Date.parse(b.since) || a.id.localeCompare(b.id));

    return { generatedAt: new Date(now).toISOString(), counts, items: items.slice(0, MAX_ITEMS) };
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** BS159: the timeout-spike rule over the aggregate row; null = no alert. */
export function promptTimeoutSpike(r: any): { title: string; detail: string; since: Date | string | null } | null {
  if (!r) return null;
  const n = Number(r.n ?? 0);
  const timedOut = Number(r.timed_out ?? 0);
  const baseN = Number(r.base_n ?? 0);
  if (n < TIMEOUT_MIN_ACCEPTED) return null;
  const share = timedOut / n;
  const baseShare = baseN ? Number(r.base_timed_out ?? 0) / baseN : null;
  if (share < TIMEOUT_SHARE_MIN) return null;
  if (baseShare != null && share < baseShare * TIMEOUT_SPIKE_FACTOR) return null;
  const normal = baseShare == null ? `no ${TIMEOUT_BASELINE_DAYS}-day history` : `${TIMEOUT_BASELINE_DAYS}-day normal: ${pct(baseShare)}`;
  const prov = Number(r.provider_error ?? 0);
  return {
    title: `Prompts are timing out: ${timedOut} of ${n} in the last ${TIMEOUT_WINDOW_HOURS}h (${normal})`,
    detail: [
      'Mobile money prompts sent but not approved in time. Check x-bridge and the mobile networks.',
      prov ? `${prov} of ${n} (${pct(prov / n)}) also failed with provider_error.` : null,
    ].filter(Boolean).join(' '),
    since: r.since ?? null,
  };
}
