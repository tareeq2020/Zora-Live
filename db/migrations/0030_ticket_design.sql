-- PR-BS130 (Web Premium v1 · F6): organizer-branded passes.
-- One design per event. Organizers edit `draft` (jsonb, camelCase keys); POST
-- …/ticket-design/publish copies the draft into the live columns, which are the
-- ONLY thing buyers' passes read. Theme inheritance (Zora defaults → storefront
-- `theme` → event cover → these overrides) lives in packages/core/src/theme-resolve.ts.
-- The QR block, pass ID, tear line and ZoraPass mark are never configurable (DD4).

create table if not exists ticket_design (
  event_id            text primary key,
  template            text check (template in ('artwork_top','classic_black','full_colour')),
  accent              text,
  bg_color            text,
  bg_image            text,
  logo_url            text,
  organizer_logo_url  text,
  sponsor_logos       jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(sponsor_logos) = 'array' and jsonb_array_length(sponsor_logos) <= 4),
  show_fields         jsonb check (show_fields is null or jsonb_typeof(show_fields) = 'array'),
  inherit_storefront  boolean not null default true,
  status              text not null default 'draft' check (status in ('draft','published')),
  draft               jsonb,
  updated_at          timestamptz not null default now(),
  published_at        timestamptz
);
