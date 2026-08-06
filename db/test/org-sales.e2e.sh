#!/usr/bin/env bash
# MT3 org sales / reporting gate. Boots the real API on a throwaway Postgres
# (XBRIDGE_MOCK) and proves GET /api/org/summary + GET /api/org/orders:
#   1. Revenue = SUM(order_item.unit_price*quantity) for PAID orders only; a
#      pending (unpaid) order is EXCLUDED from revenue and order count.
#   2. sold == inventory_pool.sold_count (C2); a HOLD (from the unpaid checkout)
#      does NOT count as sold.
#   3. Cross-org isolation — org A never sees org B's events/orders and vice versa.
#   4. ?eventId= foreign to the acting org → empty (no leak); own eventId scopes.
#   5. Buyer contacts shown in FULL to the owning organizer; credentials expose public_ref, NOT code.
#   6. BS35 — SPLIT revenue is counted. A `table_share` order has NO order_item
#      (0006), so the old order_item-only query valued every split at ZERO. The
#      union must surface it.
#   7. BS35 — net comes from the rate STAMPED on the order at pay time. Changing
#      the organizer's commission AFTER a sale must not move that sale's earnings.
#   8. BS35 — refunded money leaves earnings (it must not stay withdrawable),
#      including a refunded SPLIT seat.
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

-- BS35: a split-enabled TABLE tier on the same (org A) event. Its money lives in
-- split_share.amount, never in order_item — the case that used to read as zero.
insert into product_tier (id, event_id, name, kind, capacity, split_enabled, split_window_secs)
  values ('t-brunch-tbl','brunch-vol-09','Brunch Table', 'table', 5, true, 2700) on conflict do nothing;
insert into price_version (tier_id, price, currency, fee_treatment) select 't-brunch-tbl', 90000, 'TZS', 'included'
  where not exists (select 1 from price_version where tier_id='t-brunch-tbl');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-brunch-tbl', 5, 5) on conflict do nothing;

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
// 20 GA + the 5-table split tier added for the BS35 split-revenue case (§6).
t("brunch capacity == 25 (GA 20 + table tier 5, summed across the tiers of the event)", brunch && brunch.capacity === 25);

// ---- 1b. BS31 commission: net = revenue × (1 − rate); default 5% ----
t("org A totals.commissionRate == 0.05 (default)", sumA.totals.commissionRate === 0.05);
t("org A totals.netRevenue == 95000 (100000 net of 5%)", sumA.totals.netRevenue === 95000);
t("brunch netRevenue == 95000 (event-level net of 5%)", brunch && brunch.netRevenue === 95000);

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
t("buyer phone shown in FULL to the organizer (not masked)",
  paid && paid.buyer.phone && !paid.buyer.phone.includes("*") && paid.buyer.phone.endsWith("670"));
t("buyer email shown in FULL to the organizer",
  paid && paid.buyer.email === "alice@example.com");
t("credentials expose public_ref (2 refs), NOT the raw code",
  paid && Array.isArray(paid.credentials) && paid.credentials.length === 2 &&
  paid.credentials.includes(rawRef) && !paid.credentials.includes(rawCode));
t("raw code and public_ref differ (sanity)", rawCode && rawRef && rawCode !== rawRef);

// pending order present in the (not-paid-only) orders list but with pending status
t("org A orders list includes the pending order (status pending)",
  ordA.some(o => o.status === "pending"));
' 2>&1 || true)
echo "$RESULT"
echo "$RESULT" | grep -q '✗' && fail=1

# ════════════════════════════════════════════════════════════════════════════
# BS35 — point-in-time commission, split revenue, refunds.
# ════════════════════════════════════════════════════════════════════════════
CORE="$ROOT/packages/core/dist/index.js"
# Same signing key the API booted with, or the invite tokens we mint here would
# not verify at POST /api/splits/claim.
CORE_ENV="DATABASE_URL=$URL TICKET_SIGNING_KEY=e2e-ticket-key SESSION_SECRET=e2e XBRIDGE_MOCK=true SMS_DRIVER=mock EMAIL_DRIVER=mock"

