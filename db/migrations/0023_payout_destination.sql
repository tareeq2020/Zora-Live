-- 0023_payout_destination.sql (BS98) — WHERE a withdrawal is paid.
--
-- The v1 payout ledger (0012) recorded amount + currency + a freetext note. That
-- is not a clean record: an admin settling by hand had to read a note like
-- "M-Pesa 0712…" and guess the operator. This adds a STRUCTURED destination the
-- organizer picks at request time — method (mobile money | bank), the provider
-- (a canonical MNO or bank code from packages/core/src/fsp-registry.ts, which
-- mirrors the x-bridge gateway registry), and the receiving account — so the
-- record maps straight onto the gateway's payout DTOs when settlement is
-- automated later.
--
-- All columns are NULLABLE: existing rows (and the constraint below) stay valid,
-- and `dest_method` is the presence flag core reads to rebuild the object. New
-- requests are required to carry a valid destination in application code
-- (core `requestPayout` → `destination_invalid`), not by a NOT NULL that would
-- reject the historical rows.

alter table payout add column if not exists dest_method        text;  -- 'mobile_money' | 'bank'
alter table payout add column if not exists dest_provider      text;  -- canonical code: MPESA / CRDB / …
alter table payout add column if not exists dest_provider_name text;  -- display snapshot at request time
alter table payout add column if not exists dest_account       text;  -- phone (momo) or bank account number
alter table payout add column if not exists dest_account_name  text;  -- account holder (required for bank)

-- Guard the shape when a destination IS present: a known method, and — because
-- the bank rail requires a beneficiary name — a bank destination must name the
-- holder. Rows with no destination (legacy) skip the check entirely.
do $$ begin
  alter table payout add constraint payout_dest_method_valid
    check (dest_method is null or dest_method in ('mobile_money', 'bank'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table payout add constraint payout_dest_bank_named
    check (dest_method is distinct from 'bank' or dest_account_name is not null);
exception when duplicate_object then null; end $$;
