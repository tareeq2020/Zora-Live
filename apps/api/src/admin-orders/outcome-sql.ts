import {
  ATTEMPT_SEND_GRACE_MS, CART_OPEN_GRACE_MS, RECOVERY_WINDOW_MS, SOLD_STATUSES, normalizeBuyerPhone, FAILURE_REASONS,
  ACCEPT_TRACKED_SINCE_MS, NO_PROVIDER_ERROR,
} from '@zora/core';

/** BS159: the acceptance cut-over (core ACCEPT_TRACKED_SINCE). Tests may move it
    with OUTCOME_ACCEPT_TRACKED_SINCE (an ISO time); the list and the SQL use the same value. */
export function acceptTrackedSinceMs(): number {
  const t = Date.parse(String(process.env.OUTCOME_ACCEPT_TRACKED_SINCE ?? ''));
  return Number.isNaN(t) ? ACCEPT_TRACKED_SINCE_MS : t;
}

/** BS159: the attempt's accepted time: accepted_at, else the logged gateway_accepted
    step (BS153 logs it; rides order_event_order_at). `pt` is the attempt alias. */
export function acceptedAtSql(sql: any) {
  return sql`coalesce(pt.accepted_at, (select min(e.at) from order_event e
    where e.order_id = pt.order_id and e.transaction_id = pt.transaction_id and e.step = 'gateway_accepted'))`;
}

/* BS157: the cart-outcome rules of @zora/core cart-outcome.ts, in SQL, for the
   two reads that cannot compute them row by row in JS: the list's ?outcome=
   filter and the funnel's outcome counts. db/test/cart-outcomes.e2e.sh proves
   the SQL and the JS agree on every seeded cart. Change both together.

   `scoped` is a fragment that selects order ids (select o.id from "order" o …).
   Returns a fragment selecting (id, outcome, outcome_detail, recovered_by).
   Phones are normalized the way normalizeBuyerPhone does ("255…" digits). */

