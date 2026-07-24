#!/usr/bin/env bash
# PR-BS4 gate: the bill-split money flow + failure matrix (real correctness).
# Self-contained throwaway Postgres; XBRIDGE_MOCK steers each share's collection.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_PORT="${TEST_PG_PORT:-55439}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-splitflow-XXXXXX")"
USER_NAME="$(whoami)"

cleanup() { pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT

echo "== build @zora/core =="
(cd "$ROOT" && pnpm --filter "@zora/core" build >/dev/null 2>&1)

echo "== throwaway Postgres @ :$PG_PORT + migrate (0001..0007) =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_splitflow
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_splitflow"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null

echo "== seed: event + split-enabled table tier (price 100000, uneven /3) + pool (5) =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_splitflow -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('e-sf', 'Split Flow Test') on conflict do nothing;
insert into product_tier (id, event_id, name, kind, capacity, split_enabled, split_window_secs)
  values ('t-tbl', 'e-sf', 'VIP Table', 'table', 5, true, 2700) on conflict do nothing;
insert into price_version (tier_id, price, currency, fee_treatment) values ('t-tbl', 100000, 'TZS', 'included');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-tbl', 5, 5) on conflict do nothing;
SQL

echo "== bill-split flow + failure matrix (mock x-bridge) =="
DATABASE_URL="$URL" TICKET_SIGNING_KEY="test-key-1,test-key-2" SESSION_SECRET="test-secret" PG_PREPARE=false \
  XBRIDGE_MOCK=true SMS_DRIVER=mock EMAIL_DRIVER=mock \
  node "$ROOT/db/test/split.harness.cjs"

echo ""
echo "PR-BS4 BILL-SPLIT FLOW: PASS"
