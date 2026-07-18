-- 0002 — collection blob store.
-- Phase-A durable storage for the current JSON collections. `data` is the exact
-- JSON TEXT (not jsonb) so JSON.parse -> res.json reproduces byte-identical API
-- output (jsonb would reorder keys / normalize numbers and break the golden diff).
-- The relational tables in 0001 stay the target for Phase-B features; the launch
-- data lives here, one row per collection.
create table if not exists collection_store (
  name text primary key,
  data text not null,
  updated_at timestamptz not null default now()
);
