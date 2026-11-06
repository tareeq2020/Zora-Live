import { Injectable } from '@nestjs/common';
import { db, EVER_PAID_STATUSES, funnelWithDropoff, CART_OUTCOMES, type FunnelStage, type CartOutcome } from '@zora/core';
import { outcomeRows } from './outcome-sql';
import { OrgScopeService } from '../org/org-scope.service';

/* BS153: GET /api/admin/funnel — where buyers drop out, platform-wide or per
   org/event, over the last 7/30/90 days.

   Two halves, never joined to each other:
     · event_views and checkout_opened come from analytics_daily (aggregate only,
       no person — the BS123 privacy rule);
     · carts onwards come from the order tables, each cart counted once at the
       furthest stage it reached (the same rule as the list's stage chip, so the
       strip and the rows agree).
   Comps and cash gate sales are not carts and are left out of the stages.

   BS157: `outcomes` counts every order in the window and scope by its cart
   outcome (comps and door sales included, under their own outcome), with the
   same SQL rules as the list's ?outcome= filter. */

export const FUNNEL_DAYS = [7, 30, 90] as const;

export interface FunnelQuery {
  days?: number | null;
  org?: string | null;
  event?: string | null;
}

@Injectable()
export class AdminFunnelService {
  constructor(private readonly scope: OrgScopeService) {}

