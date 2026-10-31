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

echo "== 1b. buyers read the PUBLISHED plan (BS143) =="
check "published plan v1" "$(curl -s "$BASE/api/events/$EV/seatmap" | jget publishedVersion)" 1
check "unpublished event → 404" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/events/offshore-001/seatmap")" 404
echo "== 2. ETag =="
ET=$(curl -s -D - -o /dev/null "$BASE/api/events/$EV/seats" | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
check "If-None-Match → 304" "$(curl -s -o /dev/null -w '%{http_code}' -H "If-None-Match: $ET" "$BASE/api/events/$EV/seats")" 304

echo "== 3. sold seat blocks removal =="
psqlq "update seat_inventory set state='sold', sold_order_id=gen_random_uuid() where event_id='$EV' and seat_id='lt-B2'" >/dev/null
check "save plan with 1 row" "$(putplan 1)" 200
check "draft edit does not reach buyers" "$(curl -s "$BASE/api/events/$EV/seatmap" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const z=JSON.parse(s).zones.find(z=>z.id==="lt");process.stdout.write(String(z.rows))})')" 2
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

echo "== 6. seats through checkout (BS125) =="
psql "$URL" -q <<SQL
insert into event (id, name) values ('$EV', 'Brunch Vol 09') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-lt', '$EV', 'Long table', 6), ('t-vip', '$EV', 'VIP table', 2) on conflict do nothing;
insert into price_version (tier_id, price, currency) values ('t-lt', 90000, 'TZS'), ('t-vip', 600000, 'TZS');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-lt', 6, 6), ('t-vip', 2, 2) on conflict do nothing;
SQL
check "restore 2 rows" "$(putplan 2)" 200
check "republish 2 rows" "$(pub "$SNAP/org" $EV | tail -1)" 200
co() { # jar cart-json
  curl -s -c "$1" -b "$1" -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
    -d "{\"phone\":\"0712345678\",\"email\":\"b@example.com\",\"ageAttested\":true,\"cart\":$2}" -w "\n%{http_code}"; }
payfull() { # jar order
  curl -s -b "$1" -X POST "$BASE/api/checkout/$2/pay" -H 'content-type: application/json' -d '{"method":"mobile","payerPhone":"0712345678"}' >/dev/null
  curl -s "$BASE/api/orders/$2/status" | jget status; }
R=$(co "$SNAP/b1" '[{"tier":"t-lt","quantity":99,"seatIds":["lt-A1","lt-A2"]}]')
check "checkout 2 seats" "$(echo "$R" | tail -1)" 200
O1=$(echo "$R" | head -1 | jget orderId)
check "total from seats (2 × 90k)" "$(echo "$R" | head -1 | jget subtotal)" 180000
check "order_item qty from seats" "$(psqlq "select quantity from order_item where order_id='$O1'")" 2
check "seats held" "$(psqlq "select count(*) from seat_inventory where hold_order_id='$O1' and state='held'")" 2
R=$(co "$SNAP/b2" '[{"tier":"t-lt","quantity":1,"seatIds":["lt-A2"]}]')
check "same seat → 409" "$(echo "$R" | tail -1)" 409
check "names the seat" "$(echo "$R" | head -1 | grep -o lt-A2 | head -1)" lt-A2
check "no orphan tier hold from the 409" "$(psqlq "select available_count from inventory_pool where product_tier_id='t-lt'")" 4
check "pay → paid" "$(payfull "$SNAP/b1" "$O1")" paid
check "seats sold" "$(psqlq "select count(*) from seat_inventory where sold_order_id='$O1' and state='sold'")" 2
check "credentials name seats" "$(psqlq "select string_agg(seat_label, ',' order by seat_label) from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$O1'")" "A1,A2"

echo "== 7. table of 6 priced per table =="
R=$(co "$SNAP/b3" '[{"tier":"t-vip","quantity":1,"seatIds":["vip-T1"]}]'); O3=$(echo "$R" | head -1 | jget orderId)
check "table checkout" "$(echo "$R" | tail -1)" 200
check "1 table = qty 1" "$(psqlq "select quantity from order_item where order_id='$O3'")" 1
check "pay → paid" "$(payfull "$SNAP/b3" "$O3")" paid
check "6 passes for the table" "$(psqlq "select count(*) from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$O3'")" 6
check "pass label" "$(psqlq "select seat_label from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$O3' order by seat_index limit 1")" "Table 1 · Seat 1"

echo "== 8. expired hold can be re-taken; late money → paid_unseatable =="
R=$(co "$SNAP/b4" '[{"tier":"t-lt","quantity":1,"seatIds":["lt-B1"]}]'); O4=$(echo "$R" | head -1 | jget orderId)
curl -s -b "$SNAP/b4" -X POST "$BASE/api/checkout/$O4/pay" -H 'content-type: application/json' -d '{"method":"mobile","payerPhone":"0712345678"}' >/dev/null
psqlq "update seat_inventory set hold_expires_at = now() - interval '1 minute' where seat_id='lt-B1'" >/dev/null
R=$(co "$SNAP/b5" '[{"tier":"t-lt","quantity":1,"seatIds":["lt-B1"]}]'); O5=$(echo "$R" | head -1 | jget orderId)
check "re-take expired seat" "$(echo "$R" | tail -1)" 200
check "late payer → paid_unseatable" "$(curl -s "$BASE/api/orders/$O4/status" | jget status)" paid_unseatable
check "late payer got no passes" "$(psqlq "select count(*) from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$O4'")" 0
check "seat still held by new buyer" "$(psqlq "select hold_order_id from seat_inventory where seat_id='lt-B1'")" "$O5"

echo "== 9. buyer map + passes (BS126) =="
S=$(curl -s "$BASE/api/events/$EV/seats")
check "seat carries row + number" "$(echo "$S" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s).seats.find(r=>r.seatId==="lt-B3");process.stdout.write(x.rowLabel+":"+x.seatNumber)})')" "B:3"
REF=$(psqlq "select public_ref from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$O1' order by seat_label limit 1")
check "passes list names the seat" "$(curl -s "$BASE/api/passes/$REF" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).passes.map(p=>p.seatLabel).sort().join(","))))')" "A1,A2"
check "status credentials name the seat" "$(curl -s "$BASE/api/orders/$O1/status" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).credentials.map(c=>c.seatLabel).sort().join(","))))')" "A1,A2"
check "ticket svg renders the seat" "$(curl -s "$BASE/api/tickets/$REF.svg" | grep -o '>A[12]<' | head -1)" ">A1<"
AV0=$(psqlq "select available_count from inventory_pool where product_tier_id='t-lt'")
R=$(co "$SNAP/b6" '[{"tier":"t-lt","quantity":1,"seatIds":["lt-A3"]}]'); O6=$(echo "$R" | head -1 | jget orderId)
check "hold A3" "$(echo "$R" | tail -1)" 200
R=$(co "$SNAP/b7" '[{"tier":"t-lt","quantity":1,"seatIds":["lt-A3"]}]')
check "another buyer can't take A3" "$(echo "$R" | tail -1)" 409
R=$(co "$SNAP/b6" '[{"tier":"t-lt","quantity":1,"seatIds":["lt-A3","lt-B2"]}]'); O7=$(echo "$R" | head -1 | jget orderId)
check "same buyer re-enters with A3 + B2" "$(echo "$R" | tail -1)" 200
check "old order released" "$(psqlq "select status from \"order\" where id='$O6'")" expired
check "A3 now held by the new order" "$(psqlq "select hold_order_id from seat_inventory where seat_id='lt-A3'")" "$O7"
check "pool: old hold returned, new 2 taken" "$(psqlq "select available_count from inventory_pool where product_tier_id='t-lt'")" "$((AV0 - 2))"

