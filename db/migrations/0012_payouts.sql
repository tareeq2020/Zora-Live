-- 0012_payouts.sql (BS38 / plan #7) — the WITHDRAWAL ledger.
--
-- Settlement is OUT-OF-BAND: an organizer requests an amount, a Zora admin pays
-- it by bank transfer or mobile money and records the reference here. There is
-- no gateway payout and no automatic FX — a non-settlement currency gets the
-- rate the admin actually used, typed in at confirm time (eng review OV7).
--
-- This table is the DEBIT side of the balance:
--   available = Σ stamped net of paid orders − Σ refunded − Σ payouts NOT rejected
-- so a `requested` row RESERVES its amount the instant it is inserted. That is
-- what stops two concurrent withdrawals from each seeing the full balance and
-- between them taking out more than the organizer earned (eng review ARCH-2).
-- The reservation only works because request = "compute balance AND insert" in
-- ONE transaction under a per-organizer advisory lock; see
-- packages/core/src/payouts.ts.
--
-- State machine (v1): requested → approved (= paid, money has left) | rejected
-- (the amount returns to available). A decided payout is terminal — there is no
-- edit path, because the money has already moved in the real world.

create table if not exists payout (
  id               uuid primary key default gen_random_uuid(),
  -- Keyed on the HANDLE, not the slug id: handle is the organizer identity the
  -- whole org surface is scoped by (session.organizerHandle, event.organizerHandle)
  -- and it is UNIQUE in `organizer`, so this is a real foreign key, not a label.
  organizer_handle text        not null references organizer(handle),
  amount           bigint      not null check (amount > 0),   -- whole units, like every money column
  currency         text        not null,                      -- ISO-4217; balances never mix (I7)
  status           text        not null default 'requested',  -- requested | approved | rejected
  requested_at     timestamptz not null default now(),
  decided_at       timestamptz,
  decided_by       text,                                      -- the admin principal ('admin' today)
  reference        text,                                      -- bank / momo transfer reference (approve)
  fx_note          text,                                      -- rate + settlement currency, by hand (OV7)
  note             text,                                      -- organizer's note on request
  reason           text,                                      -- why it was rejected (shown to the organizer)
  created_at       timestamptz not null default now()
);

do $$ begin
  alter table payout add constraint payout_status_valid
    check (status in ('requested', 'approved', 'rejected'));
exception when duplicate_object then null; end $$;

-- A decided payout must say who decided it and when — an approved row with no
-- reference or no decider is money that left with no audit trail.
do $$ begin
  alter table payout add constraint payout_decided_complete
    check (status = 'requested' or (decided_at is not null and decided_by is not null));
exception when duplicate_object then null; end $$;

-- The balance query and the admin queue are the only two reads that matter:
--   balance  → WHERE organizer_handle = $1 AND status <> 'rejected'  (per currency)
--   queue    → WHERE status = 'requested' ORDER BY requested_at
create index if not exists payout_org_status_idx on payout (organizer_handle, status);
create index if not exists payout_status_requested_idx on payout (status, requested_at);
