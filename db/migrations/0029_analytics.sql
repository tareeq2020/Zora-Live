-- BS123: first-party storefront analytics (Web Premium v1, F4 / A10 / A22).
--
-- Aggregates only. No raw visitor ids, IPs, phones or emails are stored: a visit
-- is counted into analytics_daily, and unique visitors are deduped in
-- analytics_visitor_day by a DAILY-salted one-way hash that cannot be joined
-- across days. analytics_visitor_day is purged after 35 days by the worker.

create table if not exists analytics_daily (
  day        date    not null,
  org_handle text    not null,
  event_id   text    not null default '',   -- '' = the storefront page itself
  kind       text    not null,              -- storefront | event
  source     text    not null,              -- whatsapp | instagram | facebook | google | tiktok | x | direct | other
  views      integer not null default 0,
  visitors   integer not null default 0,
  primary key (day, org_handle, event_id, kind, source),
  constraint analytics_daily_kind_valid check (kind in ('storefront', 'event'))
);
create index if not exists analytics_daily_org_day on analytics_daily (org_handle, day);

create table if not exists analytics_visitor_day (
  day          date not null,
  org_handle   text not null,
  event_id     text not null default '',
  visitor_hash text not null,
  primary key (day, org_handle, event_id, visitor_hash)
);
