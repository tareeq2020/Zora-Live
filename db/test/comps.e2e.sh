#!/usr/bin/env bash
# BS104/BS105 — COMPS. Throwaway Postgres 17 (NEVER prod). A comp is a $0 order
# that draws down REAL capacity, mints credentials and delivers by SMS AND/OR
# email, and can be EDITED + re-sent. Proves:
#
#   T1  GET /api/org/comps starts empty.
#   T2  EMAIL comp (qty 2) → channel=email, delivered; inventory 10→8; 2 creds.
#   T3  PHONE comp (qty 3) → channel=sms; inventory 8→5. (mock SMS → delivery failed)
#   T4  BOTH comp (qty 2, phone+email) → channel=both, delivered (email leg); 8→... 5→3.
#   T5  SOLD OUT — qty 4 with 3 left → 409 sold_out, nothing written (inventory 3).
#   T6  list shows 3 comps; total 7 credentials.
#   T7  EDIT + RE-SEND — add an email to the phone comp → channel=both, delivered.
#   T8  RE-SEND the email comp → 200 delivered.
#   T9  OWNERSHIP — another org editing/issuing this org's comp/tier → 404.
#   T10 VALIDATION — qty 0/51, no name, no phone AND no email → 400.
#
# SMS_DRIVER=mock + EMAIL_DRIVER=mock so nothing is actually sent. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55504}"
API_PORT="${TEST_API_PORT:-4204}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-comps-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-compssnap-XXXXXX")"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_comps
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_comps"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null
psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_comps -v ON_ERROR_STOP=1 -c "$1"; }

COLS=$(psql_one "select count(*) from information_schema.columns where table_name='comp' and column_name in ('phone','email')")
[ "$COLS" = "2" ] && echo "  ✓ 0024+0025 applied — comp has phone + email columns" || { echo "  ✗ comp columns=$COLS"; fail=1; }

echo "== seed: thebrunchcity event 'ev-comp' · tier 't-comp' capacity 10 =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_comps -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name, city, status) values ('ev-comp','Comp Test','dar','published') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-comp','ev-comp','GA', 10) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-comp', 20000, 'TZS' where not exists (select 1 from price_version where tier_id='t-comp');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-comp', 10, 10) on conflict do nothing;
update collection_store set data = '[{"id":"ev-comp","name":"Comp Test","city":"dar","status":"published","organizerHandle":"thebrunchcity","webCheckout":{"tiers":[{"tierId":"t-comp","name":"GA","unitPrice":20000}]}}]' where name='events';
SQL

echo "== boot API (mock SMS + email) =="
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key SMS_DRIVER=mock EMAIL_DRIVER=mock \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
BASE="http://localhost:$API_PORT"
jlen() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);process.stdout.write(String(Array.isArray(a)?a.length:-1))}catch{process.stdout.write("-1")}})'; }
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(v==null?"":String(v))}catch{process.stdout.write("ERR")}})' "$1"; }

curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o2/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/org" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/off" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"offshore","password":"orgpass123"}' >/dev/null

inv() { psql_one "select available_count from inventory_pool where product_tier_id='t-comp'"; }
creds() { psql_one "select count(*) from credential c join order_item oi on oi.id=c.order_item_id where oi.product_tier_id='t-comp'"; }
comp() { curl -s -b "$SNAP/org" -X POST "$BASE/api/org/comps" -H 'content-type: application/json' -d "$1"; }

echo ""
echo "== T1 — comps start empty =="
[ "$(curl -s -b "$SNAP/org" "$BASE/api/org/comps" | jlen)" = "0" ] && echo "  ✓ GET → []" || { echo "  ✗ not empty"; fail=1; }

echo ""
echo "== T2 — EMAIL comp (qty 2) =="
R=$(comp '{"name":"Amina","email":"amina@example.com","eventId":"ev-comp","tier":"t-comp","qty":2}')
[ "$(echo "$R" | jget channel)" = "email" ] && [ "$(echo "$R" | jget delivery)" = "delivered" ] && echo "  ✓ channel=email, delivered" || { echo "  ✗ $R"; fail=1; }
[ "$(inv)" = "8" ] && echo "  ✓ inventory 10→8" || { echo "  ✗ inv=$(inv)"; fail=1; }

echo ""
echo "== T3 — PHONE comp (qty 3) =="
R=$(comp '{"name":"Press","phone":"0712345678","eventId":"ev-comp","tier":"t-comp","qty":3}')
[ "$(echo "$R" | jget channel)" = "sms" ] && echo "  ✓ channel=sms" || { echo "  ✗ $R"; fail=1; }
[ "$(inv)" = "5" ] && echo "  ✓ inventory 8→5" || { echo "  ✗ inv=$(inv)"; fail=1; }
PHONE_ID=$(echo "$R" | jget id)

echo ""
echo "== T4 — BOTH comp (qty 2, phone+email) =="
R=$(comp '{"name":"VIP Guest","phone":"0713000000","email":"vip@example.com","eventId":"ev-comp","tier":"t-comp","qty":2}')
[ "$(echo "$R" | jget channel)" = "both" ] && [ "$(echo "$R" | jget delivery)" = "delivered" ] && echo "  ✓ channel=both, delivered (email leg)" || { echo "  ✗ $R"; fail=1; }
[ "$(inv)" = "3" ] && echo "  ✓ inventory 5→3" || { echo "  ✗ inv=$(inv)"; fail=1; }

