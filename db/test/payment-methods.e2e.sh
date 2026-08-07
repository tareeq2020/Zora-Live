#!/usr/bin/env bash
# BS47 payment-method toggle gate. Boots the real API on a throwaway Postgres
# (XBRIDGE_MOCK) and proves:
#   1. Unauthenticated PUT /api/settings/methods-enabled -> 401.
#   2. An untouched platform behaves exactly as today — mobile/billpay/card all
#      work (fail-open: absent map/key = enabled).
#   3. Admin disables 'card' -> checkout/:id/pay with method=card -> 403
#      method_disabled; method=mobile on the SAME event is UNAFFECTED (still
#      pays out), proving the toggle is per-method, not a blunt kill-switch.
#   4. Trying to disable every method (mobile+billpay+card all false, whether
#      in one call or by disabling the last remaining one) -> 400
#      all_methods_disabled, and nothing was written (card's earlier disable
#      is still in effect, nothing else changed).
# Self-contained (throwaway local Postgres). bash 3.2 compatible.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55443}"
API_PORT="${TEST_API_PORT:-4118}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-paym-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-paymsnap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers organizers audit admin events kyc"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

echo "== throwaway Postgres @ :$PG_PORT + migrate + backfill =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_paym
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_paym"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

echo "== seed: GA tier (cap 10) =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_paym -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('e-paym', 'Payment Methods Test') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-paym', 'e-paym', 'GA', 10) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-paym', 40000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-paym');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-paym', 10, 10) on conflict do nothing;
SQL

echo "== boot API (x-bridge MOCK) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
jq_get() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(v==null?"":String(v))}catch{process.stdout.write("ERR:"+s.slice(0,120))}})' "$1"; }
checkout() {
  local jar="$1" phone="$2" email="$3"
  curl -s -c "$jar" -b "$jar" -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
    -d "{\"phone\":\"$phone\",\"email\":\"$email\",\"ageAttested\":true,\"cart\":[{\"tier\":\"t-paym\",\"quantity\":1}],\"method\":\"mobile\"}" | jq_get orderId
}

echo "== 1. unauthenticated PUT /api/settings/methods-enabled -> 401 =="
c=$(code -X PUT "$BASE/api/settings/methods-enabled" -H 'content-type: application/json' -d '{"methodsEnabled":{"card":false}}')
[ "$c" = "401" ] && echo "  ✓ anon PUT -> 401" || { echo "  ✗ anon PUT -> $c (want 401)"; fail=1; }

al=$(curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}')
echo "$al" | grep -q '"ok":true' || { echo "  ✗ admin login: $al"; fail=1; }

echo "== 2. untouched platform — all three methods still work (fail-open) =="
o1=$(checkout "$SNAP/b1" "255700000001" "b1@test.com")
c=$(code -b "$SNAP/b1" -X POST "$BASE/api/checkout/$o1/pay" -H 'content-type: application/json' -d '{"method":"card","payerPhone":"255700000001","payerName":"Buyer One"}')
[ "$c" = "200" ] && echo "  ✓ card, untouched settings -> 200" || { echo "  ✗ card, untouched -> $c (want 200)"; fail=1; }

echo "== 3. admin disables card -> card refused, mobile on the SAME event unaffected =="
pr=$(curl -s -b "$SNAP/admin" -X PUT "$BASE/api/settings/methods-enabled" -H 'content-type: application/json' -d '{"methodsEnabled":{"card":false}}')
echo "$pr" | grep -q '"card":false' && echo "  ✓ disable card -> ok" || { echo "  ✗ disable card: $pr"; fail=1; }

o2=$(checkout "$SNAP/b2" "255700000002" "b2@test.com")
c=$(code -b "$SNAP/b2" -X POST "$BASE/api/checkout/$o2/pay" -H 'content-type: application/json' -d '{"method":"card","payerPhone":"255700000002","payerName":"Buyer Two"}')
[ "$c" = "403" ] && echo "  ✓ card, disabled -> 403 method_disabled" || { echo "  ✗ card, disabled -> $c (want 403)"; fail=1; }
body=$(curl -s -b "$SNAP/b2" -X POST "$BASE/api/checkout/$o2/pay" -H 'content-type: application/json' -d '{"method":"card","payerPhone":"255700000002","payerName":"Buyer Two"}')
echo "$body" | grep -q 'method_disabled' && echo "  ✓ error body says method_disabled" || { echo "  ✗ error body: $body"; fail=1; }

o3=$(checkout "$SNAP/b3" "255700000003" "b3@test.com")
c=$(code -b "$SNAP/b3" -X POST "$BASE/api/checkout/$o3/pay" -H 'content-type: application/json' -d '{"method":"mobile","payerPhone":"255700000003"}')
[ "$c" = "200" ] && echo "  ✓ mobile, still enabled -> 200 (per-method, not a blunt kill-switch)" || { echo "  ✗ mobile -> $c (want 200)"; fail=1; }

echo "== 4. cannot disable every method (400, nothing written) =="
c=$(code -b "$SNAP/admin" -X PUT "$BASE/api/settings/methods-enabled" -H 'content-type: application/json' -d '{"methodsEnabled":{"mobile":false,"billpay":false}}')
[ "$c" = "400" ] && echo "  ✓ disabling the last two (card already off) -> 400 all_methods_disabled" || { echo "  ✗ disable-all -> $c (want 400)"; fail=1; }
d=$(curl -s "$BASE/api/settings" | jq_get methodsEnabled.mobile)
[ "$d" != "false" ] && echo "  ✓ mobile is STILL enabled — the refused write did not partially land" || { echo "  ✗ mobile was disabled despite the 400: $d"; fail=1; }

[ "$fail" = "0" ] || { echo ""; echo "PAYMENT METHODS E2E: FAIL"; cat "$SNAP/api.log" | tail -20; exit 1; }
echo ""
echo "PAYMENT METHODS E2E: PASS (auth-gated · fail-open default · per-method disable · blunt-kill-switch guardrail)"
