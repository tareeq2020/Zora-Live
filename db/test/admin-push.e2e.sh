#!/usr/bin/env bash
# BS158 — ADMIN "SEND PAYMENT PROMPT". Boots the real API on a throwaway Postgres
# (x-bridge MOCK, which now answers the sandbox test numbers like the sandbox)
# and proves:
#
#   1. POST /api/admin/orders/:id/push is super_admin only (401 anon + organizer).
#   2. A push on a pending cart to +255700001111 is accepted, then pays; the
#      timeline has admin_push_requested → pay_requested (by admin, note, masked
#      phone) → gateway_accepted → paid, and the audit log has admin.order.push.
#   3. Pushes to each sandbox fail number read PENDING first, then FAILED; the
#      attempt's failure_reason and the cart outcome's sub-reason match.
#   4. Refusals: not_payable, attempt_in_flight, rate_limited (30 s gap and
#      3/hour), invalid_phone, method_disabled — each logs admin_push_refused.
#      A gateway refusal is 502 with the sanitized error stored on the attempt.
#   5. An expired cart is revived: stock (and seats) held again, then paid.
#      Sold-out stock or a taken seat → inventory_unavailable, nothing changed.
#   6. The buyer's own pay endpoint still refuses an expired cart.
#
# Style mirrors cart-outcomes.e2e.sh. Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-56350}"
API_PORT="${TEST_API_PORT:-4350}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-push-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-pushsnap-XXXXXX")"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_push
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_push"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" settings tiers organizers audit admin events kyc >/dev/null

q() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_push -v ON_ERROR_STOP=1 -c "$1"; }
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1 → $2"; else echo "  ✗ $1 → $2 (want $3)"; fail=1; fi; }

psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_push -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('brunch-vol-09','Garden Brunch — Vol. 09') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-brunch','brunch-vol-09','GA', 80) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-brunch', 35000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-brunch');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-brunch', 80, 80) on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-last','brunch-vol-09','Last one', 1) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-last', 90000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-last');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-last', 1, 1) on conflict do nothing;
update organizer set kyc_status = 'approved' where id in ('o1','o2');
SQL

echo "== boot API (x-bridge MOCK; refuses payer $REJECT_PHONE) =="
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true XBRIDGE_MOCK_REJECT_PHONE="$REJECT_PHONE" \
    XBRIDGE_MOCK_STATUS_FILE="$STATUS_FILE" \
    COOKIE_SECURE=false SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    SMS_DRIVER=mock EMAIL_DRIVER=mock PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >>"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
