#!/usr/bin/env bash
# BS43 / plan #3 — ADMIN CART / ORDER VISIBILITY. Support needs to see the order
# someone TRIED to make, not just the ones that paid. The suite boots the real
# API on a throwaway Postgres and proves:
#
#   1. Migration 0014 applied: order(status, created_at) + order(created_at, id).
#   2. **A PENDING and a FAILED order both appear WITH THEIR LINE ITEMS** — the
#      whole point of the feature. Every other order read is paid-only.
#   3. **A SPLIT order shows its SEATS, not an empty cart (OV8).** A table_share
#      order has NO order_item, so the order_item-only query every other read
#      uses renders a blank cart for exactly the orders support is asked about.
#      The table-mates come with it, so "who else on that table has paid" is
#      answerable.
#   4. Buyer contact, payment attempt (method/FSP/reference), timestamps and
#      issued credentials are all on the row.
#   5. Filters (status / event / organizer / q) and KEYSET PAGINATION work, and
#      the recent WINDOW is applied by default (PERF-1).
#   6. Never-paid carts past the PII window have their contact MASKED (OV8),
#      while paid orders keep theirs.
#   7. **PAID-ONLY REVENUE IS UNAFFECTED**: the organizer sales/earnings numbers
#      are cross-checked against the admin view, so widening the read to every
#      state cannot have quietly widened what counts as money.
#   8. The surface is admin-only.
#
# Style/harness mirrors payouts.e2e.sh. Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CORE="$ROOT/packages/core/dist/index.js"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55450}"
API_PORT="${TEST_API_PORT:-4125}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-aorders-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-aorderssnap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers organizers audit admin events kyc"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

echo "== throwaway Postgres @ :$PG_PORT + migrate (0001..0016) + backfill =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_aorders
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_aorders"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_aorders -v ON_ERROR_STOP=1 -c "$1"; }

echo ""
echo "== 1. MIGRATION 0016 — the new access pattern is INDEXED (PERF-1) =="
I_SC=$(psql_one "select count(*) from pg_indexes where indexname='order_status_created_idx'")
I_C=$(psql_one "select count(*) from pg_indexes where indexname='order_created_idx'")
I_E=$(psql_one "select count(*) from pg_indexes where indexname='order_event_idx'")
[ "$I_SC" = "1" ] && [ "$I_C" = "1" ] && [ "$I_E" = "1" ] \
  && echo "  ✓ order(status, created_at) + order(created_at, id) + order(event_id) all present" \
  || { echo "  ✗ indexes status_created=$I_SC created=$I_C event=$I_E (want 1/1/1)"; fail=1; }

echo ""
echo "== seed catalog: org A thebrunchcity (GA + a SPLITTABLE table) · org B offshore =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_aorders -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('brunch-vol-09','Garden Brunch — Vol. 09') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-brunch','brunch-vol-09','GA', 40) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-brunch', 50000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-brunch');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-brunch', 40, 40) on conflict do nothing;

-- A splittable table tier: this is what produces order(type='table_share') rows,
-- which carry NO order_item and are the trap #3 exists to avoid (OV8).
insert into product_tier (id, event_id, name, capacity, split_enabled, split_window_secs)
  values ('t-table','brunch-vol-09','Table for 4', 5, true, 2700) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-table', 400000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-table');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-table', 5, 5) on conflict do nothing;

insert into event (id, name) values ('offshore-001','OFFSHORE — The Daytime Yacht Groove') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-offshore','offshore-001','GA', 10) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-offshore', 80000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-offshore');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-offshore', 10, 10) on conflict do nothing;

update organizer set kyc_status = 'approved' where id in ('o1','o2');
SQL

echo "== boot API (x-bridge MOCK) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    SMS_DRIVER=mock EMAIL_DRIVER=mock \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
jq_get() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(v==null?"":Array.isArray(v)?String(v.length):String(v))}catch{process.stdout.write("ERR:"+s.slice(0,120))}})' "$1"; }

checkout() {
  local jar="$1" tier="$2" qty="$3" phone="$4" email="$5"
  curl -s -c "$jar" -b "$jar" -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
    -d "{\"phone\":\"$phone\",\"email\":\"$email\",\"ageAttested\":true,\"cart\":[{\"tier\":\"$tier\",\"quantity\":$qty}],\"method\":\"mobile\"}" | jq_get orderId
}
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

