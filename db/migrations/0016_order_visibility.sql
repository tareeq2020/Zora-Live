-- 0016_order_visibility.sql (BS43 / plan #3) — indexes for the admin
-- cart/order view. NO schema change: orders, order_item and split_share already
-- hold everything support needs (eng review: "#3 reads them").
--
-- Why indexes are the whole migration (PERF-1): every read before this one was
-- paid-only and event-scoped, so `order_event_idx` carried them. The admin view
-- is the opposite shape — it deliberately includes pending, failed, expired and
-- abandoned carts, which are the MAJORITY of rows and grow fastest, and it
-- pages by recency. `where status = $1 order by created_at desc limit 50` on an
-- unindexed status is a full scan of the largest table on the busiest support
-- screen.
--
-- The default read has a recent-window (the API applies one), so the leading
-- created_at index is what a windowed unfiltered page uses.

-- Filtered-by-status, newest first — the "show me today's failed carts" query.
create index if not exists order_status_created_idx on "order" (status, created_at desc);

-- Unfiltered page + the recent-window bound + the keyset cursor (created_at, id).
create index if not exists order_created_idx on "order" (created_at desc, id desc);

-- order(event_id) already exists as order_event_idx (0004) — the per-event
-- filter and the organizer filter (which resolves to an event id set) both use
-- it. Nothing to add.

-- The tier audience for #2 ("buyers of one tier") and the admin per-tier cart
-- filter both look up order_item by tier; only (order_id) was indexed.
create index if not exists order_item_tier_idx on order_item (product_tier_id);