jx() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let o;try{o=JSON.parse(s)}catch{process.stdout.write("ERR:"+s.slice(0,160));return}try{process.stdout.write(String(eval(process.argv[1])))}catch(e){process.stdout.write("ERR:"+e.message)}})' "$1"; }
steer() { node -e 'const fs=require("fs");const f=process.argv[1];const m=JSON.parse(fs.readFileSync(f,"utf8"));m[process.argv[2]]=JSON.parse(process.argv[3]);fs.writeFileSync(f,JSON.stringify(m))' "$STATUS_FILE" "$1" "$2"; }
checkout() { # cookie phone tier
  curl -s -c "$1" -b "$1" -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
    -d "{\"phone\":\"$2\",\"email\":\"b$2@example.com\",\"ageAttested\":true,\"cart\":[{\"tier\":\"${3:-t-brunch}\",\"quantity\":1}],\"method\":\"mobile\"}" | jx 'o.orderId'
}
# push order [json body] [cookie] → "<http>" ; body in $SNAP/push.out
push() {
  local body="${2:-}"; [ -n "$body" ] || body='{}'
  curl -s -o "$SNAP/push.out" -w '%{http_code}' -b "${3:-$SNAP/admin}" -X POST "$BASE/api/admin/orders/$1/push" \
    -H 'content-type: application/json' -d "$body"
}
out() { jx "$1" < "$SNAP/push.out"; }
detail() { curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$1${2:-}"; }
refused() { q "select coalesce(string_agg(detail->>'code', ',' order by id), '-') from order_event where order_id='$1' and step='admin_push_refused'"; }
expire() { # release the holds and expire the cart, as the sweep does
  q "select release_order_holds('$1'::uuid); update \"order\" set status='expired' where id='$1'" >/dev/null
}

curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/thebrunchcity/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/org" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null

echo ""
echo "== 1. GUARD =="
O1=$(checkout "$SNAP/c1" 0712000101)
check "anon → 401" "$(push "$O1" '{}' /dev/null)" 401
check "organizer → 401" "$(push "$O1" '{}' "$SNAP/org")" 401
check "no event logged for a 401" "$(q "select count(*) from order_event where order_id='$O1' and step like 'admin_push%'")" 0

echo ""
echo "== 2. PENDING CART → ACCEPTED → PAID (+255700001111) =="
D=$(detail "$O1")
check "detail offers the prompt" "$(echo "$D" | jx 'o.push.available+":"+o.push.amount+":"+o.push.buyerPhoneValid')" "true:35000:true"
check "push 200" "$(push "$O1" '{"phone":"+255700001111","note":"called the buyer"}')" 200
check "response" "$(out 'o.status+"|"+o.gateway+"|"+o.amount+"|"+o.phone+"|"+(o.transactionId==="ZORA-'"$O1"'-1")')" "pending|accepted|35000|+255 7•• ••• 111|true"
check "attempt carries the cart's own amount" "$(q "select amount::int||':'||method from payment_transaction where order_id='$O1'")" "35000:mobile"
for i in $(seq 1 10); do S=$(detail "$O1" '?reconcile=1' | jx 'o.status'); [ "$S" = paid ] && break; sleep 0.5; done
check "cart paid via the poll" "$S" paid
check "passes issued" "$(q "select count(*) from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$O1'")" 1
check "timeline order" "$(detail "$O1" | jx 'o.timeline.filter(e=>e.source==="logged").map(e=>e.step).filter(s=>["admin_push_requested","pay_requested","gateway_accepted","paid"].includes(s)).join(">")')" "admin_push_requested>pay_requested>gateway_accepted>paid"
check "pay_requested says who asked" "$(q "select detail->>'by'||'|'||(detail->>'adminId')||'|'||(detail->>'note')||'|'||(detail->>'phone') from order_event where order_id='$O1' and step='pay_requested'")" "admin|admin|called the buyer|+255 7•• ••• 111"
check "admin_push_requested detail" "$(q "select (detail->>'amount')||'|'||(detail->>'phone')||'|'||coalesce(detail->>'revivedFrom','-') from order_event where order_id='$O1' and step='admin_push_requested'")" "35000|+255 7•• ••• 111|-"
check "no full number anywhere in the log" "$(q "select count(*) from order_event where order_id='$O1' and detail::text like '%700001111%'")" 0
check "timeline label" "$(detail "$O1" | jx 'o.timeline.find(e=>e.step==="admin_push_requested").label')" "Admin sent a payment prompt"
AUD=$(curl -s -b "$SNAP/admin" "$BASE/api/audit")
check "audit entry" "$(echo "$AUD" | jx 'o.filter(a=>a.action==="admin.order.push"&&a.detail.includes("'"$O1"'")&&a.detail.includes("accepted")&&a.detail.includes("35000 TZS")&&a.detail.includes("+255 7•• ••• 111")).length')" 1
check "paid cart: prompt unavailable" "$(detail "$O1" | jx 'o.push.available+":"+o.push.code')" "false:not_payable"
check "default phone = the buyer's" "$(O=$(checkout "$SNAP/c1b" 0712000102); push "$O" '{}' >/dev/null; out 'o.phone')" "+255 7•• ••• 102"

echo ""
echo "== 3. SANDBOX FAIL NUMBERS → FAILED WITH THE REASON =="
NUMS="3301:payer_no_response 3302:payer_cancelled 3303:insufficient_funds 3304:wrong_pin 3305:invalid_number 3306:provider_error 3307:unknown 2222:payer_cancelled"
: > "$SNAP/sbx.txt"
n=200
for pair in $NUMS; do
  num="${pair%%:*}"; want="${pair#*:}"; n=$((n+1))
  o=$(checkout "$SNAP/s$n" "0712000$n")
  code=$(push "$o" "{\"phone\":\"070000$num\"}")
  [ "$code" = 200 ] || { echo "  ✗ push to $num → $code $(cat "$SNAP/push.out")"; fail=1; }
  echo "$num $want $o" >> "$SNAP/sbx.txt"
done
FIRST=$(head -1 "$SNAP/sbx.txt" | awk '{print $3}')
check "right after the push: still pending" "$(detail "$FIRST" '?reconcile=1' | jx 'o.status+":"+o.attempts[0].status')" "pending:pending"
sleep 3.5
while read -r num want o; do
  for i in $(seq 1 8); do S=$(detail "$o" '?reconcile=1' | jx 'o.status'); [ "$S" = failed ] && break; sleep 0.5; done
  case "$want" in provider_error) wo="system_error|provider_error" ;; *) wo="buyer_didnt_complete|$want" ;; esac
  check "+25570000$num: cart failed, failure_reason" "$S:$(q "select failure_reason from payment_transaction where order_id='$o'")" "failed:$want"
  check "+25570000$num: outcome" "$(detail "$o" | jx 'o.outcome+"|"+o.outcomeDetail')" "$wo"