echo ""
echo "== seed the four order shapes support actually asks about =="
# (a) a normal PAID order
OPAID=$(checkout "$SNAP/j1" t-brunch 2 0712345670 paid@example.com)
pay_to_paid "$SNAP/j1" "$OPAID" 0712345670 || { echo "  ✗ paid order never paid"; tail -20 "$SNAP/api.log"; exit 1; }
# (b) a PENDING cart — checkout started, payment never attempted. Invisible today.
OPEND=$(checkout "$SNAP/j2" t-brunch 3 0712345671 pending@example.com)
# (c) a FAILED order — a real payment attempt that the gateway rejected.
OFAIL=$(checkout "$SNAP/j3" t-brunch 1 0712345672 failed@example.com)
curl -s -b "$SNAP/j3" -X POST "$BASE/api/checkout/$OFAIL/pay" -H 'content-type: application/json' \
  -d '{"method":"mobile","payerPhone":"0712345672"}' >/dev/null
psql_one "update \"order\" set status='failed' where id='$OFAIL'" >/dev/null
psql_one "update payment_transaction set status='failed' where order_id='$OFAIL'" >/dev/null
# (d) org B, so cross-filter assertions have something to exclude.
OB=$(checkout "$SNAP/j4" t-offshore 1 0713333331 b1@example.com)
pay_to_paid "$SNAP/j4" "$OB" 0713333331 || { echo "  ✗ org B order never paid"; exit 1; }
echo "  ✓ paid · pending · failed · another org"

echo "== seed a SPLIT: a table for 4, one seat PAID (the OV8 case) =="
# Host the table through CORE: POST /api/splits requires a consumer OTP session,
# and this suite is about what the ADMIN can see, not about the buyer's login. The
# seats it produces are real table_share orders either way — which is the point,
# since those orders carry NO order_item and would render an empty cart if the
# admin view only joined line items (OV8).
cat > "$SNAP/mksplit.js" <<'JS'
const { db, createTableSplit, closeDb } = require(process.env.CORE);
(async () => {
  const r = await createTableSplit(db(), { hostPhone: '255715000001', tierId: 't-table', capacityN: 4, feeRate: 0 });
  if (!r.ok) throw new Error('createTableSplit failed: ' + r.reason);
  console.log(r.splitId);
  for (const sh of r.shares) if (sh.token) { console.log(sh.token); break; }
  await closeDb();
})().catch((e) => { console.error(e); process.exit(1); });
JS
SPLIT_OUT=$(env CORE="$CORE" DATABASE_URL="$URL" TICKET_SIGNING_KEY=e2e-ticket-key SESSION_SECRET=e2e \
  XBRIDGE_MOCK=true SMS_DRIVER=mock EMAIL_DRIVER=mock node "$SNAP/mksplit.js")
SPLIT_ID=$(echo "$SPLIT_OUT" | sed -n '1p')
SPLIT_TOK=$(echo "$SPLIT_OUT" | sed -n '2p')
[ -n "$SPLIT_ID" ] || { echo "  ✗ split not created"; tail -30 "$SNAP/api.log"; exit 1; }
# A seat is claimed with its invite token and paid through the ordinary payment
# machine — that is what mints the order(type='table_share') this test is about.
HOST_ORDER=$(curl -s -c "$SNAP/js" -b "$SNAP/js" -X POST "$BASE/api/splits/claim" -H 'content-type: application/json' \
  -d "{\"token\":\"$SPLIT_TOK\",\"phone\":\"0715000001\"}" | jq_get orderId)
[ -n "$HOST_ORDER" ] || { echo "  ✗ share order not created (token=$SPLIT_TOK)"; tail -30 "$SNAP/api.log"; exit 1; }
pay_to_paid "$SNAP/js" "$HOST_ORDER" 0715000001 || true
curl -s -b "$SNAP/js" -X POST "$BASE/api/checkout/$HOST_ORDER/pay" -H 'content-type: application/json' \
  -d '{"method":"mobile","payerPhone":"0715000001"}' >/dev/null
for i in $(seq 1 8); do
  SS=$(psql_one "select state from split_share where order_id='$HOST_ORDER'")
  [ "$SS" = "paid" ] && break
  sleep 1
