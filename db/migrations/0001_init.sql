-- ZORA 0001 — current-domain schema (identity, catalog + pricing, registrations,
-- KYC, storefront config, ops, standalone ticket credentials).
-- Conventions: money = bigint (whole TZS); status/role = text with commented value
-- sets (migration-free evolution); ids = uuid (gen_random_uuid, built-in PG13+) or
-- text slugs for catalog. Backend connects as a privileged role; RLS for
-- consumer-facing reads is added in a later migration.

-- ── identity & tenancy ────────────────────────────────────────────
create table if not exists app_user (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  email text,
  password_hash text not null,             -- bcrypt today ($2a$...); verifier stays bcrypt-compat
  role text not null default 'admin',      -- super_admin | admin | read_only
  status text not null default 'active',   -- active | disabled
  created_at timestamptz not null default now()
);

create table if not exists organizer (
  id uuid primary key default gen_random_uuid(),
  handle text unique not null,
  name text,
  email text,
  status text not null default 'active',   -- active | suspended
  events int not null default 0,
  revenue bigint not null default 0,
  joined date,
  auth_user_id uuid,                        -- Supabase Auth bridge (later)
  created_at timestamptz not null default now()
);

create table if not exists customer (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  email text,
  name text,
  password_hash text,                       -- null until the phone becomes an account
  created_at timestamptz not null default now()
);
create unique index if not exists customer_email_account_uq
  on customer (lower(email)) where password_hash is not null;

-- ── catalog + pricing ─────────────────────────────────────────────
create table if not exists event (
  id text primary key,                      -- slug
  organizer_id uuid references organizer(id),
  name text not null,
  tagline text,
  category text,
  city text,
  venue text,
  date_label text,
  event_time text,
  status text not null default 'published', -- draft | published | past
  price_from bigint,
  cover text,
  props jsonb not null default '{}'::jsonb,  -- full canonical object for shape fidelity
  updated_at timestamptz not null default now()
);
create index if not exists event_city_idx on event (city);
create index if not exists event_organizer_idx on event (organizer_id);

create table if not exists product_tier (
  id text primary key,
  event_id text not null references event(id) on delete cascade,
  name text not null,
  kind text not null default 'shore',       -- shore | vessel | table
  capacity int,
  sort_order int not null default 0,
  price_label text,
  split_note text,
  status text not null default 'open',      -- open | locked | soldout
  created_at timestamptz not null default now()
);
create index if not exists product_tier_event_idx on product_tier (event_id);

create table if not exists price_version (
  id bigint generated always as identity primary key,
  tier_id text not null references product_tier(id) on delete cascade,
  price bigint not null,
  currency text not null default 'TZS',
  fee_treatment text not null default 'passed', -- passed | absorbed
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  updated_by text
);
create index if not exists price_version_tier_idx on price_version (tier_id);

-- ── registrations (crews) ─────────────────────────────────────────
create table if not exists registration (
  id uuid primary key default gen_random_uuid(),
  event_id text references event(id),
  code text,
  crew_name text not null,
  lead_name text not null,
  phone text not null,
  email text,
  size int not null,
  created_at timestamptz not null default now(),
  unique (event_id, phone)
);

-- ── KYC ───────────────────────────────────────────────────────────
create table if not exists kyc_verification (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid references organizer(id),
  ref text unique not null,
  status text not null default 'submitted', -- submitted | approved | rejected
  id_type text,
  country text,
  full_name text,
  doc_number_masked text,
  doc_number_hash text,
  attempt int not null default 1,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  rejection jsonb,
  vendor jsonb,
  ip text,
  ua text,
  events jsonb not null default '[]'::jsonb
);

create table if not exists kyc_document (
  id text primary key,                      -- opaque docId (16-byte hex)
  verification_id uuid not null references kyc_verification(id) on delete cascade,
  storage_path text,                        -- Supabase private bucket path
  side text,
  content_type text,
  sha256 text,
  encrypted boolean not null default true
);
create index if not exists kyc_document_verification_idx on kyc_document (verification_id);

-- ── storefront config ─────────────────────────────────────────────
create table if not exists setting (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists theme (
  organizer_id uuid primary key references organizer(id) on delete cascade,
  brand_name text,
  accent text, secondary text, bg text, card text,
  typography text, logo_url text, favicon_url text, banner_url text,
  updated_at timestamptz not null default now()
);

create table if not exists placement (
  slot text primary key,
  url text not null
);

create table if not exists floorplan (
  event_id text primary key references event(id) on delete cascade,
  space jsonb,
  stage jsonb,
  zones jsonb not null default '[]'::jsonb,
  updated_at timestamptz
);

create table if not exists media_asset (
  path text primary key,                    -- filename / storage path
  organizer_id uuid references organizer(id),
  status text not null default 'pending',   -- approved | flagged | pending
  flag_reason text,
  dims text,
  size_kb int,
  storage_path text,
  modified_at timestamptz
);

-- ── ops ───────────────────────────────────────────────────────────
create table if not exists agent (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text not null,
  via text,                                 -- email | phone
  event text,
  role text not null default 'agent',
  code text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text,
  action text,
  detail text,
  ip text
);

-- ── ticket credentials ────────────────────────────────────────────
-- Today's tickets are standalone rendered passes (no purchase flow), so
-- order_item_id is nullable with NO FK yet; the order_item FK + the
-- unique(order_item_id, seat_index) issuance guard are added in Phase B.
create table if not exists credential (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid,                       -- FK added with checkout (Phase B)
  event_id text references event(id),
  tier_id text references product_tier(id),
  code text unique not null,
  signature text,
  state text not null default 'issued',     -- issued | used | revoked
  holder_name text,
  table_name text,
  table_no text,
  seats text,
  seat_index int,
  issued_at timestamptz not null default now()
);
