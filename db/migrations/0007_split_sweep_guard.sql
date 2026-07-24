-- PR-BS3: keep the generic reservation sweep OFF split-owned reservations.
-- The PR-9 worker runs sweep_expired_reservations() every 60s over ALL reserved
-- rows. A bill-split holds the whole table as a reservation (ref_type='split');
-- if the generic sweep released it when the window lapsed, a split with money
-- already collected would silently lose its inventory — violating the "never
-- pocket money without a held table" rule (OV3). Split reservations are governed
-- exclusively by splitAwareExpirySweep (0 paid → clean release; ≥1 paid →
-- refund_pending, inventory LOCKED until ops refunds). So the generic sweep must
-- skip them. Non-split reservations (future booking/corporate refs) are unchanged.
create or replace function sweep_expired_reservations()
returns int language plpgsql as $$
declare r record; v_count int := 0;
begin
  for r in select id, pool_id, quantity from inventory_reservation
           where state = 'reserved' and expires_at < now()
             and ref_type <> 'split'                       -- BS3: splits are swept by splitAwareExpirySweep
           for update skip locked loop
    update inventory_pool set reserved_count  = reserved_count  - r.quantity,
                              available_count = available_count + r.quantity where id = r.pool_id;
    update inventory_reservation set state = 'released' where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
