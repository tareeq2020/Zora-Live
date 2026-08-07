-- PR-BS1: bill-split (split-a-table) schema + consumer OTP.
-- The split model is SHARE-AS-ORDER: a parent `table_split` places ONE reservation
-- for the whole table; each seat is a `split_share` backed by its own `order`
-- (type='table_share', NO inventory hold of its own) that is paid through the
-- EXISTING exactly-once payment machine. The table converts + issues credentials
-- ONCE, when every share settles. Nothing here touches the audited money core;
-- the aggregation gate + completion flip live in @zora/core/split.ts.
--
--   table_split (status)              split_share (state)
--   ┌─ forming ─┐  all shares paid    ┌ unclaimed → claimed → paid
--   │           └──────────────────▶ complete      (short → voided → re-mint)
--   ├─ window lapses, 0 paid ─▶ expired  (clean release, no refund)
--   └─ window lapses, ≥1 paid ─▶ refund_pending  (inventory LOCKED; ops refunds
--                                              by hand within 24h, then releases)
--
-- Money = bigint (whole TZS). status/state = text with commented value sets
-- (migration-free evolution, matching 0004/0005).

-- ── product_tier: opt a table tier into splitting + its hold window (D4) ──────
alter table product_tier add column if not exists split_enabled    boolean not null default false;
alter table product_tier add column if not exists split_window_secs integer not null default 2700; -- 45 min

-- ── table_split — the split aggregate (owns the reservation + price + creds) ──
-- One row per table someone is splitting. `reservation_id` is the single
-- inventory_reservation held for the whole table (ref_type='split'); it is
-- converted ONCE at completion. `target_value` is the table price+fee the shares
-- must sum to. paid_count is derived (count of split_share where state='paid').
create table if not exists table_split (
  id                uuid primary key default gen_random_uuid(),
  event_id          text not null references event(id),
  product_tier_id   text not null references product_tier(id),
  host_customer_id  uuid not null references customer(id),
  capacity_n        integer not null check (capacity_n >= 2),
  price_version_id  bigint not null references price_version(id),
  target_value      bigint not null check (target_value >= 0),   -- table price + fee, TZS
  reservation_id    uuid references inventory_reservation(id),   -- the ONE held table
  window_expires_at timestamptz not null,
  status            text not null default 'forming',             -- forming | complete | refund_pending | expired
  created_at        timestamptz not null default now(),
  completed_at      timestamptz
);
create index if not exists table_split_event_idx  on table_split (event_id);
create index if not exists table_split_host_idx    on table_split (host_customer_id);
-- Split-aware expiry sweep target: forming splits past their window.
create index if not exists table_split_expiry_idx  on table_split (status, window_expires_at) where status = 'forming';

-- ── split_share — one payable seat. Payment-only: NO order_item, NO hold ──────
-- order_id points at an order(type='table_share') whose target_value = `amount`;
-- that order is paid via the ordinary initiatePayment/applyOutcome path. The
-- claim_token is an HMAC-signed link (CQ4). state drives the aggregation gate.
create table if not exists split_share (
  id           uuid primary key default gen_random_uuid(),
  split_id     uuid not null references table_split(id) on delete cascade,
  share_index  integer not null,
  order_id     uuid references "order"(id),          -- the payable table_share order (null until first pay attempt)
  customer_id  uuid references customer(id),         -- the payer (null until claimed)
  amount       bigint not null check (amount >= 0),  -- snapshotted at creation (CQ3: floor, host absorbs remainder)
  is_host      boolean not null default false,
  state        text not null default 'unclaimed',    -- unclaimed | claimed | paid | voided
  claim_token  text,                                 -- HMAC-signed invite token (CQ4)
  paid_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (split_id, share_index)
);
create index if not exists split_share_split_idx on split_share (split_id);
create index if not exists split_share_order_idx on split_share (order_id) where order_id is not null;

-- ── otp_challenge — consumer SMS one-time codes (CQ2) ────────────────────────
-- Hashed code, short expiry, attempt cap, per-phone throttle. Never plaintext.
create table if not exists otp_challenge (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,
  code_hash   text not null,                 -- sha256(code + secret); never the raw code
  expires_at  timestamptz not null,
  attempts    integer not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
-- Newest-challenge-per-phone lookup + throttle window scan.
create index if not exists otp_challenge_phone_idx on otp_challenge (phone, created_at desc);

-- ── credential: link table-split seats + idempotent per-payer issuance (A2) ──
-- A table credential has order_item_id NULL (shares carry no order_item), so the
-- existing (order_item_id, seat_index) idempotency index does not cover it.
-- split_share_id gives one credential per paid share, issued exactly once.
alter table credential add column if not exists split_id       uuid references table_split(id);
alter table credential add column if not exists split_share_id uuid references split_share(id);
create unique index if not exists credential_split_share_key on credential (split_share_id) where split_share_id is not null;
