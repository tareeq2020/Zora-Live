#!/usr/bin/env bash
# MT3 org sales / reporting gate. Boots the real API on a throwaway Postgres
# (XBRIDGE_MOCK) and proves GET /api/org/summary + GET /api/org/orders:
#   1. Revenue = SUM(order_item.unit_price*quantity) for PAID orders only; a
#      pending (unpaid) order is EXCLUDED from revenue and order count.
#   2. sold == inventory_pool.sold_count (C2); a HOLD (from the unpaid checkout)
#      does NOT count as sold.
#   3. Cross-org isolation — org A never sees org B's events/orders and vice versa.
#   4. ?eventId= foreign to the acting org → empty (no leak); own eventId scopes.
#   5. Buyer PII masked (last 3 chars); credentials expose public_ref, NOT code.
# Reuses the checkout→pay→paid HTTP contract (mirrors checkout-http.e2e.sh) to
# seed real paid orders + issued credentials. Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55439}"
API_PORT="${TEST_API_PORT:-4114}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-sales-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-salessnap-XXXXXX")"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_sales
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_sales"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

echo "== seed relational catalog: org A brunch-vol-09 (thebrunchcity), org B offshore-001 (offshore) =="
# Ownership (organizerHandle) already lives in the backfilled 'events' blob:
#   brunch-vol-09 → thebrunchcity   |   offshore-001 → offshore
# Here we seed only the relational side (event row + tier + price + pool), which
# backfill does not touch.
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_sales -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('brunch-vol-09','Garden Brunch — Vol. 09') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-brunch','brunch-vol-09','GA', 20) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-brunch', 50000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-brunch');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-brunch', 20, 20) on conflict do nothing;

insert into event (id, name) values ('offshore-001','OFFSHORE — The Daytime Yacht Groove') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-offshore','offshore-001','GA', 10) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-offshore', 80000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-offshore');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-offshore', 10, 10) on conflict do nothing;
SQL

echo "== boot API (x-bridge MOCK) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_sales -v ON_ERROR_STOP=1 -c "$1"; }
jq_get() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(v==null?"":Array.isArray(v)?String(v.length):String(v))}catch{process.stdout.write("ERR:"+s.slice(0,120))}})' "$1"; }

# checkout(jar, tier, qty, phone, email) → echoes orderId
checkout() {
  local jar="$1" tier="$2" qty="$3" phone="$4" email="$5"
  curl -s -c "$jar" -b "$jar" -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
    -d "{\"phone\":\"$phone\",\"email\":\"$email\",\"ageAttested\":true,\"cart\":[{\"tier\":\"$tier\",\"quantity\":$qty}],\"method\":\"mobile\"}" | jq_get orderId
}
# pay_to_paid(jar, orderId, payerPhone) → drives to paid
pay_to_paid() {
  local jar="$1" order="$2" phone="$3"
  curl -s -b "$jar" -X POST "$BASE/api/checkout/$order/pay" -H 'content-type: application/json' \
    -d "{\"method\":\"mobile\",\"payerPhone\":\"$phone\"}" >/dev/null
  for i in $(seq 1 8); do
    local s; s=$(curl -s -b "$jar" "$BASE/api/orders/$order/status" | jq_get status)
    [ "$s" = "paid" ] && return 0
    sleep 1
  done
  return 1
}

echo "== seed orders: A paid(2×brunch), A pending(1×brunch, hold only), B paid(1×offshore) =="
OA_PAID=$(checkout "$SNAP/buyerA" t-brunch 2 0712345670 alice@example.com)
pay_to_paid "$SNAP/buyerA" "$OA_PAID" 0712345670 || { echo "  ✗ org A paid order never reached paid"; cat "$SNAP/api.log" | tail -20; exit 1; }
echo "  ✓ org A paid order $OA_PAID (2 × 50000 = 100000 TZS)"
OA_PEND=$(checkout "$SNAP/buyerA2" t-brunch 1 0719999999 pending@example.com)
echo "  ✓ org A pending order $OA_PEND (unpaid → holds 1 unit, must be excluded)"
OB_PAID=$(checkout "$SNAP/buyerB" t-offshore 1 0713333333 bob@example.com)
pay_to_paid "$SNAP/buyerB" "$OB_PAID" 0713333333 || { echo "  ✗ org B paid order never reached paid"; cat "$SNAP/api.log" | tail -20; exit 1; }
echo "  ✓ org B paid order $OB_PAID (1 × 80000 = 80000 TZS)"

# ground-truth from DB: sold_count and available for t-brunch (2 sold, 1 held → avail 17)
BRUNCH_SOLD=$(psql_one "select sold_count from inventory_pool where product_tier_id='t-brunch'")
BRUNCH_AVAIL=$(psql_one "select available_count from inventory_pool where product_tier_id='t-brunch'")
echo "  · DB truth: t-brunch sold_count=$BRUNCH_SOLD available=$BRUNCH_AVAIL (2 sold + 1 held out of 20)"
[ "$BRUNCH_SOLD" = "2" ] && [ "$BRUNCH_AVAIL" = "17" ] || { echo "  ✗ unexpected pool state (want sold=2 avail=17)"; fail=1; }
# raw credential code + public_ref for the paid order (to prove masking exposes ref, not code)
RAW_CODE=$(psql_one "select c.code from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$OA_PAID' limit 1")
RAW_REF=$(psql_one  "select c.public_ref from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$OA_PAID' limit 1")

echo "== org logins (admin sets passwords, then org/login) =="
curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o2/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/orgA" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/orgB" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"offshore","password":"orgpass123"}' >/dev/null

