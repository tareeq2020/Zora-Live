#!/usr/bin/env bash
# MT2 org events CRUD gate. Boots the real API on a throwaway Postgres and proves
# the whole /api/org/events surface end-to-end:
#   1. Create a SELLABLE drop → event+product_tier+price_version+inventory_pool +
#      blob webCheckout.tiers all land, AND a buyer checkout SUCCEEDS on it (proves
#      provisioning is real — not just rows).
#   2. Draft create → no webCheckout, absent from public /api/events.
#   3. Partial-failure rollback → a tier that fails a relational insert leaves the
#      blob AND the event table untouched (tx atomicity, C4).
#   4. Re-price (C6) → new open price_version + old one closed + blob unitPrice bumped.
#   5. Capacity down below sold (C7) → 400, not 500.
#   6. Delete: with a paid order → 409; a clean draft → archived + gone from /api/events.
#   7. Ownership: org A PUT/DELETE org B's event → 404. KYC-unapproved sellable → 403.
# Self-contained (throwaway local Postgres; XBRIDGE_MOCK). bash 3.2 compatible.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55440}"
API_PORT="${TEST_API_PORT:-4115}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-mt2-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-mt2snap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers organizers audit admin events kyc"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

echo "== throwaway Postgres @ :$PG_PORT + migrate (0001..0005) + backfill =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_mt2
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_mt2"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

echo "== approve KYC for offshore (o2); leave basement (o3) unapproved =="
cat > "$SNAP/seed-kyc.js" <<'JS'
const { EntityStore } = require(process.env.API_DIR + '/dist/storage/entity-store.js');
(async () => {
  const es = new EntityStore();
  const orgs = await es.read('organizers', []);
  const o2 = orgs.find((o) => o.handle === 'offshore');
  if (o2) o2.kycStatus = 'approved';
  await es.write('organizers', orgs);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
JS
API_DIR="$API_DIR" DATABASE_URL="$URL" node "$SNAP/seed-kyc.js"

echo "== boot API (XBRIDGE_MOCK) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
jq_get() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=Array.isArray(v)&&/^\d+$/.test(p)?v[+p]:v?.[p];process.stdout.write(v==null?"":Array.isArray(v)?String(v.length):String(v))}catch{process.stdout.write("ERR:"+s.slice(0,120))}})' "$1"; }
psql_q() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_mt2 -c "$1"; }

echo "== sessions: admin + org logins =="
curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
# offshore (o2) — KYC approved
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o2/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/offshore" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"offshore","password":"orgpass123"}' >/dev/null
# basement (o3) — KYC unapproved
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o3/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/basement" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"basement","password":"orgpass123"}' >/dev/null

echo ""
echo "== 1. CREATE SELLABLE DROP (offshore) + buyer checkout succeeds =="
CREATE=$(curl -s -b "$SNAP/offshore" -X POST "$BASE/api/org/events" -H 'content-type: application/json' -d '{
  "name":"Neon Night","dateLabel":"SAT 30 AUG 2026","city":"dar","venue":"The Pier","category":"party",
  "priceFrom":50000,"seated":false,"sellable":true,"idempotencyKey":"idem-neon-1",
  "tiers":[{"name":"General Admission","price":50000,"capacity":10}]}')
EVID=$(echo "$CREATE" | jq_get id)
STATUS=$(echo "$CREATE" | jq_get status)
SELLABLE=$(echo "$CREATE" | jq_get sellable)
TIERID=$(echo "$CREATE" | jq_get tiers.0.tierId)
[ -n "$EVID" ] && [ "$STATUS" = "published" ] && [ "$SELLABLE" = "true" ] && [ -n "$TIERID" ] \
  && echo "  ✓ created $EVID (status=published, sellable=true, tier=$TIERID)" \
  || { echo "  ✗ create sellable: $CREATE"; fail=1; }

