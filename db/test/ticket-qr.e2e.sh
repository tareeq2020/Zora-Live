#!/usr/bin/env bash
# BS109 — the web pass QR must be SCANNABLE at the gate. Regression guard for the
# bug where /api/tickets/:code.svg encoded the app deep link `zora://t/<ref>`,
# which the gate scanner (parseQrPayload) rejects → every SMS/web pass scanned as
# "not valid". The fix embeds the signed credential payload `zora:<code>:<sig>`.
# Proves:
#   T1  the ticket SVG's QR decodes to the SIGNED payload zora:<code>:<sig>
#       (NOT the deep link) — decoded via resvg + jsqr (qrdecode.mjs).
#   T2  scanning that decoded QR at the gate → valid (admits the pass).
#   T3  the old app-deep-link form is still (correctly) rejected as not-a-pass —
#       documents WHY the fix was needed.
#
# Throwaway Postgres 17 (NEVER prod). XBRIDGE_MOCK + mock SMS/email. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55716}"
API_PORT="${TEST_API_PORT:-4216}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-tqr-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-tqrsnap-XXXXXX")"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_tqr
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_tqr"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null
psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_tqr -v ON_ERROR_STOP=1 -c "$1"; }

echo "== seed: thebrunchcity ev-A (t-ga cap 10 @ 20000) =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_tqr -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id,name,city,status) values ('ev-A','Brunch A','dar','published') on conflict do nothing;
insert into product_tier (id,event_id,name,capacity) values ('t-ga','ev-A','GA',10) on conflict do nothing;
insert into price_version (tier_id,price,currency) select 't-ga',20000,'TZS' where not exists (select 1 from price_version where tier_id='t-ga');
insert into inventory_pool (product_tier_id,capacity,available_count) values ('t-ga',10,10) on conflict do nothing;
update collection_store set data='[{"id":"ev-A","name":"Brunch A","city":"dar","status":"published","organizerHandle":"thebrunchcity","dateLabel":"Sat, 6 Sep","venue":"The Slipway, Msasani"}]' where name='events';
SQL

echo "== boot API (XBRIDGE_MOCK, mock SMS/email) =="
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key SMS_DRIVER=mock EMAIL_DRIVER=mock \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
BASE="http://localhost:$API_PORT"
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(v==null?"":String(v))}catch{process.stdout.write("")}})' "$1"; }

# a SELLER (can_sell), scoped to ev-A, minted through the real org path
curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/org" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null
SELLER=$(curl -s -b "$SNAP/org" -X POST "$BASE/api/org/scanners" -H 'content-type: application/json' -d '{"name":"Cashier Gate A","contact":"0712000001","eventId":"ev-A","role":"agent","canSell":true}')
SCODE=$(echo "$SELLER" | jget code)
STOKEN=$(curl -s -X POST "$BASE/api/scan/session" -H 'content-type: application/json' -d "{\"code\":\"$SCODE\"}" | jget token)

# mint a real credential (a gate cash sale is the simplest issuance path)
curl -s -H "authorization: Bearer $STOKEN" -H 'content-type: application/json' -X POST "$BASE/api/scan/sell" \
  -d '{"tier":"t-ga","qty":1,"method":"cash","buyerPhone":"0712000999"}' >/dev/null
read CODE SIG REF <<< "$(psql_one "select code||' '||signature||' '||public_ref from credential where state='issued' order by issued_at desc limit 1")"
EXPECT="zora:$CODE:$SIG"

echo ""
echo "== T1 — the web pass SVG QR decodes to the SIGNED payload =="
curl -s "$BASE/api/tickets/$REF.svg" -o "$SNAP/pass.svg"
GOT=$(node "$ROOT/db/test/qrdecode.mjs" "$SNAP/pass.svg")
if [ "$GOT" = "$EXPECT" ]; then
  echo "  ✓ QR = zora:<code>:<sig> (scannable + verifiable)"
else
  echo "  ✗ QR mismatch"; echo "    got:    $GOT"; echo "    expect: $EXPECT"; fail=1
fi

echo ""
echo "== T2 — scanning that QR at the gate → valid =="
OUT=$(curl -s -H "authorization: Bearer $STOKEN" -H 'content-type: application/json' -X POST "$BASE/api/scan/verify" \
  -d "$(node -pe 'JSON.stringify({qr:process.argv[1]})' "$GOT")")
[ "$(echo "$OUT" | jget outcome)" = "valid" ] && echo "  ✓ gate scan → valid" || { echo "  ✗ scan → $OUT"; fail=1; }

