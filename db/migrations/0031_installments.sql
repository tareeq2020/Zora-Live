-- BS132: installments core (Web Premium v1, F7 / A2 / A3 / A16 / A19).
--
-- Three tables and two inventory functions.
--
--   installment_config    per-event organizer offer (BS136 edits it). A TABLE,
--                         not a settings document: core reads it while pricing a
--                         purchase (no EntityStore in core), the CHECKs below make
--                         an out-of-range offer (count 7, deposit 0%) impossible
--                         at the storage layer, and each event row is edited on
--                         its own instead of rewriting one shared JSON blob.
--   installment_plan      the snapshot taken at purchase (A19): totals, deposit,
--                         count, frequency, final due, grace. Later config edits
--                         never touch a placed plan.
--   installment_schedule  one row per payment (n = 1 is the deposit). Amounts are
--                         whole TSh; their sum equals the plan total (checked by
--                         the schedule maths and pinned by unit tests).
--
-- payment_transaction.schedule_n binds an attempt to ONE schedule row (A16), so
-- the attempt charges that row's amount, never the order total.
--
-- Inventory (A3): the deposit moves the order's HELD units into the reservation
-- ledger (ref_type 'installment', ref_id = order id). The final installment calls
-- convert_reservation (reserved → sold); default calls release_reservation. The
-- reservation's expires_at (final due + grace + 1 day) is only a safety net for
-- sweep_expired_reservations — the installment job closes the plan first.

-- ── per-event offer ──────────────────────────────────────────────────────────
create table if not exists installment_config (
  event_id                    text primary key,
  enabled                     boolean not null default false,
  tiers                       text[]  not null default '{}',   -- empty = every tier of the event
  deposit_pct                 numeric(5,2),                    -- e.g. 30.00 (exactly one of pct / amount)
  deposit_amount              bigint,                          -- whole TSh per order
  count                       integer not null default 3,      -- payments INCLUDING the deposit
  frequency                   text    not null default 'monthly',
  final_due_days_before_event integer not null default 7,
  grace_days                  integer not null default 3,
  updated_at                  timestamptz not null default now(),
  constraint installment_config_count_range   check (count between 2 and 6),
  constraint installment_config_frequency     check (frequency in ('weekly', 'biweekly', 'monthly')),
  constraint installment_config_deposit_one   check ((deposit_pct is null) <> (deposit_amount is null)),
  constraint installment_config_deposit_pct   check (deposit_pct is null or (deposit_pct > 0 and deposit_pct < 100)),
  constraint installment_config_deposit_amt   check (deposit_amount is null or deposit_amount > 0),
  constraint installment_config_final_due     check (final_due_days_before_event between 0 and 365),
  constraint installment_config_grace         check (grace_days between 0 and 30)
);

-- ── the plan snapshot ────────────────────────────────────────────────────────
-- status: pending (created, deposit not yet cleared) → active (deposit cleared,
-- inventory reserved) → completed (final installment cleared, passes issued)
-- or → closing (default job holds the lock) → defaulted | completed.
-- cancelled = the order died before the deposit (expired / abandoned).
create table if not exists installment_plan (
  order_id        uuid primary key references "order"(id),
  event_id        text not null,
  org_handle      text,
  total           bigint not null check (total > 0),
  service_fee     bigint not null default 0 check (service_fee >= 0), -- buyer fee in total; kept on default
  currency        text not null default 'TZS',
  deposit         bigint not null check (deposit > 0),
  count           integer not null check (count between 2 and 6),
  frequency       text not null check (frequency in ('weekly', 'biweekly', 'monthly')),
  final_due       date not null,
  grace_days      integer not null default 0 check (grace_days >= 0),
  status          text not null default 'pending',
  receivable_id   text,                       -- x-bridge /v1 receivable (BS133)
  excess_collected bigint not null default 0 check (excess_collected >= 0), -- over/duplicate payments owed back
  refund_due      bigint not null default 0 check (refund_due >= 0),        -- default: collected − service fee
  refund_status   text not null default 'none',                            -- none | pending | recorded
  closing_at      timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  constraint installment_plan_status_valid check (status in ('pending', 'active', 'completed', 'closing', 'defaulted', 'cancelled')),
  constraint installment_plan_refund_status check (refund_status in ('none', 'pending', 'recorded')),
  constraint installment_plan_deposit_lt_total check (deposit < total)
);
create index if not exists installment_plan_event  on installment_plan (event_id);
create index if not exists installment_plan_status on installment_plan (status) where status in ('active', 'closing');
create unique index if not exists installment_plan_receivable on installment_plan (receivable_id) where receivable_id is not null;

