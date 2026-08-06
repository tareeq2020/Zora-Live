-- 0009_organizer_table.sql (BS35 / eng-review OV2) — organizers move OFF the
-- collection_store JSON blob and ONTO the relational `organizer` table.
--
-- Why: `EntityStore.write` is a whole-blob upsert with no version guard, so two
-- concurrent organizer writes (set commission + set password, a signup racing an
-- admin edit) silently lose one of them — last write wins over the ENTIRE org
-- list. Money (commission, payouts) cannot sit on that. A row per organizer gives
-- per-row locks, a UNIQUE handle enforced by the database, and targeted column
-- updates instead of rewriting every organizer on every edit.
--
-- `organizer` has existed since 0001_init.sql but was never used or populated —
-- the app read the blob instead, so the table stayed an empty shell with a uuid
-- primary key. The blob's ids are slugs ('o1'…'o4') and the whole API surface is
-- keyed on them (PUT /api/organizers/o1/commission), so the id column becomes
-- text and the four (also empty, also unused) columns that reference it follow.
-- No data is migrated by these ALTERs because every one of those tables is empty.
--
-- The blob row (collection_store name='organizers') is deliberately LEFT IN PLACE:
-- it is the migration source and a rollback escape hatch. Nothing reads it after
-- this migration.

-- ── id: uuid → text (slug ids), with the referencing columns ─────────────────
alter table event            drop constraint if exists event_organizer_id_fkey;
alter table kyc_verification drop constraint if exists kyc_verification_organizer_id_fkey;
alter table theme            drop constraint if exists theme_organizer_id_fkey;
alter table media_asset      drop constraint if exists media_asset_organizer_id_fkey;

alter table organizer        alter column id drop default;
alter table organizer        alter column id type text using id::text;
alter table event            alter column organizer_id type text using organizer_id::text;
alter table kyc_verification alter column organizer_id type text using organizer_id::text;
alter table theme            alter column organizer_id type text using organizer_id::text;
alter table media_asset      alter column organizer_id type text using organizer_id::text;

alter table event            add constraint event_organizer_id_fkey            foreign key (organizer_id) references organizer(id);
alter table kyc_verification add constraint kyc_verification_organizer_id_fkey foreign key (organizer_id) references organizer(id);
alter table theme            add constraint theme_organizer_id_fkey            foreign key (organizer_id) references organizer(id) on delete cascade;
alter table media_asset      add constraint media_asset_organizer_id_fkey      foreign key (organizer_id) references organizer(id);

-- ── the fields the blob carried that the table never had ────────────────────
alter table organizer add column if not exists kyc_status      text;           -- null | unverified | pending | approved | rejected
alter table organizer add column if not exists commission_rate numeric(6,5);   -- null = platform default (5%)
alter table organizer add column if not exists password_hash   text;           -- bcrypt; NEVER returned by the API
alter table organizer add column if not exists updated_at      timestamptz not null default now();
-- `joined` is display-only in every response; keep it text so the JSON shape is
-- the blob's 'YYYY-MM-DD' string and not a serialized timestamp.
alter table organizer alter column joined type text using joined::text;
-- Handles are always stored lower-cased (login normalizes), so 0001's UNIQUE is a
-- true case-insensitive guarantee: two orgs can no longer claim the same handle.

-- ── BACKFILL from the blob (idempotent) ──────────────────────────────────────
-- Production path: the blob already exists, so every organizer (including the
-- bcrypt passwordHash, kycStatus and commissionRate added by later PRs) lands
-- here verbatim. Re-running is a no-op via ON CONFLICT DO NOTHING.
insert into organizer (id, name, handle, email, status, kyc_status, commission_rate, password_hash, joined, events, revenue)
select o->>'id',
       coalesce(o->>'name', o->>'handle'),
       lower(o->>'handle'),
       o->>'email',
       coalesce(o->>'status', 'active'),
       o->>'kycStatus',
       case when jsonb_typeof(o->'commissionRate') = 'number' then (o->>'commissionRate')::numeric else null end,
       o->>'passwordHash',
       o->>'joined',
       coalesce((case when jsonb_typeof(o->'events')  = 'number' then (o->>'events')::int    else 0 end), 0),
       coalesce((case when jsonb_typeof(o->'revenue') = 'number' then (o->>'revenue')::bigint else 0 end), 0)
  from collection_store cs,
       lateral jsonb_array_elements(cs.data::jsonb) as o
 where cs.name = 'organizers'
   and jsonb_typeof(cs.data::jsonb) = 'array'
   and coalesce(o->>'handle', '') <> ''
on conflict (id) do nothing;

-- ── FRESH-INSTALL seed ───────────────────────────────────────────────────────
-- On a brand-new database this migration runs BEFORE db/backfill.mjs, so there is
-- no blob to read yet. Seed the canonical starter organizers (identical to
-- data/organizers.json) so GET /api/organizers keeps its pre-migration fallback
-- behaviour instead of returning an empty list. Guarded on the table being empty,
-- so it can never touch a real deployment.
insert into organizer (id, name, handle, email, status, joined, events, revenue)
select * from (values
  ('o1', 'The Brunch City', 'thebrunchcity', 'hello@thebrunchcity.co', 'active', '2024-03-11',  9, 167713000::bigint),
  ('o2', 'Offshore Ltd',    'offshore',      'board@offshore.app',     'active', '2026-05-02',  1,  84200000::bigint),
  ('o3', 'Basement',        'basement',      'crew@basement.co',       'active', '2025-11-20',  4,  22400000::bigint),
  ('o4', 'Palmwine Co',     'palmwine',      'team@palmwine.ng',       'active', '2025-08-14',  2,  11800000::bigint)
) as seed(id, name, handle, email, status, joined, events, revenue)
 where not exists (select 1 from organizer)
on conflict (id) do nothing;
