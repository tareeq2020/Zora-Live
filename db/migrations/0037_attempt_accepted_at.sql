-- BS159: record on the attempt row when the gateway accepted it.
--
-- Set by @zora/core initiatePayment in the same update that moves the attempt
-- to 'pending' (and on a receivable payment the provider started). An attempt
-- with accepted_at that later expires timed out at the buyer; it was never
-- refused, even when x-bridge returned no reference.
-- Nullable, no backfill: older rows stay null (cart-outcome.ts handles them).
alter table payment_transaction add column if not exists accepted_at timestamptz;

-- The "prompts are timing out" alert reads mobile attempts of the last 7 days.
create index if not exists payment_transaction_mobile_created
  on payment_transaction (created_at) where method = 'mobile';
