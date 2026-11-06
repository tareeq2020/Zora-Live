#!/usr/bin/env bash
# BS153 — CART FUNNEL + PER-CART DETAIL. Boots the real API on a throwaway
# Postgres (x-bridge MOCK) and proves:
#
#   1. A cart that pays logs cart_created → pay_requested → gateway_accepted →
#      paid → passes_issued → buyer_notified, in that order.
#   2. A REJECTED attempt (the prod "Credentials for GODIGITAL not found") stores
#      the error on payment_transaction and shows it on the detail, the list and
#      the funnel's top errors. The attempt is still refused exactly as before.
#   3. An OLD order with no order_event rows still gets a timeline, derived from
#      the tables and marked source:'derived'.
#   4. Funnel stage counts match the seeded carts; checkout beacons count.
#   5. A scan logs checked_in.
#   6. 401 without a session; PII redaction holds on the detail endpoint.
#
# Style mirrors admin-orders.e2e.sh. Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CORE="$ROOT/packages/core/dist/index.js"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-56320}"
API_PORT="${TEST_API_PORT:-4320}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-funnel-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-funnelsnap-XXXXXX")"
USER_NAME="$(whoami)"
REJECT_PHONE="0712999999"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

echo "== throwaway Postgres @ :$PG_PORT + migrate + backfill =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_funnel
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_funnel"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" settings tiers organizers audit admin events kyc >/dev/null

q() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_funnel -v ON_ERROR_STOP=1 -c "$1"; }
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1 → $2"; else echo "  ✗ $1 → $2 (want $3)"; fail=1; fi; }

echo ""
echo "== 0. MIGRATION 0035 =="
check "order_event table" "$(q "select count(*) from information_schema.tables where table_name='order_event'")" 1
check "payment_transaction.error + error_at" "$(q "select count(*) from information_schema.columns where table_name='payment_transaction' and column_name in ('error','error_at')")" 2
check "order_event indexes" "$(q "select count(*) from pg_indexes where indexname in ('order_event_order_at','order_event_step_at')")" 2
check "migration is idempotent (re-run)" "$(DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null 2>&1 && psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_funnel -f "$ROOT/db/migrations/0035_order_funnel.sql" >/dev/null 2>&1 && echo ok)" ok

psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_funnel -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('brunch-vol-09','Garden Brunch — Vol. 09') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-brunch','brunch-vol-09','GA', 40) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-brunch', 50000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-brunch');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-brunch', 40, 40) on conflict do nothing;
update organizer set kyc_status = 'approved' where id in ('o1','o2');
SQL

echo "== boot API (x-bridge MOCK; refuses payer $REJECT_PHONE like prod) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true XBRIDGE_MOCK_REJECT_PHONE="$REJECT_PHONE" \
    COOKIE_SECURE=false SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    SMS_DRIVER=mock EMAIL_DRIVER=mock PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
jx() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let o;try{o=JSON.parse(s)}catch{process.stdout.write("ERR:"+s.slice(0,160));return}try{process.stdout.write(String(eval(process.argv[1])))}catch(e){process.stdout.write("ERR:"+e.message)}})' "$1"; }

checkout() {
  curl -s -c "$1" -b "$1" -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
    -d "{\"phone\":\"$2\",\"email\":\"$3\",\"ageAttested\":true,\"cart\":[{\"tier\":\"t-brunch\",\"quantity\":$4}],\"method\":\"mobile\"}" | jx 'o.orderId'
}
pay() {
  curl -s -o "$SNAP/pay.out" -w '%{http_code}' -b "$1" -X POST "$BASE/api/checkout/$2/pay" -H 'content-type: application/json' \
    -d "{\"method\":\"mobile\",\"payerPhone\":\"$3\"}"
}
pay_to_paid() {
  pay "$1" "$2" "$3" >/dev/null
  for i in $(seq 1 8); do
    s=$(curl -s -b "$1" "$BASE/api/orders/$2/status" | jx 'o.status')
    [ "$s" = "paid" ] && return 0
    sleep 1
  done
  return 1
}