# all four relational rows + the blob webCheckout landed
n_event=$(psql_q "select count(*) from event where id='$EVID';")
n_tier=$(psql_q "select count(*) from product_tier where id='$TIERID';")
n_price=$(psql_q "select count(*) from price_version where tier_id='$TIERID' and effective_to is null;")
n_pool=$(psql_q "select count(*) from inventory_pool where product_tier_id='$TIERID';")
n_web=$(psql_q "select count(*) from collection_store where name='events' and data like '%webCheckout%$TIERID%';")
[ "$n_event" = "1" ] && [ "$n_tier" = "1" ] && [ "$n_price" = "1" ] && [ "$n_pool" = "1" ] && [ "$n_web" = "1" ] \
  && echo "  ✓ event+product_tier+price_version+inventory_pool+blob webCheckout.tiers all landed" \
  || { echo "  ✗ relational landing: event=$n_event tier=$n_tier price=$n_price pool=$n_pool web=$n_web"; fail=1; }

# idempotency: same key returns the same event, no second drop
CREATE2=$(curl -s -b "$SNAP/offshore" -X POST "$BASE/api/org/events" -H 'content-type: application/json' -d '{
  "name":"Neon Night","dateLabel":"SAT 30 AUG 2026","city":"dar","venue":"The Pier","category":"party",
  "priceFrom":50000,"seated":false,"sellable":true,"idempotencyKey":"idem-neon-1",
  "tiers":[{"name":"General Admission","price":50000,"capacity":10}]}')
EVID2=$(echo "$CREATE2" | jq_get id)
[ "$EVID2" = "$EVID" ] && echo "  ✓ idempotencyKey dedupe → same event $EVID2 (I5)" || { echo "  ✗ idempotency: $CREATE2"; fail=1; }

# buyer checkout on the new drop → paid + credential
CO=$(curl -s -c "$SNAP/buyer" -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
  -d "{\"phone\":\"0712345678\",\"email\":\"buyer@x.co\",\"ageAttested\":true,\"cart\":[{\"tier\":\"$TIERID\",\"quantity\":2}],\"method\":\"mobile\"}")
ORDER=$(echo "$CO" | jq_get orderId)
[ -n "$ORDER" ] && [ "$ORDER" != ERR* ] || { echo "  ✗ checkout on new drop: $CO"; fail=1; }
curl -s -b "$SNAP/buyer" -X POST "$BASE/api/checkout/$ORDER/pay" -H 'content-type: application/json' -d '{"method":"mobile","payerPhone":"0712345678"}' >/dev/null
FINAL=""
for i in $(seq 1 8); do
  ST=$(curl -s -b "$SNAP/buyer" "$BASE/api/orders/$ORDER/status")
  [ "$(echo "$ST" | jq_get status)" = "paid" ] && { FINAL="$ST"; break; }
  sleep 1
done
CREDS=$(echo "$FINAL" | jq_get credentials)
[ "$CREDS" = "2" ] && echo "  ✓ BUYER CHECKOUT SUCCEEDS on new drop → paid, $CREDS credentials (provisioning is real)" \
  || { echo "  ✗ buyer checkout did not reach paid/2 creds. last: $ST"; fail=1; }