done < "$SNAP/sbx.txt"

echo ""
echo "== 4. REFUSALS (each logs admin_push_refused) =="
check "not_payable (paid)" "$(push "$O1" '{}')|$(out 'o.error+":"+o.status')" "409|not_payable:paid"
OCOMP=$(q "with c as (insert into customer (phone, email) values ('255713000053','x53@example.com') returning id)
           insert into \"order\" (customer_id, event_id, type, status, target_value) select id, 'brunch-vol-09', 'comp', 'paid', 0 from c returning id" | head -1)
check "not_payable (comp)" "$(push "$OCOMP" '{}')|$(out 'o.error+":"+o.reason')" "409|not_payable:comp"
ODOOR=$(q "with c as (insert into customer (phone, email) values ('255713000054','x54@example.com') returning id)
           insert into \"order\" (customer_id, event_id, type, status, target_value, channel) select id, 'brunch-vol-09', 'ga_vip', 'pending', 35000, 'gate_mobile' from c returning id" | head -1)
check "not_payable (door sale)" "$(push "$ODOOR" '{}')|$(out 'o.error+":"+o.reason')" "409|not_payable:door_sale"
check "  logged" "$(refused "$O1"):$(refused "$OCOMP")" "not_payable:not_payable"

OFLY=$(checkout "$SNAP/f1" 0712000301)
steer "ZORA-$OFLY-1" '{"status":"PENDING"}'
check "first push accepted" "$(push "$OFLY" '{}')" 200
check "attempt_in_flight" "$(push "$OFLY" '{}')|$(out 'o.error+":"+(o.retryAfterSecs>0)')" "409|attempt_in_flight:true"
check "  detail shows the prompt as in flight" "$(detail "$OFLY" | jx 'o.push.available+":"+o.push.code')" "false:attempt_in_flight"
check "  logged" "$(refused "$OFLY")" attempt_in_flight

ORL=$(checkout "$SNAP/r1" 0712000302)
check "push to a fail number" "$(push "$ORL" '{"phone":"0700003302"}')" 200
sleep 3.2; detail "$ORL" '?reconcile=1' >/dev/null
q "update payment_transaction set created_at = created_at - interval '3 minutes' where order_id='$ORL'" >/dev/null
check "rate_limited (under 30 s since the last prompt)" "$(push "$ORL" '{}')|$(out 'o.error')" "429|rate_limited"
curl -s -D "$SNAP/h.txt" -o /dev/null -b "$SNAP/admin" -X POST "$BASE/api/admin/orders/$ORL/push" -H 'content-type: application/json' -d '{}'
check "  Retry-After header" "$(grep -ci '^retry-after:' "$SNAP/h.txt")" 1
q "update order_event set at = at - interval '5 minutes' where order_id='$ORL' and step='admin_push_requested';
   insert into order_event (order_id, step, at, detail) values ('$ORL','admin_push_requested', now() - interval '10 minutes', '{}'), ('$ORL','admin_push_requested', now() - interval '20 minutes', '{}')" >/dev/null
