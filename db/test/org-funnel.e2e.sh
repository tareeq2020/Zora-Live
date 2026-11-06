#!/usr/bin/env bash
# BS160 — ORGANIZER FUNNEL, OUTCOMES AND SIMPLE ORDER TIMELINE. Boots the real
# API on a throwaway Postgres (x-bridge MOCK, steered per attempt by
# XBRIDGE_MOCK_STATUS_FILE) and proves, for an organizer session:
#
#   1. /api/org/orders rows carry outcome, outcomeLabel, outcomeDetail and
#      stageReached, for their own events only.
#   2. ?outcome= returns exactly the rows the list labels with that outcome.
#   3. GET /api/org/orders/:id: own order → outcome + explanation + a short
#      timeline; another org's order, a malformed id or an unknown id → 404.
#   4. The timeline collapses retries ("Payment tried N times") and keeps the
#      buyer-side reason; a system error reads with the generic wording.
#   5. GET /api/org/funnel: their events only, no gateway_accepted stage, and
#      outcome counts equal the admin funnel and the admin list for the same scope.
#   6. No response carries transaction ids, ZORA- refs, gateway errors,
#      callback/status bodies, admin push steps or notes.
#   7. 401 without a session.
#
# Style mirrors cart-outcomes.e2e.sh and org-sales.e2e.sh. Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-56370}"
API_PORT="${TEST_API_PORT:-4370}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-orgfunnel-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-orgfunnelsnap-XXXXXX")"
USER_NAME="$(whoami)"
REJECT_PHONE="0712999999"
STATUS_FILE="$SNAP/status.json"
echo '{}' > "$STATUS_FILE"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_orgfunnel
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_orgfunnel"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" settings tiers organizers audit admin events kyc >/dev/null

q() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_orgfunnel -v ON_ERROR_STOP=1 -c "$1"; }
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1 → $2"; else echo "  ✗ $1 → $2 (want $3)"; fail=1; fi; }

# Org A (thebrunchcity) owns brunch-vol-09, org B (offshore) owns offshore-001 (events blob).
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_orgfunnel -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('brunch-vol-09','Garden Brunch — Vol. 09') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-brunch','brunch-vol-09','GA', 80) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-brunch', 50000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-brunch');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-brunch', 80, 80) on conflict do nothing;
insert into event (id, name) values ('offshore-001','OFFSHORE — The Daytime Yacht Groove') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-offshore','offshore-001','GA', 10) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-offshore', 80000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-offshore');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-offshore', 10, 10) on conflict do nothing;
update organizer set kyc_status = 'approved' where id in ('o1','o2');
SQL

echo "== boot API (x-bridge MOCK, status file steering; refuses payer $REJECT_PHONE) =="
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true XBRIDGE_MOCK_REJECT_PHONE="$REJECT_PHONE" \
    XBRIDGE_MOCK_STATUS_FILE="$STATUS_FILE" \
    COOKIE_SECURE=false SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    SMS_DRIVER=mock EMAIL_DRIVER=mock PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >>"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
jx() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let o;try{o=JSON.parse(s)}catch{process.stdout.write("ERR:"+s.slice(0,160));return}try{process.stdout.write(String(eval(process.argv[1])))}catch(e){process.stdout.write("ERR:"+e.message)}})' "$1"; }
steer() { node -e 'const fs=require("fs");const f=process.argv[1];const m=JSON.parse(fs.readFileSync(f,"utf8"));m[process.argv[2]]=JSON.parse(process.argv[3]);fs.writeFileSync(f,JSON.stringify(m))' "$STATUS_FILE" "$1" "$2"; }
checkout() { # jar phone email tier
  curl -s -c "$1" -b "$1" -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
    -d "{\"phone\":\"$2\",\"email\":\"$3\",\"ageAttested\":true,\"cart\":[{\"tier\":\"${4:-t-brunch}\",\"quantity\":1}],\"method\":\"mobile\"}" | jx 'o.orderId'
}
pay() {
  curl -s -o "$SNAP/pay.out" -w '%{http_code}' -b "$1" -X POST "$BASE/api/checkout/$2/pay" -H 'content-type: application/json' \
    -d "{\"method\":\"mobile\",\"payerPhone\":\"$3\"}"
}
status_of() { curl -s -b "$1" "$BASE/api/orders/$2/status" | jx 'o.status'; }
wait_status() {
  for i in $(seq 1 8); do s=$(status_of "$1" "$2"); [ "$s" = "$3" ] && return 0; sleep 0.5; done
  echo "  ✗ $2 never reached $3 (got $s)"; tail -20 "$SNAP/api.log"; return 1
}
hook() { curl -s -X POST "$BASE/api/webhooks/xbridge" -H 'content-type: application/json' -d "$1"; }

