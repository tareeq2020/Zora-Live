#!/usr/bin/env bash
# PR-3 gate: prove the file->Postgres flip is byte-identical.
# For a batch of collections: snapshot each read endpoint on the JSON backend,
# backfill into Postgres, snapshot again on the PG backend, and diff. Any byte
# difference fails. Self-contained (throwaway local Postgres; no Supabase).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_PORT="${TEST_PG_PORT:-55433}"
API_PORT="${TEST_API_PORT:-4108}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-pg-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-snap-XXXXXX")"
USER_NAME="$(whoami)"
FLAG="pg:settings|tiers|placements|theme"
PATHS=(/api/settings /api/tiers /api/placements /api/storefront-theme)

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

echo "== throwaway Postgres @ :$PG_PORT =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_test
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_test"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null

boot_and_snapshot() {
  local tag="$1"; shift   # remaining args = extra env
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.5
  ( cd "$ROOT/apps/api" && env PORT="$API_PORT" ZORA_DATA_DIR="$ROOT/data" "$@" node dist/main.js ) >"$SNAP/api-$tag.log" 2>&1 &
  for i in $(seq 1 25); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
  for p in "${PATHS[@]}"; do curl -s "http://localhost:$API_PORT$p" > "$SNAP/${tag}${p//\//_}"; done
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.5
}

echo "== snapshot JSON backend =="
boot_and_snapshot json

echo "== backfill -> Postgres =="
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" settings tiers placements theme

echo "== snapshot PG backend =="
boot_and_snapshot pg DATABASE_URL="$URL" DATA_BACKEND="$FLAG" PG_PREPARE=false

echo "== golden diff =="
fail=0
for p in "${PATHS[@]}"; do
  f="${p//\//_}"
  if diff -q "$SNAP/json$f" "$SNAP/pg$f" >/dev/null; then
    echo "  ✓ $p  ($(wc -c < "$SNAP/json$f" | tr -d ' ') bytes, byte-identical)"
  else
    echo "  ✗ $p  DIFFERS"; diff "$SNAP/json$f" "$SNAP/pg$f" | head -6; fail=1
  fi
done
[ "$fail" = "0" ] || { echo ""; echo "PR-3 GOLDEN DIFF: FAIL"; exit 1; }
echo ""
echo "PR-3 GOLDEN DIFF: PASS (json == pg for all $(echo ${#PATHS[@]}) endpoints)"
