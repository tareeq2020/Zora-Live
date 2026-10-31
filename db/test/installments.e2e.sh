#!/usr/bin/env bash
# BS132 gate: installments core (Web Premium v1, F7 / A2 / A3 / A5 / A16 / A17 / A19).
# Throwaway Postgres 17 (NEVER prod), x-bridge MOCK. Two parts:
#   1. installments.harness.cjs — the money proof against @zora/core directly
#      (steerable mock collection status): plan snapshot, deposit-only charge,
#      held → reserved, no passes until paid, earnings by collected money,
#      duplicate / short / failed / late-deposit paths, seats, pay-in-full intact.
#   2. HTTP: POST /api/checkout/installments is gated server-side by the
#      zp_installments flag (403 when off) and by the event's offer; when on it
#      returns the schedule, and the deposit pay charges only the deposit.
# Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_PORT="${TEST_PG_PORT:-55531}"
API_PORT="${TEST_API_PORT:-4231}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-inst-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-instsnap-XXXXXX")"
USER_NAME="$(whoami)"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

echo "== build @zora/core + @zora/api =="
(cd "$ROOT" && pnpm --filter "@zora/core" build >/dev/null 2>&1)
(cd "$ROOT" && pnpm --filter "@zora/api" build >/dev/null 2>&1)

echo "== throwaway Postgres @ :$PG_PORT + migrate =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_inst
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_inst"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_inst -v ON_ERROR_STOP=1 -c "$1"; }

echo "== seed: event e-inst (GA 50000 passed, cap 10 · t-other · t-tiny cap 1 · seated t-seat) + offer =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_inst -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('e-inst', 'Installments Test');
insert into product_tier (id, event_id, name, capacity) values
  ('t-inst', 'e-inst', 'GA', 10), ('t-other', 'e-inst', 'VIP', 5), ('t-tiny', 'e-inst', 'Tiny', 1), ('t-seat', 'e-inst', 'Seated', 4);
insert into price_version (tier_id, price, currency, fee_treatment) values
  ('t-inst', 50000, 'TZS', 'passed'), ('t-other', 90000, 'TZS', 'passed'), ('t-tiny', 40000, 'TZS', 'passed'), ('t-seat', 30000, 'TZS', 'passed');
insert into inventory_pool (product_tier_id, capacity, available_count) values
  ('t-inst', 10, 10), ('t-other', 5, 5), ('t-tiny', 1, 1), ('t-seat', 4, 4);
insert into seat_inventory (event_id, seat_id, zone_id, kind, label, row_label, seat_number, tier_id, layout_version) values
  ('e-inst', 'z1-A1', 'z1', 'seat', 'A1', 'A', 1, 't-seat', 1), ('e-inst', 'z1-A2', 'z1', 'seat', 'A2', 'A', 2, 't-seat', 1),
  ('e-inst', 'z1-A3', 'z1', 'seat', 'A3', 'A', 3, 't-seat', 1), ('e-inst', 'z1-A4', 'z1', 'seat', 'A4', 'A', 4, 't-seat', 1);
insert into installment_config (event_id, enabled, tiers, deposit_pct, count, frequency, final_due_days_before_event, grace_days)
values ('e-inst', true, '{t-inst,t-tiny,t-seat}', 30, 3, 'monthly', 7, 3);
insert into collection_store (name, data) values
  ('events', '[{"id":"e-inst","organizerHandle":"inst-org","date":"2027-02-20"}]'),
  ('settings', '{"flags":{}}')
on conflict (name) do update set data = excluded.data;
SQL

HAS=$(psql_one "select count(*) from pg_proc where proname in ('convert_order_holds_to_reservation','try_reserve_order')")
[ "$HAS" = "2" ] && echo "  ✓ 0031: convert_order_holds_to_reservation + try_reserve_order exist" || { echo "  ✗ 0031 functions missing ($HAS)"; fail=1; }
BAD=$(psql_one "insert into installment_config (event_id, deposit_pct, count) values ('x', 30, 7)" 2>&1 || true)
echo "$BAD" | grep -q 'installment_config_count_range' && echo "  ✓ CHECK rejects an offer with 7 payments" || { echo "  ✗ count CHECK missing: $BAD"; fail=1; }

echo "== 1. core harness (mock x-bridge, steered collection status) =="
DATABASE_URL="$URL" TICKET_SIGNING_KEY="test-key-1,test-key-2" PG_PREPARE=false \
  XBRIDGE_MOCK=true SMS_DRIVER=mock EMAIL_DRIVER=mock \
  node "$ROOT/db/test/installments.harness.cjs" || fail=1

