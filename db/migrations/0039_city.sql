-- BS168: cities move from code into the database.
--
-- Until now the five cities were written out in five places (web, API, the
-- events read path, a backfill script, the mobile home screen). Adding one took
-- a release that had to touch all of them. Now this table is the one list:
-- Admin → Cities edits it, GET /api/cities serves it, and event.city holds a
-- city id from here.
--
-- status
--   active     organizers can pick it; buyers see it once it has upcoming events
--   hidden     not offered for new events; existing events keep it and still show
--   requested  an organizer asked for it; usable on their events, waiting for
--              an admin to approve it or match it to an existing city
--   merged     matched to `merged_into`; events were moved there, and the old id
--              still resolves to the new city
--   declined   request refused; not offered, and not shown on any city page
create table if not exists city (
  id            text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name          text not null check (length(btrim(name)) between 2 and 60),
  country       text not null default '',
  currency      text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  timezone      text not null default 'Africa/Dar_es_Salaam',
  aliases       text[] not null default '{}',   -- other spellings that mean this city (lower-case)
  status        text not null default 'active'
                check (status in ('active', 'hidden', 'requested', 'merged', 'declined')),
  sort          integer not null default 100,   -- tie-break when two cities have the same event count
  merged_into   text references city(id),
  requested_by  text,                           -- organizer handle, for requested cities
  requested_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (status <> 'merged' or merged_into is not null)
);
create index if not exists city_status on city (status);

insert into city (id, name, country, currency, timezone, aliases, sort) values
  ('dar',      'Dar es Salaam', 'Tanzania', 'TZS', 'Africa/Dar_es_Salaam', '{dar es salaam,dar-es-salaam,dsm,daressalaam}', 10),
  ('zanzibar', 'Zanzibar',      'Tanzania', 'TZS', 'Africa/Dar_es_Salaam', '{unguja,stone town}', 20),
  ('nairobi',  'Nairobi',       'Kenya',    'KES', 'Africa/Nairobi',       '{nbo}', 30),
  ('accra',    'Accra',         'Ghana',    'GHS', 'Africa/Accra',         '{}', 40),
  ('lagos',    'Lagos',         'Nigeria',  'NGN', 'Africa/Lagos',         '{}', 50)
on conflict (id) do nothing;
