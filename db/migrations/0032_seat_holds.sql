-- BS125: seats through checkout (Web Premium v1, F5 / A6 / A17).
--
-- order_seat records WHICH seats an order bought, independent of the transient
-- hold columns on seat_inventory, so a late settlement can re-take the same
-- seats (or flag paid_unseatable) and a refund can release them.
-- credential gains the seat it admits.

create table if not exists order_seat (
  order_id      uuid not null,
  order_item_id uuid not null,
  event_id      text not null,
  seat_id       text not null,
  primary key (order_id, seat_id)
);
create index if not exists order_seat_item on order_seat (order_item_id);
create index if not exists order_seat_event_seat on order_seat (event_id, seat_id);

alter table credential add column if not exists seat_id    text;
alter table credential add column if not exists seat_label text;
