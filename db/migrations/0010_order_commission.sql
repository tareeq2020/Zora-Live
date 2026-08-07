-- 0010_order_commission.sql (BS35 / plan #6) — POINT-IN-TIME commission.
--
-- Net earnings used to be `revenue × org.commissionRate` read LIVE, so editing an
-- organizer's rate silently rewrote every historical payout. Payouts cannot sit on
-- numbers that move. The rate that applied at pay time is now STAMPED on the order
-- (resolved event override → org rate → 5% default, in @zora/core/commission.ts),
-- exactly mirroring how price_version pins the price at checkout.
--
-- Nullable on purpose: an un-stamped order reads as "platform default" through
-- netOf(), so nothing 500s on a pre-migration row.
alter table "order" add column if not exists commission_rate numeric(6,5);

-- ── BACKFILL (eng review ARCH-5, an ACCEPTED APPROXIMATION) ──────────────────
-- Orders placed before this migration have no record of the rate that was in force
-- when they were paid, because the rate was only ever read live. Each one is
-- therefore stamped with its organizer's CURRENT rate — correct for every org
-- whose rate never changed (all of them today), and the closest available answer
-- for any that did. From here on the stamp is written at pay time and is exact.
--
-- Event ownership lives in the collection_store 'events' blob (event.organizer_id
-- is NULL post-seed, see org-scope.service.ts C3), so the join goes through it.
with owner as (
  select e->>'id' as event_id, lower(e->>'organizerHandle') as handle
    from collection_store cs,
         lateral jsonb_array_elements(cs.data::jsonb) as e
   where cs.name = 'events'
     and jsonb_typeof(cs.data::jsonb) = 'array'
     and coalesce(e->>'organizerHandle', '') <> ''
)
update "order" o
   set commission_rate = coalesce(org.commission_rate, 0.05)
  from owner join organizer org on org.handle = owner.handle
 where o.event_id = owner.event_id
   and o.commission_rate is null
   and o.status in ('paid', 'paid_unseatable', 'payment_short');

-- Money-bearing orders whose event has no resolvable organizer fall back to the
-- platform default, so no paid order is left without a stamp.
update "order"
   set commission_rate = 0.05
 where commission_rate is null
   and status in ('paid', 'paid_unseatable', 'payment_short');