check "rate_limited (3 in the last hour)" "$(push "$ORL" '{}')|$(out 'o.error+":"+/3 prompts/.test(o.message)')" "429|rate_limited:true"
q "update order_event set at = at - interval '2 hours' where order_id='$ORL' and step='admin_push_requested'" >/dev/null
check "  an hour later it is allowed again (failed cart re-held)" "$(push "$ORL" '{"phone":"+255700001111"}')|$(out 'o.revivedFrom')" "200|failed"
check "  logged" "$(refused "$ORL")" "rate_limited,rate_limited,rate_limited"

OPH=$(checkout "$SNAP/p1" 0712000303)
check "invalid_phone (+255 8…)" "$(push "$OPH" '{"phone":"+255812345678"}')|$(out 'o.error')" "400|invalid_phone"
check "invalid_phone (Kenya)" "$(push "$OPH" '{"phone":"+254712345678"}')" 400
check "invalid_phone (too short)" "$(push "$OPH" '{"phone":"0712"}')" 400
check "  logged, nothing sent" "$(refused "$OPH"):$(q "select count(*) from payment_transaction where order_id='$OPH'")" "invalid_phone,invalid_phone,invalid_phone:0"

curl -s -b "$SNAP/admin" -X PUT "$BASE/api/settings/methods-enabled" -H 'content-type: application/json' -d '{"methodsEnabled":{"mobile":false}}' >/dev/null
check "method_disabled" "$(push "$OPH" '{}')|$(out 'o.error')" "403|method_disabled"
check "  detail shows mobile money off" "$(detail "$OPH" | jx 'o.push.code')" method_disabled
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/settings/methods-enabled" -H 'content-type: application/json' -d '{"methodsEnabled":{"mobile":true}}' >/dev/null
check "  logged" "$(refused "$OPH" | awk -F, '{print $NF}')" method_disabled

OREJ=$(checkout "$SNAP/g1" 0712000304)
check "gateway refusal → 502" "$(push "$OREJ" "{\"phone\":\"$REJECT_PHONE\"}")|$(out 'o.gateway+":"+o.status+":"+/Credentials for GODIGITAL/.test(o.error)+":"+o.error.includes("712999999")')" "502|rejected:pending:true:false"
check "  error stored on the attempt" "$(q "select (error like '%GODIGITAL%')::text from payment_transaction where order_id='$OREJ'")" true
check "  gateway_rejected in the log" "$(q "select count(*) from order_event where order_id='$OREJ' and step='gateway_rejected'")" 1
check "  a refused attempt is not 'in flight'" "$(detail "$OREJ" | jx 'o.push.code')" rate_limited
check "  audited as rejected" "$(curl -s -b "$SNAP/admin" "$BASE/api/audit" | jx 'o.filter(a=>a.action==="admin.order.push"&&a.detail.includes("'"$OREJ"'")&&a.detail.includes("gateway rejected")).length')" 1
check "refusals audited too" "$(curl -s -b "$SNAP/admin" "$BASE/api/audit" | jx 'o.filter(a=>a.action==="admin.order.push"&&a.detail.includes("refused: invalid_phone")).length')" 3

echo ""
echo "== 5. EXPIRED CART: REVIVE =="
OEXP=$(checkout "$SNAP/e1" 0712000401)
AV0=$(q "select available_count from inventory_pool where product_tier_id='t-brunch'")
expire "$OEXP"
check "expired, stock back" "$(q "select status from \"order\" where id='$OEXP'"):$(q "select available_count from inventory_pool where product_tier_id='t-brunch'")" "expired:$((AV0+1))"
check "buyer's pay endpoint still refuses it" "$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/e1" -X POST "$BASE/api/checkout/$OEXP/pay" -H 'content-type: application/json' -d '{"method":"mobile","payerPhone":"0712000401"}')" 409
check "detail: prompt revives it" "$(detail "$OEXP" | jx 'o.push.available+":"+o.push.revives')" "true:expired"
check "admin push 200" "$(push "$OEXP" '{"phone":"+255700001111"}')|$(out 'o.revivedFrom')" "200|expired"
check "stock held again" "$(q "select count(*) from inventory_hold where order_id='$OEXP' and state='held'"):$(q "select available_count from inventory_pool where product_tier_id='t-brunch'")" "1:$AV0"
check "revive logged" "$(q "select detail->>'reason' from order_event where order_id='$OEXP' and step='status_changed' and detail->>'to'='pending'")" admin_revive
for i in $(seq 1 10); do S=$(detail "$OEXP" '?reconcile=1' | jx 'o.status'); [ "$S" = paid ] && break; sleep 0.5; done
check "revived cart pays" "$S" paid

