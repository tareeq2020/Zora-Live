#!/usr/bin/env bash
# BS124 seat inventory: publish a floor plan into seat rows, read availability,
# safe republish (409 when a sold seat would be removed), ownership, ETag.
# Self-contained (throwaway local Postgres; XBRIDGE_MOCK). bash 3.2 compatible.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55463}"
API_PORT="${TEST_API_PORT:-4138}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-seat-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-seatsnap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers organizers audit admin events kyc"
fail=0
cleanup() { lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA" "$SNAP"; }
trap cleanup EXIT

initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_seat
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_seat"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
BASE="http://localhost:$API_PORT"
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1 → $2"; else echo "  ✗ $1 → $2 (want $3)"; fail=1; fi; }
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);let v=o;for(const p of process.argv[1].split("."))v=v?.[p];process.stdout.write(Array.isArray(v)?String(v.length):String(v))})' "$1"; }
psqlq() { psql "$URL" -tAc "$1"; }

curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o2/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/org" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null
EV=brunch-vol-09
plan() { # rows
  echo "{\"space\":{\"w\":1600,\"h\":900},\"zones\":[{\"id\":\"lt\",\"name\":\"Long table\",\"type\":\"seated\",\"x\":0,\"y\":0,\"w\":300,\"h\":200,\"rows\":$1,\"perRow\":3,\"tierId\":\"t-lt\"},{\"id\":\"vip\",\"name\":\"VIP\",\"type\":\"table\",\"x\":0,\"y\":300,\"w\":200,\"h\":200,\"tables\":2,\"perTable\":6,\"tierId\":\"t-vip\"},{\"id\":\"ga\",\"name\":\"GA\",\"type\":\"ga\",\"x\":400,\"y\":0,\"w\":200,\"h\":200,\"capacity\":100}]}"
}
putplan() { curl -s -o /dev/null -w "%{http_code}" -b "$SNAP/org" -X PUT -H 'content-type: application/json' -d "$(plan $1)" "$BASE/api/events/$EV/floorplan"; }
pub() { curl -s -b "$1" -X POST "$BASE/api/org/events/$2/seatmap/publish" -w "\n%{http_code}"; }

echo "== 1. publish 2 rows × 3 + 2 tables =="
check "save plan" "$(putplan 2)" 200
R=$(pub "$SNAP/org" $EV); check "publish status" "$(echo "$R" | tail -1)" 200
check "seats published" "$(echo "$R" | head -1 | jget seats)" 8
check "version" "$(echo "$R" | head -1 | jget version)" 1
S=$(curl -s "$BASE/api/events/$EV/seats"); check "GET seats count" "$(echo "$S" | jget seats)" 8
check "seat ids deterministic" "$(psqlq "select string_agg(seat_id, ',' order by seat_id) from seat_inventory where event_id='$EV' and zone_id='lt'")" "lt-A1,lt-A2,lt-A3,lt-B1,lt-B2,lt-B3"
check "table seats 6" "$(psqlq "select seats_count from seat_inventory where event_id='$EV' and seat_id='vip-T1'")" 6
check "ga makes no rows" "$(psqlq "select count(*) from seat_inventory where zone_id='ga'")" 0

echo "== 2. ETag =="
ET=$(curl -s -D - -o /dev/null "$BASE/api/events/$EV/seats" | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
check "If-None-Match → 304" "$(curl -s -o /dev/null -w '%{http_code}' -H "If-None-Match: $ET" "$BASE/api/events/$EV/seats")" 304

echo "== 3. sold seat blocks removal =="
psqlq "update seat_inventory set state='sold', sold_order_id=gen_random_uuid() where event_id='$EV' and seat_id='lt-B2'" >/dev/null
check "save plan with 1 row" "$(putplan 1)" 200
R=$(pub "$SNAP/org" $EV); check "republish → 409" "$(echo "$R" | tail -1)" 409
check "conflict names B2" "$(echo "$R" | head -1 | grep -o 'lt-B2' | head -1)" lt-B2
check "nothing removed" "$(psqlq "select count(*) from seat_inventory where event_id='$EV'")" 8

echo "== 4. safe shrink once B2 is free =="
psqlq "update seat_inventory set state='available', sold_order_id=null where seat_id='lt-B2'" >/dev/null
R=$(pub "$SNAP/org" $EV); check "republish → 200" "$(echo "$R" | tail -1)" 200
check "removed 3" "$(echo "$R" | head -1 | jget removed)" 3
check "version 2" "$(echo "$R" | head -1 | jget version)" 2

echo "== 5. auth =="
check "anon publish" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/org/events/$EV/seatmap/publish")" 401
check "other org's event" "$(pub "$SNAP/org" offshore-001 | tail -1)" 404

[ "$fail" = 0 ] && echo "SEAT INVENTORY E2E: PASS" || { echo "SEAT INVENTORY E2E: FAIL"; tail -30 "$SNAP/api.log"; exit 1; }