export function outcomeRows(sql: any, scoped: any) {
  const sold = [...SOLD_STATUSES];
  const sendGrace = Math.round(ATTEMPT_SEND_GRACE_MS / 1000);
  const openGrace = Math.round(CART_OPEN_GRACE_MS / 1000);
  const recoverySecs = Math.round(RECOVERY_WINDOW_MS / 1000);
  const paidLike = ['paid', 'installment_active']; // issuesPasses || earnsCollected
  const cutover = new Date(acceptTrackedSinceMs()).toISOString();
  const noProvider = `%${NO_PROVIDER_ERROR}%`;
  return sql`
    with b as (
      select o.id, o.status, o.type, coalesce(o.channel, 'online') as channel, o.event_id, o.created_at, o.customer_id,
             (case when c.phone is null or c.phone ilike 'comp:%' then null else (
               select case when length(n) between 10 and 15 then n end from (
                 select case when d like '0%' then '255' || substr(d, 2) when length(d) = 9 then '255' || d else d end as n
                   from (select regexp_replace(c.phone, '[^0-9]', '', 'g') as d) d0) n0) end) as nphone
        from "order" o left join customer c on c.id = o.customer_id
       where o.id in (${scoped})
    ), x0 as (
      select pt.order_id, pt.created_at, pt.error, pt.failure_reason, pt.method, pt.status, pt.order_reference,
             pt.bill_pay_number, ${acceptedAtSql(sql)} as accepted_at
        from payment_transaction pt where pt.order_id in (select id from b)
    ), x as (
      select x0.order_id, x0.created_at, x0.error, x0.failure_reason,
             case when x0.status = 'successful' then 'paid'
                  when x0.status = 'partial' then 'short'
                  when x0.error is not null and x0.accepted_at is null then 'refused'
                  when x0.status in ('pending', 'processing') then 'in_flight'
                  when x0.status = 'created' then
                    case when x0.order_reference is not null or x0.bill_pay_number is not null or x0.accepted_at is not null then 'in_flight'
                         when x0.created_at > now() - make_interval(secs => ${sendGrace}) then 'in_flight'
                         else 'refused' end
                  when x0.status = 'expired' then
                    case when x0.order_reference is not null or x0.bill_pay_number is not null or x0.accepted_at is not null
                         then 'timed_out' else 'refused' end
                  else 'declined' end as k,
             -- refusalReason (only read for refused attempts)
             case when x0.error is not null then
                    case when upper(x0.error) like ${noProvider} then
                           case when lower(coalesce(x0.method, '')) = 'card' then 'card_unavailable' else 'method_unavailable' end
                         else 'gateway_refused' end
                  when x0.created_at >= ${cutover}::timestamptz then 'no_gateway_reference'
                  when lower(coalesce(x0.method, '')) = 'card' then 'card_unavailable'
                  else 'not_recorded' end as rr
        from x0
    ), a0 as (
      select order_id, count(*)::int as n,
             bool_or(k in ('refused', 'declined', 'timed_out')) as any_bad,
             bool_and(k = 'refused') as all_refused,
             bool_or(k = 'in_flight') as any_inflight,
             (array_agg(rr order by created_at desc))[1] as refused_reason,
             (array_agg(k order by created_at desc) filter (where k <> 'refused'))[1] as last_k,
             (array_agg(nullif(btrim(failure_reason), '') order by created_at desc) filter (where k <> 'refused'))[1] as last_reason
        from x group by order_id
    ), a as (
      -- mapFailureReason: x-bridge's known values, anything else 'unknown'.
      select a0.*, case when a0.last_reason is null then null
                        when lower(a0.last_reason) = any(${[...FAILURE_REASONS]}) then lower(a0.last_reason)
                        else 'unknown' end as last_code
        from a0
    ), h as (
      select order_id from inventory_hold
       where order_id in (select id from b) and state = 'held' and expires_at > now()
      union
      select hold_order_id from seat_inventory
       where hold_order_id in (select id from b) and state = 'held' and hold_expires_at > now()
    ), base as (
      select b.id, b.event_id, b.created_at, b.customer_id, b.nphone,
             case
               when b.type = 'comp' then 'comp'
               when b.channel like 'gate%' then 'door_sale'
               when b.status = 'refunded' then 'refunded'
               when b.status = 'paid_unseatable' then 'paid_unseatable'
               when b.status = 'payment_short' then 'underpaid'
               when b.status = any(${paidLike}) then case when coalesce(a.any_bad, false) then 'paid_after_retry' else 'paid' end
               when b.status = 'pending' and (b.id in (select order_id from h) or coalesce(a.any_inflight, false)
                    or b.created_at > now() - make_interval(secs => ${openGrace})) then 'in_progress'
               when b.status = 'installment_defaulted' then 'buyer_didnt_complete'
               when a.order_id is null then 'abandoned'
               when a.all_refused then 'system_error'
               when a.last_code = 'provider_error' then 'system_error'
               else 'buyer_didnt_complete' end as outcome,
             case
               when b.type = 'comp' or b.channel like 'gate%' then null
               when b.status in ('refunded', 'paid_unseatable', 'payment_short') then null
               when b.status = any(${paidLike}) then case when b.status = 'installment_active' then 'installment' end
               when b.status = 'pending' and (b.id in (select order_id from h) or coalesce(a.any_inflight, false)
                    or b.created_at > now() - make_interval(secs => ${openGrace})) then null
               when b.status = 'installment_defaulted' then 'installment_defaulted'
               when a.order_id is null then b.status
               when a.all_refused then a.refused_reason
               when a.last_code = 'provider_error' then 'provider_error'
               else coalesce(a.last_code, case when a.last_k = 'declined' then 'declined' else 'timed_out' end) end as detail
        from b left join a on a.order_id = b.id
    ), r as (
      select base.*,
             case when base.outcome in ('in_progress', 'abandoned', 'system_error', 'buyer_didnt_complete') then (
               select p.id from "order" p left join customer pc on pc.id = p.customer_id
                where p.event_id = base.event_id and p.id <> base.id and p.type <> 'comp'
                  and p.status = any(${sold})
                  and p.created_at >= base.created_at
                  and p.created_at <= base.created_at + make_interval(secs => ${recoverySecs})
                  and ((base.customer_id is not null and p.customer_id = base.customer_id)
                       or (base.nphone is not null and (case when pc.phone is null or pc.phone ilike 'comp:%' then null else (
               select case when length(n) between 10 and 15 then n end from (
                 select case when d like '0%' then '255' || substr(d, 2) when length(d) = 9 then '255' || d else d end as n
                   from (select regexp_replace(pc.phone, '[^0-9]', '', 'g') as d) d0) n0) end) = base.nphone))
                order by p.created_at asc, p.id asc limit 1) end as recovered_by
        from base
    )
    select id,
           case when recovered_by is not null then 'recovered' else outcome end as outcome,
           case when recovered_by is not null then outcome else detail end as outcome_detail,
           recovered_by
      from r`;
}

/** Paid orders that could have recovered one of these carts: same event, created
    in the 24h after the earliest cart, same customer or same normalized phone.
    One query for a page; @zora/core matchRecoveries picks the match per cart. */
export function recoveryCandidates(
  sql: any,
  carts: { eventId: string; createdAt: Date | string; customerId?: string | null; phone?: string | null }[],
) {
  const sold = [...SOLD_STATUSES];
  const times = carts.map((c) => new Date(c.createdAt).getTime()).filter((t) => Number.isFinite(t));
  const from = new Date(Math.min(...times)).toISOString();
  const to = new Date(Math.max(...times) + RECOVERY_WINDOW_MS).toISOString();
  const eventIds = [...new Set(carts.map((c) => c.eventId))];
  const customerIds = [...new Set(carts.map((c) => c.customerId).filter(Boolean))] as string[];
  const phones = [...new Set(carts.map((c) => normalizeBuyerPhone(c.phone)).filter(Boolean))] as string[];
  return sql`
    select p.id, p.event_id, p.created_at, p.customer_id, pc.phone
      from "order" p left join customer pc on pc.id = p.customer_id
     where p.event_id = any(${eventIds}) and p.type <> 'comp' and p.status = any(${sold})
       and p.created_at >= ${from}::timestamptz and p.created_at <= ${to}::timestamptz
       and (p.customer_id = any(${customerIds}::uuid[])
            or (case when pc.phone is null or pc.phone ilike 'comp:%' then null else (
               select case when length(n) between 10 and 15 then n end from (
                 select case when d like '0%' then '255' || substr(d, 2) when length(d) = 9 then '255' || d else d end as n
                   from (select regexp_replace(pc.phone, '[^0-9]', '', 'g') as d) d0) n0) end) = any(${phones}::text[]))`;
}
