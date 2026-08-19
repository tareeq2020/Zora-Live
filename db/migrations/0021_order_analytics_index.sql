-- 0021_order_analytics_index.sql (BS70 / dashboard-redesign #8, Lane D) — the
-- index the dashboard analytics query needs. NO schema change: the analytics
-- endpoint reads the existing "order" table (revenue nets via the already-stamped
-- order.commission_rate, migration 0010) — this only adds the access path.
--
-- The analytics read is time-bucketed and scope-filtered: it walks a date range
-- for a set of owned event ids and separates paid orders from started ones
--   ... where created_at >= $from and event_id = any($ownedIds) [and status = …]
-- Existing indexes don't cover this shape: order_created_idx (0016) leads on
-- created_at but drops event_id/status; order_event_idx (0004) leads on event_id
-- with no time bound; order_status_created_idx (0016) leads on status. A leading
-- created_at with status + event_id trailing lets the range scan stay bounded to
-- the window and still filter the scope/status without a heap visit per row.
--
-- Additive and idempotent (create index if not exists) — never rewrites a public
-- read path. Built against the SESSION/direct connection like every migration.
create index if not exists order_created_status_event_idx
  on "order" (created_at, status, event_id);
