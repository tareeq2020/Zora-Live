-- PR-7: orders + checkout. The order aggregate and its line items, plus the
-- payment-success reacquire path. Builds on PR-6's atomic inventory (holds place
-- units aside at checkout; convert_order_holds turns them sold on payment; if the
-- holds lapsed first, try_reacquire_order re-takes the stock all-or-nothing).
-- Money = bigint (whole TZS). status/type = text with commented value sets
-- (migration-free evolution, matching 0001).

-- ── order aggregate ──────────────────────────────────────────────────────────
create table if not exists "order" (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid references customer(id),
  event_id     text not null references event(id),
  type         text not null default 'ga_vip',            -- ga_vip | table | ...
  status       text not null default 'pending',           -- pending | paid | failed | expired | cancelled
  target_value bigint not null default 0,                 -- amount to collect (subtotal + fee), TZS
  created_at   timestamptz not null default now()
);
create index if not exists order_customer_idx on "order" (customer_id);
create index if not exists order_event_idx    on "order" (event_id);

-- ── order line items — price/fee snapshot at purchase time ───────────────────
-- price_version_id pins the exact price row read at checkout; unit_price is the
-- captured snapshot so a later re-price never mutates an existing order.
create table if not exists order_item (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references "order"(id) on delete cascade,
  product_tier_id  text not null references product_tier(id),
  price_version_id bigint not null references price_version(id),
  quantity         int not null check (quantity > 0),
  unit_price       bigint not null,
  created_at       timestamptz not null default now()
);
create index if not exists order_item_order_idx on order_item (order_id);

-- ── payment-success reacquire (all-or-nothing) ───────────────────────────────
-- Used only when convert_order_holds returned 0 (the checkout holds already
-- expired and were swept). Two passes over the order's tier quantities:
--   pass 1 — lock every involved pool row (FOR UPDATE) and verify each has enough
--            available; if ANY is short, apply nothing and return false.
--   pass 2 — decrement available / increment sold for each tier.
-- All under the caller's tx, so the pool locks + the all-or-nothing decision are
-- atomic against concurrent buyers.
create or replace function try_reacquire_order(p_order_id uuid)
returns boolean language plpgsql as $$
declare r record; v_avail int; ok boolean := true;
begin
  -- pass 1: lock + verify
  for r in
    select product_tier_id, sum(quantity)::int as qty
      from order_item
     where order_id = p_order_id
     group by product_tier_id
  loop
    perform 1 from inventory_pool where product_tier_id = r.product_tier_id for update;
    select available_count into v_avail from inventory_pool where product_tier_id = r.product_tier_id;
    if v_avail is null or v_avail < r.qty then ok := false; end if;
  end loop;
  if not ok then return false; end if;

  -- pass 2: apply
  for r in
    select product_tier_id, sum(quantity)::int as qty
      from order_item
     where order_id = p_order_id
     group by product_tier_id
  loop
    update inventory_pool
       set sold_count      = sold_count      + r.qty,
           available_count = available_count - r.qty
     where product_tier_id = r.product_tier_id;
  end loop;
  return true;
end $$;
