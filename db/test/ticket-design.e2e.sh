#!/usr/bin/env bash
# BS131 — organizer Pass design (F6): draft → preview → publish → buyers' pass.
# Proves:
#   D1  flag off → GET says enabled:false; PUT is refused (feature ships dark)
#   D2  PUT validation: bad hex / http (non-https) URL / 5 sponsors / bad template → 400
#   D3  save a draft → GET returns it; status draft
#   D4  preview.svg → 200 image/svg+xml, branded, draft accent; ?design= previews unsaved state
#   D5  before publish the buyer pass does NOT carry the draft accent
#   D6  publish → /api/tickets/:ref.svg carries the accent + template; QR still signed
#   D7  another organizer → 404 on GET / PUT / publish / preview (no existence leak)
#
# Throwaway Postgres 17 (NEVER prod). XBRIDGE_MOCK + mock SMS/email. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55731}"
API_PORT="${TEST_API_PORT:-4231}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-tdz-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-tdzsnap-XXXXXX")"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_tdz
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_tdz"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null
psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_tdz -v ON_ERROR_STOP=1 -c "$1"; }

echo "== seed: thebrunchcity owns ev-A (t-ga) · offshore owns ev-B =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_tdz -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id,name,city,status) values ('ev-A','Brunch A','dar','published'),('ev-B','Offshore B','dar','published') on conflict do nothing;
insert into product_tier (id,event_id,name,capacity) values ('t-ga','ev-A','GA',10) on conflict do nothing;
insert into price_version (tier_id,price,currency) select 't-ga',20000,'TZS' where not exists (select 1 from price_version where tier_id='t-ga');
insert into inventory_pool (product_tier_id,capacity,available_count) values ('t-ga',10,10) on conflict do nothing;
update collection_store set data='[{"id":"ev-A","name":"Brunch A","city":"dar","status":"published","organizerHandle":"thebrunchcity","dateLabel":"Sat, 6 Sep","venue":"The Slipway, Msasani"},{"id":"ev-B","name":"Offshore B","city":"dar","status":"published","organizerHandle":"offshore","dateLabel":"Sun, 7 Sep","venue":"Coco Beach"}]' where name='events';
SQL

echo "== boot API (XBRIDGE_MOCK, mock SMS/email) =="
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key SMS_DRIVER=mock EMAIL_DRIVER=mock \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
BASE="http://localhost:$API_PORT"
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(v==null?"":String(v))}catch{process.stdout.write("")}})' "$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
TD="$BASE/api/org/events/ev-A/ticket-design"

curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
for o in o1 o2; do
  curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/$o/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
done
curl -s -c "$SNAP/org" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/off" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"offshore","password":"orgpass123"}' >/dev/null

# a real credential on ev-A (gate cash sale = simplest issuance path)
SELLER=$(curl -s -b "$SNAP/org" -X POST "$BASE/api/org/scanners" -H 'content-type: application/json' -d '{"name":"Cashier","contact":"0712000001","eventId":"ev-A","role":"agent","canSell":true}')
STOKEN=$(curl -s -X POST "$BASE/api/scan/session" -H 'content-type: application/json' -d "{\"code\":\"$(echo "$SELLER" | jget code)\"}" | jget token)
curl -s -H "authorization: Bearer $STOKEN" -H 'content-type: application/json' -X POST "$BASE/api/scan/sell" \
  -d '{"tier":"t-ga","qty":1,"method":"cash","buyerPhone":"0712000999"}' >/dev/null
read CODE SIG REF <<< "$(psql_one "select code||' '||signature||' '||public_ref from credential where state='issued' order by issued_at desc limit 1")"
EXPECT="zora:$CODE:$SIG"
DRAFT='{"template":"full_colour","accent":"#F4A259","inheritStorefront":true,"sponsorLogos":[],"showFields":["guest_name","seat","pass_type"]}'

echo ""
echo "== D1 — flag off: GET enabled:false, PUT refused =="
[ "$(curl -s -b "$SNAP/org" "$TD" | jget enabled)" = "false" ] && echo "  ✓ enabled:false" || { echo "  ✗ enabled not false"; fail=1; }
c=$(code -b "$SNAP/org" -X PUT "$TD" -H 'content-type: application/json' -d "$DRAFT")
[ "$c" = "403" ] && echo "  ✓ PUT with flag off → 403" || { echo "  ✗ PUT flag off → $c"; fail=1; }

curl -s -b "$SNAP/admin" -X PUT "$BASE/api/settings/flags" -H 'content-type: application/json' \
  -d '{"flags":{"zp_pass_design":{"orgs":["thebrunchcity","offshore"]}}}' >/dev/null

echo ""
echo "== D2 — validation =="
d2=0
for bad in '{"accent":"orange"}' '{"bgImage":"http://insecure.example/a.png"}' '{"logoUrl":"javascript:alert(1)"}' \
           '{"template":"neon"}' '{"sponsorLogos":["https://a/1.png","https://a/2.png","https://a/3.png","https://a/4.png","https://a/5.png"]}' \
           '{"showFields":["ssn"]}'; do
  c=$(code -b "$SNAP/org" -X PUT "$TD" -H 'content-type: application/json' -d "$bad")
  [ "$c" = "400" ] || { echo "  ✗ $bad → $c (want 400)"; d2=1; }
