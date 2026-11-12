#!/usr/bin/env bash
# BS164 — ADMIN "CHECK WITH X-BRIDGE". Boots the real API on a throwaway Postgres
# (x-bridge MOCK, steered per attempt by XBRIDGE_MOCK_STATUS_FILE) and proves
# POST /api/admin/orders/:id/gateway-check:
#
#   1. is super_admin only (401 anon + organizer); 404 for an unknown / bad id.
#   2. EXPIRED attempt + x-bridge COMPLETED (late settlement) → attempt
#      successful, cart paid, stock taken again, pass issued; timeline has
#      gateway_checked; audit has admin.order.gateway_check.
#   3. EXPIRED + PARTIAL → partial, cart payment_short.
#   4. EXPIRED + FAILED on the cart's only attempt → cart failed, buyer can
#      retry (as before). An OLDER attempt failing while a newer one is still
#      out → only that attempt closes; cart and holds untouched (GUARD 3).
#   5. EXPIRED + PENDING → still_pending, nothing changes.
#   6. OPEN attempt + COMPLETED → paid, exactly like the poller.
#   7. FINISHED attempt: x-bridge agrees → unchanged; disagrees → mismatch,
#      nothing changed, gateway_mismatch ops alert in Needs attention.
#   8. An attempt stored with a gateway error is still asked (the POST may have
#      timed out after x-bridge took it).
#   9. One check per cart per 10 s (429 + Retry-After), then allowed again.
#  10. Repeating a check changes nothing (exactly-once).
#  11. Money the cart can't take is flagged, never applied: a late COMPLETED /
#      PARTIAL on an expired attempt after a newer attempt paid the cart
#      (late_collection), and a second collection on a paid cart
#      (duplicate_collection) → needs_refund; the cart stays paid, one pass.
#  12. A partial whose amount x-bridge now reports differently → mismatch.
#
# Style mirrors admin-push.e2e.sh. Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-56364}"
API_PORT="${TEST_API_PORT:-4364}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-gwc-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-gwcsnap-XXXXXX")"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_gwc
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_gwc"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" settings tiers organizers audit admin events kyc >/dev/null

q() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_gwc -v ON_ERROR_STOP=1 -c "$1"; }
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1 → $2"; else echo "  ✗ $1 → $2 (want $3)"; fail=1; fi; }

psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_gwc -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('brunch-vol-09','Garden Brunch — Vol. 09') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-brunch','brunch-vol-09','GA', 80) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-brunch', 35000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-brunch');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-brunch', 80, 80) on conflict do nothing;
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
checkout() { # cookie phone
  curl -s -c "$1" -b "$1" -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
    -d "{\"phone\":\"$2\",\"email\":\"b$2@example.com\",\"ageAttested\":true,\"cart\":[{\"tier\":\"t-brunch\",\"quantity\":1}],\"method\":\"mobile\"}" | jx 'o.orderId'
}
pay() { # cookie order phone → http
  curl -s -o "$SNAP/pay.out" -w '%{http_code}' -b "$1" -X POST "$BASE/api/checkout/$2/pay" -H 'content-type: application/json' \
    -d "{\"method\":\"mobile\",\"payerPhone\":\"$3\"}"
}
# gwc order [cookie] → "<http>" ; body in $SNAP/gwc.out
gwc() {
  curl -s -D "$SNAP/gwc.h" -o "$SNAP/gwc.out" -w '%{http_code}' -b "${2:-$SNAP/admin}" -X POST "$BASE/api/admin/orders/$1/gateway-check" \
    -H 'content-type: application/json' -d '{}'
}
out() { jx "$1" < "$SNAP/gwc.out"; }
unthrottle() { q "update order_event set at = at - interval '1 minute' where order_id='$1' and step='gateway_checked'" >/dev/null; }
# A pending attempt the worker gave up on: attempt expired, holds released, cart expired.
expire_all() {
  q "update payment_transaction set status='expired' where order_id='$1';
     select release_order_holds('$1'::uuid); update \"order\" set status='expired' where id='$1'" >/dev/null
}
ostatus() { q "select status from \"order\" where id='$1'"; }
tstatus() { q "select status from payment_transaction where order_id='$1' order by created_at desc limit 1"; }
PENDING='{"status":"PENDING","amount":"35000"}'
COMPLETED='{"status":"COMPLETED","amount":"35000","collectedAmount":"35000"}'

curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/org" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null

echo ""
echo "== 1. GUARD =="
O1=$(checkout "$SNAP/c1" 0712000101)
check "anon → 401" "$(gwc "$O1" /dev/null)" 401
check "organizer → 401" "$(gwc "$O1" "$SNAP/org")" 401
check "unknown order → 404" "$(gwc 00000000-0000-0000-0000-000000000000)|$(out 'o.error')" "404|order_not_found"
check "bad id → 404" "$(gwc not-a-uuid)" 404
check "no attempts → 200, empty" "$(gwc "$O1")|$(out 'o.attempts.length+":"+o.updated')" "200|0:0"
unthrottle "$O1"

echo ""
echo "== 2. EXPIRED + COMPLETED → LATE SETTLEMENT → PAID =="
steer "ZORA-$O1-1" "$PENDING"
check "buyer pay 200" "$(pay "$SNAP/c1" "$O1" 0712000101)" 200
expire_all "$O1"
AV0=$(q "select available_count from inventory_pool where product_tier_id='t-brunch'")
check "before: cart + attempt expired, no holds" "$(ostatus "$O1"):$(tstatus "$O1"):$(q "select count(*) from inventory_hold where order_id='$O1' and state='held'")" "expired:expired:0"
steer "ZORA-$O1-1" "$COMPLETED"
check "check 200" "$(gwc "$O1")" 200
check "attempt verdict" "$(out 'o.attempts[0].verdict+"|"+o.attempts[0].before+"→"+o.attempts[0].after+"|"+o.attempts[0].gatewayStatus+"|"+o.attempts[0].collectedAmount')" "updated|expired→successful|COMPLETED|35000"
check "summary" "$(out 'o.orderStatusBefore+"→"+o.orderStatusAfter+"|"+o.updated+"|"+o.mismatches')" "expired→paid|1|0"
check "cart paid, attempt successful" "$(ostatus "$O1"):$(tstatus "$O1")" "paid:successful"
check "stock taken again" "$(q "select available_count from inventory_pool where product_tier_id='t-brunch'")" "$((AV0-1))"
check "pass issued" "$(q "select count(*) from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$O1'")" 1
check "timeline: empty check, paid, then the check that caused it (stamped at its end)" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$O1" | jx 'o.timeline.filter(e=>e.source==="logged").map(e=>e.step).filter(s=>["paid","gateway_checked"].includes(s)).join(">")')" "gateway_checked>paid>gateway_checked"
check "timeline label" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$O1" | jx 'o.timeline.find(e=>e.step==="gateway_checked").label')" "Checked with x-bridge"
check "gateway_checked detail" "$(q "select (detail->>'by')||'|'||(detail->>'checked')||'|'||(detail->>'updated')||'|'||(detail->>'from')||'|'||(detail->>'to') from order_event where order_id='$O1' and step='gateway_checked' order by id desc limit 1")" "admin|1|1|expired|paid"
check "audit entry" "$(curl -s -b "$SNAP/admin" "$BASE/api/audit" | jx 'o.filter(a=>a.action==="admin.order.gateway_check"&&a.detail.includes("'"$O1"'")&&a.detail.includes("updated 1")).length')" 1

echo ""
echo "== 10. REPEAT → NOTHING CHANGES =="
unthrottle "$O1"
check "second check 200" "$(gwc "$O1")" 200
check "  verdict unchanged (x-bridge agrees)" "$(out 'o.attempts[0].verdict+"|"+o.updated')" "unchanged|0"
check "  still one pass, stock same" "$(q "select count(*) from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$O1'"):$(q "select available_count from inventory_pool where product_tier_id='t-brunch'")" "1:$((AV0-1))"

