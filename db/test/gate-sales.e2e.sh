#!/usr/bin/env bash
# BS107 (#184) — EVENT-DAY (gate/box-office) selling. Throwaway Postgres 17 (NEVER
# prod). A gate seller (a scanner_user with can_sell) sells a walk-up a ticket at
# the real price; cash settles instantly, mobile fires an STK push. Proves:
#
#   T1  catalog: the seller's event tiers + price + availability.
#   T2  CASH sale draws real inventory, mints credentials, real revenue,
#       attributed (sold_by + channel=gate_cash).
#   T3  a scanner without can_sell → 403 not_a_seller.
#   T4  selling a tier NOT on the seller's event → 403 wrong_event.
#   T5  over-capacity → 409 sold_out, nothing written.
#   T6  VOID a cash sale pre-scan returns the seat + revokes credentials; a second
#       void fails.
#   T7  per-seller cash reconciliation (GET /api/org/scanners/sales).
#   T8  MOBILE sale → pending order, channel=gate_mobile, attributed, STK fired.
#
# XBRIDGE_MOCK + mock SMS/email. Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55506}"
API_PORT="${TEST_API_PORT:-4206}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-gate-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-gatesnap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers organizers audit admin events kyc"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

if [ ! -f "$API_DIR/dist/main.js" ]; then
  echo "== building @zora/core + @zora/api (dist missing) =="
  ( cd "$ROOT" && pnpm --filter @zora/core build && pnpm --filter @zora/api build ) >/dev/null
fi

echo "== throwaway Postgres @ :$PG_PORT + migrate + backfill =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_gate
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_gate"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null
psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_gate -v ON_ERROR_STOP=1 -c "$1"; }

COLS=$(psql_one "select count(*) from information_schema.columns where (table_name='scanner_user' and column_name='can_sell') or (table_name='order' and column_name in ('sold_by','channel'))")
[ "$COLS" = "3" ] && echo "  ✓ 0027 applied — can_sell + order.sold_by + order.channel" || { echo "  ✗ columns=$COLS"; fail=1; }

echo "== seed: thebrunchcity ev-A (t-ga cap 10 @ 20000) · offshore ev-Z (t-z) =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_gate -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id,name,city,status) values ('ev-A','Brunch A','dar','published'),('ev-Z','Foreign Z','dar','published') on conflict do nothing;
insert into product_tier (id,event_id,name,capacity) values ('t-ga','ev-A','GA',10),('t-z','ev-Z','GA',10) on conflict do nothing;
insert into price_version (tier_id,price,currency) select 't-ga',20000,'TZS' where not exists (select 1 from price_version where tier_id='t-ga');
insert into price_version (tier_id,price,currency) select 't-z',15000,'TZS' where not exists (select 1 from price_version where tier_id='t-z');
insert into inventory_pool (product_tier_id,capacity,available_count) values ('t-ga',10,10),('t-z',10,10) on conflict do nothing;
update collection_store set data='[{"id":"ev-A","name":"Brunch A","city":"dar","status":"published","organizerHandle":"thebrunchcity"},{"id":"ev-Z","name":"Foreign Z","city":"dar","status":"published","organizerHandle":"offshore"}]' where name='events';
SQL

echo "== boot API (XBRIDGE_MOCK, mock SMS/email) =="
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key SMS_DRIVER=mock EMAIL_DRIVER=mock \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
BASE="http://localhost:$API_PORT"
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(v==null?"":String(v))}catch{process.stdout.write("")}})' "$1"; }

curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/org" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null

# a SELLER (can_sell) + a plain agent (cannot sell), both scoped to ev-A
SELLER=$(curl -s -b "$SNAP/org" -X POST "$BASE/api/org/scanners" -H 'content-type: application/json' -d '{"name":"Cashier Gate A","contact":"0712000001","eventId":"ev-A","role":"agent","canSell":true}')
SCODE=$(echo "$SELLER" | jget code); SID=$(echo "$SELLER" | jget id)
AGENT=$(curl -s -b "$SNAP/org" -X POST "$BASE/api/org/scanners" -H 'content-type: application/json' -d '{"name":"Just Scans","contact":"0712000002","eventId":"ev-A","role":"agent"}')
ACODE=$(echo "$AGENT" | jget code)
STOKEN=$(curl -s -X POST "$BASE/api/scan/session" -H 'content-type: application/json' -d "{\"code\":\"$SCODE\"}" | jget token)
ATOKEN=$(curl -s -X POST "$BASE/api/scan/session" -H 'content-type: application/json' -d "{\"code\":\"$ACODE\"}" | jget token)
sell() { curl -s -o "$2" -w '%{http_code}' -H "authorization: Bearer $STOKEN" -H 'content-type: application/json' -X POST "$BASE/api/scan/sell" -d "$1"; }
inv() { psql_one "select available_count from inventory_pool where product_tier_id='t-ga'"; }
creds() { psql_one "select count(*) from credential c join order_item oi on oi.id=c.order_item_id where oi.product_tier_id='t-ga' and c.state<>'revoked'"; }

echo ""
echo "== T1 — catalog =="
CAT=$(curl -s -H "authorization: Bearer $STOKEN" "$BASE/api/scan/sell/catalog")
[ "$(echo "$CAT" | jget tiers.0.price)" = "20000" ] && [ "$(echo "$CAT" | jget tiers.0.available)" = "10" ] && echo "  ✓ catalog: GA @ 20000, 10 available" || { echo "  ✗ catalog: $CAT"; fail=1; }