echo ""
echo "== 6. SPLIT REVENUE IS COUNTED (a table_share order has NO order_item) =="
# Host the table through core (POST /api/splits needs a consumer OTP session);
# the seats are then claimed + paid over the REAL HTTP path, which is what stamps
# the commission on each share order.
cat > "$SNAP/mksplit.js" <<'JS'
const path = require('path');
const { db, createTableSplit, closeDb } = require(process.env.CORE);
(async () => {
  const r = await createTableSplit(db(), { hostPhone: '255700000900', tierId: 't-brunch-tbl', capacityN: 3, feeRate: 0 });
  if (!r.ok) throw new Error('createTableSplit failed: ' + r.reason);
  // splitId, then one line per invitee token (the host seat has no token).
  console.log(r.splitId);
  for (const s of r.shares) if (s.token) console.log(s.token + ' ' + s.amount);
  await closeDb();
})().catch((e) => { console.error(e); process.exit(1); });
JS
SPLIT_OUT=$(env CORE="$CORE" DATABASE_URL="$URL" TICKET_SIGNING_KEY=e2e-ticket-key SESSION_SECRET=e2e \
  XBRIDGE_MOCK=true SMS_DRIVER=mock EMAIL_DRIVER=mock node "$SNAP/mksplit.js")
SPLIT_ID=$(echo "$SPLIT_OUT" | sed -n '1p')
TOK1=$(echo "$SPLIT_OUT" | sed -n '2p' | cut -d' ' -f1)
TOK2=$(echo "$SPLIT_OUT" | sed -n '3p' | cut -d' ' -f1)
SHARE_AMT=$(echo "$SPLIT_OUT" | sed -n '2p' | cut -d' ' -f2)
[ -n "$SPLIT_ID" ] && [ -n "$TOK1" ] && [ -n "$TOK2" ] && [ "$SHARE_AMT" = "30000" ] \
  && echo "  ✓ hosted a 3-way table on t-brunch-tbl (90000 TZS → 3 × $SHARE_AMT)" \
  || { echo "  ✗ split seed: $SPLIT_OUT"; fail=1; }

# claim_and_pay(jar, token, phone) → drives one seat to paid over HTTP
claim_and_pay() {
  local jar="$1" token="$2" phone="$3"
  local oid
  oid=$(curl -s -c "$jar" -b "$jar" -X POST "$BASE/api/splits/claim" -H 'content-type: application/json' \
    -d "{\"token\":\"$token\",\"phone\":\"$phone\"}" | jq_get orderId)
  [ -n "$oid" ] || return 1
  pay_to_paid "$jar" "$oid" "$phone" || return 1
  echo "$oid"
}
SHARE_ORDER_1=$(claim_and_pay "$SNAP/seat1" "$TOK1" 0712000901) || { echo "  ✗ seat 1 never reached paid"; fail=1; }
SHARE_ORDER_2=$(claim_and_pay "$SNAP/seat2" "$TOK2" 0712000902) || { echo "  ✗ seat 2 never reached paid"; fail=1; }
echo "  ✓ 2 of 3 seats paid over HTTP (orders $SHARE_ORDER_1, $SHARE_ORDER_2)"

# Ground truth: these orders really have no order_item, and they ARE stamped.
N_ITEMS=$(psql_one "select count(*) from order_item where order_id in ('$SHARE_ORDER_1','$SHARE_ORDER_2')")
N_STAMPED=$(psql_one "select count(*) from \"order\" where id in ('$SHARE_ORDER_1','$SHARE_ORDER_2') and commission_rate = 0.05")
[ "$N_ITEMS" = "0" ] && [ "$N_STAMPED" = "2" ] \
  && echo "  · DB truth: share orders have 0 order_item rows AND both carry commission_rate=0.05 (D1 stamp)" \
  || { echo "  ✗ share orders: order_item=$N_ITEMS stamped=$N_STAMPED (want 0 / 2)"; fail=1; }

