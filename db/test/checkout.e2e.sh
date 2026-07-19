#!/usr/bin/env bash
# PR-7 gate: order creation + checkout write path. Self-contained (throwaway local
# Postgres; no Supabase). bash 3.2 compatible. Proves: happy-path order + hold +
# price snapshot, all-or-nothing rollback on sold-out (holds released, no partial
# rows), idempotent credential issuance, and try_reacquire_order all-or-nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_PORT="${TEST_PG_PORT:-55436}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-chk-XXXXXX")"
USER_NAME="$(whoami)"

cleanup() { pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT

echo "== build @zora/core =="
(cd "$ROOT" && pnpm --filter "@zora/core" build >/dev/null 2>&1)

echo "== throwaway Postgres @ :$PG_PORT + migrate (0001..0004) =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_chk
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_chk"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null

echo "== seed: event + GA tier (cap 2) + price_version (65000, passed) + pool (avail 2) =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_chk -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('e-chk', 'Checkout Test') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-ga', 'e-chk', 'GA', 2) on conflict do nothing;
insert into price_version (tier_id, price, currency, fee_treatment) values ('t-ga', 65000, 'TZS', 'passed');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-ga', 2, 2) on conflict do nothing;
SQL

echo "== order / rollback / credentials / reacquire =="
DATABASE_URL="$URL" TICKET_SIGNING_KEY="test-key-1,test-key-2" PG_PREPARE=false \
  node "$ROOT/db/test/checkout.harness.cjs"

echo ""
echo "PR-7 ORDERS + CHECKOUT: PASS"
