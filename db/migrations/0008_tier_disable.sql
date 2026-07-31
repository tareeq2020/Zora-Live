-- 0008_tier_disable.sql (BS23) — an organizer can DISABLE a ticket tier: stop new
-- sales and hide it from the storefront WITHOUT deleting it. Reversible (re-enable
-- from the drop editor). Deleting a tier outright stays allowed only when it has no
-- orders / splits / credentials (enforced in the org API, since product_tier is
-- referenced without ON DELETE CASCADE by order_item, table_split, and credential).
--
-- The dormant product_tier.status column (open|locked|soldout, never read) is left
-- untouched to avoid overloading its meaning; `disabled` is an explicit, orthogonal
-- flag that both the checkout paths (@zora/core) and the storefront read against.
alter table product_tier
  add column if not exists disabled boolean not null default false;