echo ""
echo "== seed carts =="
# A: paid first try
OPAID=$(checkout "$SNAP/c1" 0712000001 p1@example.com); pay "$SNAP/c1" "$OPAID" 0712000001 >/dev/null; wait_status "$SNAP/c1" "$OPAID" paid
# A: not enough balance, then a refused attempt, then paid (three attempts on one cart)
ORETRY=$(checkout "$SNAP/c2" 0712000002 p2@example.com)
steer "ZORA-$ORETRY-1" '{"status":"FAILED","failureReason":"insufficient_funds"}'
pay "$SNAP/c2" "$ORETRY" 0712000002 >/dev/null; wait_status "$SNAP/c2" "$ORETRY" failed
pay "$SNAP/c2" "$ORETRY" "$REJECT_PHONE" >/dev/null || true
pay "$SNAP/c2" "$ORETRY" 0712000002 >/dev/null; wait_status "$SNAP/c2" "$ORETRY" paid
# A: buyer cancelled (via the callback; body has a secret and a phone)
OCANCEL=$(checkout "$SNAP/c3" 0712000003 p3@example.com)
steer "ZORA-$OCANCEL-1" '{"status":"FAILED"}'
pay "$SNAP/c3" "$OCANCEL" 0712000003 >/dev/null
hook "{\"event\":\"collection.updated\",\"transactionId\":\"ZORA-$OCANCEL-1\",\"status\":\"FAILED\",\"failureReason\":\"payer_cancelled\",\"payerPhone\":\"+255712000003\",\"apiKey\":\"sk_live_SECRET123\"}" >/dev/null
wait_status "$SNAP/c3" "$OCANCEL" failed
# A: cancelled twice (two attempts, both cancelled) → one failure line, tried 2 times
OTWICE=$(checkout "$SNAP/c4" 0712000004 p4@example.com)
steer "ZORA-$OTWICE-1" '{"status":"FAILED","failureReason":"payer_cancelled"}'
pay "$SNAP/c4" "$OTWICE" 0712000004 >/dev/null; wait_status "$SNAP/c4" "$OTWICE" failed
steer "ZORA-$OTWICE-2" '{"status":"FAILED","failureReason":"wrong_pin"}'
pay "$SNAP/c4" "$OTWICE" 0712000004 >/dev/null; wait_status "$SNAP/c4" "$OTWICE" failed
# A: system error — x-bridge refused the push, cart then expired
OREJ=$(checkout "$SNAP/c5" "$REJECT_PHONE" r@example.com); pay "$SNAP/c5" "$OREJ" "$REJECT_PHONE" >/dev/null || true
q "update inventory_hold set state='released' where order_id='$OREJ'; update \"order\" set status='expired' where id='$OREJ'" >/dev/null
# A: system error — provider_error from x-bridge
OPROV=$(checkout "$SNAP/c6" 0712000006 p6@example.com)
steer "ZORA-$OPROV-1" '{"status":"FAILED","failureReason":"provider_error"}'
pay "$SNAP/c6" "$OPROV" 0712000006 >/dev/null; wait_status "$SNAP/c6" "$OPROV" failed
# A: abandoned (no attempt, hold lapsed)
OABAN=$(checkout "$SNAP/c7" 0712000007 p7@example.com)
q "update inventory_hold set state='released' where order_id='$OABAN'; update \"order\" set status='expired', created_at=now()-interval '2 hours' where id='$OABAN'" >/dev/null
# A: an admin pushed a prompt on the cancelled cart (log rows only; must not show)
q "insert into order_event (order_id, step, detail) values
   ('$OCANCEL', 'admin_push_requested', '{\"by\":\"admin\",\"name\":\"Ops Admin\",\"note\":\"called the buyer\"}'),
   ('$OCANCEL', 'admin_push_refused', '{\"by\":\"admin\",\"reason\":\"rate_limited\"}')" >/dev/null
