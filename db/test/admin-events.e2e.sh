#!/usr/bin/env bash
# BS99 — super-admin EVENTS-MANAGER + derived from-price. Boots the real API on a
# THROWAWAY Postgres 17 (NEVER prod) and proves:
#
#   #1  GET /api/admin/events returns EVERY event (real data, not the old mock),
#       with owner name + live sold/capacity + status/enabled/mega.
#   #1  POST /api/admin/events/:id/enabled {enabled:false} archives it → the event
#       vanishes from the PUBLIC /api/events; {enabled:true} restores it.
#   #1  PUT /api/events/:id/mega {mega:true} pins it (one per city).
#   #1  the endpoints are super_admin-only (org/anon → 401).
#   #2  the public "FROM {price}" is the lowest ON-SALE tier: an event whose
#       cheapest tier is disabled advertises the cheapest LIVE tier, not the dead
#       one (the reported Apricot-Crush "from 1,000" bug).
#
# Self-contained (throwaway PG; XBRIDGE_MOCK). bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55499}"
API_PORT="${TEST_API_PORT:-4199}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-adminev-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-adminevsnap-XXXXXX")"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_adminev
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_adminev"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_adminev -v ON_ERROR_STOP=1 -c "$1"; }

echo "== seed: one event with a DISABLED cheapest tier (thebrunchcity, city=dar) =="
# Relational rows so sold/capacity resolve from the inventory pool.
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_adminev -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name, city, status) values ('ev-seasoned','Seasoned Sundays','dar','published') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity, disabled) values
  ('ts-ga','ev-seasoned','General Admission',300,true),
  ('ts-early','ev-seasoned','Early Birds',100,false),
  ('ts-one','ev-seasoned','Brunch for One',50,false) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 'ts-ga',1000,'TZS' where not exists (select 1 from price_version where tier_id='ts-ga');
insert into price_version (tier_id, price, currency) select 'ts-early',20000,'TZS' where not exists (select 1 from price_version where tier_id='ts-early');
insert into price_version (tier_id, price, currency) select 'ts-one',90000,'TZS' where not exists (select 1 from price_version where tier_id='ts-one');
insert into inventory_pool (product_tier_id, capacity, available_count, sold_count) values
  ('ts-ga',300,300,0),('ts-early',100,88,12),('ts-one',50,50,0) on conflict do nothing;
SQL

# The BLOB the public read + admin list consume: priceFrom is STALE (1000 = the now
# disabled GA tier); the cheapest LIVE tier is Early Birds at 20000.
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_adminev -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
update collection_store set data = '[
  {"id":"ev-seasoned","name":"Seasoned Sundays","city":"dar","status":"published","priceFrom":1000,"organizerHandle":"thebrunchcity",
   "webCheckout":{"tiers":[
     {"tierId":"ts-ga","name":"General Admission","unitPrice":1000,"disabled":true},
     {"tierId":"ts-early","name":"Early Birds","unitPrice":20000},
     {"tierId":"ts-one","name":"Brunch for One","unitPrice":90000}
   ]}}
]' where name='events';
SQL

echo "== boot API (x-bridge MOCK) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
jq_get() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(v==null?"":Array.isArray(v)?String(v.length):String(v))}catch{process.stdout.write("ERR:"+s.slice(0,120))}})' "$1"; }

curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null

echo ""
echo "== #2 — public /api/events derives FROM from the cheapest ON-SALE tier =="
PF=$(curl -s "$BASE/api/events" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);const e=(Array.isArray(a)?a:a.events||[]).find(x=>x.id==="ev-seasoned");process.stdout.write(e?String(e.priceFrom):"?")})')
[ "$PF" = "20000" ] && echo "  ✓ priceFrom = 20000 (Early Birds), NOT the disabled 1000 GA tier" || { echo "  ✗ priceFrom = $PF (want 20000)"; fail=1; }

echo ""
echo "== #1 — GET /api/admin/events is REAL data (owner + sold/capacity + flags) =="
AE=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/events")
R=$(AE="$AE" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const a=JSON.parse(process.env.AE); const e=a.find(x=>x.id==="ev-seasoned");
t("the seeded event is listed (not the old mock e_apr/e_neon)", !!e && !a.some(x=>x.id==="e_neon"));
t("owner display name resolved", e && e.owner==="The Brunch City");
t("sold/capacity summed from the pool (12 / 450)", e && e.sold===12 && e.capacity===450);
t("enabled=true, status=published, mega=false initially", e && e.enabled===true && e.status==="published" && e.mega===false);
' 2>&1 || true); echo "$R"; echo "$R" | grep -q '✗' && fail=1

echo ""
echo "== #1 — disable archives it (vanishes from public /api/events) =="
curl -s -b "$SNAP/admin" -X POST "$BASE/api/admin/events/ev-seasoned/enabled" -H 'content-type: application/json' -d '{"enabled":false}' >/dev/null
PUBN=$(curl -s "$BASE/api/events" | jq_get "")
STAT=$(psql_one "select data::jsonb->0->>'status' from collection_store where name='events'")
[ "$STAT" = "archived" ] && echo "  ✓ blob status → archived" || { echo "  ✗ status=$STAT"; fail=1; }
GONE=$(curl -s "$BASE/api/events" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);const arr=Array.isArray(a)?a:a.events||[];process.stdout.write(arr.some(x=>x.id==="ev-seasoned")?"present":"gone")})')
[ "$GONE" = "gone" ] && echo "  ✓ archived event is hidden from the public marketplace" || { echo "  ✗ still public: $GONE"; fail=1; }

echo ""
echo "== #1 — enable restores it =="
curl -s -b "$SNAP/admin" -X POST "$BASE/api/admin/events/ev-seasoned/enabled" -H 'content-type: application/json' -d '{"enabled":true}' >/dev/null
BACK=$(curl -s "$BASE/api/events" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);const arr=Array.isArray(a)?a:a.events||[];process.stdout.write(arr.some(x=>x.id==="ev-seasoned")?"present":"gone")})')
[ "$BACK" = "present" ] && echo "  ✓ re-enabled event is public again" || { echo "  ✗ not restored: $BACK"; fail=1; }

echo ""
echo "== #1 — mega pin via PUT /api/events/:id/mega =="
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/events/ev-seasoned/mega" -H 'content-type: application/json' -d '{"mega":true}' >/dev/null
MEGA=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/events" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const e=JSON.parse(s).find(x=>x.id==="ev-seasoned");process.stdout.write(e&&e.mega?"yes":"no")})')
[ "$MEGA" = "yes" ] && echo "  ✓ event pinned as mega (shows on admin list)" || { echo "  ✗ mega not set: $MEGA"; fail=1; }

echo ""
echo "== #1 — admin endpoints are super_admin-only =="
ANON=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/events")
[ "$ANON" = "401" ] && echo "  ✓ anon GET /api/admin/events → 401" || { echo "  ✗ anon → $ANON"; fail=1; }
ANONP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/admin/events/ev-seasoned/enabled" -H 'content-type: application/json' -d '{"enabled":false}')
[ "$ANONP" = "401" ] && echo "  ✓ anon POST enabled → 401 (no unauthenticated archive)" || { echo "  ✗ anon POST → $ANONP"; fail=1; }

echo ""
[ "$fail" = "0" ] && echo "ADMIN EVENTS E2E: PASS" || echo "ADMIN EVENTS E2E: FAIL"
exit $fail
