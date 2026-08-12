-- BS62: a FULL refund must return the seat to inventory.
--
-- refundOrder recorded the money side (order.status='refunded', refunded_amount,
-- split_share.state='refunded') but never touched inventory_pool. So a fully
-- refunded order left its seats counted as SOLD forever and never returned to
-- available_count — the dashboard "sold" over-counted, and a refunded seat could
-- never be resold (it stayed permanently consumed). This is the debit side of the
-- BS56 phantom-sold family, for the refund path.
--
-- release_order_inventory reverses a line-item order's seats: sold_count -= qty,
-- available_count += qty per tier. The total (sold+available+blocked+reserved)
-- is unchanged, so the capacity CHECK still holds. greatest(0, …) guards against
-- double-release. Split/table orders carry NO order_item (their money lives in
-- split_share) so this is a no-op for them — releasing a refunded split seat's
-- reservation is tracked separately and intentionally out of scope here.
create or replace function release_order_inventory(p_order_id uuid)
returns void language plpgsql as $$
declare r record;
begin
  for r in
    select product_tier_id, sum(quantity)::int as qty
      from order_item
     where order_id = p_order_id
     group by product_tier_id
  loop
    update inventory_pool
       set sold_count      = greatest(0, sold_count - r.qty),
           available_count = available_count + r.qty
     where product_tier_id = r.product_tier_id;
  end loop;
end $$;