# A: comp + door sale (SQL)
mk() { # suffix status type channel event
  q "with c as (insert into customer (phone, email) values ('2557130000$1','x$1@example.com') returning id)
     insert into \"order\" (customer_id, event_id, type, status, target_value, channel)
     select id, '$5', '$3', '$2', 50000, '$4' from c returning id" | head -1
}
OCOMP=$(mk 53 paid comp online brunch-vol-09)
ODOOR=$(mk 54 paid ga_vip gate_cash brunch-vol-09)
# B: paid + cancelled
BPAID=$(checkout "$SNAP/b1" 0713000001 b1@example.com t-offshore); pay "$SNAP/b1" "$BPAID" 0713000001 >/dev/null; wait_status "$SNAP/b1" "$BPAID" paid
BFAIL=$(checkout "$SNAP/b2" 0713000002 b2@example.com t-offshore)
steer "ZORA-$BFAIL-1" '{"status":"FAILED","failureReason":"payer_cancelled"}'
pay "$SNAP/b2" "$BFAIL" 0713000002 >/dev/null; wait_status "$SNAP/b2" "$BFAIL" failed
check "retry cart has 3 attempts (one refused)" "$(q "select count(*)||':'||count(error) from payment_transaction where order_id='$ORETRY'")" "3:1"

echo ""
echo "== logins =="
curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o2/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/orgA" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/orgB" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"offshore","password":"orgpass123"}' >/dev/null

echo ""
echo "== 7. 401 WITHOUT A SESSION =="
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
check "GET /api/org/orders" "$(code "$BASE/api/org/orders")" 401
check "GET /api/org/orders/:id" "$(code "$BASE/api/org/orders/$OPAID")" 401
check "GET /api/org/funnel" "$(code "$BASE/api/org/funnel?days=7")" 401
check "plain admin (not impersonating) gets no org data" "$(curl -s -w ' %{http_code}' -b "$SNAP/admin" "$BASE/api/org/funnel" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=s.slice(-3);process.stdout.write(String((c==="401"||c==="403")&&!s.includes("stages")))})')" true

echo ""
echo "== 1. ORG LIST: OUTCOME PER ROW, OWN EVENTS ONLY =="
LIST=$(curl -s -b "$SNAP/orgA" "$BASE/api/org/orders?limit=200")
echo "$LIST" > "$SNAP/list.json"
oc() { echo "$LIST" | jx "(r=>r?[r.outcome,r.outcomeDetail,r.stageReached].map(x=>x==null?'-':x).join('|'):'missing')(o.rows.find(x=>x.orderId==='$1'))"; }
check "row count (9 A carts)" "$(echo "$LIST" | jx 'o.rows.length')" 9
check "no B order on A's list" "$(echo "$LIST" | jx "o.rows.some(r=>r.orderId==='$BPAID'||r.orderId==='$BFAIL'||r.eventId!=='brunch-vol-09')")" false
check "paid (buyer notified)" "$(oc "$OPAID")" "paid|-|passes_delivered"
check "paid after retry" "$(oc "$ORETRY")" "paid_after_retry|-|passes_delivered"
check "cancelled by buyer" "$(oc "$OCANCEL")" "buyer_didnt_complete|payer_cancelled|payment_started"
check "cancelled label" "$(echo "$LIST" | jx "o.rows.find(x=>x.orderId==='$OCANCEL').outcomeLabel")" "Buyer didn't complete: cancelled by buyer"
check "newest reason wins (wrong PIN)" "$(oc "$OTWICE")" "buyer_didnt_complete|wrong_pin|payment_started"
check "refused push: system error, no sub-reason" "$(oc "$OREJ")" "system_error|-|payment_started"
check "provider_error: system error, no sub-reason" "$(oc "$OPROV")" "system_error|-|payment_started"
check "system error label is the generic one" "$(echo "$LIST" | jx "[...new Set(o.rows.filter(x=>x.outcome==='system_error').map(x=>x.outcomeLabel))].join('/')")" "Payment didn't go through (not the buyer; ZoraPass is on it)"
check "abandoned: no internal detail" "$(oc "$OABAN")" "abandoned|-|cart_created"
check "comp" "$(oc "$OCOMP" | cut -d'|' -f1)" comp
check "door sale" "$(oc "$ODOOR" | cut -d'|' -f1)" door_sale
check "no row says gateway_accepted" "$(echo "$LIST" | jx 'o.rows.some(r=>r.stageReached==="gateway_accepted")')" false
check "today's sales fields kept (buyer contact in full)" "$(echo "$LIST" | jx "(r=>[r.tier,r.qty,r.amount,r.currency,r.buyer.phone,r.buyer.email].join('|'))(o.rows.find(x=>x.orderId==='$OPAID'))")" "GA|1|50000|TZS|255712000001|p1@example.com"
LIST_B=$(curl -s -b "$SNAP/orgB" "$BASE/api/org/orders?limit=200")
check "B sees only B's two orders" "$(echo "$LIST_B" | jx 'o.rows.map(r=>r.orderId).sort().join()')" "$(printf '%s\n%s\n' "$BPAID" "$BFAIL" | sort | paste -sd, -)"