done
[ "$d2" = "0" ] && echo "  ✓ bad hex / http URL / js URL / template / 5 sponsors / unknown field → 400" || fail=1

echo ""
echo "== D3 — save draft =="
OUT=$(curl -s -b "$SNAP/org" -X PUT "$TD" -H 'content-type: application/json' -d "$DRAFT")
[ "$(echo "$OUT" | jget ok)" = "true" ] || { echo "  ✗ PUT → $OUT"; fail=1; }
G=$(curl -s -b "$SNAP/org" "$TD")
if [ "$(echo "$G" | jget draft.accent)" = "#F4A259" ] && [ "$(echo "$G" | jget status)" = "draft" ] && [ "$(echo "$G" | jget enabled)" = "true" ]; then
  echo "  ✓ draft saved (accent #F4A259, status draft)"
else echo "  ✗ GET → $G"; fail=1; fi

echo ""
echo "== D4 — preview.svg renders the draft with a sample guest =="
H=$(curl -s -b "$SNAP/org" -D - -o "$SNAP/prev.svg" "$TD/preview.svg" | tr -d '\r')
d4=0
echo "$H" | grep -q '^HTTP/1.1 200' || { echo "  ✗ preview status"; d4=1; }
echo "$H" | grep -qi '^content-type: image/svg+xml' || { echo "  ✗ preview content-type"; d4=1; }
grep -qF 'data-template="full_colour"' "$SNAP/prev.svg" || { echo "  ✗ preview template"; d4=1; }
grep -qF '#F4A259' "$SNAP/prev.svg" || { echo "  ✗ preview accent"; d4=1; }
grep -qF 'Brunch A' "$SNAP/prev.svg" || { echo "  ✗ preview event name"; d4=1; }
UNSAVED=$(node -pe 'encodeURIComponent(JSON.stringify({template:"classic_black",accent:"#7FD1AE"}))')
curl -s -b "$SNAP/org" "$TD/preview.svg?design=$UNSAVED" -o "$SNAP/prev2.svg"
grep -qF 'data-template="classic_black"' "$SNAP/prev2.svg" && grep -qF '#7FD1AE' "$SNAP/prev2.svg" || { echo "  ✗ ?design= unsaved preview"; d4=1; }
c=$(code -b "$SNAP/org" "$TD/preview.svg?design=%7B%22accent%22%3A%22nope%22%7D")
[ "$c" = "400" ] || { echo "  ✗ invalid ?design= → $c"; d4=1; }
[ "$d4" = "0" ] && echo "  ✓ 200 image/svg+xml, draft + unsaved state previewed, bad input 400" || fail=1

echo ""
echo "== D5 — unpublished draft never reaches the buyer's pass =="
curl -s "$BASE/api/tickets/$REF.svg" -o "$SNAP/pass-pre.svg"
grep -qF '#F4A259' "$SNAP/pass-pre.svg" && { echo "  ✗ draft accent leaked"; fail=1; } || echo "  ✓ buyer pass has no draft accent"

echo ""
echo "== D6 — publish → buyer pass reflects the accent; QR still signed =="
P=$(curl -s -b "$SNAP/org" -X POST "$TD/publish")
[ "$(echo "$P" | jget status)" = "published" ] || { echo "  ✗ publish → $P"; fail=1; }
curl -s "$BASE/api/tickets/$REF.svg" -o "$SNAP/pass-post.svg"
d6=0
grep -qF 'data-template="full_colour"' "$SNAP/pass-post.svg" || { echo "  ✗ template not on pass"; d6=1; }
grep -qF 'fill="#F4A259"' "$SNAP/pass-post.svg" || { echo "  ✗ accent not on pass"; d6=1; }
[ "$(node "$ROOT/db/test/qrdecode.mjs" "$SNAP/pass-post.svg")" = "$EXPECT" ] || { echo "  ✗ QR not signed payload"; d6=1; }
[ "$(psql_one "select status||' '||accent||' '||template from ticket_design where event_id='ev-A'")" = "published #F4A259 full_colour" ] || { echo "  ✗ row not published"; d6=1; }
[ "$d6" = "0" ] && echo "  ✓ published accent + template on /api/tickets/:ref.svg, QR scannable" || fail=1

echo ""
echo "== D7 — another organizer can't read or touch ev-A's design =="
d7=0
for spec in "GET $TD" "PUT $TD" "POST $TD/publish" "GET $TD/preview.svg"; do
  m=${spec%% *}; u=${spec#* }
  c=$(code -b "$SNAP/off" -X "$m" "$u" -H 'content-type: application/json' -d "$DRAFT")
  [ "$c" = "404" ] || [ "$c" = "403" ] || { echo "  ✗ offshore $m → $c"; d7=1; }
done
c=$(code -X GET "$TD")
[ "$c" = "401" ] || [ "$c" = "403" ] || { echo "  ✗ anonymous GET → $c"; d7=1; }
[ "$d7" = "0" ] && echo "  ✓ other org → 404, anonymous → 401/403" || fail=1

echo ""
[ "$fail" = "0" ] && echo "TICKET DESIGN E2E: PASS" || { echo "TICKET DESIGN E2E: FAIL"; tail -20 "$SNAP/api.log"; exit 1; }