echo ""
echo "== T5 — SOLD OUT (qty 4, only 3 left) → 409, nothing written =="
C=$(curl -s -o "$SNAP/so" -w '%{http_code}' -b "$SNAP/org" -X POST "$BASE/api/org/comps" -H 'content-type: application/json' -d '{"name":"Too Many","email":"x@y.com","eventId":"ev-comp","tier":"t-comp","qty":4}')
[ "$C" = "409" ] && grep -q '"sold_out"' "$SNAP/so" && [ "$(inv)" = "3" ] && echo "  ✓ 409 sold_out · inventory unchanged at 3" || { echo "  ✗ HTTP $C inv=$(inv)"; fail=1; }

echo ""
echo "== T6 — list has 3 comps · 7 credentials total =="
[ "$(curl -s -b "$SNAP/org" "$BASE/api/org/comps" | jlen)" = "3" ] && echo "  ✓ 3 comps listed" || { echo "  ✗ list count"; fail=1; }
[ "$(creds)" = "7" ] && echo "  ✓ 7 credentials (2+3+2)" || { echo "  ✗ creds=$(creds)"; fail=1; }

echo ""
echo "== T7 — EDIT + RE-SEND: add an email to the phone comp → channel=both, delivered =="
E=$(curl -s -b "$SNAP/org" -X PUT "$BASE/api/org/comps/$PHONE_ID" -H 'content-type: application/json' -d '{"name":"Press Fixed","phone":"0712345678","email":"press@example.com"}')
[ "$(echo "$E" | jget channel)" = "both" ] && [ "$(echo "$E" | jget delivery)" = "delivered" ] && [ "$(echo "$E" | jget name)" = "Press Fixed" ] && echo "  ✓ edited → channel=both, delivered, name updated" || { echo "  ✗ edit: $E"; fail=1; }
[ "$(inv)" = "3" ] && echo "  ✓ inventory unchanged (edit moves the destination, not the seats)" || { echo "  ✗ inv changed to $(inv)"; fail=1; }
DBE=$(psql_one "select email from comp where id='$PHONE_ID'")
[ "$DBE" = "press@example.com" ] && echo "  ✓ comp.email persisted" || { echo "  ✗ db email=$DBE"; fail=1; }

echo ""
echo "== T8 — re-send an existing comp =="
CID=$(curl -s -b "$SNAP/org" "$BASE/api/org/comps" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);const e=a.find(x=>x.channel==="email");process.stdout.write(e?e.id:"")})')
RS=$(curl -s -b "$SNAP/org" -X POST "$BASE/api/org/comps/$CID/resend")
[ "$(echo "$RS" | jget delivery)" = "delivered" ] && echo "  ✓ re-send → delivered" || { echo "  ✗ $RS"; fail=1; }

echo ""
echo "== T9 — another org cannot issue/edit against this org =="
C=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/off" -X POST "$BASE/api/org/comps" -H 'content-type: application/json' -d '{"name":"X","email":"z@z.com","eventId":"ev-comp","tier":"t-comp","qty":1}')
[ "$C" = "404" ] && echo "  ✓ offshore issuing on thebrunchcity's tier → 404" || { echo "  ✗ issue → $C"; fail=1; }
C=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/off" -X PUT "$BASE/api/org/comps/$PHONE_ID" -H 'content-type: application/json' -d '{"email":"z@z.com"}')
[ "$C" = "404" ] && echo "  ✓ offshore editing thebrunchcity's comp → 404" || { echo "  ✗ edit → $C"; fail=1; }

echo ""
echo "== T10 — validation =="
c0=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/org" -X POST "$BASE/api/org/comps" -H 'content-type: application/json' -d '{"name":"A","email":"a@b.com","eventId":"ev-comp","tier":"t-comp","qty":0}')
c51=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/org" -X POST "$BASE/api/org/comps" -H 'content-type: application/json' -d '{"name":"A","email":"a@b.com","eventId":"ev-comp","tier":"t-comp","qty":51}')
cn=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/org" -X POST "$BASE/api/org/comps" -H 'content-type: application/json' -d '{"name":"","email":"a@b.com","eventId":"ev-comp","tier":"t-comp","qty":1}')
cc=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/org" -X POST "$BASE/api/org/comps" -H 'content-type: application/json' -d '{"name":"A","eventId":"ev-comp","tier":"t-comp","qty":1}')
[ "$c0" = "400" ] && [ "$c51" = "400" ] && [ "$cn" = "400" ] && [ "$cc" = "400" ] && echo "  ✓ qty 0 / qty 51 / no name / no phone+email → 400" || { echo "  ✗ q0=$c0 q51=$c51 noname=$cn nocontact=$cc"; fail=1; }

echo ""
[ "$fail" = "0" ] && echo "COMPS E2E: PASS" || echo "COMPS E2E: FAIL"
exit $fail
