-- BS56: a failed-payment RETRY must re-HOLD inventory, not re-SELL it.
--
-- The retry path in initiatePayment() called try_reacquire_order(), which is the
-- payment-SUCCESS primitive: it does `sold_count += qty, available -= qty` and
-- leaves NO hold row. So every retry of a failed payment permanently marked the
-- seats sold even though nothing was ever paid — and because no hold row was
-- created, release_order_holds (which only touches state='held') could never
-- give the seat back. Result: sold_count inflated by every failed-then-retried
-- checkout (observed: apricot-crush early-birds showed 24 sold against 2 real).
--
-- try_rehold_order mirrors try_reacquire_order's all-or-nothing availability
-- check, but instead of touching sold_count it re-creates a HELD hold per tier
-- (exactly what checkout's place_inventory_hold does). The seat then follows the
-- normal lifecycle: convert_order_holds on success (held → sold), or
-- release_order_holds on expiry/failure (held → available). sold_count is only
-- ever touched by a real payment success again.
create or replace function try_rehold_order(p_order_id uuid, p_ttl_secs int)
returns boolean language plpgsql as $$
declare r record; v_avail int; v_pool_id bigint; ok boolean := true;
begin
  -- pass 1: lock + verify availability for every tier the order buys
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

  -- pass 2: decrement available + insert a fresh HELD hold per tier (no sold_count)
  for r in
    select product_tier_id, sum(quantity)::int as qty
      from order_item
     where order_id = p_order_id
     group by product_tier_id
  loop
    update inventory_pool
       set available_count = available_count - r.qty
     where product_tier_id = r.product_tier_id
    returning id into v_pool_id;
    insert into inventory_hold (pool_id, order_id, quantity, expires_at)
    values (v_pool_id, p_order_id, r.qty, now() + make_interval(secs => p_ttl_secs));
  end loop;
  return true;
end $$;