# Sold out: the only "t-last" ticket is held by someone else.
OLA=$(checkout "$SNAP/e2" 0712000402 t-last); expire "$OLA"
OLB=$(checkout "$SNAP/e3" 0712000403 t-last)
check "other buyer holds the last one" "$(q "select available_count from inventory_pool where product_tier_id='t-last'")" 0
check "inventory_unavailable" "$(push "$OLA" '{}')|$(out 'o.error')" "409|inventory_unavailable"
check "  nothing changed" "$(q "select status from \"order\" where id='$OLA'"):$(q "select count(*) from inventory_hold where order_id='$OLA' and state='held'"):$(q "select count(*) from payment_transaction where order_id='$OLA'")" "expired:0:0"
check "  logged" "$(refused "$OLA")" inventory_unavailable
check "  no admin_push_requested" "$(q "select count(*) from order_event where order_id='$OLA' and step='admin_push_requested'")" 0

# Seats (BS125): the cart's exact seats come back with it.
q "insert into seat_inventory (event_id, seat_id, zone_id, kind, label, tier_id, layout_version) values
   ('brunch-vol-09','z-A1','z','seat','A1','t-brunch',1), ('brunch-vol-09','z-A2','z','seat','A2','t-brunch',1), ('brunch-vol-09','z-B1','z','seat','B1','t-brunch',1)" >/dev/null
OS1=$(checkout "$SNAP/e4" 0712000404)
q "insert into order_seat (order_id, order_item_id, event_id, seat_id) select '$OS1', id, 'brunch-vol-09', s from order_item, unnest(array['z-A1','z-A2']) s where order_id='$OS1'" >/dev/null
expire "$OS1"
check "seated cart: push 200" "$(push "$OS1" '{"phone":"+255700001111"}')" 200
check "  both seats held for it" "$(q "select count(*) from seat_inventory where hold_order_id='$OS1' and state='held'")" 2
check "  revive logged the seats" "$(q "select detail->>'seats' from order_event where order_id='$OS1' and step='status_changed' and detail->>'reason'='admin_revive'")" 2
for i in $(seq 1 10); do S=$(detail "$OS1" '?reconcile=1' | jx 'o.status'); [ "$S" = paid ] && break; sleep 0.5; done
check "  paid, seats sold to it" "$S:$(q "select count(*) from seat_inventory where sold_order_id='$OS1' and state='sold'")" "paid:2"
OS2=$(checkout "$SNAP/e5" 0712000405)
q "insert into order_seat (order_id, order_item_id, event_id, seat_id) select '$OS2', id, 'brunch-vol-09', 'z-B1' from order_item where order_id='$OS2';
   update seat_inventory set state='sold', sold_order_id=gen_random_uuid() where seat_id='z-B1'" >/dev/null
expire "$OS2"
AV1=$(q "select available_count from inventory_pool where product_tier_id='t-brunch'")
check "seat taken → inventory_unavailable" "$(push "$OS2" '{}')|$(out 'o.error')" "409|inventory_unavailable"
check "  tier hold rolled back too" "$(q "select count(*) from inventory_hold where order_id='$OS2' and state='held'"):$(q "select available_count from inventory_pool where product_tier_id='t-brunch'"):$(q "select status from \"order\" where id='$OS2'")" "0:$AV1:expired"
check "buyer pay on the expired cart: unchanged 409" "$(curl -s -o "$SNAP/bp.out" -w '%{http_code}' -b "$SNAP/e5" -X POST "$BASE/api/checkout/$OS2/pay" -H 'content-type: application/json' -d '{"method":"mobile","payerPhone":"0712000405"}')|$(jx 'o.error' < "$SNAP/bp.out")" "409|not_payable"

echo ""
[ "$fail" = "0" ] || { echo "ADMIN PUSH E2E: FAIL"; tail -40 "$SNAP/api.log"; exit 1; }
echo "ADMIN PUSH E2E: PASS (super_admin only · accepted → paid via 1111 · sandbox fail numbers → failure_reason + outcome · every refusal coded + logged · gateway refusal 502 · expired cart revived with stock and seats · buyer path unchanged)"
