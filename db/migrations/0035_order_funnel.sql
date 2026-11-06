-- BS153: per-cart funnel log + gateway errors + checkout-open aggregates.
--
-- order_event is an append-only log of what happened to ONE order (cart made,
-- payment asked for, gateway said yes/no, paid, passes sent, checked in). It is
-- written best-effort by @zora/core: a failed write never breaks the money path.
-- Old orders have no rows; the admin detail read derives their timeline from the
-- existing tables instead.
--
-- Pre-cart steps (page views, checkout opens) stay aggregate-only in
-- analytics_daily and are never linked to a person or an order.

create table if not exists order_event (
  id             bigserial primary key,
  order_id       uuid not null,
  at             timestamptz not null default now(),
  step           text not null,
  transaction_id text,
  detail         jsonb not null default '{}'::jsonb
);
create index if not exists order_event_order_at on order_event (order_id, at);
create index if not exists order_event_step_at on order_event (step, at);

-- Why an attempt failed at the gateway (sanitized message, no secrets).
alter table payment_transaction add column if not exists error text;
alter table payment_transaction add column if not exists error_at timestamptz;

-- Checkout-sheet opens are counted per day/org/event/source like page views.
alter table analytics_daily drop constraint if exists analytics_daily_kind_valid;
alter table analytics_daily add constraint analytics_daily_kind_valid
  check (kind in ('storefront', 'event', 'checkout'));
