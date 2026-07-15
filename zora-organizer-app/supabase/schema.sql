-- Zora shared schema — run in Supabase → SQL Editor. One Postgres = the single
-- source of truth for both the website (zora-site) and the mobile app.

-- ── organizations ─────────────────────────────────────────────
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- ── profiles (1:1 with auth.users) — carries the role for routing ──
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'consumer' check (role in ('consumer','organizer','staff')),
  org_id uuid references organizations(id),
  kyc_verified boolean not null default false,   -- flips true when identity verification is approved; gates payouts
  created_at timestamptz default now()
);
-- (existing installs) add the column if the table predates it:
alter table profiles add column if not exists kyc_verified boolean not null default false;
alter table profiles enable row level security;
create policy "own profile read"  on profiles for select using (auth.uid() = id);
create policy "own profile write" on profiles for update using (auth.uid() = id);

-- Auto-create a profile row on signup (role defaults to 'consumer').
create or replace function handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, role) values (new.id, new.email, 'consumer');
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ── events — the table both platforms share ───────────────────
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id),
  name text not null,
  city text,
  date timestamptz,
  status text not null default 'draft' check (status in ('draft','published','past')),
  cap int,
  tiers jsonb not null default '[]',
  cover text,
  updated_at timestamptz default now()
);
alter table events enable row level security;

-- Anyone (even anon) can read published events; organizers write their own.
create policy "public reads published" on events for select
  using (status = 'published');
create policy "org reads own"          on events for select
  using (org_id = (select org_id from profiles where id = auth.uid()));
create policy "org writes own"         on events for all
  using  (org_id = (select org_id from profiles where id = auth.uid()))
  with check (org_id = (select org_id from profiles where id = auth.uid()));

-- Turn on realtime so inserts/updates stream to the app + web instantly.
alter publication supabase_realtime add table events;