echo ""
echo "== 9. RATE LIMIT =="
check "immediate re-check → 429" "$(gwc "$O1")|$(out 'o.error')" "429|rate_limited"
check "  Retry-After set" "$(grep -ic '^retry-after:' "$SNAP/gwc.h")" 1
unthrottle "$O1"
check "after the gap → 200" "$(gwc "$O1")" 200
unthrottle "$O1"
for k in 1 2; do curl -s -o /dev/null -w '%{http_code}\n' -b "$SNAP/admin" -X POST "$BASE/api/admin/orders/$O1/gateway-check" -H 'content-type: application/json' -d '{}' > "$SNAP/par$k" & pids="${pids:-} $!"; done; for p in $pids; do wait "$p"; done
check "two at once → one 200, one 429" "$(cat "$SNAP/par1" "$SNAP/par2" | sort | tr '\n' ' ')" "200 429 "

echo ""
echo "== 3. EXPIRED + PARTIAL → PAYMENT_SHORT =="
O3=$(checkout "$SNAP/c3" 0712000103)
steer "ZORA-$O3-1" "$PENDING"
pay "$SNAP/c3" "$O3" 0712000103 >/dev/null
expire_all "$O3"
steer "ZORA-$O3-1" '{"status":"PARTIAL","amount":"35000","collectedAmount":"10000"}'
check "check 200" "$(gwc "$O3")" 200
check "  partial, cart payment_short, collected" "$(tstatus "$O3"):$(ostatus "$O3"):$(q "select collected_amount::int from payment_transaction where order_id='$O3'")" "partial:payment_short:10000"

echo ""
echo "== 4. EXPIRED + FAILED: the cart's only attempt → cart fails (buyer can retry); an older one while a newer is out → attempt only =="
O4=$(checkout "$SNAP/c4" 0712000104)
steer "ZORA-$O4-1" "$PENDING"
pay "$SNAP/c4" "$O4" 0712000104 >/dev/null
q "update payment_transaction set status='expired' where order_id='$O4'" >/dev/null  # cart still pending, holds kept
HOLDS4=$(q "select count(*) from inventory_hold where order_id='$O4' and state='held'")
steer "ZORA-$O4-1" '{"status":"FAILED","amount":"35000","failureReason":"payer_no_response"}'
check "check 200" "$(gwc "$O4")" 200
check "  verdict + reason" "$(out 'o.attempts[0].verdict+"|"+o.attempts[0].after+"|"+o.attempts[0].failureReason')" "updated|failed|payer_no_response"
check "  attempt failed, cart failed, holds released" "$(tstatus "$O4"):$(ostatus "$O4"):$(q "select count(*) from inventory_hold where order_id='$O4' and state='held'")" "failed:failed:0"
check "  buyer can retry" "$(steer "ZORA-$O4-2" "$PENDING"; pay "$SNAP/c4" "$O4" 0712000104)" 200

O4B=$(checkout "$SNAP/c4b" 0712000114)
steer "ZORA-$O4B-1" '{"status":"FAILED","amount":"35000","failureReason":"payer_cancelled"}'
pay "$SNAP/c4b" "$O4B" 0712000114 >/dev/null
q "insert into payment_transaction (order_id, transaction_id, method, amount, status, created_at) values ('$O4B','ZORA-$O4B-2','mobile',35000,'pending', now() + interval '1 second');
   update payment_transaction set accepted_at = now() where transaction_id='ZORA-$O4B-2'" >/dev/null
steer "ZORA-$O4B-2" "$PENDING"
HOLDS4B=$(q "select count(*) from inventory_hold where order_id='$O4B' and state='held'")
check "OPEN older attempt fails while a newer one is out → attempt only" "$(gwc "$O4B")|$(out 'o.attempts.find(a=>a.transactionId.endsWith("-1")).verdict+":"+o.attempts.find(a=>a.transactionId.endsWith("-1")).after')" "200|updated:failed"
check "  cart still pending, holds kept" "$(ostatus "$O4B"):$(q "select count(*) from inventory_hold where order_id='$O4B' and state='held'")" "pending:$HOLDS4B"