echo ""
echo "== seed carts =="
OA=$(checkout "$SNAP/ja" 0712000001 a@example.com 2)
pay_to_paid "$SNAP/ja" "$OA" 0712000001 || { echo "  ✗ A never paid"; tail -30 "$SNAP/api.log"; exit 1; }
OH=$(checkout "$SNAP/jh" 0712000002 h@example.com 1)
pay_to_paid "$SNAP/jh" "$OH" 0712000002 || { echo "  ✗ H never paid"; exit 1; }
OR=$(checkout "$SNAP/jr" "$REJECT_PHONE" r@example.com 1)
REJ_CODE=$(pay "$SNAP/jr" "$OR" "$REJECT_PHONE")
OP=$(checkout "$SNAP/jp" 0712000004 p@example.com 1)
OE=$(checkout "$SNAP/je" 0712000005 e@example.com 1)
q "update \"order\" set status='expired' where id='$OE'" >/dev/null
# H becomes an "old" order: its log is wiped, so its timeline must be derived.
q "delete from order_event where order_id='$OH'" >/dev/null
echo "  ✓ A paid · H paid (log wiped) · R rejected · P pending · E expired"

echo ""
echo "== 1. A PAID CART LOGS EVERY STEP, IN ORDER =="
curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
DA=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$OA")
WANT="cart_created,pay_requested,gateway_accepted,paid,passes_issued,buyer_notified"
check "A timeline (key steps, in order)" "$(echo "$DA" | jx "o.timeline.map(e=>e.step).filter(s=>'$WANT'.split(',').includes(s)).join(',')")" "$WANT"
check "A key steps all logged (not derived)" "$(echo "$DA" | jx "o.timeline.filter(e=>'$WANT'.split(',').includes(e.step)).every(e=>e.source==='logged')")" true
check "A stageReached" "$(echo "$DA" | jx 'o.stageReached')" passes_delivered
check "A passes issued = 2" "$(echo "$DA" | jx 'o.passes.length')" 2
check "A attempt carries the gateway ref" "$(echo "$DA" | jx 'o.attempts[0].orderReference.startsWith("MOCK-")')" true
check "A has durations" "$(echo "$DA" | jx 'typeof o.durations.cartToPaid')" number
check "A sincePrevMs on 2nd entry" "$(echo "$DA" | jx 'typeof o.timeline[1].sincePrevMs')" number
check "passes_issued detail count" "$(q "select detail->>'count' from order_event where order_id='$OA' and step='passes_issued'")" 2
check "buyer_notified ok" "$(q "select detail->>'ok' from order_event where order_id='$OA' and step='buyer_notified'")" true

echo ""
echo "== 2. A REJECTED ATTEMPT KEEPS ITS REASON =="
check "pay still refused the same way (500)" "$REJ_CODE" 500
check "pay body unchanged" "$(cat "$SNAP/pay.out" | jx 'o.error')" payment_init_failed
check "payment_transaction.error stored" "$(q "select (error like '%Credentials for GODIGITAL not found%')::text from payment_transaction where order_id='$OR'")" true
check "error_at stamped" "$(q "select (error_at is not null)::text from payment_transaction where order_id='$OR'")" true
check "attempt row still 'created' (state machine untouched)" "$(q "select status from payment_transaction where order_id='$OR'")" created
DR=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$OR")
check "detail: attempt error in full" "$(echo "$DR" | jx 'o.attempts[0].error.includes("Credentials for GODIGITAL not found")')" true
check "detail: gateway_rejected on the timeline" "$(echo "$DR" | jx 'o.timeline.some(e=>e.step==="gateway_rejected" && e.source==="logged" && String(e.detail.error).includes("GODIGITAL"))')" true
check "detail: rejected cart stage = payment_started" "$(echo "$DR" | jx 'o.stageReached')" payment_started
check "the error never carries the payer number" "$(echo "$DR" | jx 'JSON.stringify(o.timeline).includes("712999999")')" false
LIST=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders?limit=50")
check "list: latestAttempt.error on R" "$(echo "$LIST" | jx "o.orders.find(x=>x.id==='$OR').latestAttempt.error.includes('GODIGITAL')")" true
check "list: P has no attempt (null)" "$(echo "$LIST" | jx "o.orders.find(x=>x.id==='$OP').latestAttempt")" null
check "list: P stage = cart_created" "$(echo "$LIST" | jx "o.orders.find(x=>x.id==='$OP').stageReached")" cart_created
check "list: A latestAttempt status" "$(echo "$LIST" | jx "o.orders.find(x=>x.id==='$OA').latestAttempt.status")" successful

