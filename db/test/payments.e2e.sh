#!/usr/bin/env bash
# PR-9 gate: payment state machine + apply-exactly-once (real money correctness).
# Self-contained (throwaway local Postgres; no Supabase). bash 3.2 compatible.
# XBRIDGE_MOCK=true makes collection status steerable, so the harness can force the
# full failure matrix: happy, terminal-guard duplicate, duplicate-collection by a
# different txn, short, failed, paid_unseatable, and webhook dedup.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_PORT="${TEST_PG_PORT:-55437}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-pay-XXXXXX")"
USER_NAME="$(whoami)"

cleanup() { pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT

echo "== build @zora/core =="
(cd "$ROOT" && pnpm --filter "@zora/core" build >/dev/null 2>&1)

echo "== throwaway Postgres @ :$PG_PORT + migrate (0001..0005) =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_pay
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_pay"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null

echo "== seed: event + GA tier (cap 3) + price_version (65000, passed) + pool (avail 3) =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_pay -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('e-pay', 'Payments Test') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-ga', 'e-pay', 'GA', 3) on conflict do nothing;
insert into price_version (tier_id, price, currency, fee_treatment) values ('t-ga', 65000, 'TZS', 'passed');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-ga', 3, 3) on conflict do nothing;
SQL

echo "== payment failure matrix (mock x-bridge, steered collection status) =="
DATABASE_URL="$URL" TICKET_SIGNING_KEY="test-key-1,test-key-2" PG_PREPARE=false \
  XBRIDGE_MOCK=true SMS_DRIVER=mock EMAIL_DRIVER=mock \
  node "$ROOT/db/test/payments.harness.cjs"

echo ""
echo "PR-9 PAYMENTS STATE MACHINE: PASS"
