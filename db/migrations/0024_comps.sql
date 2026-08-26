-- 0024_comps.sql (BS104) — COMPLIMENTARY passes (comps).
--
-- The Comps surface shipped as a UI stub (no backend): issuing a comp only faked
-- delivery in the browser, so no ticket was created and no SMS/email was sent.
-- This is the record side of the real feature. A comp is issued as an ORDER at
-- price 0 (type='comp', status='paid') so it flows through the SAME pipeline paid
-- tickets use — credentials, SMS+email delivery, scanning, and the BS59 resend —
-- and, because the seat is really SOLD (convert_holds), it DRAWS DOWN the event's
-- real capacity just like a paid ticket. Revenue is untouched (unit_price = 0).
--
-- This table is the organizer-facing ledger: who a comp went to, on what channel,
-- and whether it landed — the order_id ties back to the ticket/credentials.

create table if not exists comp (
  id               uuid primary key default gen_random_uuid(),
  -- the $0 order behind the comp (credentials/delivery/resend hang off this).
  order_id         uuid not null references "order"(id) on delete cascade,
  organizer_handle text        not null,                 -- the issuing org (acting handle)
  recipient_name   text        not null,
  contact          text        not null,                 -- phone or email, as entered
  channel          text        not null,                 -- 'sms' | 'email'
  event_id         text        not null,
  event_name       text        not null,                 -- snapshot for the list
  tier_name        text        not null,                 -- snapshot for the list
  qty              int         not null check (qty > 0),
  delivery         text        not null default 'pending', -- 'delivered' | 'failed' | 'pending'
  issued_at        timestamptz not null default now()
);

do $$ begin
  alter table comp add constraint comp_channel_valid check (channel in ('sms', 'email'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table comp add constraint comp_delivery_valid check (delivery in ('delivered', 'failed', 'pending'));
exception when duplicate_object then null; end $$;

-- The organizer's comps list: WHERE organizer_handle = $1 ORDER BY issued_at DESC.
create index if not exists comp_org_idx on comp (organizer_handle, issued_at desc);
