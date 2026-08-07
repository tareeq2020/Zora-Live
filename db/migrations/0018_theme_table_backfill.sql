-- BS47: theme moves off the collection_store singleton (name='theme') onto the
-- `theme` table (has existed since 0001_init.sql, never used). Production's
-- blob carries a REAL customization (thebrunchcity uploaded their own accent,
-- logo, favicon, banner via Studio) — this must land on the right organizer's
-- row, not the generic seed defaults, or the switchover would silently wipe it.
--
-- The blob is a single JSON OBJECT (not an array like organizers/agents), and
-- carries its own 'handle' field naming which organizer it belongs to — match
-- on that. ON CONFLICT DO NOTHING: idempotent, and never clobbers a theme row
-- an organizer has already saved through the new per-org PUT.
insert into theme (organizer_id, brand_name, accent, secondary, bg, card, typography, logo_url, favicon_url, banner_url, updated_at)
select o.id,
       cs.data::jsonb ->> 'brandName',
       cs.data::jsonb ->> 'accent',
       cs.data::jsonb ->> 'secondary',
       cs.data::jsonb ->> 'bg',
       cs.data::jsonb ->> 'card',
       cs.data::jsonb ->> 'typography',
       cs.data::jsonb ->> 'logoUrl',
       cs.data::jsonb ->> 'faviconUrl',
       cs.data::jsonb ->> 'bannerUrl',
       now()
  from collection_store cs
  join organizer o on lower(o.handle) = lower(cs.data::jsonb ->> 'handle')
 where cs.name = 'theme'
   and jsonb_typeof(cs.data::jsonb) = 'object'
on conflict (organizer_id) do nothing;