done
SHARE_STATE=$(psql_one "select state from split_share where order_id='$HOST_ORDER'")
[ "$SHARE_STATE" = "paid" ] \
  && echo "  ✓ split created, a seat PAID (order $HOST_ORDER, type=table_share)" \
  || { echo "  ✗ host share state = $SHARE_STATE (want paid)"; tail -30 "$SNAP/api.log"; fail=1; }
# The trap, stated as a fact of the schema: this order has ZERO order_item rows.
SHARE_ITEMS=$(psql_one "select count(*) from order_item where order_id='$HOST_ORDER'")
[ "$SHARE_ITEMS" = "0" ] \
  && echo "  · CONFIRMED: the split order has 0 order_item rows — an order_item-only query WOULD render an empty cart" \
  || { echo "  ✗ the split order unexpectedly has $SHARE_ITEMS order_items"; fail=1; }

echo "== logins =="
curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
for o in o1 o2; do
  curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/$o/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
done
curl -s -c "$SNAP/orgA" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null

ao() { curl -s -b "$SNAP/admin" "$BASE/api/admin/orders$1"; }

echo ""
echo "══ 2. EVERY ORDER STATE IS VISIBLE — WITH ITS LINE ITEMS ══"
ALL=$(ao "?limit=100")
R2=$(A="$ALL" P="$OPAID" N="$OPEND" F="$OFAIL" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const v=JSON.parse(process.env.A), o=v.orders||[];
const by=(id)=>o.find(x=>x.id===id);
const paid=by(process.env.P), pend=by(process.env.N), fail_=by(process.env.F);
t("the PAID order is listed", !!paid && paid.status==="paid");
t("THE PENDING CART IS LISTED — invisible to every other order read", !!pend && pend.status==="pending");
t("THE FAILED ORDER IS LISTED", !!fail_ && fail_.status==="failed");
t("the PENDING cart carries its LINE ITEMS (3 x GA @ 50000) — support sees what they tried to buy",
  !!pend && pend.lines.length===1 && pend.lines[0].qty===3 && pend.lines[0].unitPrice===50000 && pend.lines[0].tier==="GA");
t("the FAILED order carries its line items too (1 x GA)",
  !!fail_ && fail_.lines.length===1 && fail_.lines[0].qty===1);
t("cart value is computed for a cart that never paid (150000)", !!pend && pend.cartValue===150000);
t("the failed order keeps its PAYMENT ATTEMPT (method + FSP) so support can see what was tried",
  !!fail_ && fail_.attempts.length>=1 && !!fail_.attempts[0].method && !!fail_.attempts[0].fspId);
t("a never-attempted cart has zero payment attempts, honestly", !!pend && pend.attempts.length===0);
t("buyer contact is present on the admin view (that IS the feature)",
  !!pend && pend.buyer.phone==="255712345671" && pend.buyer.email==="pending@example.com");
t("the paid order shows its ISSUED CREDENTIALS", !!paid && paid.credentials.length===2 && !!paid.credentials[0].publicRef);
t("event + organizer are named, not left as slugs",
  !!paid && paid.eventName==="Garden Brunch — Vol. 09" && paid.organizerHandle==="thebrunchcity" && paid.organizerName==="The Brunch City");
t("timestamps are present", !!pend && !!pend.createdAt);
t("the window is reported so the UI can say what it is showing", v.window && v.window.days===90);
t("per-status counts over the window ride along", Array.isArray(v.counts) && v.counts.length>=3);
' 2>&1 || true)
echo "$R2"; echo "$R2" | grep -q '✗' && fail=1

echo ""
echo "══ 3. THE SPLIT CART IS NOT EMPTY (OV8) — the assertion this feature exists for ══"
R3=$(A="$ALL" H="$HOST_ORDER" S="$SPLIT_ID" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const v=JSON.parse(process.env.A), o=(v.orders||[]).find(x=>x.id===process.env.H);
t("the table_share order is listed at all", !!o && o.type==="table_share");
t("it has NO order_item — the schema fact that makes a naive query render blank", !!o && o.lines.length===0);
t("*** IT STILL SHOWS A CART: the split block is populated, not null ***", !!o && !!o.split);
t("the split block names the tier the table was bought on", !!o && o.split.tier==="Table for 4");
t("ALL FOUR SEATS of the table are listed (not just the one this order paid)",
  !!o && o.split.seats.length===4);
t("the seat THIS order paid is flagged", !!o && o.split.seats.filter(s=>s.isThisOrder).length===1);
t("that seat reads as PAID", !!o && o.split.seats.find(s=>s.isThisOrder).state==="paid");
t("the other three seats are visible as unpaid — support can answer \"who else has paid\"",
  !!o && o.split.seats.filter(s=>s.state!=="paid").length===3);
t("paidCount = 1 of capacity 4", !!o && o.split.paidCount===1 && o.split.capacity===4);
t("the split is still forming and says so", !!o && o.split.status==="forming");
t("CART VALUE comes from split_share.amount, not from a missing order_item",
  !!o && o.cartValue>0 && o.cartValue===o.split.seats.find(s=>s.isThisOrder).amount);
t("the table target value is shown so the seat amount has context", !!o && o.split.targetValue>0);
' 2>&1 || true)
echo "$R3"; echo "$R3" | grep -q '✗' && fail=1

echo ""
echo "== 4. FILTERS: status · event · organizer · search =="
PENDING_ONLY=$(ao "?status=pending&limit=100")
echo "$PENDING_ONLY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s).orders;process.exit(o.length>0&&o.every(x=>x.status==="pending")?0:1)})' \
  && echo "  ✓ status=pending returns only pending carts" \
  || { echo "  ✗ status filter leaked other states"; fail=1; }
FAILED_ONLY=$(ao "?status=failed&limit=100")
echo "$FAILED_ONLY" | grep -q "\"$OFAIL\"" \
  && echo "  ✓ status=failed finds the failed order" || { echo "  ✗ status=failed missed it"; fail=1; }

ORGA=$(ao "?organizer=thebrunchcity&limit=100")
echo "$ORGA" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s).orders;process.exit(o.length>0&&o.every(x=>x.organizerHandle==="thebrunchcity")?0:1)})' \
  && echo "  ✓ organizer=thebrunchcity excludes org B entirely" \
  || { echo "  ✗ organizer filter leaked another org"; fail=1; }
