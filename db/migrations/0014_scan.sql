-- 0013_scan.sql (BS42 / plan #1) — TWO-STEP SCANNING at the door.
--
-- Three things land here, all additive:
--   1. the scan lifecycle on the EXISTING `credential.state` column (eng review
--      OV4 — no parallel scan_state column set),
--   2. `scanner_user`: the legacy `agents` blob promoted to a real table with a
--      ROLE and an optional event scope (ARCH-3),
--   3. `scan_auth_attempt`: the audit + rate-limit ledger behind the 6-digit
--      code→session exchange (OV4 — 6 digits is a 900k space, brute-forceable
--      in minutes without a lockout).
--
-- ── 1. credential.state, extended ───────────────────────────────────────────
-- 0001_init declared `state text not null default 'issued'  -- issued|used|revoked`
-- with NO constraint, and nothing has ever written anything but 'issued'. The
-- door needs two more stops on the SAME column:
--
--   issued ──agent scan──▶ scanned ──supervisor confirm──▶ wristband_issued
--      │                      │
--      └──────────────────────┴────────────────────▶ revoked   (terminal)
--                                                    used      (terminal, legacy)
--
-- `used` is kept and treated as terminal-consumed: it is what the pre-order
-- standalone ticket path meant by "this pass has been through the door", and a
-- scanner meeting one must say ALREADY USED rather than let it in twice.
--
-- OV6: the supervisor step is SELECTIVE, not universal. Normal GA entry ends at
-- `scanned` — that IS the gate. Only credentials that carry real risk (a table /
-- bill-split seat, a comp, anything ops flagged) require the second person, so a
-- server blip at the door can never stop the GA queue. `requires_confirm` is the
-- per-credential escape hatch; table credentials are marked automatically below.

alter table credential add column if not exists scanned_at        timestamptz;
alter table credential add column if not exists scanned_by        text;  -- scanner_user.id
alter table credential add column if not exists scanned_by_name   text;  -- denormalized for the 409 ("SCANNED 21:14 · AGENT 4")
alter table credential add column if not exists confirmed_at      timestamptz;
alter table credential add column if not exists confirmed_by      text;  -- scanner_user.id (supervisor)
alter table credential add column if not exists confirmed_by_name text;
alter table credential add column if not exists requires_confirm  boolean not null default false;

-- Any state outside this set is a bug that would silently strand a pass at the
-- door, so the database refuses it rather than the application hoping.
do $$ begin
  alter table credential add constraint credential_state_valid
    check (state in ('issued', 'scanned', 'wristband_issued', 'used', 'revoked'));
exception when duplicate_object then null; end $$;

-- A scanned/confirmed credential must say WHO and WHEN — a pass that went
-- through with no actor is exactly the fraud the two-step exists to catch.
do $$ begin
  alter table credential add constraint credential_scan_actor_complete
    check (state not in ('scanned', 'wristband_issued') or (scanned_at is not null and scanned_by is not null));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table credential add constraint credential_confirm_actor_complete
    check (state <> 'wristband_issued' or (confirmed_at is not null and confirmed_by is not null));
exception when duplicate_object then null; end $$;

-- OV6 — table / bill-split seats always take the second person (a table is the
-- high-value, most-disputed credential and it is a small, bounded population).
update credential set requires_confirm = true
 where requires_confirm = false and (split_id is not null or table_no is not null);

-- The supervisor queue read: "everything waiting on me, for this event".
create index if not exists credential_scan_pending_idx
  on credential (event_id, scanned_at) where state = 'scanned';
-- The agent scan read is by `code`, already UNIQUE from 0001_init.

-- ── 2. scanner_user — the `agents` blob, promoted ───────────────────────────
-- The legacy concept (collection_store name='agents': a name, a contact, a
-- 6-digit code, a 3-day expiry) survives verbatim; what it gains is a ROLE, an
-- optional event scope, and a database-enforced guarantee that one live code
-- resolves to exactly one person.
--
-- Kept as text ids (the blob's Date.now().toString(36) keys) because the whole
-- admin surface is already keyed on them — POST /api/agents/:id/rotate.
create table if not exists scanner_user (
  id              text primary key,
  name            text        not null,
  contact         text,
  via             text,                                      -- phone | email (display only)
  role            text        not null default 'agent',      -- agent | supervisor (ARCH-3)
  event_scope     text,                                      -- event.id; NULL = every event
  code            text        not null,                      -- the 6-digit sign-in code
  status          text        not null default 'active',     -- active | revoked
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,                               -- code auto-expiry (legacy 3 days)
  code_rotated_at timestamptz not null default now(),         -- rotating a code kills live sessions
  last_seen_at    timestamptz
);

do $$ begin
  alter table scanner_user add constraint scanner_user_role_valid   check (role   in ('agent', 'supervisor'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table scanner_user add constraint scanner_user_status_valid check (status in ('active', 'revoked'));
exception when duplicate_object then null; end $$;

-- THE security-critical index. A 6-digit code is an authenticator: if two ACTIVE
-- scanner users could hold the same code, the code→session exchange would have
-- to pick one, and a door agent could be silently handed a supervisor's session.
-- Partial (status='active') so revoked codes are free to be reissued later.
create unique index if not exists scanner_user_active_code_uq
  on scanner_user (code) where status = 'active';
create index if not exists scanner_user_status_idx on scanner_user (status, created_at);

-- BACKFILL from the blob (idempotent). Production migrates a database that
-- already holds collection_store name='agents'; a FRESH install runs this before
-- db/backfill.mjs writes the blob, so backfill.mjs repeats the same copy (same
-- pattern as 0009 → syncOrganizerTable).
insert into scanner_user (id, name, contact, via, role, event_scope, code, status, created_at, expires_at)
select a->>'id',
       coalesce(a->>'name', 'Scanner'),
       a->>'contact',
       a->>'via',
       case when a->>'role' = 'supervisor' then 'supervisor' else 'agent' end,
       -- The blob's `event` was a free-text label ('OFFSHORE' / 'All events').
       -- Only a value that matches a real event id becomes a hard scope; anything
       -- else (including 'All events') stays NULL = unscoped, which is what the
       -- legacy behaviour actually was.
       (select e.id from event e where e.id = a->>'event'),
       a->>'code',
       case when a->>'status' = 'revoked' then 'revoked' else 'active' end,
       coalesce((a->>'createdAt')::timestamptz, now()),
       (a->>'expiresAt')::timestamptz
  from collection_store cs,
       lateral jsonb_array_elements(cs.data::jsonb) as a
 where cs.name = 'agents'
   and jsonb_typeof(cs.data::jsonb) = 'array'
   and coalesce(a->>'id', '') <> ''
   and coalesce(a->>'code', '') <> ''
on conflict (id) do nothing;

-- ── 3. scan_auth_attempt — the lockout ledger (OV4) ─────────────────────────
-- Six digits is 900,000 possibilities: a script doing 20 requests/second walks
-- the whole space in about twelve hours, and a WORKING code in far less. So every
-- exchange is recorded and the exchange refuses to run once a code (targeted
-- attack) or a source IP (sweep) has failed too often inside the window.
--
-- The attempted code is stored as a SHA-256 hash, never in the clear: this table
-- would otherwise be a list of near-miss door codes.
create table if not exists scan_auth_attempt (
  id        bigint generated always as identity primary key,
  code_hash text        not null,
  ip        text,
  ok        boolean     not null default false,
  user_id   text,                                   -- set on success (who signed in)
  at        timestamptz not null default now()
);
-- Both reads are "failures for this key since T" — the partial index keeps the
-- lockout check off the (much larger) success history.
create index if not exists scan_auth_attempt_code_idx on scan_auth_attempt (code_hash, at desc) where not ok;
create index if not exists scan_auth_attempt_ip_idx   on scan_auth_attempt (ip, at desc)        where not ok;
create index if not exists scan_auth_attempt_at_idx   on scan_auth_attempt (at);