  async funnel(q: FunnelQuery) {
    const sql = db();
    const days = (FUNNEL_DAYS as readonly number[]).includes(Number(q.days)) ? Number(q.days) : 7;
    const now = new Date();
    const from = new Date(now.getTime() - days * 86_400_000);
    const fromDay = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const org = q.org ? String(q.org).toLowerCase() : null;
    const event = q.event ? String(q.event) : null;

    // Org scope resolves to event ids through the events blob (C3).
    let eventIds: string[] | null = null;
    if (org) {
      const events = await this.scope.readEvents();
      eventIds = events.filter((e) => e && String(e.organizerHandle ?? '').toLowerCase() === org).map((e) => e.id as string);
      if (event) eventIds = eventIds.includes(event) ? [event] : [];
    } else if (event) {
      eventIds = [event];
    }

    // ── pre-cart: aggregate only ──
    const [traffic] = await sql`
      select coalesce(sum(views) filter (where kind = 'event'), 0)::int as event_views,
             coalesce(sum(visitors) filter (where kind = 'event'), 0)::int as event_visitors,
             coalesce(sum(views) filter (where kind = 'checkout'), 0)::int as checkout_opened,
             coalesce(sum(visitors) filter (where kind = 'checkout'), 0)::int as checkout_visitors
        from analytics_daily
       where day >= ${fromDay}::date
         and (${org}::text is null or org_handle = ${org})
         and (${event}::text is null or event_id = ${event})`;

    // ── carts onwards: one row per cart, at the furthest stage it reached ──
    const none = eventIds !== null && eventIds.length === 0;
    const scopeIds = none ? ['__none__'] : eventIds;
    const paid = [...EVER_PAID_STATUSES];
    const [stages] = await sql`
      with o as (
        select o.id, o.status, o.notified_at from "order" o
         where o.created_at >= ${from.toISOString()}::timestamptz
           and o.type <> 'comp' and coalesce(o.channel, 'online') <> 'gate_cash'
           and (${scopeIds}::text[] is null or o.event_id = any(${scopeIds}))
      ), a as (
        select pt.order_id, bool_or(pt.order_reference is not null or pt.bill_pay_number is not null
                 or pt.status in ('pending', 'processing', 'successful', 'partial')
                 or (pt.status = 'failed' and pt.error is null)) as accepted
          from payment_transaction pt where pt.order_id in (select id from o) group by pt.order_id
      ), ev as (
        select order_id, array_agg(distinct step) as steps from order_event
         where order_id in (select id from o) group by order_id
      ), c as (
        select coalesce(oi.order_id, ss.order_id) as order_id,
               bool_or(cr.state in ('scanned', 'wristband_issued', 'used')) as checked_in
          from credential cr
          left join order_item oi on oi.id = cr.order_item_id
          left join split_share ss on ss.id = cr.split_share_id
         where coalesce(oi.order_id, ss.order_id) in (select id from o)
         group by 1
      ), s as (
        select case
                 when coalesce(c.checked_in, false) or 'checked_in' = any(coalesce(ev.steps, '{}')) then 5
                 when o.notified_at is not null or 'buyer_notified' = any(coalesce(ev.steps, '{}')) then 4
                 when o.status = any(${paid}) or 'paid' = any(coalesce(ev.steps, '{}')) then 3
                 when coalesce(a.accepted, false) or 'gateway_accepted' = any(coalesce(ev.steps, '{}')) then 2
                 when a.order_id is not null or 'pay_requested' = any(coalesce(ev.steps, '{}')) then 1
                 else 0 end as k
          from o left join a on a.order_id = o.id left join ev on ev.order_id = o.id left join c on c.order_id = o.id
      )
      select count(*)::int as carts,
             count(*) filter (where k >= 1)::int as started,
             count(*) filter (where k >= 2)::int as accepted,
             count(*) filter (where k >= 3)::int as paid,
             count(*) filter (where k >= 4)::int as delivered,
             count(*) filter (where k >= 5)::int as checked_in
        from s`;

    const counts: Record<FunnelStage, number> = {
      event_views: traffic.event_views,
      checkout_opened: traffic.checkout_opened,
      carts_created: stages.carts,
      payment_started: stages.started,
      gateway_accepted: stages.accepted,
      paid: stages.paid,
      passes_delivered: stages.delivered,
      checked_in: stages.checked_in,
    };

    // ── why they dropped ──
    const scoped = sql`
      select o.id from "order" o
       where o.created_at >= ${from.toISOString()}::timestamptz
         and o.type <> 'comp' and coalesce(o.channel, 'online') <> 'gate_cash'
         and (${scopeIds}::text[] is null or o.event_id = any(${scopeIds}))`;
    // BS157: every order in the window + scope, by outcome.
    const allScoped = sql`
      select o.id from "order" o
       where o.created_at >= ${from.toISOString()}::timestamptz
         and (${scopeIds}::text[] is null or o.event_id = any(${scopeIds}))`;
    const [topErrors, [reasons], outcomeCounts] = await Promise.all([
      sql`
        select pt.error, count(*)::int as attempts, max(coalesce(pt.error_at, pt.updated_at)) as last_at
          from payment_transaction pt
         where pt.error is not null and pt.order_id in (${scoped})
         group by pt.error order by 2 desc, 3 desc limit 8`,
      sql`
        select
          (select count(*)::int from "order" o where o.id in (${scoped}) and o.status = 'expired'
              and not exists (select 1 from payment_transaction pt where pt.order_id = o.id)) as expired_no_attempt,
          (select count(*)::int from "order" o where o.id in (${scoped}) and o.status = 'pending'
              and not exists (select 1 from payment_transaction pt where pt.order_id = o.id)) as open_no_attempt,
          (select count(*)::int from payment_transaction pt where pt.order_id in (${scoped}) and pt.status = 'expired') as attempts_timed_out,
          (select count(*)::int from payment_transaction pt where pt.order_id in (${scoped}) and pt.status = 'failed' and pt.error is null) as failed_after_push,
          (select count(*)::int from payment_transaction pt where pt.order_id in (${scoped}) and pt.error is not null) as gateway_rejected,
          (select count(*)::int from payment_transaction pt where pt.order_id in (${scoped}) and pt.status = 'partial') as short_payments`,
      sql`select z.outcome, z.outcome_detail, count(*)::int as n from (${outcomeRows(sql, allScoped)}) z group by 1, 2`,
    ]);
    const outcomes = Object.fromEntries(CART_OUTCOMES.map((k) => [k, 0])) as Record<CartOutcome, number>;
    // …and by sub-reason (e.g. buyer_didnt_complete → payer_cancelled: 4).
    const outcomeDetails: Record<string, Record<string, number>> = {};
    for (const r of outcomeCounts as any[]) {
      if (!(r.outcome in outcomes)) continue;
      outcomes[r.outcome as CartOutcome] += Number(r.n);
      if (r.outcome_detail != null) {
        const m = (outcomeDetails[r.outcome] ??= {});
        m[r.outcome_detail] = (m[r.outcome_detail] ?? 0) + Number(r.n);
      }
    }

    return {
      window: { days, from: from.toISOString(), to: now.toISOString() },
      scope: { org, event },
      stages: funnelWithDropoff(counts),
      unique: { eventVisitors: traffic.event_visitors, checkoutVisitors: traffic.checkout_visitors },
      outcomes,
      outcomeDetails,
      dropoff: {
        topGatewayErrors: (topErrors as any[]).map((r) => ({
          error: r.error, attempts: r.attempts, lastAt: r.last_at ? new Date(r.last_at).toISOString() : null,
        })),
        expiredNoAttempt: reasons.expired_no_attempt,
        openNoAttempt: reasons.open_no_attempt,
        attemptsTimedOut: reasons.attempts_timed_out,
        failedAfterPush: reasons.failed_after_push,
        gatewayRejected: reasons.gateway_rejected,
        shortPayments: reasons.short_payments,
      },
    };
  }
}
