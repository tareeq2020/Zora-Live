#!/usr/bin/env bash
# End-to-end HTTP checkout gate: boots the real API on a throwaway Postgres with
# the x-bridge MOCK gateway and walks the buyer contract — POST /api/checkout →
# POST /api/checkout/:id/pay → GET /api/orders/:id/status → paid + signed QR
# credentials. Proves the whole payments stack front-to-back offline. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_PORT="${TEST_PG_PORT:-55436}"
API_PORT="${TEST_API_PORT:-4111}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-co-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-cosnap-XXXXXX")"
USER_NAME="$(whoami)"

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

echo "== throwaway Postgres @ :$PG_PORT + migrate (0001..0005) + seed a tier =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_co
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_co"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_co -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('e-http', 'HTTP Test Event') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-http', 'e-http', 'GA', 5) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-http', 65000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-http');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-http', 5, 5) on conflict do nothing;
SQL

echo "== boot API (x-bridge MOCK) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$ROOT/apps/api" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

jq_get() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(v==null?"":Array.isArray(v)?String(v.length):String(v))}catch{process.stdout.write("ERR:"+s.slice(0,120))}})' "$1"; }

echo "== 1. POST /api/checkout (2 × GA) =="
CO=$(curl -s -c "$SNAP/jar" -X POST "http://localhost:$API_PORT/api/checkout" -H 'content-type: application/json' \
  -d '{"phone":"0712345678","email":"buyer@example.com","ageAttested":true,"cart":[{"tier":"t-http","quantity":2}],"method":"mobile"}')
ORDER=$(echo "$CO" | jq_get orderId); TOTAL=$(echo "$CO" | jq_get total)
[ -n "$ORDER" ] && [ "$ORDER" != "ERR"* ] || { echo "FAIL checkout: $CO"; exit 1; }
echo "  ✓ order $ORDER · total $TOTAL (subtotal 130000 + fee)"

echo "== 2. POST /api/checkout/$ORDER/pay (mobile) =="
PAY=$(curl -s -b "$SNAP/jar" -X POST "http://localhost:$API_PORT/api/checkout/$ORDER/pay" -H 'content-type: application/json' \
  -d '{"method":"mobile","payerPhone":"0712345678"}')
TXN=$(echo "$PAY" | jq_get transactionId); PSTATUS=$(echo "$PAY" | jq_get status)
[ -n "$TXN" ] || { echo "FAIL pay: $PAY"; exit 1; }
echo "  ✓ transaction $TXN · status $PSTATUS (PIN push, mock)"

echo "== 3. GET /api/orders/$ORDER/status (self-reconciles → mock COMPLETED) =="
FINAL=""
for i in $(seq 1 8); do
  ST=$(curl -s -b "$SNAP/jar" "http://localhost:$API_PORT/api/orders/$ORDER/status")
  S=$(echo "$ST" | jq_get status); CREDS=$(echo "$ST" | jq_get credentials)
  if [ "$S" = "paid" ]; then FINAL="$ST"; break; fi
  sleep 1
done
[ -n "$FINAL" ] || { echo "FAIL: order never reached paid. last: $ST"; exit 1; }
CREDS=$(echo "$FINAL" | jq_get credentials)
QR0=$(echo "$FINAL" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);process.stdout.write(o.credentials?.[0]?.qr||"")})')
echo "  ✓ status paid · $CREDS credentials issued"
[ "$CREDS" = "2" ] || { echo "FAIL: expected 2 credentials, got $CREDS"; exit 1; }
case "$QR0" in zora:*:*) echo "  ✓ credential QR is a signed zora:<code>:<sig> payload";; *) echo "FAIL: bad QR '$QR0'"; exit 1;; esac

echo ""
echo "CHECKOUT HTTP E2E: PASS (checkout → pay → paid → 2 signed-QR credentials)"