# GET reflects live sold = sold_count = 2 (C2)
LIST=$(curl -s -b "$SNAP/offshore" "$BASE/api/org/events")
SOLD=$(echo "$LIST" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const e=d.find(x=>x.id===process.argv[1]);process.stdout.write(String(e?.tiers?.[0]?.sold))' "$EVID")
[ "$SOLD" = "2" ] && echo "  ✓ GET /api/org/events sold=2 (from inventory_pool.sold_count, C2)" || { echo "  ✗ GET sold=$SOLD (want 2)"; fail=1; }

echo ""
echo "== 2. DRAFT CREATE → no webCheckout, absent from public /api/events =="
DRAFT=$(curl -s -b "$SNAP/offshore" -X POST "$BASE/api/org/events" -H 'content-type: application/json' -d '{
  "name":"Quiet Draft","dateLabel":"FRI 01 JAN 2027","city":"dar","venue":"TBD","category":"party",
  "priceFrom":20000,"seated":false,"sellable":false,"tiers":[{"name":"GA","price":20000,"capacity":5}]}')
DRAFTID=$(echo "$DRAFT" | jq_get id)
DSTATUS=$(echo "$DRAFT" | jq_get status)
DSELL=$(echo "$DRAFT" | jq_get sellable)
[ "$DSTATUS" = "draft" ] && [ "$DSELL" = "false" ] && echo "  ✓ draft $DRAFTID (status=draft, sellable=false)" || { echo "  ✗ draft create: $DRAFT"; fail=1; }
n_dtier=$(psql_q "select count(*) from product_tier where event_id='$DRAFTID';")
[ "$n_dtier" = "0" ] && echo "  ✓ draft provisioned NO relational tiers" || { echo "  ✗ draft leaked $n_dtier product_tier rows"; fail=1; }
PUB=$(curl -s "$BASE/api/events")
echo "$PUB" | grep -q "$DRAFTID" && { echo "  ✗ draft leaked into /api/events"; fail=1; } || echo "  ✓ draft absent from public /api/events"

echo ""
echo "== 3. PARTIAL-FAILURE ROLLBACK (tx atomicity, C4) =="
# capacity 3e9 passes the API's positive-integer check but overflows the int event
# catalog columns AFTER the event row inserts → the whole tx must roll back.
BEFORE=$(psql_q "select count(*) from event;")
RB=$(curl -s -o /dev/null -w "%{http_code}" -b "$SNAP/offshore" -X POST "$BASE/api/org/events" -H 'content-type: application/json' -d '{
  "name":"Rollback Drop","dateLabel":"SAT 02 JAN 2027","city":"dar","venue":"X","category":"party",
  "priceFrom":10000,"seated":false,"sellable":true,"tiers":[{"name":"GA","price":10000,"capacity":3000000000}]}')
AFTER=$(psql_q "select count(*) from event;")
n_rbblob=$(psql_q "select count(*) from collection_store where name='events' and data like '%Rollback Drop%';")
[ "$BEFORE" = "$AFTER" ] && [ "$n_rbblob" = "0" ] \
  && echo "  ✓ failed provisioning ($RB) rolled back — event table unchanged (${BEFORE}→${AFTER}), blob has no 'Rollback Drop'" \
  || { echo "  ✗ rollback: event ${BEFORE}→$AFTER, blob match=$n_rbblob (code $RB)"; fail=1; }

echo ""
echo "== 4. RE-PRICE (C6) → new open version + old closed + blob unitPrice bumped =="
curl -s -b "$SNAP/offshore" -X PUT "$BASE/api/org/events/$EVID" -H 'content-type: application/json' -d '{
  "sellable":true,"tiers":[{"name":"General Admission","price":75000,"capacity":10}]}' >/dev/null