echo "== 10. organizer seat actions (BS127) =="
act() { # jar event json
  curl -s -b "$1" -X POST "$BASE/api/org/events/$2/seats/actions" -H 'content-type: application/json' -d "$3" -w "\n%{http_code}"; }
pool() { psqlq "select available_count||'/'||blocked_count||'/'||reserved_count from inventory_pool where product_tier_id='$1'"; }
LT0=$(psqlq "select available_count from inventory_pool where product_tier_id='t-lt'")
R=$(act "$SNAP/org" $EV '{"action":"block","seatIds":["lt-B3"]}'); check "block B3" "$(echo "$R" | tail -1)" 200
check "pool: available → blocked" "$(pool t-lt)" "$((LT0 - 1))/1/0"
check "buyer sees B3 reserved" "$(curl -s "$BASE/api/events/$EV/seats" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).seats.find(x=>x.seatId==="lt-B3").state))')" reserved
O=$(curl -s -b "$SNAP/org" "$BASE/api/org/events/$EV/seats")
check "owner sees blocked" "$(echo "$O" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);process.stdout.write(o.seats.find(x=>x.seatId==="lt-B3").state+":"+o.counts.blocked)})')" "blocked:1"
check "buyer checkout of blocked seat → 409" "$(co "$SNAP/b8" '[{"tier":"t-lt","quantity":1,"seatIds":["lt-B3"]}]' | tail -1)" 409
R=$(act "$SNAP/org" $EV '{"action":"block","seatIds":["lt-A1"]}'); check "can't block a sold seat" "$(echo "$R" | tail -1)" 409
check "names the sold seat" "$(echo "$R" | head -1 | grep -o '"state":"sold"' | head -1)" '"state":"sold"'
R=$(act "$SNAP/org" $EV '{"action":"release","seatIds":["lt-A1"]}'); check "can't release a sold seat" "$(echo "$R" | tail -1)" 409
R=$(act "$SNAP/org" $EV '{"action":"release","seatIds":["lt-A3"]}'); check "can't release a held seat" "$(echo "$R" | tail -1)" 409
R=$(act "$SNAP/org" $EV '{"action":"release","seatIds":["lt-B3"]}'); check "release B3" "$(echo "$R" | tail -1)" 200
check "pool back" "$(pool t-lt)" "$LT0/0/0"
check "B3 available again" "$(psqlq "select state from seat_inventory where seat_id='lt-B3'")" available
check "anon → 401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/org/events/$EV/seats/actions" -H 'content-type: application/json' -d '{"action":"block","seatIds":["lt-B3"]}')" 401
check "other org's event → 404" "$(act "$SNAP/org" offshore-001 '{"action":"block","seatIds":["x"]}' | tail -1)" 404
check "bad action → 400" "$(act "$SNAP/org" $EV '{"action":"sell","seatIds":["lt-B3"]}' | tail -1)" 400
VIP0=$(psqlq "select available_count from inventory_pool where product_tier_id='t-vip'")
R=$(act "$SNAP/org" $EV '{"action":"reserve","seatIds":["vip-T2"],"note":"Sponsor table"}'); check "reserve T2 with note" "$(echo "$R" | tail -1)" 200
check "pool: available → reserved" "$(pool t-vip)" "$((VIP0 - 1))/0/1"
check "note stored" "$(psqlq "select reserved_note from seat_inventory where seat_id='vip-T2'")" "Sponsor table"

