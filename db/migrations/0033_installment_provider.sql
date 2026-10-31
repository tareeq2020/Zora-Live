-- BS133: installment provider adapter (x-bridge /v1 receivables, mock until R3).
--
-- payment_transaction.provider names the rail an attempt went out on:
--   NULL          the /collection/* API (every pay-in-full attempt, and
--                 installment attempts while XBRIDGE_V1 is off) — reconciled by
--                 polling /collection/status as before.
--   'xbridge_v1'  a pay against an x-bridge /v1 receivable — settled by the signed
--                 receivable webhooks; never polled through /collection/status
--                 (x-bridge does not know these ids there).
alter table payment_transaction add column if not exists provider text;
create index if not exists payment_transaction_recent_mobile
  on payment_transaction (order_id, created_at) where method = 'mobile' and schedule_n is not null;
