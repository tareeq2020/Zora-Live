#!/usr/bin/env bash
# PR-1 test gate: spin up a throwaway local Postgres, run the migration runner,
# assert the schema landed, and prove the runner is idempotent. Self-contained —
# needs only a local `initdb`/`pg_ctl`/`psql` (Homebrew Postgres). No Supabase.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${TEST_PG_PORT:-55432}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-pg-XXXXXX")"
USER_NAME="$(whoami)"

cleanup() { pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT

echo "== initdb (throwaway cluster @ :$PORT) =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null
pg_ctl -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PORT" -U "$USER_NAME" zora_test
URL="postgres://$USER_NAME@127.0.0.1:$PORT/zora_test"

echo "== migrate (first run) =="
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs"

echo "== assert schema =="
MIGS=$(psql "$URL" -tAc "select count(*) from schema_migrations" | tr -d '[:space:]')
TABLES=$(psql "$URL" -tAc "select count(*) from information_schema.tables where table_schema='public'" | tr -d '[:space:]')
for t in app_user organizer customer event product_tier price_version registration kyc_verification kyc_document setting theme placement floorplan media_asset agent audit_log credential; do
  ok=$(psql "$URL" -tAc "select to_regclass('public.$t') is not null" | tr -d '[:space:]')
  [ "$ok" = "t" ] || { echo "FAIL: table $t missing"; exit 1; }
done
echo "  migrations=$MIGS public_tables=$TABLES (all 17 domain tables present)"
[ "$MIGS" = "1" ] || { echo "FAIL: expected 1 applied migration, got $MIGS"; exit 1; }

echo "== migrate (idempotent re-run) =="
OUT=$(DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs")
echo "$OUT"
echo "$OUT" | grep -q "0 applied" || { echo "FAIL: re-run applied migrations again (not idempotent)"; exit 1; }

echo ""
echo "PR-1 MIGRATE TEST: PASS"