echo "== 11. comps for seats (BS127) =="
R=$(curl -s -b "$SNAP/org" -X POST "$BASE/api/org/comps" -H 'content-type: application/json' \
  -d '{"name":"Sponsor","phone":"0712345678","tier":"t-vip","seatIds":["vip-T2"]}' -w "\n%{http_code}")
check "comp the reserved table" "$(echo "$R" | tail -1)" 200
CO=$(psqlq "select sold_order_id from seat_inventory where seat_id='vip-T2' and state='sold'")
check "table sold to the comp order" "$(psqlq "select type from \"order\" where id='$CO'")" comp
check "6 passes name the table" "$(psqlq "select count(*) from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$CO' and seat_label like 'Table 2 · Seat %'")" 6
check "pool: reserved → sold" "$(pool t-vip)" "$((VIP0 - 1))/0/0"
R=$(curl -s -b "$SNAP/org" -X POST "$BASE/api/org/comps" -H 'content-type: application/json' \
  -d '{"name":"Late","phone":"0712345678","tier":"t-lt","seatIds":["lt-A1"]}' -w "\n%{http_code}")
check "comp a sold seat → 409" "$(echo "$R" | tail -1)" 409

echo "== 12. price mode reaches inventory (BS127) =="
PM=$(plan 2 | sed 's/"perTable":6,/"perTable":6,"priceMode":"per_seat",/')
check "save per-seat tables" "$(curl -s -o /dev/null -w "%{http_code}" -b "$SNAP/org" -X PUT -H 'content-type: application/json' -d "$PM" "$BASE/api/events/$EV/floorplan")" 200
check "plan keeps priceMode" "$(curl -s "$BASE/api/events/$EV/floorplan" | grep -o '"priceMode":"per_seat"' | head -1)" '"priceMode":"per_seat"'
check "republish" "$(pub "$SNAP/org" $EV | tail -1)" 200
check "seats per_seat" "$(psqlq "select price_mode from seat_inventory where seat_id='vip-T1'")" per_seat

[ "$fail" = 0 ] && echo "SEAT INVENTORY E2E: PASS" || { echo "SEAT INVENTORY E2E: FAIL"; tail -30 "$SNAP/api.log"; exit 1; }
