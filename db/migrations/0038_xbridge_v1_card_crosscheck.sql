-- BS166: x-bridge /v1 card checkout + the payment cross-check job.
--
-- Card attempts (provider = 'xbridge_v1c') keep the hosted card page and its
-- expiry, so a buyer who comes back to /pay/<order> can reopen the same page
-- instead of starting a second checkout.
alter table payment_transaction add column if not exists payment_url text;
alter table payment_transaction add column if not exists payment_url_expires_at timestamptz;

-- The cross-check job re-asks x-bridge about finished-but-unpaid attempts
-- (expired, failed) for 7 days, backing off as they age. These two columns
-- are its schedule: when it last asked, and how many times.
alter table payment_transaction add column if not exists gateway_checked_at timestamptz;
alter table payment_transaction add column if not exists gateway_check_count integer not null default 0;

create index if not exists payment_transaction_recheck
  on payment_transaction (created_at)
  where status in ('expired', 'failed');

-- One row per cross-check run, for the admin page and for "is the job alive".
create table if not exists gateway_crosscheck_run (
  id           bigserial primary key,
  kind         text not null,               -- 'recheck' (our unpaid attempts) | 'list' (x-bridge's list, 72 h)
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  checked      integer not null default 0,  -- attempts or rows looked at
  settled      integer not null default 0,  -- attempts our records changed for
  flagged      integer not null default 0,  -- sent to Needs attention
  errors       integer not null default 0,  -- reads that failed (retried next run)
  complete     boolean not null default true, -- false when the list was cut short
  detail       jsonb
);
create index if not exists gateway_crosscheck_run_kind_started on gateway_crosscheck_run (kind, started_at desc);
