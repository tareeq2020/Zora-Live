-- 0022_auth_users.sql (BS92 / auth-identity Phase 1) — the USER + MEMBERSHIP layer.
--
-- Today the `organizer` ROW is the login identity (POST /api/org/login checks a
-- handle + bcrypt against `organizer.password_hash`) and super-admin is a magic
-- account in the collection_store `admin` blob. There is no `user`, so one human
-- cannot own two orgs, be added to someone else's, or be super-admin AND an
-- organizer with a single login. This migration lays the tables the rework needs.
-- It is ADDITIVE and IDEMPOTENT: nothing here changes login, the session shape, or
-- the verification gate — Phase 2 flips the auth path onto these tables and retires
-- `organizer.password_hash`. Backfill lives in db/backfill-users.mjs.
--
-- Target model (spec E2/D2):
--   app_user (auth identity: email + phone + password_hash)
--     └─ GLOBAL roles  : super_admin | staff | scanner   (user_role)
--     └─ MEMBERSHIPS    : owner | admin | finance | door | viewer  (organizer_member)
--   organizer (the company/entity) — verification stays here (kyc_status).
--   org_invite — teammate invites (used in Phase 3; the table is created now).

-- ── app_user ─────────────────────────────────────────────────────────────────
-- 0001_init.sql already shipped an UNUSED `app_user` shell (username-keyed, for a
-- Supabase-Auth bridge that never landed — the app went the collection_store route
-- instead; nothing in apps/* references it). Rather than a second, colliding table,
-- reshape the empty shell to the Phase-1 identity: keyed on lower(email), carrying
-- phone + updated_at. Relax the shell's NOT NULLs so a backfilled organizer with no
-- password (or the email fallback) can land. `username`, `role`, `status` stay as
-- harmless legacy columns.
alter table app_user add column if not exists phone      text;
alter table app_user add column if not exists updated_at timestamptz not null default now();
alter table app_user alter column username      drop not null;  -- users are email-keyed now
alter table app_user alter column password_hash drop not null;  -- an org may have no password yet

-- Case-insensitive identity: one User per email address. Partial (email not null)
-- so the synthetic `handle@handles.zorapass` fallbacks and any legacy null-email
-- rows do not collide on NULL.
create unique index if not exists app_user_email_lower_uq
  on app_user (lower(email)) where email is not null;

-- ── user_role — GLOBAL, platform-wide roles ──────────────────────────────────
-- super_admin (the old magic admin), staff, scanner. A user can hold several
-- (unique per (user_id, role)); org-scoped roles live in organizer_member, not here.
create table if not exists user_role (
  user_id    uuid not null references app_user(id) on delete cascade,
  role       text not null,                         -- super_admin | staff | scanner
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table user_role drop constraint if exists user_role_role_valid;
alter table user_role add  constraint user_role_role_valid
  check (role in ('super_admin', 'staff', 'scanner'));
create index if not exists user_role_user_idx on user_role (user_id);

-- ── organizer_member — a User's MEMBERSHIP in an Organizer, with a scoped role ─
-- owner (the backfilled organizer's login-holder), admin, finance, door, viewer.
-- unique (user_id, organizer_id): one membership row per user per org. `organizer.id`
-- is a text slug (see 0009), so organizer_id is text.
create table if not exists organizer_member (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references app_user(id)  on delete cascade,
  organizer_id text not null references organizer(id) on delete cascade,
  role         text not null default 'owner',         -- owner | admin | finance | door | viewer
  invited_by   uuid references app_user(id),
  created_at   timestamptz not null default now(),
  unique (user_id, organizer_id)
);
alter table organizer_member drop constraint if exists organizer_member_role_valid;
alter table organizer_member add  constraint organizer_member_role_valid
  check (role in ('owner', 'admin', 'finance', 'door', 'viewer'));
create index if not exists organizer_member_org_idx  on organizer_member (organizer_id);
create index if not exists organizer_member_user_idx on organizer_member (user_id);

-- ── org_invite — invite a teammate by email (Phase 3; table created now) ──────
-- A pending invite carries the org, the invited email, the role they'll get, an
-- opaque single-use token, an expiry, and the accept timestamp (null until used).
create table if not exists org_invite (
  id           uuid primary key default gen_random_uuid(),
  organizer_id text not null references organizer(id) on delete cascade,
  email        text not null,
  role         text not null default 'viewer',        -- owner | admin | finance | door | viewer
  token        text not null unique,
  invited_by   uuid references app_user(id),
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);
alter table org_invite drop constraint if exists org_invite_role_valid;
alter table org_invite add  constraint org_invite_role_valid
  check (role in ('owner', 'admin', 'finance', 'door', 'viewer'));
create index if not exists org_invite_org_idx   on org_invite (organizer_id);
create index if not exists org_invite_email_idx on org_invite (lower(email));
