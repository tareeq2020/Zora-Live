-- BS157: keep what x-bridge actually tells us, so a failed cart can say why.
--
-- All columns are nullable and written best-effort by @zora/core
-- (gateway-capture.ts): a failed write never touches the payment state machine.
-- Bodies are sanitized before they are stored (no tokens, secrets or signatures;
-- phone numbers masked) and capped at about 8 KB. No backfill: older rows stay null.

-- The callback body, as received (sanitized).
alter table webhook_event add column if not exists payload jsonb;

-- The last status-read body, saved only when its status changes.
alter table payment_transaction add column if not exists gateway_status jsonb;
alter table payment_transaction add column if not exists gateway_status_at timestamptz;

-- A short reason pulled from a callback or status body, when one is present.
alter table payment_transaction add column if not exists failure_reason text;