echo "$ORGA" | grep -q "\"$OB\"" \
  && { echo "  ✗ org B order appeared under the thebrunchcity filter"; fail=1; } \
  || echo "  ✓ org B order is absent from org A filter"

EVFILT=$(ao "?event=offshore-001&limit=100")
echo "$EVFILT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s).orders;process.exit(o.length===1&&o[0].eventId==="offshore-001"?0:1)})' \
  && echo "  ✓ event=offshore-001 returns exactly its one order" \
  || { echo "  ✗ event filter: $(echo "$EVFILT" | head -c 200)"; fail=1; }

QPHONE=$(ao "?q=712345671&limit=100")
echo "$QPHONE" | grep -q "\"$OPEND\"" \
  && echo "  ✓ q=<phone> finds the PENDING cart (support searches by the number on the call)" \
  || { echo "  ✗ phone search missed the pending cart"; fail=1; }
QMAIL=$(ao "?q=failed@example.com&limit=100")
echo "$QMAIL" | grep -q "\"$OFAIL\"" \
  && echo "  ✓ q=<email> finds the FAILED order" || { echo "  ✗ email search missed it"; fail=1; }
QID=$(ao "?q=$OPAID&limit=100")
echo "$QID" | grep -q "\"$OPAID\"" \
  && echo "  ✓ q=<order id> finds the order" || { echo "  ✗ order-id search missed it"; fail=1; }
QNONE=$(ao "?q=255799999999&limit=100")
echo "$QNONE" | grep -q '"orders":\[\]' \
  && echo "  ✓ a search that matches nothing returns an empty list, not everything" \
  || { echo "  ✗ empty search returned rows"; fail=1; }

FILTERS=$(ao "/filters")
echo "$FILTERS" | grep -q '"statuses"' && echo "$FILTERS" | grep -q '"organizers"' \
  && echo "  ✓ /filters publishes the status + event + organizer vocabulary (the UI hard-codes nothing)" \
  || { echo "  ✗ /filters payload: $(echo "$FILTERS" | head -c 200)"; fail=1; }