create table if not exists installment_schedule (
  order_id       uuid not null references installment_plan(order_id),
  n              integer not null check (n >= 1),
  due_date       date not null,
  amount         bigint not null check (amount > 0),
  status         text not null default 'due',
  paid_at        timestamptz,
  transaction_id text,                        -- the attempt whose success paid this row
  primary key (order_id, n),
  constraint installment_schedule_status_valid check (status in ('due', 'paid', 'missed')),
  constraint installment_schedule_paid_shape check (status <> 'paid' or (paid_at is not null and transaction_id is not null))
);
create index if not exists installment_schedule_due on installment_schedule (due_date) where status <> 'paid';

-- A16: an attempt bound to one schedule row. NULL = an ordinary pay-in-full attempt.
alter table payment_transaction add column if not exists schedule_n integer;
create index if not exists payment_transaction_schedule on payment_transaction (order_id, schedule_n) where schedule_n is not null;

-- ── inventory: held → reserved (A3) ──────────────────────────────────────────
-- Deposit cleared: every HELD hold of the order leaves the hold ledger (state
-- 'reserved', so convert/release_order_holds never see it again) and becomes a
-- reservation of the same pool + quantity. Held units are already out of
-- available_count, so only reserved_count grows — conservation is unchanged.
-- Returns the number of hold rows moved; 0 = the holds lapsed (caller falls back
-- to try_reserve_order).
create or replace function convert_order_holds_to_reservation(p_order_id uuid, p_ref_type text, p_expires_at timestamptz)
returns int language plpgsql as $$
declare r record; v_count int := 0;
begin
  for r in select id, pool_id, quantity from inventory_hold
           where order_id = p_order_id and state = 'held' for update loop
    update inventory_pool set reserved_count = reserved_count + r.quantity where id = r.pool_id;
    update inventory_hold  set state = 'reserved' where id = r.id;
    insert into inventory_reservation (pool_id, ref_type, ref_id, quantity, expires_at)
    values (r.pool_id, p_ref_type, p_order_id, r.quantity, p_expires_at);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Late deposit after the hold sweep (A17): all-or-nothing re-take of the order's
-- tier quantities straight into the reservation ledger (available → reserved).
-- Mirrors try_reacquire_order's two passes. False = something sold out meanwhile;
-- nothing is applied.
create or replace function try_reserve_order(p_order_id uuid, p_ref_type text, p_expires_at timestamptz)
returns boolean language plpgsql as $$
declare r record; v_avail int; v_pool_id bigint; ok boolean := true;
begin
  for r in select product_tier_id, sum(quantity)::int as qty from order_item
            where order_id = p_order_id group by product_tier_id loop
    perform 1 from inventory_pool where product_tier_id = r.product_tier_id for update;
    select available_count into v_avail from inventory_pool where product_tier_id = r.product_tier_id;
    if v_avail is null or v_avail < r.qty then ok := false; end if;
  end loop;
  if not ok then return false; end if;
  for r in select product_tier_id, sum(quantity)::int as qty from order_item
            where order_id = p_order_id group by product_tier_id loop
    update inventory_pool
       set available_count = available_count - r.qty,
           reserved_count  = reserved_count  + r.qty
     where product_tier_id = r.product_tier_id
    returning id into v_pool_id;
    insert into inventory_reservation (pool_id, ref_type, ref_id, quantity, expires_at)
    values (v_pool_id, p_ref_type, p_order_id, r.qty, p_expires_at);
  end loop;
  return true;
end $$;