echo ""
echo "== 2. ?outcome= MATCHES THE LIST LABELS =="
AGREE=agree
for k in paid paid_after_retry recovered in_progress abandoned system_error buyer_didnt_complete underpaid paid_unseatable refunded comp door_sale; do
  GOT=$(curl -s -b "$SNAP/orgA" "$BASE/api/org/orders?limit=200&outcome=$k" | jx "o.rows.every(x=>x.outcome==='$k')+':'+o.rows.map(x=>x.orderId).sort().join(',')")
  WANT=$(echo "$LIST" | jx "'true:'+o.rows.filter(x=>x.outcome==='$k').map(x=>x.orderId).sort().join(',')")
  if [ "$GOT" != "$WANT" ]; then AGREE="disagree"; echo "    $k: sql=$GOT js=$WANT"; fi
done
check "every outcome filter = the rows with that outcome" "$AGREE" agree
check "system_error filter finds both" "$(curl -s -b "$SNAP/orgA" "$BASE/api/org/orders?outcome=system_error" | jx 'o.rows.length')" 2
check "unknown outcome is ignored" "$(curl -s -b "$SNAP/orgA" "$BASE/api/org/orders?limit=200&outcome=nope" | jx 'o.rows.length')" 9
check "outcome + event filter (foreign event) → empty" "$(curl -s -b "$SNAP/orgA" "$BASE/api/org/orders?outcome=paid&eventId=offshore-001" | jx 'o.rows.length')" 0
check "B's filter never returns A's carts" "$(curl -s -b "$SNAP/orgB" "$BASE/api/org/orders?outcome=buyer_didnt_complete" | jx 'o.rows.map(r=>r.orderId).join()')" "$BFAIL"