O4C=$(checkout "$SNAP/c4c" 0712000115)
steer "ZORA-$O4C-1" "$PENDING"
pay "$SNAP/c4c" "$O4C" 0712000115 >/dev/null   # older attempt, still out (think: a bill-pay number)
q "insert into payment_transaction (order_id, transaction_id, method, amount, status, accepted_at, created_at) values ('$O4C','ZORA-$O4C-2','mobile',35000,'pending', now(), now() + interval '1 second')" >/dev/null
steer "ZORA-$O4C-2" '{"status":"FAILED","amount":"35000","failureReason":"payer_cancelled"}'
H4C=$(q "select count(*) from inventory_hold where order_id='$O4C' and state='held'")
check "NEWER attempt fails while an older one is still out → attempt only" "$(gwc "$O4C")|$(out 'o.attempts.find(a=>a.transactionId.endsWith("-2")).after'):$(ostatus "$O4C"):$(q "select count(*) from inventory_hold where order_id='$O4C' and state='held'")" "200|failed:pending:$H4C"

echo ""
echo "== 5. EXPIRED + PENDING → STILL PENDING =="
O5=$(checkout "$SNAP/c5" 0712000105)
steer "ZORA-$O5-1" "$PENDING"
pay "$SNAP/c5" "$O5" 0712000105 >/dev/null
expire_all "$O5"
check "check 200" "$(gwc "$O5")" 200
check "  still_pending, nothing changed" "$(out 'o.attempts[0].verdict+"|"+o.updated'):$(tstatus "$O5"):$(ostatus "$O5")" "still_pending|0:expired:expired"

echo ""
echo "== 6. OPEN + COMPLETED → PAID (same as the poller) =="
O6=$(checkout "$SNAP/c6" 0712000106)
steer "ZORA-$O6-1" "$PENDING"
pay "$SNAP/c6" "$O6" 0712000106 >/dev/null
steer "ZORA-$O6-1" "$COMPLETED"
check "check 200" "$(gwc "$O6")" 200
check "  pending→successful, cart paid" "$(out 'o.attempts[0].before+"→"+o.attempts[0].after'):$(ostatus "$O6")" "pending→successful:paid"

echo ""
echo "== 7. FINISHED: AGREES / DISAGREES =="
unthrottle "$O6"
check "agrees → unchanged" "$(gwc "$O6")|$(out 'o.attempts[0].verdict')" "200|unchanged"
unthrottle "$O6"
steer "ZORA-$O6-1" '{"status":"FAILED","amount":"35000","failureReason":"unknown"}'
check "disagrees → mismatch" "$(gwc "$O6")|$(out 'o.attempts[0].verdict+"|"+o.mismatches')" "200|mismatch|1"
check "  nothing changed" "$(tstatus "$O6"):$(ostatus "$O6"):$(q "select count(*) from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$O6' and c.state='issued'")" "successful:paid:1"
check "  ops alert raised" "$(q "select count(*) from webhook_event where provider='ops-alert' and dedup_key like 'gateway_mismatch:$O6:%'")" 1
check "  in Needs attention" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/attention" | jx 'o.items.filter(i=>i.kind==="ops_alert"&&i.href.includes("'"$O6"'")&&i.title.startsWith("x-bridge disagrees")).length')" 1

echo ""
echo "== 8. AN ATTEMPT STORED AS REFUSED IS STILL ASKED (a timed-out POST may have been taken) =="
O8=$(checkout "$SNAP/c8" 0712000108)
check "buyer pay refused by the gateway (existing 500)" "$(pay "$SNAP/c8" "$O8" "$REJECT_PHONE")" 500
steer "ZORA-$O8-1" '{"status":"FAILED","amount":"35000","failureReason":"unknown"}'
check "check 200" "$(gwc "$O8")" 200
check "  read and applied" "$(out 'o.attempts[0].verdict+"|"+o.attempts[0].gatewayStatus+"|"+o.attempts[0].after')" "updated|FAILED|failed"