SUM_A=$(curl -s -b "$SNAP/orgA" "$BASE/api/org/summary")
SUM_B=$(curl -s -b "$SNAP/orgB" "$BASE/api/org/summary")
ORD_A=$(curl -s -b "$SNAP/orgA" "$BASE/api/org/orders")
ORD_A_FOREIGN=$(curl -s -b "$SNAP/orgA" "$BASE/api/org/orders?eventId=offshore-001")
ORD_A_OWN=$(curl -s -b "$SNAP/orgA" "$BASE/api/org/orders?eventId=brunch-vol-09")
ORD_B=$(curl -s -b "$SNAP/orgB" "$BASE/api/org/orders")

echo "== 1. summary revenue = paid-only; pending excluded; sold from sold_count (hold not sold) =="
RESULT=$(BRUNCH_SOLD="$BRUNCH_SOLD" RAW_CODE="$RAW_CODE" RAW_REF="$RAW_REF" \
  SUM_A="$SUM_A" SUM_B="$SUM_B" ORD_A="$ORD_A" ORD_A_FOREIGN="$ORD_A_FOREIGN" ORD_A_OWN="$ORD_A_OWN" ORD_B="$ORD_B" \
  node -e '
const t = (name, cond) => console.log((cond ? "  ✓ " : "  ✗ ") + name) || (cond ? 0 : process.exitCode = 1);
const sumA = JSON.parse(process.env.SUM_A);
const sumB = JSON.parse(process.env.SUM_B);
const ordA = JSON.parse(process.env.ORD_A);
const ordAForeign = JSON.parse(process.env.ORD_A_FOREIGN);
const ordAOwn = JSON.parse(process.env.ORD_A_OWN);
const ordB = JSON.parse(process.env.ORD_B);
const brunchSold = Number(process.env.BRUNCH_SOLD);
const rawCode = process.env.RAW_CODE, rawRef = process.env.RAW_REF;

// ---- 1. paid-only revenue + pending excluded + sold_count ----
t("org A totals.revenue == 100000 (2×50000 paid; pending 1×50000 excluded)", sumA.totals.revenue === 100000);
t("org A totals.orders == 1 (pending order not counted)", sumA.totals.orders === 1);
t("org A totals.currency == TZS", sumA.totals.currency === "TZS");
const brunch = sumA.events.find(e => e.id === "brunch-vol-09");
t("org A summary lists brunch-vol-09", !!brunch);
t("brunch revenue == 100000 (paid only)", brunch && brunch.revenue === 100000);
t("brunch sold == sold_count ("+brunchSold+") — HOLD not counted as sold", brunch && brunch.sold === brunchSold && brunch.sold === 2);
t("brunch capacity == 20", brunch && brunch.capacity === 20);

// ---- 2. currency grouping (I7) never mixes ----
t("org A revenueByCurrency single TZS bucket = 100000",
  Array.isArray(sumA.totals.revenueByCurrency) && sumA.totals.revenueByCurrency.length === 1 &&
  sumA.totals.revenueByCurrency[0].currency === "TZS" && sumA.totals.revenueByCurrency[0].revenue === 100000);

// ---- 3. cross-org isolation ----
t("org A summary EXCLUDES org B event offshore-001", !sumA.events.some(e => e.id === "offshore-001"));
t("org A revenue EXCLUDES org B 80000 (no leak into total)", sumA.totals.revenue === 100000);
t("org B totals.revenue == 80000", sumB.totals.revenue === 80000);
t("org B summary EXCLUDES org A event brunch-vol-09", !sumB.events.some(e => e.id === "brunch-vol-09"));
t("org A orders never reference offshore-001", !ordA.some(o => o.eventId === "offshore-001"));
t("org B orders never reference brunch-vol-09", !ordB.some(o => o.eventId === "brunch-vol-09"));

// ---- 4. eventId scoping ----
t("org A ?eventId=offshore-001 (foreign) → [] (no leak)", Array.isArray(ordAForeign) && ordAForeign.length === 0);
t("org A ?eventId=brunch-vol-09 → only brunch orders", ordAOwn.length > 0 && ordAOwn.every(o => o.eventId === "brunch-vol-09"));

// ---- 5. PII masking + credentials public_ref (I4) ----
const paid = ordA.find(o => o.status === "paid");
t("org A orders include the paid order", !!paid);
t("paid order amount == 100000, qty == 2", paid && paid.amount === 100000 && paid.qty === 2);
t("buyer phone masked (last 3 '670' visible, rest hidden)",
  paid && paid.buyerMasked.phone && paid.buyerMasked.phone.endsWith("670") &&
  paid.buyerMasked.phone !== "0712345670" && paid.buyerMasked.phone.startsWith("*"));
t("buyer email masked (last 3 'com' visible, not the full address)",
  paid && paid.buyerMasked.email && paid.buyerMasked.email.endsWith("com") &&
  paid.buyerMasked.email !== "alice@example.com" && paid.buyerMasked.email.includes("*"));
t("credentials expose public_ref (2 refs), NOT the raw code",
  paid && Array.isArray(paid.credentials) && paid.credentials.length === 2 &&
  paid.credentials.includes(rawRef) && !paid.credentials.includes(rawCode));
t("raw code and public_ref differ (sanity)", rawCode && rawRef && rawCode !== rawRef);

// pending order present in the (not-paid-only) orders list but with pending status
t("org A orders list includes the pending order (status pending)",
  ordA.some(o => o.status === "pending"));
' 2>&1)
echo "$RESULT"
echo "$RESULT" | grep -q '✗' && fail=1

[ "$fail" = "0" ] || { echo ""; echo "ORG SALES E2E: FAIL"; cat "$SNAP/api.log" | tail -25; exit 1; }
echo ""
echo "ORG SALES E2E: PASS (paid-only revenue · sold_count not holds · cross-org isolation · eventId scope · PII masked · public_ref creds)"