echo ""
echo "== T3 — the old app-deep-link form is (still) rejected — why the fix mattered =="
OUT=$(curl -s -H "authorization: Bearer $STOKEN" -H 'content-type: application/json' -X POST "$BASE/api/scan/verify" \
  -d "$(node -pe 'JSON.stringify({qr:"zora://t/"+process.argv[1]})' "$REF")")
[ "$(echo "$OUT" | jget outcome)" = "invalid" ] && echo "  ✓ zora://t/<ref> → invalid (unscannable — the bug we fixed)" || { echo "  ✗ expected invalid, got $OUT"; fail=1; }

echo ""
echo "== T4 — the pass shows the REAL event details, not the placeholders (XBR-348) =="
# the SVG carries event/date/venue/tier as literal <text>; assert they're the
# seeded values and that none of the vendor placeholders leaked through.
SVG="$SNAP/pass.svg"
d4=0
for want in "Brunch A" "Sat, 6 Sep" "The Slipway" "$REF"; do
  grep -qF "$want" "$SVG" || { echo "  ✗ missing on pass: $want"; d4=1; }
done
for bad in "Untitled Event" "Date TBA" "Venue TBA"; do
  grep -qF "$bad" "$SVG" && { echo "  ✗ placeholder leaked: $bad"; d4=1; }
done
[ "$d4" = "0" ] && echo "  ✓ pass shows event name, date, venue + ref (no Untitled/TBA placeholders)" || fail=1

echo ""
echo "== T5 — BS130: flag zp_pass_design OFF for this org → the classic pass, byte-identical =="
ORGID=$(psql_one "select id from organizer where handle='thebrunchcity'")
psql_one "insert into theme (organizer_id, accent) values ('$ORGID', '#7FD1AE') on conflict (organizer_id) do update set accent='#7FD1AE'" >/dev/null
# flag on for SOMEONE ELSE only — this org must still get exactly the pre-BS130 pass
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/settings/flags" -H 'content-type: application/json' \
  -d '{"flags":{"zp_pass_design":{"on":false,"orgs":["someone-else"]}}}' >/dev/null
curl -s "$BASE/api/tickets/$REF.svg" -o "$SNAP/pass-off.svg"
d5=0
cmp -s "$SVG" "$SNAP/pass-off.svg" || { echo "  ✗ flag-off pass differs from the pre-flag pass"; d5=1; }
grep -qF 'THE TICKET IS THE PRODUCT' "$SNAP/pass-off.svg" || { echo "  ✗ classic footer missing"; d5=1; }
grep -qF 'data-pass="branded"' "$SNAP/pass-off.svg" && { echo "  ✗ branded pass leaked with the flag off"; d5=1; }
grep -qiF '#7FD1AE' "$SNAP/pass-off.svg" && { echo "  ✗ organizer accent leaked with the flag off"; d5=1; }
[ "$d5" = "0" ] && echo "  ✓ flag off → classic pass unchanged (storefront accent ignored)" || fail=1

echo ""
echo "== T6 — flag ON → storefront accent on the pass; QR still the signed payload =="
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/settings/flags" -H 'content-type: application/json' \
  -d '{"flags":{"zp_pass_design":{"orgs":["thebrunchcity"]}}}' >/dev/null
curl -s "$BASE/api/tickets/$REF.svg" -o "$SNAP/pass-on.svg"
d6=0
grep -qF 'data-pass="branded"' "$SNAP/pass-on.svg" || { echo "  ✗ not the branded pass"; d6=1; }
grep -qF 'fill="#7FD1AE"' "$SNAP/pass-on.svg" || { echo "  ✗ storefront accent not applied"; d6=1; }
for want in "Brunch A" "Sat, 6 Sep" "$REF" "ZoraPass" "Turn your brightness up"; do
  grep -qF "$want" "$SNAP/pass-on.svg" || { echo "  ✗ missing on branded pass: $want"; d6=1; }
done
GOT6=$(node "$ROOT/db/test/qrdecode.mjs" "$SNAP/pass-on.svg")
[ "$GOT6" = "$EXPECT" ] || { echo "  ✗ branded QR = $GOT6"; d6=1; }
curl -s -o /dev/null -w '%{http_code} %{content_type}' "$BASE/api/tickets/$REF.png" | grep -q '^200 image/png' || { echo "  ✗ branded PNG did not render"; d6=1; }
[ "$d6" = "0" ] && echo "  ✓ flag on → branded pass with the storefront accent, QR still scannable, PNG renders" || fail=1

echo ""
echo "== T7 — published ticket_design beats the storefront; an unpublished draft never shows =="
psql_one "insert into ticket_design (event_id, template, accent, status, draft, published_at)
          values ('ev-A', 'classic_black', '#F4A259', 'published', '{\"accent\":\"#3D5AFE\"}', now())" >/dev/null
curl -s "$BASE/api/tickets/$REF.svg" -o "$SNAP/pass-td.svg"
d7=0
grep -qF 'data-template="classic_black"' "$SNAP/pass-td.svg" || { echo "  ✗ published template not applied"; d7=1; }
grep -qF '#F4A259' "$SNAP/pass-td.svg" || { echo "  ✗ published accent not applied"; d7=1; }
grep -qF '#3D5AFE' "$SNAP/pass-td.svg" && { echo "  ✗ DRAFT accent leaked to buyers"; d7=1; }
[ "$(node "$ROOT/db/test/qrdecode.mjs" "$SNAP/pass-td.svg")" = "$EXPECT" ] || { echo "  ✗ QR broken on classic_black"; d7=1; }
[ "$d7" = "0" ] && echo "  ✓ published design wins, draft stays private, QR fixed" || fail=1

echo ""
[ "$fail" = "0" ] && echo "TICKET QR E2E: PASS (web pass carries the signed, scannable QR + real event details)" || { echo "TICKET QR E2E: FAIL"; exit 1; }
