-- 0027_gate_sales.sql (BS107 / #184) — event-day (gate/box-office) selling.
--
-- A door person can now SELL a walk-up a ticket and hand them a valid pass on the
-- spot. A gate sale is a real order (real revenue, real inventory) — cash settles
-- immediately, mobile goes through the existing x-bridge STK-push + webhook path.
-- The same door-staff identity (scanner_user) does both scanning and selling.
--
-- `can_sell` is orthogonal to role (agent|supervisor) so ONE person scans AND
-- sells with ONE code. Orders gain `sold_by` (the seller) + `channel` so on-site
-- sales are attributable and reconcilable (per-seller cash owed at settlement).

alter table scanner_user add column if not exists can_sell boolean not null default false;

alter table "order" add column if not exists sold_by text;                              -- scanner_user.id (gate seller); NULL = online self-serve
alter table "order" add column if not exists channel  text not null default 'online';   -- online | gate_cash | gate_mobile
create index if not exists order_soldby_idx on "order" (sold_by) where sold_by is not null;