echo ""
echo "== 5. PAGINATION + the RECENT WINDOW (PERF-1) =="
PAGE1=$(ao "?limit=2")
CUR=$(echo "$PAGE1" | jq_get nextCursor)
R5=$(A="$PAGE1" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const v=JSON.parse(process.env.A);
t("limit=2 returns exactly 2 rows", (v.orders||[]).length===2);
t("a nextCursor is issued because more exist", typeof v.nextCursor==="string" && v.nextCursor.length>0);
t("rows are newest-first", new Date(v.orders[0].createdAt) >= new Date(v.orders[1].createdAt));
' 2>&1 || true)
echo "$R5"; echo "$R5" | grep -q '✗' && fail=1

PAGE2=$(ao "?limit=2&cursor=$CUR")
OVERLAP=$(P1="$PAGE1" P2="$PAGE2" node -e '
const a=JSON.parse(process.env.P1).orders.map(o=>o.id);
const b=JSON.parse(process.env.P2).orders.map(o=>o.id);
process.stdout.write(String(a.filter(x=>b.includes(x)).length));
')
[ "$OVERLAP" = "0" ] && [ "$(echo "$PAGE2" | jq_get orders)" != "0" ] \
  && echo "  ✓ page 2 shares ZERO rows with page 1 — keyset paging, not OFFSET drift" \
  || { echo "  ✗ pages overlapped by $OVERLAP rows"; fail=1; }

# Walk to the end: every order must be reachable and none duplicated.
WALK=$(node -e '
const http=require("http");
const base=process.argv[1], cookie=process.argv[2];
(async()=>{
  const seen=[]; let cursor=null;
  for(let i=0;i<20;i++){
    const url=base+"/api/admin/orders?limit=2"+(cursor?"&cursor="+encodeURIComponent(cursor):"");
    const body=await new Promise((res,rej)=>{http.get(url,{headers:{cookie}},r=>{let s="";r.on("data",d=>s+=d);r.on("end",()=>res(s))}).on("error",rej)});
    const v=JSON.parse(body);
    if(!v || !Array.isArray(v.orders) || v.orders.length===0) break; // last page: stop cleanly
    for(const o of v.orders) seen.push(o.id);
    if(!v.nextCursor) break;
    cursor=v.nextCursor;
  }
  const uniq=new Set(seen);
  process.stdout.write(seen.length+"/"+uniq.size);
})();
' "$BASE" "$(node -e 'const fs=require("fs");const l=fs.readFileSync(process.argv[1],"utf8").split("\n").map(x=>x.replace(/^#HttpOnly_/,"")).filter(x=>x&&!x.startsWith("#"));const c=l.map(x=>{const p=x.split("\t");return p[5]+"="+p[6]}).join("; ");process.stdout.write(c)' "$SNAP/admin")")
TOTAL=$(psql_one "select count(*) from \"order\"")
[ "$WALK" = "$TOTAL/$TOTAL" ] \
  && echo "  ✓ walking every page reached all $TOTAL orders exactly once ($WALK)" \
  || { echo "  ✗ page walk saw $WALK, database holds $TOTAL"; fail=1; }

# The window is a REAL bound, not a decoration: backdate a cart past it.
OLD=$(checkout "$SNAP/j5" t-brunch 1 0716000001 old@example.com)
psql_one "update \"order\" set created_at = now() - interval '200 days' where id='$OLD'" >/dev/null
IN_DEFAULT=$(ao "?limit=100" | grep -c "\"$OLD\"" || true)
IN_WIDE=$(ao "?limit=100&days=365" | grep -c "\"$OLD\"" || true)
[ "$IN_DEFAULT" = "0" ] && [ "$IN_WIDE" != "0" ] \
  && echo "  ✓ a 200-day-old cart is OUTSIDE the 90-day default window and INSIDE days=365 — the window really bounds the scan" \
  || { echo "  ✗ window: default=$IN_DEFAULT wide=$IN_WIDE (want 0 / >0)"; fail=1; }
IN_ALL=$(ao "?limit=100&days=0" | grep -c "\"$OLD\"" || true)
[ "$IN_ALL" != "0" ] && echo "  ✓ days=0 explicitly disables the window (opt-in full scan, never the default)" \
  || { echo "  ✗ days=0 did not return the old order"; fail=1; }

echo ""
echo "== 6. TIME-BOXED PII on never-paid carts (OV8) =="
# The 200-day-old cart above never paid — its contact must be masked by now.
OLDROW=$(ao "?limit=100&days=365")
R6=$(A="$OLDROW" O="$OLD" P="$OPAID" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const o=JSON.parse(process.env.A).orders;
const old=o.find(x=>x.id===process.env.O), paid=o.find(x=>x.id===process.env.P);
t("the old NEVER-PAID cart is flagged piiRedacted", !!old && old.piiRedacted===true);
t("its phone is masked, last 3 digits only", !!old && /^\*+001$/.test(old.phone===undefined?old.buyer.phone:old.buyer.phone));
t("its email is masked too", !!old && /^\*+/.test(old.buyer.email));
t("its LINE ITEMS are still there — the cart stays inspectable, only the contact ages out",
  !!old && old.lines.length===1);
t("a PAID order keeps full contact regardless of age (admin needs it, and they are a customer)",
  !!paid && paid.piiRedacted===false && paid.buyer.phone==="255712345670");
' 2>&1 || true)
echo "$R6"; echo "$R6" | grep -q '✗' && fail=1

echo ""
echo "══ 7. CROSS-CHECK: PAID-ONLY REVENUE IS UNAFFECTED ══"
# Widening the admin read to every order state must not have widened what counts
# as money. The organizer summary is the money surface; it must still see only
# the paid orders, and its figure must equal the paid rows in the admin view.
SUM=$(curl -s -b "$SNAP/orgA" "$BASE/api/org/summary")
R7=$(S="$SUM" A="$ALL" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const s=JSON.parse(process.env.S), adm=JSON.parse(process.env.A).orders;
// Line-item money from PAID orders only, computed off the admin view.
const paidLines = adm.filter(o=>o.organizerHandle==="thebrunchcity" && o.status==="paid")
  .reduce((a,o)=>a + o.lines.reduce((x,l)=>x+l.amount,0) + (o.split? (o.split.seats.find(z=>z.isThisOrder)||{amount:0}).amount : 0), 0);
t("org A paid revenue = 100000 GA + 100000 split seat = 200000", paidLines===200000);
t("the organizer summary reports the SAME 200000 — the admin view did not move the money line",
  s.totals.revenue===paidLines);
t("orders counted as revenue = 2 (the paid GA order + the paid split seat), NOT the pending/failed carts",
  s.totals.orders===2);
t("net is still commission-netted (5% of 200000 = 190000)", s.totals.netRevenue===190000);
' 2>&1 || true)
echo "$R7"; echo "$R7" | grep -q '✗' && fail=1

PENDING_IN_SUMMARY=$(echo "$SUM" | grep -c '150000' || true)
[ "$PENDING_IN_SUMMARY" = "0" ] \
  && echo "  ✓ the 150000 PENDING cart appears in the admin view and NOWHERE in the money summary" \
  || { echo "  ✗ the pending cart value leaked into the org summary"; fail=1; }

echo ""
echo "== 8. THE SURFACE IS ADMIN-ONLY =="
ORG_HIT=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/orgA" "$BASE/api/admin/orders")
[ "$ORG_HIT" = "401" ] && echo "  ✓ organizer session → GET /api/admin/orders 401" \
  || { echo "  ✗ organizer reached the admin order view: HTTP $ORG_HIT"; fail=1; }
ANON_HIT=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/orders")
[ "$ANON_HIT" = "401" ] && echo "  ✓ anonymous → 401 (buyer PII is never public)" \
  || { echo "  ✗ anon reached the admin order view: HTTP $ANON_HIT"; fail=1; }

[ "$fail" = "0" ] || { echo ""; echo "ADMIN ORDERS E2E: FAIL"; tail -40 "$SNAP/api.log"; exit 1; }
echo ""
echo "ADMIN ORDERS E2E: PASS (pending + failed carts visible WITH line items · SPLIT ORDER SHOWS ITS SEATS not an empty cart · buyer/attempt/credentials · filters + keyset pagination + recent window · time-boxed PII on never-paid carts · paid-only revenue unaffected · admin-only)"