echo ""
echo "== 11. MONEY THE CART CAN'T TAKE → NEEDS_REFUND =="
O11=$(checkout "$SNAP/c11" 0712000111)
steer "ZORA-$O11-1" "$PENDING"
pay "$SNAP/c11" "$O11" 0712000111 >/dev/null
q "update payment_transaction set status='expired' where order_id='$O11'" >/dev/null   # timed out; cart still pending
steer "ZORA-$O11-2" "$COMPLETED"
check "retry pay 200" "$(pay "$SNAP/c11" "$O11" 0712000111)" 200
check "check: retry pays, old one still pending" "$(gwc "$O11")|$(out 'o.attempts.map(a=>a.verdict).join(",")'):$(ostatus "$O11")" "200|updated,still_pending:paid"
unthrottle "$O11"
steer "ZORA-$O11-1" '{"status":"PARTIAL","amount":"35000","collectedAmount":"5000"}'
check "late PARTIAL on the old attempt → needs_refund" "$(gwc "$O11")|$(out 'o.attempts[1].verdict+"|"+o.needsRefund')" "200|needs_refund|1"
check "  cart still paid (not payment_short); money recorded on the attempt" "$(ostatus "$O11"):$(q "select status||':'||collected_amount::int from payment_transaction where transaction_id='ZORA-$O11-1'")" "paid:partial:5000"
check "  late_collection alert" "$(q "select count(*) from webhook_event where provider='ops-alert' and dedup_key like 'late_collection:$O11:%'")" 1
unthrottle "$O11"
q "insert into payment_transaction (order_id, transaction_id, method, amount, status, created_at) values ('$O11','ZORA-$O11-4','mobile',35000,'expired', now() - interval '3 hours')" >/dev/null
steer "ZORA-$O11-4" "$COMPLETED"
check "late COMPLETED on another expired attempt → needs_refund (duplicate)" "$(gwc "$O11")|$(out 'o.attempts.find(a=>a.transactionId.endsWith("-4")).verdict')" "200|needs_refund"
check "  still one pass, cart paid" "$(q "select count(*) from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$O11'"):$(ostatus "$O11")" "1:paid"
check "  in Needs attention" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/attention" | jx 'o.items.filter(i=>i.kind==="ops_alert"&&i.href.includes("'"$O11"'")&&i.title.startsWith("Money collected")).length>0')" true
unthrottle "$O11"
q "insert into payment_transaction (order_id, transaction_id, method, amount, status) values ('$O11','ZORA-$O11-3','mobile',35000,'pending')" >/dev/null
steer "ZORA-$O11-3" "$COMPLETED"
check "second collection on an open attempt → needs_refund" "$(gwc "$O11")|$(out 'o.attempts.find(a=>a.transactionId.endsWith("-3")).verdict')" "200|needs_refund"
check "  one duplicate_collection alert per extra attempt, still one pass, cart paid" "$(q "select count(*) from webhook_event where provider='ops-alert' and dedup_key in ('duplicate_collection:$O11:ZORA-$O11-3','duplicate_collection:$O11:ZORA-$O11-4')"):$(q "select count(*) from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$O11'"):$(ostatus "$O11")" "2:1:paid"
unthrottle "$O11"
check "timeline: one Paid only (logged + derived), extras are neutral" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$O11" | jx 'o.timeline.filter(e=>e.step==="paid").length+":"+o.timeline.filter(e=>e.step==="short").length')" "1:0"
check "organizer timeline: one Paid only" "$(curl -s -b "$SNAP/org" "$BASE/api/org/orders/$O11" | jx 'o.timeline.filter(e=>e.step==="paid").length')" 1
q "update webhook_event set received_at = now() - interval '4 days' where provider='ops-alert' and dedup_key='late_collection:$O11:ZORA-$O11-1'" >/dev/null
check "re-check: money never taken is still needs_refund" "$(gwc "$O11")|$(out 'o.attempts.find(a=>a.transactionId.endsWith("-1")).verdict')" "200|needs_refund"
check "  and its aged-out alert is back in view" "$(q "select (received_at > now() - interval '1 minute')::text from webhook_event where provider='ops-alert' and dedup_key='late_collection:$O11:ZORA-$O11-1'")" true