echo ""
echo "== 3. AN OLD ORDER (NO LOG) GETS A DERIVED TIMELINE =="
check "H has no order_event rows" "$(q "select count(*) from order_event where order_id='$OH'")" 0
DH=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$OH")
check "H derived timeline (key steps, in order)" "$(echo "$DH" | jx "o.timeline.map(e=>e.step).filter(s=>'$WANT'.split(',').includes(s)).join(',')")" "$WANT"
check "H entries all source:derived" "$(echo "$DH" | jx 'o.timeline.length>0 && o.timeline.every(e=>e.source==="derived")')" true
check "H stageReached from tables" "$(echo "$DH" | jx 'o.stageReached')" passes_delivered

echo ""
echo "== 4. CHECKOUT BEACON (aggregate only) =="
T="$BASE/api/v/track"
post() { curl -s -o /dev/null -w '%{http_code}' -X POST "$T" -H 'content-type: application/json' -A "$UA" -d "$1"; }
check "checkout beacon 204" "$(post '{"kind":"checkout","org":"thebrunchcity","event":"brunch-vol-09","anonId":"v1"}')" 204
post '{"kind":"checkout","org":"thebrunchcity","event":"brunch-vol-09","anonId":"v1"}' >/dev/null
post '{"kind":"checkout","org":"thebrunchcity","event":"brunch-vol-09","anonId":"v2"}' >/dev/null
post '{"kind":"checkout","org":"thebrunchcity","anonId":"v3"}' >/dev/null   # no event → ignored
for a in v1 v2 v3 v4; do post "{\"kind\":\"event\",\"org\":\"thebrunchcity\",\"event\":\"brunch-vol-09\",\"anonId\":\"$a\"}" >/dev/null; done
check "checkout views" "$(q "select coalesce(sum(views),0) from analytics_daily where kind='checkout'")" 3
check "checkout unique visitors" "$(q "select coalesce(sum(visitors),0) from analytics_daily where kind='checkout'")" 2
check "event view visitors not eaten by checkout dedupe" "$(q "select coalesce(sum(visitors),0) from analytics_daily where kind='event'")" 4
check "no raw anon id stored" "$(q "select count(*) from analytics_visitor_day where visitor_hash in ('v1','v2')")" 0
check "storefront page views exclude checkout opens" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/storefront-analytics?range=7D" | jx 'o.kpis.pageViews')" 4

