-- BS124: seat-level inventory for seated + table zones (Web Premium v1, F5).
--
-- inventory_pool stays the single CAPACITY truth (per tier). seat_inventory only
-- carries seat IDENTITY and state, so a seat can never be sold twice and a ticket
-- can name its seat. GA / standing zones have no rows here (tier-level only).
--
-- Seat ids are deterministic from the published plan: <zoneId>-<ROW><n> for
-- seated rows, <zoneId>-T<n> for tables. Republishing diffs against these rows
-- and refuses to remove or re-tier a seat that is held, sold or reserved.

create table if not exists seatmap_version (
  event_id     text        not null,
  version      integer     not null,
  published_at timestamptz not null default now(),
  published_by text,
  seat_count   integer     not null default 0,
  primary key (event_id, version)
);

create table if not exists seat_inventory (
  event_id        text        not null,
  seat_id         text        not null,
  zone_id         text        not null,
  kind            text        not null,                 -- seat | table
  label           text        not null,                 -- "C7", "Table 5"
  row_label       text,
  seat_number     integer,
  tier_id         text,
  seats_count     integer     not null default 1,       -- a table seats N
  price_mode      text        not null default 'per_seat', -- per_seat | per_table (tables)
  state           text        not null default 'available',
  hold_order_id   uuid,
  hold_expires_at timestamptz,
  sold_order_id   uuid,
  reserved_note   text,
  layout_version  integer     not null,
  updated_at      timestamptz not null default now(),
  primary key (event_id, seat_id),
  constraint seat_inventory_kind_valid  check (kind in ('seat', 'table')),
  constraint seat_inventory_state_valid check (state in ('available', 'held', 'sold', 'reserved', 'blocked')),
  constraint seat_inventory_price_mode_valid check (price_mode in ('per_seat', 'per_table')),
  constraint seat_inventory_seats_positive check (seats_count > 0),
  -- a held seat always names its order and expiry; a sold seat names its order
  constraint seat_inventory_hold_shape check (state <> 'held' or (hold_order_id is not null and hold_expires_at is not null)),
  constraint seat_inventory_sold_shape check (state <> 'sold' or sold_order_id is not null)
);

create index if not exists seat_inventory_event_state on seat_inventory (event_id, state);
create index if not exists seat_inventory_hold_sweep  on seat_inventory (hold_expires_at) where state = 'held';
create index if not exists seat_inventory_hold_order  on seat_inventory (hold_order_id) where hold_order_id is not null;
