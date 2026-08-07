-- 0015_broadcasts.sql (BS43 / plan #2) — bulk SMS + email fan-out.
--
-- Three tables, one job each:
--
--   broadcast            the composed message + WHO it was aimed at + the
--                        AGGREGATE outcome. v1 is aggregate-only by decision
--                        (eng review D4): no per-recipient dashboard, no
--                        templates, no personalization.
--   broadcast_recipient  the QUEUE. One row per (broadcast, channel, address).
--                        The worker drains it in BOUNDED batches per tick so a
--                        50,000-person blast can never starve payment
--                        reconciliation (ARCH-4). It is deliberately a real
--                        table and not an in-memory job list: a worker restart
--                        mid-send must resume, never re-send.
--   message_suppression  opt-out. Checked when the audience is COUNTED, again
--                        when recipients are materialized, and once more at
--                        SEND time — because someone can unsubscribe in the
--                        minutes between "queued" and "sent" and that has to be
--                        honoured, not raced.
--
-- Why the queue is materialized at all (PERF-2): resolving "how many people
-- will this reach" must stay a cheap aggregate — the composer asks for it on
-- every keystroke of the audience picker. Only once SEND is confirmed do we
-- write recipient rows, and then in pages, so a large audience never becomes
-- one giant statement.
--
-- Money note: SMS costs the organizer real money, so sending is gated on org
-- verification + a per-org monthly cap enforced server-side (OV5). The cap is
-- counted off THIS table (sms rows per sender per calendar month), which is why
-- broadcast carries sender_handle and is indexed by (sender_handle, created_at).

-- ── broadcast — the message + its aggregate outcome ──────────────────────────
create table if not exists broadcast (
  id                     uuid primary key default gen_random_uuid(),
  -- The organizer handle that sent it, or the literal 'admin' for a platform
  -- broadcast. Not a FK: 'admin' is not an organizer, and a sent broadcast must
  -- survive an organizer row being renamed.
  sender_handle          text        not null,
  sender_kind            text        not null default 'org',   -- org | admin
  -- Audience, stored as it was CHOSEN (not as it resolved) so history reads
  -- "everyone at Garden Brunch Vol. 09", not a frozen list of phone numbers.
  scope_kind             text        not null,                 -- event | tier | org_all | organizer | platform
  scope_event_id         text,
  scope_tier_id          text,
  scope_organizer_handle text,
  channel                text        not null,                 -- sms | email | both
  sender_id              text,                                 -- SMS sender ID (OV5 — required to send)
  subject                text,                                 -- email subject
  body_sms               text,
  body_email             text,
  -- Counts resolved at send time. audience_count is PEOPLE; sms/email counts are
  -- addressable rows (a person with no email is in one and not the other).
  audience_count         integer     not null default 0,
  sms_count              integer     not null default 0,
  email_count            integer     not null default 0,
  suppressed_count       integer     not null default 0,       -- excluded up front by opt-out
  -- Aggregate delivery outcome (D4). Recomputed by the worker after each batch.
  sent_count             integer     not null default 0,
  failed_count           integer     not null default 0,
  skipped_count          integer     not null default 0,       -- opted out AFTER queueing
  status                 text        not null default 'queued', -- queued | sending | sent | failed
  created_at             timestamptz not null default now(),
  started_at             timestamptz,
  completed_at           timestamptz
);

do $$ begin
  alter table broadcast add constraint broadcast_channel_valid
    check (channel in ('sms', 'email', 'both'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table broadcast add constraint broadcast_status_valid
    check (status in ('queued', 'sending', 'sent', 'failed'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table broadcast add constraint broadcast_sender_kind_valid
    check (sender_kind in ('org', 'admin'));
exception when duplicate_object then null; end $$;

-- The monthly SMS cap read (OV5): "how many SMS has this sender queued since the
-- start of the month". Without this index the cap check scans every broadcast.
create index if not exists broadcast_sender_created_idx on broadcast (sender_handle, created_at desc);
-- The history list, newest first.
create index if not exists broadcast_created_idx on broadcast (created_at desc);

-- ── broadcast_recipient — the queue the worker drains ────────────────────────
-- One row per person per channel. `address` is the normalized destination: a
-- 255XXXXXXXXX MSISDN for sms, a lower-cased address for email. The unique
-- constraint is the DEDUP rule (plan: "dedup per person") — two customer rows
-- sharing an email get one email, not two.
create table if not exists broadcast_recipient (
  id                uuid        primary key default gen_random_uuid(),
  broadcast_id      uuid        not null references broadcast(id) on delete cascade,
  channel           text        not null,                      -- sms | email
  address           text        not null,
  customer_id       uuid        references customer(id),
  status            text        not null default 'queued',     -- queued | sending | sent | failed | skipped
  attempts          integer     not null default 0,
  error             text,
  -- Per-recipient opt-out link. Random, unguessable, and stored rather than
  -- HMAC-derived so a leaked token can be revoked by deleting the row and so an
  -- operator can trace an unsubscribe back to the broadcast that caused it.
  unsubscribe_token text        not null,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  unique (broadcast_id, channel, address)
);

do $$ begin
  alter table broadcast_recipient add constraint broadcast_recipient_channel_valid
    check (channel in ('sms', 'email'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table broadcast_recipient add constraint broadcast_recipient_status_valid
    check (status in ('queued', 'sending', 'sent', 'failed', 'skipped'));
exception when duplicate_object then null; end $$;

create unique index if not exists broadcast_recipient_token_key on broadcast_recipient (unsubscribe_token);
-- THE drain query: oldest queued rows first, bounded (ARCH-4). Partial index so
-- it stays small no matter how much send history accumulates.
create index if not exists broadcast_recipient_queue_idx
  on broadcast_recipient (created_at, id) where status = 'queued';
-- The aggregate recount after every batch.
create index if not exists broadcast_recipient_broadcast_idx on broadcast_recipient (broadcast_id, status);

-- ── message_suppression — opt-out / unsubscribe ──────────────────────────────
-- scope_handle NULL = platform-wide (an unsubscribe from a Zora-sent broadcast
-- means "stop messaging me", full stop). A per-organizer row only silences that
-- organizer, which is what an organizer's own unsubscribe link produces — a fan
-- opting out of one promoter's blasts has not opted out of their ticket receipts
-- or of another promoter they actually follow (plan open decision (d)).
create table if not exists message_suppression (
  id           uuid        primary key default gen_random_uuid(),
  channel      text        not null,                            -- sms | email
  address      text        not null,                            -- normalized (msisdn / lower(email))
  scope_handle text,                                            -- null = platform-wide
  reason       text,
  source       text,                                            -- unsubscribe-link | admin | bounce
  created_at   timestamptz not null default now()
);

do $$ begin
  alter table message_suppression add constraint message_suppression_channel_valid
    check (channel in ('sms', 'email'));
exception when duplicate_object then null; end $$;

-- One suppression per (channel, address, scope). coalesce() because NULL is not
-- distinct-comparable in a unique index — without it a platform-wide opt-out
-- could be inserted twice.
create unique index if not exists message_suppression_key
  on message_suppression (channel, address, coalesce(scope_handle, '*'));
-- The check every count / materialize / send does.
create index if not exists message_suppression_lookup_idx on message_suppression (channel, address);
