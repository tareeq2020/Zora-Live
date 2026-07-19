-- PR-6: atomic inventory (pools + holds + reservations) and signed credentials.
-- Net-new ticketing foundation. Oversell is made STRUCTURALLY impossible: a single
-- conditional-decrement UPDATE (WHERE available_count >= qty) is the only choke
-- point, and the capacity_not_exceeded CHECK is the constraint-level backstop.
-- try_reacquire_order + credential FKs to order_item arrive with orders in PR-7.

create extension if not exists pgcrypto;

-- ── Inventory pools — the atomic counter set (one row per sellable tier) ──────
-- Four conserved buckets. "Held" units have no column: they are the ones missing
-- from available_count while a state='held' hold row exists. Every transition
-- conserves available+sold+blocked+reserved; the CHECK catches any logic bug as a
-- constraint violation rather than a silent oversell.
create table if not exists inventory_pool (
  id               bigint generated always as identity primary key,
  product_tier_id  text not null unique references product_tier(id) on delete cascade,
  capacity         integer not null check (capacity >= 0),
  available_count  integer not null check (available_count >= 0),
  sold_count       integer not null default 0 check (sold_count >= 0),
  blocked_count    integer not null default 0 check (blocked_count >= 0),
  reserved_count   integer not null default 0 check (reserved_count >= 0),
  created_at       timestamptz not null default now(),
  constraint capacity_not_exceeded
    check (available_count + sold_count + blocked_count + reserved_count <= capacity)
);

