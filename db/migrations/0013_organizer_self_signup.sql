-- 0013_organizer_self_signup.sql (BS41 / #4 + #5) — organizer SELF-REGISTRATION.
--
-- Until now every organizer arrived by hand: a row seeded by 0009 or created by
-- staff, always `status:'active'`. #4 lets an organizer sign themselves up over
-- phone-OTP, which means the table has to carry two new facts it never held:
--
--   source  — WHERE the row came from. 'self-signup' marks a row nobody at Zora
--             vouched for yet, so the #5 verification queue can list it distinctly
--             from the seeded/staff-created orgs (design-review spec: "name ·
--             handle · self-signup marker · submitted-at"). NULL = pre-existing /
--             admin-created, which keeps GET /api/organizers byte-identical to the
--             golden fixture (publicOrganizer only emits `source` when set).
--   phone   — the MSISDN that was actually proven by SMS-OTP at registration. This
--             is the ONLY identity a self-signed-up org has (no password is
--             required, no email is collected), so it is what support and the
--             verification reviewer key on. Consumer-canonical shape (255XXXXXXXXX,
--             matching apps/api/src/common/phone.ts) so one human is one identity
--             across the buyer and organizer sides.
--
-- The remaining three columns are the DECISION record for #5. Verification reuses
-- the existing KYC vocabulary (kyc_status + the KYC_REASONS codes) rather than
-- inventing a parallel "verification" concept — one queue, one set of words — but
-- kyc_status alone cannot answer "why was this org rejected, by whom, when?", and
-- the collection_store `kyc` blob can't hold it either because a self-signup has
-- no document submission to attach to.
--
-- NOT enforced here: a UNIQUE on phone. One person legitimately runs more than one
-- brand, and the OTP request throttle (3/min/phone) already bounds abuse. Handle
-- uniqueness — the thing that actually collides — is already a database UNIQUE
-- from 0001, so a signup race ends in a constraint violation, not a duplicate.

alter table organizer add column if not exists source              text;         -- null | 'self-signup'
alter table organizer add column if not exists phone               text;         -- verified MSISDN, 255XXXXXXXXX
alter table organizer add column if not exists reviewed_at         timestamptz;  -- when a Zora admin decided
alter table organizer add column if not exists reviewed_by         text;         -- who decided (admin)
alter table organizer add column if not exists verification_reason text;         -- KYC_REASONS code + optional note, on reject

-- The verification queue reads "self-signups, oldest first". Tiny table today, but
-- the queue is polled by the admin console and this keeps it an index scan.
create index if not exists organizer_source_idx on organizer (source, created_at)
  where source is not null;