echo ""
echo "== 3. DETAIL: OWN ORDER ONLY =="
D() { curl -s -b "$SNAP/orgA" "$BASE/api/org/orders/$1"; }
for o in $OPAID $ORETRY $OCANCEL $OTWICE $OREJ $OPROV $OABAN $OCOMP $ODOOR; do D "$o" > "$SNAP/d-$o.json"; done
check "A → B's order is 404" "$(code -b "$SNAP/orgA" "$BASE/api/org/orders/$BPAID")" 404
check "B → A's order is 404" "$(code -b "$SNAP/orgB" "$BASE/api/org/orders/$OCANCEL")" 404
check "404 body carries no order data" "$(curl -s -b "$SNAP/orgA" "$BASE/api/org/orders/$BPAID" | jx 'Object.keys(o).includes("orderId")||JSON.stringify(o).includes("offshore")')" false
check "malformed id is 404" "$(code -b "$SNAP/orgA" "$BASE/api/org/orders/not-a-uuid")" 404
check "unknown id is 404" "$(code -b "$SNAP/orgA" "$BASE/api/org/orders/00000000-0000-4000-8000-000000000000")" 404
check "detail keeps the sales row fields" "$(jx "[o.orderId,o.eventName,o.amount,o.buyer.phone,o.outcome].join('|')" < "$SNAP/d-$OPAID.json")" "$OPAID|Garden Brunch — Vol. 09|50000|255712000001|paid"
check "detail matches its list row" "$(node -e '
const fs=require("fs");const l=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).rows;
const bad=process.argv.slice(2).filter(id=>{const d=JSON.parse(fs.readFileSync(process.argv[1].replace("list.json","d-"+id+".json"),"utf8"));const r=l.find(x=>x.orderId===id);
  return !r||["outcome","outcomeLabel","outcomeDetail","status","amount","tier"].some(k=>JSON.stringify(r[k])!==JSON.stringify(d[k]))});
process.stdout.write(bad.length?"differ:"+bad.join(","):"same")' "$SNAP/list.json" $OPAID $ORETRY $OCANCEL $OTWICE $OREJ $OPROV $OABAN $OCOMP $ODOOR)" same
check "cancelled explanation" "$(jx 'o.outcomeExplanation' < "$SNAP/d-$OCANCEL.json")" "The buyer cancelled the payment prompt."
check "system error explanation" "$(jx 'o.outcomeExplanation' < "$SNAP/d-$OREJ.json")" "The payment didn't go through on our side. It wasn't the buyer; ZoraPass is on it."

echo ""
echo "== 4. TIMELINE =="
tl() { jx "o.timeline.map(e=>e.step+'='+e.label).join(' > ')" < "$SNAP/d-$1.json"; }
check "paid" "$(jx "o.timeline.map(e=>e.step).join(',')" < "$SNAP/d-$OPAID.json")" "cart_created,pay_requested,paid,passes_issued,buyer_notified"
check "paid: Payment started / Passes sent" "$(jx "o.timeline.filter(e=>['pay_requested','passes_issued'].includes(e.step)).map(e=>e.label).join(',')" < "$SNAP/d-$OPAID.json")" "Payment started,Passes sent"
check "retry collapses; earlier failures dropped once paid" "$(tl "$ORETRY")" "cart_created=Cart created > pay_requested=Payment tried 3 times > paid=Paid > passes_issued=Passes sent > buyer_notified=Buyer notified"
check "cancelled: buyer reason on the failure" "$(tl "$OCANCEL")" "cart_created=Cart created > pay_requested=Payment started > failed=Payment failed: cancelled by buyer"
check "two failed attempts: one line, the last reason" "$(tl "$OTWICE")" "cart_created=Cart created > pay_requested=Payment tried 2 times > failed=Payment failed: wrong PIN"
check "refused push: generic wording" "$(jx "o.timeline.find(e=>e.step==='failed').label" < "$SNAP/d-$OREJ.json")" "Payment didn't go through (not the buyer; ZoraPass is on it)"
check "provider_error: generic wording" "$(jx "o.timeline.find(e=>e.step==='failed').label" < "$SNAP/d-$OPROV.json")" "Payment didn't go through (not the buyer; ZoraPass is on it)"
check "abandoned: cart then expiry" "$(jx "o.timeline.map(e=>e.step).join(',')" < "$SNAP/d-$OABAN.json")" "cart_created,expired"
details() { node -e 'const fs=require("fs");const d=process.argv[1];const objs=fs.readdirSync(d).filter(f=>/^d-.*\.json$/.test(f)).map(f=>JSON.parse(fs.readFileSync(d+"/"+f,"utf8")));process.stdout.write(String(eval(process.argv[2])))' "$SNAP" "$1"; }
check "entries are {at, step, label} only" "$(details 'objs.length===9&&objs.every(o=>o.timeline.every(e=>Object.keys(e).sort().join()==="at,label,step"))')" true
check "only organizer steps" "$(details 'objs.every(o=>o.timeline.every(e=>["cart_created","pay_requested","paid","failed","expired","passes_issued","buyer_notified","checked_in","refunded"].includes(e.step)))')" true
# A check-in shows up
REF=$(q "select c.public_ref from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$OPAID' limit 1")
q "update credential set state='scanned', scanned_at=now(), scanned_by='e2e-scanner' where public_ref='$REF'" >/dev/null
check "checked in: stage + timeline" "$(D "$OPAID" | jx "o.stageReached+'|'+o.timeline[o.timeline.length-1].label")" "checked_in|Checked in"

