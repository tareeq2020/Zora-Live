-- 0025_comp_contacts.sql (BS105) — comps can carry BOTH a phone and an email, and
-- be edited + re-sent if a contact was wrong.
--
-- BS104 stored a single `contact` + `channel ('sms'|'email')`. This splits the
-- destination into discrete, editable `phone` + `email` columns (either or both),
-- so a comp delivers to both channels and an organizer can correct a mistyped
-- number/email and re-send. `channel` now also allows 'both'. The old `contact`
-- column stays (back-compat) and is backfilled into the right new column.

alter table comp add column if not exists phone text;
alter table comp add column if not exists email text;

-- Widen the channel check to include 'both' (a comp with phone AND email).
do $$ begin
  alter table comp drop constraint if exists comp_channel_valid;
exception when undefined_object then null; end $$;
do $$ begin
  alter table comp add constraint comp_channel_valid check (channel in ('sms', 'email', 'both'));
exception when duplicate_object then null; end $$;

-- Backfill existing rows: the single contact was a phone (sms) or an email.
update comp set phone = contact where channel = 'sms' and phone is null;
update comp set email = contact where channel = 'email' and email is null;