-- ── Hold ledger (GA/VIP path) — TTL, swept by the worker ─────────────────────
create table if not exists inventory_hold (
  id         uuid primary key default gen_random_uuid(),
  pool_id    bigint not null references inventory_pool(id) on delete cascade,
  order_id   uuid not null,                      -- soft ref; FK to "order" added in PR-7
  quantity   integer not null check (quantity > 0),
  state      text not null default 'held',       -- held | converted | released
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists inventory_hold_sweep on inventory_hold (state, expires_at) where state = 'held';
create index if not exists inventory_hold_order on inventory_hold (order_id);

-- ── Reservation ledger (soft reserved-bucket path) — parallels holds ─────────
create table if not exists inventory_reservation (
  id         uuid primary key default gen_random_uuid(),
  pool_id    bigint not null references inventory_pool(id) on delete cascade,
  ref_type   text not null,                      -- generic owner-type tag: order | booking | corporate
  ref_id     uuid not null,
  quantity   integer not null check (quantity > 0),
  state      text not null default 'reserved',   -- reserved | converted | released
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists inventory_reservation_sweep on inventory_reservation (state, expires_at) where state = 'reserved';
create index if not exists inventory_reservation_ref   on inventory_reservation (ref_type, ref_id)  where state = 'reserved';

-- ── Credentials (tickets) — one per seat, idempotent issuance ────────────────
-- 0001_init already defines `credential` (id, order_item_id, event_id, tier_id,
-- code unique, signature, state, seat_index, ...). It's unused; here we add the
-- PR-6 columns + the idempotency indexes. code = opaque QR id (no PII); signature
-- = HMAC over the claims tuple; public_ref = human-dictatable ref.
alter table credential add column if not exists public_ref     text;
alter table credential add column if not exists revoked_reason text;
-- Idempotent issuance: at most one credential per (order_item_id, seat_index).
create unique index if not exists credential_order_item_seat on credential (order_item_id, seat_index) where order_item_id is not null;
create unique index if not exists credential_public_ref_key  on credential (public_ref)                 where public_ref    is not null;

-- ── Atomic functions ─────────────────────────────────────────────────────────

-- The single oversell choke point. Conditional decrement in ONE statement:
-- contenders for the last unit -> one row updated (wins), the other matches zero
-- rows (v_pool_id NULL -> sold out). No SELECT ... FOR UPDATE needed.
create or replace function place_inventory_hold(p_tier_id text, p_order_id uuid, p_quantity int, p_ttl_secs int)
returns uuid language plpgsql as $$
declare v_pool_id bigint; v_hold_id uuid;
begin
  update inventory_pool
     set available_count = available_count - p_quantity
   where product_tier_id = p_tier_id
     and available_count >= p_quantity
  returning id into v_pool_id;
  if v_pool_id is null then return null; end if;
  insert into inventory_hold (pool_id, order_id, quantity, expires_at)
  values (v_pool_id, p_order_id, p_quantity, now() + make_interval(secs => p_ttl_secs))
  returning id into v_hold_id;
  return v_hold_id;
end $$;

-- Payment confirmed: held -> sold. Does NOT touch available (units already left it
-- at hold time). Idempotent (only state='held' rows). Returns count converted; a
-- 0 on first confirm means the holds lapsed -> caller must try_reacquire (PR-7).
create or replace function convert_order_holds(p_order_id uuid)
returns int language plpgsql as $$
declare r record; v_count int := 0;
begin
  for r in select id, pool_id, quantity from inventory_hold
           where order_id = p_order_id and state = 'held' for update loop
    update inventory_pool set sold_count = sold_count + r.quantity where id = r.pool_id;
    update inventory_hold  set state = 'converted' where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Expiry / abandonment: restore available. Idempotent (only state='held' rows).
create or replace function release_order_holds(p_order_id uuid)
returns void language plpgsql as $$
declare r record;
begin
  for r in select id, pool_id, quantity from inventory_hold
           where order_id = p_order_id and state = 'held' for update loop
    update inventory_pool set available_count = available_count + r.quantity where id = r.pool_id;
    update inventory_hold  set state = 'released' where id = r.id;
  end loop;
end $$;

-- Reserved-bucket quartet (moves available <-> reserved), keyed by (ref_type, ref_id).
create or replace function reserve_inventory(p_tier_id text, p_ref_type text, p_ref_id uuid, p_quantity int, p_ttl_secs int)
returns uuid language plpgsql as $$
declare v_pool_id bigint; v_res_id uuid;
begin
  update inventory_pool
     set available_count = available_count - p_quantity,
         reserved_count  = reserved_count  + p_quantity
   where product_tier_id = p_tier_id
     and available_count >= p_quantity
  returning id into v_pool_id;
  if v_pool_id is null then return null; end if;
  insert into inventory_reservation (pool_id, ref_type, ref_id, quantity, expires_at)
  values (v_pool_id, p_ref_type, p_ref_id, p_quantity, now() + make_interval(secs => p_ttl_secs))
  returning id into v_res_id;
  return v_res_id;
end $$;

create or replace function convert_reservation(p_ref_type text, p_ref_id uuid)
returns int language plpgsql as $$
declare r record; v_count int := 0;
begin
  for r in select id, pool_id, quantity from inventory_reservation
           where ref_type = p_ref_type and ref_id = p_ref_id and state = 'reserved' for update loop
    update inventory_pool set reserved_count = reserved_count - r.quantity,
                              sold_count     = sold_count     + r.quantity where id = r.pool_id;
    update inventory_reservation set state = 'converted' where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function release_reservation(p_ref_type text, p_ref_id uuid)
returns void language plpgsql as $$
declare r record;
begin
  for r in select id, pool_id, quantity from inventory_reservation
           where ref_type = p_ref_type and ref_id = p_ref_id and state = 'reserved' for update loop
    update inventory_pool set reserved_count  = reserved_count  - r.quantity,
                              available_count = available_count + r.quantity where id = r.pool_id;
    update inventory_reservation set state = 'released' where id = r.id;
  end loop;
end $$;

-- Concurrent-sweep-safe (for update skip locked). Returns count released.
create or replace function sweep_expired_reservations()
returns int language plpgsql as $$
declare r record; v_count int := 0;
begin
  for r in select id, pool_id, quantity from inventory_reservation
           where state = 'reserved' and expires_at < now() for update skip locked loop
    update inventory_pool set reserved_count  = reserved_count  - r.quantity,
                              available_count = available_count + r.quantity where id = r.pool_id;
    update inventory_reservation set state = 'released' where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
