import { ATTEMPT_SEND_GRACE_MS, CART_OPEN_GRACE_MS, RECOVERY_WINDOW_MS, SOLD_STATUSES, normalizeBuyerPhone, FAILURE_REASONS } from '@zora/core';

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
  return sql`
    with b as (
      select o.id, o.status, o.type, coalesce(o.channel, 'online') as channel, o.event_id, o.created_at, o.customer_id,
             (case when c.phone is null or c.phone ilike 'comp:%' then null else (
               select case when length(n) between 10 and 15 then n end from (
                 select case when d like '0%' then '255' || substr(d, 2) when length(d) = 9 then '255' || d else d end as n
                   from (select regexp_replace(c.phone, '[^0-9]', '', 'g') as d) d0) n0) end) as nphone
        from "order" o left join customer c on c.id = o.customer_id
       where o.id in (${scoped})
    ), x as (
      select pt.order_id, pt.created_at, pt.error, pt.failure_reason,
             case when pt.status = 'successful' then 'paid'
                  when pt.status = 'partial' then 'short'
                  when pt.error is not null then 'refused'
                  when pt.status in ('pending', 'processing') then 'in_flight'
                  when pt.status = 'created' then
                    case when pt.order_reference is not null or pt.bill_pay_number is not null then 'in_flight'
                         when pt.created_at > now() - make_interval(secs => ${sendGrace}) then 'in_flight'
                         else 'refused' end
                  when pt.status = 'expired' then
                    case when pt.order_reference is not null or pt.bill_pay_number is not null then 'timed_out' else 'refused' end
                  else 'declined' end as k
        from payment_transaction pt where pt.order_id in (select id from b)
    ), a0 as (
      select order_id, count(*)::int as n,
             bool_or(k in ('refused', 'declined', 'timed_out')) as any_bad,
             bool_and(k = 'refused') as all_refused,
             bool_or(k = 'in_flight') as any_inflight,
             bool_or(error is not null) as any_error,
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
               when a.all_refused then case when a.any_error then 'gateway_refused' else 'no_gateway_reference' end
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
