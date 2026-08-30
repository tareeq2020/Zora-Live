#!/usr/bin/env bash
# BS111 (XBR-346) — a multi-ticket buyer gets ONE SMS link (/t/<first-ref>), so
# the web pass MUST expand that ref to every pass in the same order. Regression
# guard for GET /api/passes/:ref. Proves:
#   T1  a qty-2 order → /api/passes/<ref> returns BOTH refs (either sibling ref
#       resolves to the whole set).
#   T2  a qty-1 order → exactly one pass.
#   T3  an unknown ref → zero passes (no crash, no leak).
#
# Throwaway Postgres 17 (NEVER prod). XBRIDGE_MOCK + mock SMS/email. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55726}"
API_PORT="${TEST_API_PORT:-4226}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-passes-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-passessnap-XXXXXX")"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_passes
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_passes"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null
psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_passes -v ON_ERROR_STOP=1 -c "$1"; }

echo "== seed: thebrunchcity ev-A (t-ga cap 10 @ 20000) =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_passes -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id,name,city,status) values ('ev-A','Brunch A','dar','published') on conflict do nothing;
insert into product_tier (id,event_id,name,capacity) values ('t-ga','ev-A','GA',10) on conflict do nothing;
insert into price_version (tier_id,price,currency) select 't-ga',20000,'TZS' where not exists (select 1 from price_version where tier_id='t-ga');
insert into inventory_pool (product_tier_id,capacity,available_count) values ('t-ga',10,10) on conflict do nothing;
update collection_store set data='[{"id":"ev-A","name":"Brunch A","city":"dar","status":"published","organizerHandle":"thebrunchcity"}]' where name='events';
SQL

echo "== boot API =="
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key SMS_DRIVER=mock EMAIL_DRIVER=mock \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
BASE="http://localhost:$API_PORT"
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(v==null?"":String(v))}catch{process.stdout.write("")}})' "$1"; }

curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/org" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null
SELLER=$(curl -s -b "$SNAP/org" -X POST "$BASE/api/org/scanners" -H 'content-type: application/json' -d '{"name":"Cashier Gate A","contact":"0712000001","eventId":"ev-A","role":"agent","canSell":true}')
STOKEN=$(curl -s -X POST "$BASE/api/scan/session" -H 'content-type: application/json' -d "{\"code\":\"$(echo "$SELLER" | jget code)\"}" | jget token)
sell() { curl -s -H "authorization: Bearer $STOKEN" -H 'content-type: application/json' -X POST "$BASE/api/scan/sell" -d "$1"; }
refs_after() { psql_one "select string_agg(public_ref, ',' order by seat_index) from (select public_ref, seat_index from credential order by issued_at desc limit $1) x"; }

echo ""
echo "== T1 — qty-2 order: either ref resolves to BOTH passes =="
sell '{"tier":"t-ga","qty":2,"method":"cash","buyerPhone":"0712002222"}' >/dev/null
PAIR=$(refs_after 2)                          # both refs, comma-joined
R1=$(echo "$PAIR" | cut -d, -f1); R2=$(echo "$PAIR" | cut -d, -f2)
RESP=$(curl -s "$BASE/api/passes/$R1")
N=$(echo "$RESP" | node -pe 'JSON.parse(require("fs").readFileSync(0)).passes.length')
HAS_BOTH=$(echo "$RESP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).passes.map(x=>x.ref);process.stdout.write((p.includes(process.argv[1])&&p.includes(process.argv[2]))?"yes":"no")})' "$R1" "$R2")
[ "$N" = "2" ] && [ "$HAS_BOTH" = "yes" ] && echo "  ✓ /api/passes/$R1 → 2 passes incl. both siblings" || { echo "  ✗ N=$N both=$HAS_BOTH resp=$RESP"; fail=1; }
# the OTHER ref resolves to the same set
N2=$(curl -s "$BASE/api/passes/$R2" | node -pe 'JSON.parse(require("fs").readFileSync(0)).passes.length')
[ "$N2" = "2" ] && echo "  ✓ the sibling ref resolves to the same 2 passes" || { echo "  ✗ sibling N=$N2"; fail=1; }

echo ""
echo "== T2 — qty-1 order: exactly one pass =="
sell '{"tier":"t-ga","qty":1,"method":"cash","buyerPhone":"0712003333"}' >/dev/null
SR=$(refs_after 1)
N=$(curl -s "$BASE/api/passes/$SR" | node -pe 'JSON.parse(require("fs").readFileSync(0)).passes.length')
[ "$N" = "1" ] && echo "  ✓ single-ticket order → 1 pass" || { echo "  ✗ N=$N"; fail=1; }

echo ""
echo "== T3 — unknown ref → zero passes, no crash =="
N=$(curl -s "$BASE/api/passes/ZORA-NOPE-0000" | node -pe 'JSON.parse(require("fs").readFileSync(0)).passes.length')
[ "$N" = "0" ] && echo "  ✓ unknown ref → 0 passes" || { echo "  ✗ N=$N"; fail=1; }

echo ""
[ "$fail" = "0" ] && echo "ORDER PASSES E2E: PASS (one SMS link surfaces every pass in the order)" || { echo "ORDER PASSES E2E: FAIL"; exit 1; }