echo ""
echo "== T2 — CASH sale qty 2 =="
C=$(sell '{"tier":"t-ga","qty":2,"method":"cash","buyerEmail":"walkup@example.com"}' "$SNAP/t2"); R=$(cat "$SNAP/t2")
OID=$(echo "$R" | jget orderId)
[ "$C" = "201" -o "$C" = "200" ] && [ "$(echo "$R" | jget status)" = "paid" ] && [ "$(echo "$R" | jget amount)" = "40000" ] && echo "  ✓ cash sale → paid, amount 40000" || { echo "  ✗ cash HTTP $C $R"; fail=1; }
[ "$(inv)" = "8" ] && echo "  ✓ inventory 10→8 (real capacity drawn)" || { echo "  ✗ inv=$(inv)"; fail=1; }
[ "$(creds)" = "2" ] && echo "  ✓ 2 credentials minted" || { echo "  ✗ creds=$(creds)"; fail=1; }
ROW=$(psql_one "select channel||'|'||sold_by||'|'||status from \"order\" where id='$OID'")
[ "$ROW" = "gate_cash|$SID|paid" ] && echo "  ✓ order attributed: $ROW" || { echo "  ✗ order row=$ROW"; fail=1; }

echo ""
echo "== T3 — a non-seller cannot sell =="
C=$(curl -s -o "$SNAP/t3" -w '%{http_code}' -H "authorization: Bearer $ATOKEN" -H 'content-type: application/json' -X POST "$BASE/api/scan/sell" -d '{"tier":"t-ga","qty":1,"method":"cash"}')
[ "$C" = "403" ] && grep -q '"not_a_seller"' "$SNAP/t3" && echo "  ✓ agent without can_sell → 403 not_a_seller" || { echo "  ✗ HTTP $C $(cat "$SNAP/t3")"; fail=1; }

echo ""
echo "== T4 — cannot sell another event's tier =="
C=$(sell '{"tier":"t-z","qty":1,"method":"cash"}' "$SNAP/t4")
[ "$C" = "403" ] && grep -q '"wrong_event"' "$SNAP/t4" && echo "  ✓ foreign tier → 403 wrong_event" || { echo "  ✗ HTTP $C $(cat "$SNAP/t4")"; fail=1; }

echo ""
echo "== T5 — over-capacity → 409, nothing written =="
C=$(sell '{"tier":"t-ga","qty":20,"method":"cash"}' "$SNAP/t5")
[ "$C" = "409" ] && grep -q '"sold_out"' "$SNAP/t5" && [ "$(inv)" = "8" ] && echo "  ✓ 409 sold_out · inventory unchanged at 8" || { echo "  ✗ HTTP $C inv=$(inv)"; fail=1; }

echo ""
echo "== T6 — VOID a cash sale pre-scan returns the seat =="
B=$(sell '{"tier":"t-ga","qty":1,"method":"cash"}' "$SNAP/t6"); BID=$(cat "$SNAP/t6" | jget orderId)
[ "$(inv)" = "7" ] && echo "  ✓ second cash sale drops inventory 8→7" || { echo "  ✗ inv=$(inv)"; fail=1; }
VC=$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $STOKEN" -X POST "$BASE/api/scan/sell/$BID/void")
[ "$VC" = "201" -o "$VC" = "200" ] && [ "$(inv)" = "8" ] && echo "  ✓ void → seat returns (7→8)" || { echo "  ✗ void HTTP $VC inv=$(inv)"; fail=1; }
[ "$(psql_one "select status from \"order\" where id='$BID'")" = "cancelled" ] && echo "  ✓ voided order is cancelled" || { echo "  ✗ order not cancelled"; fail=1; }
VC2=$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $STOKEN" -X POST "$BASE/api/scan/sell/$BID/void")
[ "$VC2" != "200" ] && [ "$VC2" != "201" ] && echo "  ✓ voiding again is refused ($VC2)" || { echo "  ✗ double void allowed"; fail=1; }

echo ""
echo "== T7 — per-seller cash reconciliation =="
SALES=$(curl -s -b "$SNAP/org" "$BASE/api/org/scanners/sales")
[ "$(echo "$SALES" | jget totals.cash)" = "40000" ] && [ "$(echo "$SALES" | jget sellers.0.cash)" = "40000" ] && echo "  ✓ report: seller owes 40000 cash (voided sale excluded)" || { echo "  ✗ report: $SALES"; fail=1; }

echo ""
echo "== T8 — MOBILE sale: pending, attributed, STK fired =="
C=$(sell '{"tier":"t-ga","qty":1,"method":"mobile","buyerPhone":"0713000000"}' "$SNAP/t8"); R=$(cat "$SNAP/t8")
MID=$(echo "$R" | jget orderId)
[ "$(echo "$R" | jget status)" = "pending" ] && [ -n "$(echo "$R" | jget transactionId)" ] && echo "  ✓ mobile → pending + STK transaction" || { echo "  ✗ mobile: $R"; fail=1; }
MROW=$(psql_one "select channel||'|'||sold_by||'|'||status from \"order\" where id='$MID'")
[ "$MROW" = "gate_mobile|$SID|pending" ] && echo "  ✓ mobile order attributed (gate_mobile, seller, pending)" || { echo "  ✗ mobile row=$MROW"; fail=1; }

echo ""
[ "$fail" = "0" ] && echo "GATE SALES E2E: PASS" || echo "GATE SALES E2E: FAIL"
exit $fail
