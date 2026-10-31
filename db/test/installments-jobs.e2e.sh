#!/usr/bin/env bash
# BS135 gate: installment worker jobs — reminders (SMS + email: 3 days before,
# on the due date, once on miss; ≤1 per order per day; idempotent) and the
# locked default close (A18: lock → closing → reconcile in-flight → complete or
# release + installment_defaulted + refund owed minus the service fee, once).
# Throwaway Postgres 17 (NEVER prod), x-bridge + SMS + email MOCK. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_PORT="${TEST_PG_PORT:-55535}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-instj-XXXXXX")"
USER_NAME="$(whoami)"

cleanup() { pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT

echo "== build @zora/core + typecheck @zora/worker =="
(cd "$ROOT" && pnpm --filter "@zora/core" build >/dev/null 2>&1)
(cd "$ROOT/apps/worker" && npx tsc --noEmit -p tsconfig.json)

echo "== throwaway Postgres @ :$PG_PORT + migrate =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_instj
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_instj"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null

psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_instj -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('e-job', 'Jobs Test');
insert into product_tier (id, event_id, name, capacity) values ('t-job', 'e-job', 'GA', 30);
insert into price_version (tier_id, price, currency, fee_treatment) values ('t-job', 40000, 'TZS', 'passed');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-job', 30, 30);
insert into seat_inventory (event_id, seat_id, zone_id, kind, label, row_label, seat_number, tier_id, layout_version)
values ('e-job', 's-1', 'z', 'seat', 'A1', 'A', 1, 't-job', 1);
insert into installment_config (event_id, enabled, deposit_pct, count, frequency, final_due_days_before_event, grace_days)
values ('e-job', true, 30, 3, 'weekly', 7, 2);
SQL

echo "== jobs harness (simulated clock) =="
DATABASE_URL="$URL" TICKET_SIGNING_KEY="test-key-1" PG_PREPARE=false XBRIDGE_MOCK=true SMS_DRIVER=mock EMAIL_DRIVER=mock \
  node "$ROOT/db/test/installments-jobs.harness.cjs"

echo ""
echo "BS135 INSTALLMENT JOBS E2E: PASS"