q "insert into payment_transaction (order_id, transaction_id, method, amount, status, created_at) values ('$O11','ZORA-$O11-5','mobile',35000,'expired', now() - interval '4 hours')" >/dev/null
steer "ZORA-$O11-5" '{"status":"PARTIAL","amount":"35000","collectedAmount":"7000"}'
curl -s -o /dev/null -X POST "$BASE/api/webhooks/xbridge" -H 'content-type: application/json' -d "{\"transactionId\":\"ZORA-$O11-5\",\"status\":\"PARTIAL\"}"
check "late webhook on a paid cart: guarded the same way" "$(ostatus "$O11"):$(q "select status||':'||collected_amount::int from payment_transaction where transaction_id='ZORA-$O11-5'"):$(q "select count(*) from webhook_event where provider='ops-alert' and dedup_key='late_collection:$O11:ZORA-$O11-5'")" "paid:partial:7000:1"

unthrottle "$O11"
q "insert into payment_transaction (order_id, transaction_id, method, amount, status) values ('$O11','ZORA-$O11-6','mobile',35000,'pending')" >/dev/null
steer "ZORA-$O11-6" '{"status":"PARTIAL","amount":"35000","collectedAmount":"2000"}'
check "OPEN attempt PARTIAL on a paid cart → needs_refund, cart stays paid" "$(gwc "$O11")|$(out 'o.attempts.find(a=>a.transactionId.endsWith("-6")).verdict'):$(ostatus "$O11")" "200|needs_refund:paid"

OR=$(checkout "$SNAP/cr" 0712000120)
steer "ZORA-$OR-1" "$COMPLETED"
pay "$SNAP/cr" "$OR" 0712000120 >/dev/null
gwc "$OR" >/dev/null; unthrottle "$OR"
q "update \"order\" set status='refunded' where id='$OR';
   insert into payment_transaction (order_id, transaction_id, method, amount, status, created_at) values ('$OR','ZORA-$OR-2','mobile',35000,'expired', now() - interval '1 hour')" >/dev/null
steer "ZORA-$OR-2" "$COMPLETED"
check "late COMPLETED on a REFUNDED cart → needs_refund, no new passes" "$(gwc "$OR")|$(out 'o.attempts.find(a=>a.transactionId.endsWith("-2")).verdict'):$(ostatus "$OR"):$(q "select count(*) from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$OR'")" "200|needs_refund:refunded:1"
check "  still shown in Needs attention" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/attention" | jx 'o.items.filter(i=>i.kind==="ops_alert"&&i.href.includes("'"$OR"'")).length')" 1

echo ""
echo "== 12. PARTIAL AMOUNT DRIFT → MISMATCH =="
unthrottle "$O3"
check "same partial amount → unchanged" "$(gwc "$O3")|$(out 'o.attempts[0].verdict')" "200|unchanged"
unthrottle "$O3"
steer "ZORA-$O3-1" '{"status":"PARTIAL","amount":"35000","collectedAmount":"30000"}'
check "x-bridge now reports 30000 → mismatch" "$(gwc "$O3")|$(out 'o.attempts[0].verdict'):$(q "select collected_amount::int from payment_transaction where order_id='$O3'")" "200|mismatch:10000"

echo ""
echo "== organizer timeline never shows the check =="
check "org view has a timeline, no gateway_checked" "$(curl -s -b "$SNAP/org" "$BASE/api/org/orders/$O1" | jx '!Array.isArray(o.timeline)?"no-timeline":(JSON.stringify(o).includes("gateway_check")||JSON.stringify(o).includes("x-bridge"))?"leak":"clean"')" clean

echo ""
[ "$fail" = "0" ] || { echo "GATEWAY CHECK E2E: FAIL"; tail -40 "$SNAP/api.log"; exit 1; }
echo "GATEWAY CHECK E2E: PASS (super_admin only · expired + COMPLETED settles late → paid with pass · PARTIAL → short · FAILED fails the cart unless a newer attempt is out · PENDING untouched · open settles like the poller · finished: agree unchanged, disagree flagged not changed · refused attempt still asked · money the cart can't take → needs_refund · partial drift → mismatch · 10 s limit, atomic · repeat is a no-op)"
