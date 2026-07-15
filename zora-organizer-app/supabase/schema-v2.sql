-- Zora schema v2 — unify ALL website data into Supabase as one source of truth.
-- Run in Supabase → SQL Editor (safe to re-run; all statements are idempotent).

-- ── events: carry the full canonical event object ─────────────────
-- The site's marketplace (discover.html via /api/events) expects the rich
-- events.json shape (tagline, category, venue, dateLabel, priceFrom, flags,
-- organizerHandle). We keep the existing top-level columns for querying/RLS and
-- stash the full object in `props` so both the site and the app get everything.
alter table events add column if not exists props jsonb not null default '{}'::jsonb;

-- ── organizers — migrated from the site so both platforms share them ──
create table if not exists organizers (
  id uuid primary key default gen_random_uuid(),
  handle text unique not null,
  name text,
  email text,
  status text default 'active',
  events int default 0,
  revenue bigint default 0,
  joined date,
  created_at timestamptz default now()
);
alter table organizers enable row level security;
drop policy if exists "public reads organizers" on organizers;
create policy "public reads organizers" on organizers for select using (true);

-- ── realtime so inserts/updates stream to the app + web instantly ──
do $$ begin
  alter publication supabase_realtime add table organizers;
exception when duplicate_object then null; end $$;