n_open=$(psql_q "select count(*) from price_version where tier_id='$TIERID' and effective_to is null;")
n_closed=$(psql_q "select count(*) from price_version where tier_id='$TIERID' and effective_to is not null;")
open_price=$(psql_q "select price from price_version where tier_id='$TIERID' and effective_to is null;")
LIST2=$(curl -s -b "$SNAP/offshore" "$BASE/api/org/events")
NEWPRICE=$(echo "$LIST2" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const e=d.find(x=>x.id===process.argv[1]);process.stdout.write(String(e?.tiers?.[0]?.unitPrice))' "$EVID")
[ "$n_open" = "1" ] && [ "$n_closed" = "1" ] && [ "$open_price" = "75000" ] && [ "$NEWPRICE" = "75000" ] \
  && echo "  ✓ re-priced: 1 open (75000) + 1 closed version; blob unitPrice=75000 (never mutated the price)" \
  || { echo "  ✗ re-price: open=$n_open closed=$n_closed openprice=$open_price blob=$NEWPRICE"; fail=1; }

echo ""
echo "== 5. CAPACITY DOWN BELOW SOLD (C7) → 400, not 500 =="
# 2 sold on this tier; try to drop capacity to 1
CAP=$(code -b "$SNAP/offshore" -X PUT "$BASE/api/org/events/$EVID" -H 'content-type: application/json' -d '{
  "sellable":true,"tiers":[{"name":"General Admission","price":75000,"capacity":1}]}')
[ "$CAP" = "400" ] && echo "  ✓ capacity 1 < sold 2 → 400 (rejected cleanly, not a 500)" || { echo "  ✗ capacity-down → $CAP (want 400)"; fail=1; }

echo ""
echo "== 6a. DELETE with a paid order → 409 has_paid_orders =="
DELPAID=$(curl -s -b "$SNAP/offshore" -X DELETE "$BASE/api/org/events/$EVID")
DELPAID_C=$(code -b "$SNAP/offshore" -X DELETE "$BASE/api/org/events/$EVID")
echo "$DELPAID" | grep -q 'has_paid_orders' && [ "$DELPAID_C" = "409" ] \
  && echo "  ✓ delete drop with paid order → 409 has_paid_orders (I1, no hard-delete)" \
  || { echo "  ✗ delete-with-paid: $DELPAID ($DELPAID_C)"; fail=1; }

echo "== 6b. DELETE a clean draft → archived + gone from /api/events =="
DDEL=$(code -b "$SNAP/offshore" -X DELETE "$BASE/api/org/events/$DRAFTID")
dstat=$(curl -s -b "$SNAP/offshore" "$BASE/api/org/events" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const e=d.find(x=>x.id===process.argv[1]);process.stdout.write(String(e?.status))' "$DRAFTID")
PUB2=$(curl -s "$BASE/api/events")
[ "$DDEL" = "200" ] && [ "$dstat" = "archived" ] && ! echo "$PUB2" | grep -q "$DRAFTID" \
  && echo "  ✓ clean draft soft-deleted → status=archived, absent from /api/events" \
  || { echo "  ✗ draft delete: code=$DDEL status=$dstat"; fail=1; }

echo ""
echo "== 7. OWNERSHIP + KYC gate =="
# offshore tries to PUT basement's event (basement-001) → 404
OWN_PUT=$(code -b "$SNAP/offshore" -X PUT "$BASE/api/org/events/basement-001" -H 'content-type: application/json' -d '{"name":"hijack"}')
[ "$OWN_PUT" = "404" ] && echo "  ✓ org A PUT org B's event → 404" || { echo "  ✗ cross-org PUT → $OWN_PUT (want 404)"; fail=1; }
OWN_DEL=$(code -b "$SNAP/offshore" -X DELETE "$BASE/api/org/events/basement-001")
[ "$OWN_DEL" = "404" ] && echo "  ✓ org A DELETE org B's event → 404" || { echo "  ✗ cross-org DELETE → $OWN_DEL (want 404)"; fail=1; }
# basement (KYC unapproved) tries a sellable create → 403 kyc_required
KYC=$(curl -s -b "$SNAP/basement" -X POST "$BASE/api/org/events" -H 'content-type: application/json' -d '{
  "name":"Unapproved","dateLabel":"SAT 03 JAN 2027","city":"dar","venue":"Y","category":"party",
  "priceFrom":10000,"seated":false,"sellable":true,"tiers":[{"name":"GA","price":10000,"capacity":5}]}')
KYC_C=$(code -b "$SNAP/basement" -X POST "$BASE/api/org/events" -H 'content-type: application/json' -d '{
  "name":"Unapproved","dateLabel":"SAT 03 JAN 2027","city":"dar","venue":"Y","category":"party",
  "priceFrom":10000,"seated":false,"sellable":true,"tiers":[{"name":"GA","price":10000,"capacity":5}]}')
echo "$KYC" | grep -q 'kyc_required' && [ "$KYC_C" = "403" ] \
  && echo "  ✓ KYC-unapproved sellable create → 403 kyc_required (I6)" \
  || { echo "  ✗ kyc gate: $KYC ($KYC_C)"; fail=1; }

echo ""
[ "$fail" = "0" ] || { echo "ORG EVENTS E2E: FAIL"; echo "---- api.log tail ----"; tail -25 "$SNAP/api.log"; exit 1; }
echo "ORG EVENTS E2E: PASS (sellable provisioning + buyer checkout + draft + rollback + re-price + capacity + delete guards + ownership + KYC)"