echo ""
echo "== 5. FUNNEL =="
F=$(curl -s -b "$SNAP/orgA" "$BASE/api/org/funnel?days=7")
echo "$F" > "$SNAP/funnel.json"
AF=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/funnel?days=7&org=thebrunchcity")
ALIST=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders?limit=200&organizer=thebrunchcity")
check "stages, gateway_accepted merged out" "$(echo "$F" | jx 'o.stages.map(s=>s.stage).join()')" "event_views,checkout_opened,carts_created,payment_started,paid,passes_delivered,checked_in"
check "stage counts = admin funnel (same scope)" "$(node -e '
const f=JSON.parse(process.argv[1]),a=JSON.parse(process.argv[2]);const m=new Map(a.stages.map(s=>[s.stage,s.count]));
process.stdout.write(f.stages.every(s=>m.get(s.stage)===s.count)?"same":"differ")' "$F" "$AF")" same
check "carts (comps + door sales left out)" "$(echo "$F" | jx 'o.stages.find(s=>s.stage==="carts_created").count')" 7
check "paid stage" "$(echo "$F" | jx 'o.stages.find(s=>s.stage==="paid").count')" 2
check "checked in stage" "$(echo "$F" | jx 'o.stages.find(s=>s.stage==="checked_in").count')" 1
check "outcome counts = admin funnel" "$(node -e '
const f=JSON.parse(process.argv[1]),a=JSON.parse(process.argv[2]);
process.stdout.write(f.outcomes.every(x=>(a.outcomes[x.outcome]||0)===x.count)&&f.outcomes.length===Object.keys(a.outcomes).length?"same":"differ")' "$F" "$AF")" same
check "outcome counts = admin list tally" "$(node -e '
const f=JSON.parse(process.argv[1]),l=JSON.parse(process.argv[2]).orders;const t={};for(const r of l)t[r.outcome]=(t[r.outcome]||0)+1;
process.stdout.write(f.outcomes.every(x=>(t[x.outcome]||0)===x.count)?"same":"differ")' "$F" "$ALIST")" same
check "outcome counts = org list tally" "$(node -e '
const f=JSON.parse(process.argv[1]),l=JSON.parse(process.argv[2]).rows;const t={};for(const r of l)t[r.outcome]=(t[r.outcome]||0)+1;
process.stdout.write(f.outcomes.every(x=>(t[x.outcome]||0)===x.count)?"same":"differ")' "$F" "$LIST")" same
check "buyer sub-reasons" "$(echo "$F" | jx 'o.outcomes.find(x=>x.outcome==="buyer_didnt_complete").details.map(d=>d.detail+":"+d.count).sort().join()')" "payer_cancelled:1,wrong_pin:1"
check "sub-reason label" "$(echo "$F" | jx 'o.outcomes.find(x=>x.outcome==="buyer_didnt_complete").details.find(d=>d.detail==="payer_cancelled").label')" "Buyer didn't complete: cancelled by buyer"
check "system error: count, generic label, no sub-reasons" "$(echo "$F" | jx '(x=>x.count+"|"+x.label+"|"+x.details.length)(o.outcomes.find(x=>x.outcome==="system_error"))')" "2|Payment didn't go through (not the buyer; ZoraPass is on it)|0"
check "B's funnel: B only" "$(curl -s -b "$SNAP/orgB" "$BASE/api/org/funnel?days=7" | jx 'o.stages.find(s=>s.stage==="carts_created").count+"|"+o.outcomes.reduce((a,x)=>a+x.count,0)')" "2|2"
check "own event filter" "$(curl -s -b "$SNAP/orgA" "$BASE/api/org/funnel?days=30&event=brunch-vol-09" | jx 'o.window.days+"|"+o.event+"|"+o.stages.find(s=>s.stage==="carts_created").count')" "30|brunch-vol-09|7"
check "foreign event filter is 404" "$(code -b "$SNAP/orgA" "$BASE/api/org/funnel?event=offshore-001")" 404
check "bad days falls back to 7" "$(curl -s -b "$SNAP/orgA" "$BASE/api/org/funnel?days=5" | jx 'o.window.days')" 7