echo "== 2. HTTP: flag gate + offer gate + deposit-only charge =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$ROOT/apps/api" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key SMS_DRIVER=mock EMAIL_DRIVER=mock \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
BASE="http://localhost:$API_PORT"
jq_get() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(v==null?"":Array.isArray(v)?String(v.length):String(v))}catch{process.stdout.write("ERR:"+s.slice(0,120))}})' "$1"; }
co_inst() { # tier qty → writes body to $SNAP/co, prints HTTP code
  curl -s -o "$SNAP/co" -w '%{http_code}' -c "$SNAP/jar" -X POST "$BASE/api/checkout/installments" -H 'content-type: application/json' \
    -d "{\"phone\":\"0712000001\",\"email\":\"i@example.com\",\"ageAttested\":true,\"cart\":[{\"tier\":\"$1\",\"quantity\":$2}]}"
}

CODE=$(co_inst t-inst 1)
[ "$CODE" = "403" ] && grep -q '"installments_disabled"' "$SNAP/co" \
  && echo "  ✓ flag OFF → 403 installments_disabled" || { echo "  ✗ flag off: HTTP $CODE $(cat "$SNAP/co")"; fail=1; }

psql_one "update collection_store set data = '{\"flags\":{\"zp_installments\":{\"orgs\":[\"inst-org\"]}}}' where name = 'settings'" >/dev/null
CODE=$(co_inst t-other 1)
[ "$CODE" = "403" ] && grep -q '"installments_not_offered"' "$SNAP/co" \
  && echo "  ✓ flag ON, tier outside the offer → 403 installments_not_offered" || { echo "  ✗ not offered: HTTP $CODE $(cat "$SNAP/co")"; fail=1; }

CODE=$(co_inst t-inst 1)
ORDER=$(jq_get orderId < "$SNAP/co"); DEP=$(jq_get installments.deposit < "$SNAP/co"); ROWS=$(jq_get installments.schedule < "$SNAP/co")
[ "$CODE" = "200" ] && [ -n "$ORDER" ] && [ "$ROWS" = "3" ] \
  && echo "  ✓ flag ON (org rule) → 200, order $ORDER, 3-row schedule, deposit $DEP" || { echo "  ✗ flag on: HTTP $CODE $(cat "$SNAP/co")"; fail=1; }
ST=$(psql_one "select status from \"order\" where id = '$ORDER'")
[ "$ST" = "pending" ] && echo "  ✓ order pending until the deposit clears" || { echo "  ✗ order status $ST"; fail=1; }

PAY=$(curl -s -b "$SNAP/jar" -X POST "$BASE/api/checkout/$ORDER/pay" -H 'content-type: application/json' -d '{"method":"mobile","payerPhone":"0712000001"}')
TXN=$(echo "$PAY" | jq_get transactionId)
AMT=$(psql_one "select amount from payment_transaction where transaction_id = '$TXN'")
[ -n "$TXN" ] && [ "$AMT" = "$DEP" ] && echo "  ✓ deposit pay charges $AMT (the deposit), not the order total" || { echo "  ✗ pay: $PAY amount=$AMT dep=$DEP"; fail=1; }
CODE=$(curl -s -o "$SNAP/p2" -w '%{http_code}' -b "$SNAP/jar" -X POST "$BASE/api/checkout/$ORDER/pay" -H 'content-type: application/json' -d '{"method":"mobile","payerPhone":"0712000001"}')
[ "$CODE" = "409" ] && grep -q 'installment_attempt_in_flight' "$SNAP/p2" \
  && echo "  ✓ second pay-now while in flight → 409 installment_attempt_in_flight" || { echo "  ✗ double pay: HTTP $CODE $(cat "$SNAP/p2")"; fail=1; }
CODE=$(curl -s -o "$SNAP/p3" -w '%{http_code}' -X POST "$BASE/api/checkout/$ORDER/pay" -H 'content-type: application/json' -d '{"method":"mobile","payerPhone":"0712000001","scheduleN":"x"}')
[ "$CODE" = "400" ] && echo "  ✓ junk scheduleN → 400" || { echo "  ✗ junk scheduleN: HTTP $CODE"; fail=1; }

# Flag back OFF stops new plans immediately (no cache).
psql_one "update collection_store set data = '{\"flags\":{\"zp_installments\":{\"on\":true,\"offOrgs\":[\"inst-org\"]}}}' where name = 'settings'" >/dev/null
CODE=$(co_inst t-inst 1)
[ "$CODE" = "403" ] && echo "  ✓ org switched off (offOrgs beats on) → 403 at once" || { echo "  ✗ off again: HTTP $CODE $(cat "$SNAP/co")"; fail=1; }

[ "$fail" = "0" ] || { echo ""; echo "INSTALLMENTS E2E: FAIL"; tail -30 "$SNAP/api.log"; exit 1; }
echo ""
echo "BS132 INSTALLMENTS E2E: PASS"
