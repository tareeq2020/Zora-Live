-- PR-9: payment state machine + webhook + reconciliation.
-- THE money layer. Builds on PR-7's orders + PR-8's x-bridge adapter. Two tables:
--   payment_transaction — one row per attempt (H2: a fresh transaction_id per
--     attempt makes a failed/timed-out payment retryable). Its status is the local
--     mirror of the gateway's collection status; applyOutcome() drives it terminal
--     EXACTLY once (the correctness core).
--   webhook_event — the idempotency + audit sink. UNIQUE(provider, dedup_key)
--     absorbs duplicate webhook deliveries (dedup_key = sha256(rawBody)) AND
--     doubles as the ops-alert log (provider='ops-alert', see alertOps).
-- order.notified_at is the once-only claim latch for the buyer confirmation.

-- ── payment_transaction — one attempt, its money, its gateway status ─────────
create table if not exists payment_transaction (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid references "order"(id),
  transaction_id   text unique not null,       -- our attempt key (ZORA-<orderId>-<n>)
  method           text,                        -- mobile | billpay | card
  fsp_id           text,                        -- resolved FSP (CLICKPESA | SELCOM | GODIGITAL)
  amount           bigint,                      -- target to collect, TZS
  currency         text default 'TZS',
  status           text not null default 'created', -- created|pending|processing|successful|failed|partial|expired
  order_reference  text,                        -- gateway's reference (H3 resolve path)
  bill_pay_number  text,                        -- control number the payer settles later
  collected_amount bigint,                      -- what the gateway actually collected
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists payment_transaction_order_idx  on payment_transaction (order_id);
create index if not exists payment_transaction_status_idx on payment_transaction (status);
create index if not exists payment_transaction_order_ref_idx on payment_transaction (order_reference) where order_reference is not null;

-- ── webhook_event — dedup sink for provider callbacks + ops-alert log ────────
-- unique(provider, dedup_key): the SAME raw webhook body applied twice inserts
-- once (second is deduped, no re-reconcile). alertOps reuses the table with
-- provider='ops-alert' and dedup_key='<kind>:<orderId>:<detail>' (idempotent alert).
create table if not exists webhook_event (
  id             uuid primary key default gen_random_uuid(),
  provider       text,                          -- bridge | ops-alert
  dedup_key      text,
  transaction_id text,
  received_at    timestamptz not null default now(),
  applied        boolean not null default false,
  unique (provider, dedup_key)
);

-- ── order.notified_at — once-only claim for the buyer confirmation send ──────
alter table "order" add column if not exists notified_at timestamptz;
