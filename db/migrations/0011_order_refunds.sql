-- 0011_order_refunds.sql (BS35 / eng-review OV1) — the DEBIT side of the ledger.
--
-- Money leak this closes: once an order reached 'paid' nothing could ever take it
-- back out of the organizer's earnings, so refunded money stayed withdrawable
-- forever. That is now recorded on the order itself — the same row org-sales
-- reads — so earnings fall the moment a refund is booked.
--
--   status='refunded'     the whole order was repaid (drops out of paid revenue)
--   refunded_amount > 0   partial refund; the order stays 'paid' and only the
--                         repaid portion is netted out of earnings
--
-- `status` stays free text with a commented value set (matching 0004/0005/0006):
--   pending | paid | failed | expired | cancelled | paid_unseatable |
--   payment_short | refunded
alter table "order" add column if not exists refunded_amount bigint not null default 0;
alter table "order" add column if not exists refunded_at     timestamptz;
do $$ begin
  alter table "order" add constraint order_refunded_amount_nonneg check (refunded_amount >= 0);
exception when duplicate_object then null; end $$;

-- Split seats carry no order_item — their money is split_share.amount — so a
-- refunded seat must be visible on the share too, or the split-revenue union in
-- org-sales would keep counting a repaid seat as live revenue. This is what makes
-- the `refund_pending` worklist (0006/0007) actually settle: ops books the refund
-- and the money leaves the organizer's balance.
--   state: unclaimed | claimed | paid | voided | refunded
alter table split_share add column if not exists refunded_at timestamptz;