SUM6=$(curl -s -b "$SNAP/orgA" "$BASE/api/org/summary")
R6=$(SUM="$SUM6" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const s=JSON.parse(process.env.SUM); const ev=s.events.find(e=>e.id==="brunch-vol-09");
// 100000 (GA) + 2 × 30000 (split seats). Before BS35 the split half read as ZERO.
t("brunch revenue == 160000 (100000 GA + 60000 SPLIT — split money is no longer invisible)", ev && ev.revenue===160000);
t("brunch netRevenue == 152000 (95000 + 2×28500, netted PER ORDER)", ev && ev.netRevenue===152000);
t("org A totals.revenue == 160000", s.totals.revenue===160000);
t("org A totals.netRevenue == 152000", s.totals.netRevenue===152000);
t("org A totals.orders == 3 (1 GA + 2 share orders)", s.totals.orders===3);
t("org A totals.commissionRate == 0.05 (all stamps agree)", s.totals.commissionRate===0.05);
' 2>&1 || true)
echo "$R6"; echo "$R6" | grep -q '✗' && fail=1

echo ""
echo "== 7. NET COMES FROM THE STAMPED RATE — a rate change does NOT rewrite history =="
SET_COMM=$(curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/commission" \
  -H 'content-type: application/json' -d '{"commissionRate":0.20}')
echo "$SET_COMM" | grep -q '"commissionRate":0.2' \
  && echo "  ✓ admin raised thebrunchcity 5% → 20%" || { echo "  ✗ set commission: $SET_COMM"; fail=1; }

SUM7=$(curl -s -b "$SNAP/orgA" "$BASE/api/org/summary")
ME7=$(curl -s -b "$SNAP/orgA" "$BASE/api/org/me")
R7=$(SUM="$SUM7" ME="$ME7" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const s=JSON.parse(process.env.SUM), me=JSON.parse(process.env.ME);
const ev=s.events.find(e=>e.id==="brunch-vol-09");
// THE regression this whole PR exists to prevent: before BS35 net was
// revenue × the LIVE org rate, so this single admin edit would have silently
// rewritten 152000 → 128000 of already-earned money.
t("brunch netRevenue STILL 152000 after the rate change (not 128000)", ev && ev.netRevenue===152000);
t("org A totals.netRevenue STILL 152000", s.totals.netRevenue===152000);
t("org A totals.revenue unchanged at 160000", s.totals.revenue===160000);
t("summary commissionRate still reports the STAMPED 0.05, not the new 0.20", s.totals.commissionRate===0.05);
t("GET /api/org/me reports the NEW live rate 0.20 (what the next sale will use)", me.commissionRate===0.2);
' 2>&1 || true)
echo "$R7"; echo "$R7" | grep -q '✗' && fail=1

# A NEW sale must pick up the new rate — the stamp is point-in-time, not frozen.
OA_NEW=$(checkout "$SNAP/buyerA3" t-brunch 1 0712345671 alice3@example.com)
pay_to_paid "$SNAP/buyerA3" "$OA_NEW" 0712345671 || { echo "  ✗ post-change order never reached paid"; fail=1; }
NEW_RATE=$(psql_one "select commission_rate from \"order\" where id='$OA_NEW'")
OLD_RATE=$(psql_one "select commission_rate from \"order\" where id='$OA_PAID'")
[ "$NEW_RATE" = "0.20000" ] && [ "$OLD_RATE" = "0.05000" ] \
  && echo "  ✓ new order stamped 0.20000 while the older order keeps 0.05000 (two rates coexist)" \
  || { echo "  ✗ stamps: new=$NEW_RATE old=$OLD_RATE (want 0.20000 / 0.05000)"; fail=1; }

SUM7B=$(curl -s -b "$SNAP/orgA" "$BASE/api/org/summary")
R7B=$(SUM="$SUM7B" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const s=JSON.parse(process.env.SUM); const ev=s.events.find(e=>e.id==="brunch-vol-09");
t("brunch revenue == 210000 (160000 + the new 50000)", ev && ev.revenue===210000);
// 152000 (old, at 5%) + 40000 (new 50000 at 20%) — each order netted at its OWN rate.
t("brunch netRevenue == 192000 (152000 @5% + 40000 @20%)", ev && ev.netRevenue===192000);
t("totals.orders == 4", s.totals.orders===4);
// Rates now differ, so the scalar becomes the revenue-weighted blend: 18000/210000.
t("totals.commissionRate == 0.08571 (revenue-weighted blend of 5% and 20%)", s.totals.commissionRate===0.08571);
' 2>&1 || true)
echo "$R7B"; echo "$R7B" | grep -q '✗' && fail=1

echo ""
echo "== 8. REFUNDED MONEY LEAVES EARNINGS (it must not stay withdrawable) =="
cat > "$SNAP/refund.js" <<'JS'
const { db, refundOrder, closeDb } = require(process.env.CORE);
(async () => {
  const r = await refundOrder(db(), process.argv[2]);
  console.log(JSON.stringify(r));
  await closeDb();
  if (!r.ok) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
JS
run_refund() { env CORE="$CORE" DATABASE_URL="$URL" node "$SNAP/refund.js" "$1"; }

# 8a. refund the 50000 GA order that was stamped at 20%.
REF1=$(run_refund "$OA_NEW") || { echo "  ✗ refund of $OA_NEW failed: $REF1"; fail=1; }
REF1_STATUS=$(psql_one "select status from \"order\" where id='$OA_NEW'")
[ "$REF1_STATUS" = "refunded" ] && echo "  ✓ GA order refunded → status=refunded ($REF1)" \
  || { echo "  ✗ refund status=$REF1_STATUS"; fail=1; }

SUM8A=$(curl -s -b "$SNAP/orgA" "$BASE/api/org/summary")
R8A=$(SUM="$SUM8A" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const s=JSON.parse(process.env.SUM); const ev=s.events.find(e=>e.id==="brunch-vol-09");
t("brunch revenue back to 160000 (the refunded 50000 is gone)", ev && ev.revenue===160000);
t("brunch netRevenue back to 152000 (the 40000 net is NOT withdrawable)", ev && ev.netRevenue===152000);
t("totals.orders back to 3 (a fully refunded order is not a paid order)", s.totals.orders===3);
t("totals.refundedRevenue == 50000 (the debit is visible, not hidden)", s.totals.refundedRevenue===50000);
t("totals.commissionRate back to 0.05 (only 5%-stamped money remains)", s.totals.commissionRate===0.05);
' 2>&1 || true)
echo "$R8A"; echo "$R8A" | grep -q '✗' && fail=1

# 8b. refund a paid SPLIT SEAT — the path that used to leave `refund_pending`
#     tables with their shares stuck on 'paid' and the money in the balance forever.
REF2=$(run_refund "$SHARE_ORDER_1") || { echo "  ✗ refund of share order failed: $REF2"; fail=1; }
SHARE_STATE=$(psql_one "select state from split_share where order_id='$SHARE_ORDER_1'")
[ "$SHARE_STATE" = "refunded" ] && echo "  ✓ split seat refunded → split_share.state=refunded (no longer 'paid' forever)" \
  || { echo "  ✗ split_share state=$SHARE_STATE (want refunded)"; fail=1; }

SUM8B=$(curl -s -b "$SNAP/orgA" "$BASE/api/org/summary")
R8B=$(SUM="$SUM8B" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const s=JSON.parse(process.env.SUM); const ev=s.events.find(e=>e.id==="brunch-vol-09");
t("brunch revenue == 130000 (160000 − the refunded 30000 seat)", ev && ev.revenue===130000);
t("brunch netRevenue == 123500 (152000 − 28500)", ev && ev.netRevenue===123500);
t("totals.orders == 2", s.totals.orders===2);
t("totals.refundedRevenue == 80000 (50000 GA + 30000 seat)", s.totals.refundedRevenue===80000);
' 2>&1 || true)
echo "$R8B"; echo "$R8B" | grep -q '✗' && fail=1

# A refund is not repeatable — the money can only leave once.
REF3=$(run_refund "$SHARE_ORDER_1" 2>/dev/null || true)
echo "$REF3" | grep -q 'not_refundable' \
  && echo "  ✓ re-refunding the same order → not_refundable (no double debit)" \
  || { echo "  ✗ double refund was allowed: $REF3"; fail=1; }

# Cross-org isolation still holds with all of BS35 in play.
SUM_B2=$(curl -s -b "$SNAP/orgB" "$BASE/api/org/summary")
echo "$SUM_B2" | grep -q 'brunch-vol-09' && { echo "  ✗ org B summary leaked org A's event"; fail=1; } \
  || echo "  ✓ org B summary still excludes org A entirely (isolation holds)"

[ "$fail" = "0" ] || { echo ""; echo "ORG SALES E2E: FAIL"; cat "$SNAP/api.log" | tail -25; exit 1; }
echo ""
echo "ORG SALES E2E: PASS (paid-only revenue · sold_count not holds · cross-org isolation · eventId scope · full buyer contacts · public_ref creds · split revenue counted · net from the STAMPED rate · refunds debited)"