echo ""
echo "== 6. NO FORBIDDEN FIELDS =="
q "select transaction_id from payment_transaction union select order_reference from payment_transaction where order_reference is not null
   union select bill_pay_number from payment_transaction where bill_pay_number is not null" > "$SNAP/secrets.txt"
for o in $OPAID $ORETRY $OCANCEL $OTWICE $OREJ $OPROV $OABAN $OCOMP $ODOOR; do D "$o" > "$SNAP/d-$o.json"; done
curl -s -b "$SNAP/orgA" "$BASE/api/org/funnel?days=90" > "$SNAP/funnel90.json"
curl -s -b "$SNAP/orgA" "$BASE/api/org/orders?limit=200&outcome=system_error" > "$SNAP/list-sys.json"
SCAN=$(node -e '
const fs=require("fs");const dir=process.argv[1];
const secrets=fs.readFileSync(dir+"/secrets.txt","utf8").split("\n").map(s=>s.trim()).filter(Boolean);
const files=fs.readdirSync(dir).filter(f=>/^(d-.*|list|list-sys|funnel|funnel90)\.json$/.test(f));
const badKey=/^(error|errorAt|errors|payload|gatewayStatus|gatewayStatusAt|transactionId|orderReference|billPayNumber|attempts|callbacks|failureReason|outcomeReason|reasonRaw|recoveredBy|note|notes|latestAttempt|fspId|dropoff|push)$|admin/i;
const out=[];
const walk=(v,p)=>{ if(v&&typeof v==="object"){for(const [k,x] of Object.entries(v)){ if(badKey.test(k)) out.push(p+"."+k); walk(x,p+"."+k);} } };
for (const f of files) {
  const txt=fs.readFileSync(dir+"/"+f,"utf8");
  walk(JSON.parse(txt),f);
  // Pass codes (ZORA-XXXX-XXXX) are on the Sales rows already; attempt ids are ZORA-<uuid>-n.
  if (/ZORA-[0-9a-f]{8}-/i.test(txt)) out.push(f+": ZORA- attempt ref");
  for (const s of secrets) if (txt.includes(s)) out.push(f+": "+s);
  const t=txt.replace(/"system_error"/g,"");
  for (const re of [/error/i,/payload/i,/gatewayStatus/i,/admin/i,/gateway/i,/x-?bridge/i,/callback/i,/SECRET/,/rate_limited/,/called the buyer/,/Ops /,/MOCK/,/provider_error/,/no_gateway_reference/,/card_unavailable/,/method_unavailable/,/not_recorded/])
    if (re.test(t)) out.push(f+": "+re);
}
process.stdout.write(out.length?out.slice(0,12).join(" ; "):"clean");' "$SNAP")
check "list, filtered list, every detail and the funnel" "$SCAN" clean
check "the scan saw the seeded secrets" "$(wc -l < "$SNAP/secrets.txt" | tr -d ' ' | awk '{print ($1>=10)?"yes":"no"}')" yes
check "the admin view still has them (control)" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$OCANCEL" | jx 'o.callbacks.length>0&&o.timeline.some(e=>e.step==="admin_push_requested")')" true

echo ""
[ "$fail" = "0" ] || { echo "ORG FUNNEL E2E: FAIL"; tail -40 "$SNAP/api.log"; exit 1; }
echo "ORG FUNNEL E2E: PASS (own orders/funnel/detail only · 404 cross-org · ?outcome= = labels · counts = admin · retries collapse · generic system error · no plumbing in any response · 401 without a session)"