echo ""
echo "== 5. A SCAN LOGS checked_in =="
REF=$(q "select c.public_ref from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$OA' order by c.seat_index limit 1")
SCAN=$(DATABASE_URL="$URL" REF="$REF" node -e '
const core=require(process.argv[1]); const sql=core.makeSql();
core.scanCredential(sql,{ref:process.env.REF,actor:{id:"door-1",name:"Door 1"},keys:[]})
  .then(r=>{process.stdout.write(String(r.ok));return sql.end()}).catch(e=>{process.stdout.write("ERR:"+e.message);return sql.end()})' "$CORE")
check "scan ok" "$SCAN" true
check "checked_in logged" "$(q "select count(*) from order_event where order_id='$OA' and step='checked_in'")" 1
check "A stage now checked_in" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$OA" | jx 'o.stageReached')" checked_in

echo ""
echo "== 6. FUNNEL COUNTS MATCH THE SEED =="
F=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/funnel?days=7&org=thebrunchcity")
st() { echo "$F" | jx "o.stages.find(s=>s.stage==='$1').count"; }
check "event_views" "$(st event_views)" 4
check "unique event visitors" "$(echo "$F" | jx 'o.unique.eventVisitors')" 4
check "checkout_opened" "$(st checkout_opened)" 3
check "carts_created (A,H,R,P,E)" "$(st carts_created)" 5
check "payment_started (A,H,R)" "$(st payment_started)" 3
check "gateway_accepted (A,H)" "$(st gateway_accepted)" 2
check "paid" "$(st paid)" 2
check "passes_delivered" "$(st passes_delivered)" 2
check "checked_in" "$(st checked_in)" 1
check "drop-off % carts→started" "$(echo "$F" | jx 'o.stages.find(s=>s.stage==="payment_started").dropPct')" 40
check "stage order" "$(echo "$F" | jx 'o.stages.map(s=>s.stage).join(">")')" "event_views>checkout_opened>carts_created>payment_started>gateway_accepted>paid>passes_delivered>checked_in"
check "top gateway error" "$(echo "$F" | jx 'o.dropoff.topGatewayErrors[0].attempts+":"+o.dropoff.topGatewayErrors[0].error.includes("GODIGITAL")')" "1:true"
check "expired with no attempt" "$(echo "$F" | jx 'o.dropoff.expiredNoAttempt')" 1
check "open with no attempt" "$(echo "$F" | jx 'o.dropoff.openNoAttempt')" 1
check "short payments" "$(echo "$F" | jx 'o.dropoff.shortPayments')" 0
check "other org's funnel is empty" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/funnel?days=30&org=offshore" | jx 'o.stages.find(s=>s.stage==="carts_created").count')" 0
check "days coerced to an allowed window" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/funnel?days=13" | jx 'o.window.days')" 7

echo ""
echo "== 7. GUARD + PII =="
check "detail 401 without a session" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/orders/$OA")" 401
check "funnel 401 without a session" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/funnel")" 401
check "detail 404 on unknown id" "$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/admin" "$BASE/api/admin/orders/00000000-0000-0000-0000-000000000000")" 404
check "detail 404 on a non-uuid" "$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/admin" "$BASE/api/admin/orders/nope")" 404
check "filters route still wins over :id" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/filters" | jx 'Array.isArray(o.statuses)')" true
# An abandoned cart from 200 days ago: contact must be masked on the detail too.
OLD=$(q "with c as (insert into customer (phone, email, name) values ('255700111222','old@example.com','Old Buyer') returning id)
         insert into \"order\" (customer_id, event_id, type, status, target_value, created_at)
         select id, 'brunch-vol-09', 'ga_vip', 'expired', 50000, now() - interval '200 days' from c returning id" | head -1)
DO=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$OLD")
check "old never-paid detail: piiRedacted" "$(echo "$DO" | jx 'o.piiRedacted')" true
check "old never-paid detail: phone masked" "$(echo "$DO" | jx 'o.buyer.phone')" "*********222"
check "old never-paid detail: email masked" "$(echo "$DO" | jx 'o.buyer.email.includes("old@")')" false
check "old never-paid detail: derived timeline" "$(echo "$DO" | jx 'o.timeline[0].step+"/"+o.timeline[0].source')" "cart_created/derived"
check "paid detail keeps contact" "$(echo "$DA" | jx 'o.buyer.email')" a@example.com

echo ""
[ "$fail" = "0" ] || { echo "ORDER FUNNEL E2E: FAIL"; tail -40 "$SNAP/api.log"; exit 1; }
echo "ORDER FUNNEL E2E: PASS (paid cart logs every step in order · rejected attempt keeps its reason · old orders get a derived timeline · checkout beacon counts · scan logs checked_in · funnel counts match · 401 + PII redaction on detail)"
