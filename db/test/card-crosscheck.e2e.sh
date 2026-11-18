#!/usr/bin/env bash
# BS166 — CARD CHECKOUT (x-bridge /v1), SIGNED BUSINESS WEBHOOKS, PAYMENT CROSS-CHECK.
# Boots the real API on a throwaway Postgres (x-bridge MOCK: statuses steered by
# XBRIDGE_MOCK_STATUS_FILE, x-bridge's list by XBRIDGE_MOCK_LIST_FILE) and proves:
#
#   1. /api/payment-methods offers card only with the admin switch on, and says
#      a billing address is needed (x-bridge's billing_address_required).
#   2. Card pay without a full billing address → 400 billing_incomplete naming
#      the fields, and NOTHING is written (no attempt, cart unchanged).
#   3. Card pay with it → 200, redirectUrl is the card page; the attempt is on
#      the /v1 rail (provider xbridge_v1c) with its page + expiry stored; the
#      stock is held for 70 min.
#   4. The buyer's status read shows the open card attempt and the page to go
#      back to; a stranger's doesn't. PENDING stays pending; COMPLETED → paid,
#      one pass.
#   5. Card switched off by the admin → payment-methods hides it, pay → 403.
#   6. Webhook: unsigned / wrong secret / stale timestamp → 401; signed
#      payment.received for an attempt our window expired → paid; the same
#      eventId again → deduped; an unknown reference → 200 + Needs attention.
#   7. Webhook on a FAILED attempt: full amount → reopened and paid; less than
#      the amount → nothing applied, gateway_mismatch.
#   8. Cross-check recheck: an expired attempt x-bridge now says COMPLETED →
#      settled; a second run right away skips it (backoff).
#   9. Cross-check list: COMPLETED row for our expired attempt → settled; a
#      paid row we have no attempt for → gateway_unknown_payment; ours paid but
#      x-bridge FAILED → gateway_mismatch.
#  10. Admin page data: guard (401 anon), runs + alerts listed.
#
# Style mirrors gateway-check.e2e.sh. Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-56366}"
API_PORT="${TEST_API_PORT:-4366}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-card-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-cardsnap-XXXXXX")"
USER_NAME="$(whoami)"
STATUS_FILE="$SNAP/status.json"
LIST_FILE="$SNAP/list.json"
SECRET="whsec_e2e_card"
echo '{}' > "$STATUS_FILE"
echo '[]' > "$LIST_FILE"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_card
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_card"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" settings tiers organizers audit admin events kyc >/dev/null

q() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_card -v ON_ERROR_STOP=1 -c "$1"; }
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1 → $2"; else echo "  ✗ $1 → $2 (want $3)"; fail=1; fi; }

psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_card -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('brunch-vol-09','Garden Brunch — Vol. 09') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-brunch','brunch-vol-09','GA', 80) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-brunch', 35000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-brunch');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-brunch', 80, 80) on conflict do nothing;
update organizer set kyc_status = 'approved' where id in ('o1','o2');
SQL

echo "== boot API (x-bridge MOCK, webhook secret set) =="
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true \
    XBRIDGE_MOCK_STATUS_FILE="$STATUS_FILE" XBRIDGE_MOCK_LIST_FILE="$LIST_FILE" XBRIDGE_WEBHOOK_SECRET="$SECRET" \
    COOKIE_SECURE=false SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    SMS_DRIVER=mock EMAIL_DRIVER=mock PUBLIC_ORIGIN="http://localhost:$API_PORT" PUBLIC_WEB_ORIGIN="https://web.test" \
    node dist/main.js ) >>"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
jx() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let o;try{o=JSON.parse(s)}catch{process.stdout.write("ERR:"+s.slice(0,160));return}try{process.stdout.write(String(eval(process.argv[1])))}catch(e){process.stdout.write("ERR:"+e.message)}})' "$1"; }
steer() { node -e 'const fs=require("fs");const f=process.argv[1];const m=JSON.parse(fs.readFileSync(f,"utf8"));m[process.argv[2]]=JSON.parse(process.argv[3]);fs.writeFileSync(f,JSON.stringify(m))' "$STATUS_FILE" "$1" "$2"; }
checkout() { # cookie phone → orderId
  curl -s -c "$1" -b "$1" -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
    -d "{\"phone\":\"$2\",\"email\":\"b$2@example.com\",\"ageAttested\":true,\"cart\":[{\"tier\":\"t-brunch\",\"quantity\":1}],\"method\":\"card\"}" | jx 'o.orderId'
}
BILLING='{"address1":"Plot 12, Samora Ave","city":"Dar es Salaam","stateOrRegion":"Dar es Salaam","postcodeOrPobox":"11101","country":"TZ"}'
paycard() { # cookie order phone billingJson → http ; body in $SNAP/pay.out
  curl -s -o "$SNAP/pay.out" -w '%{http_code}' -b "$1" -X POST "$BASE/api/checkout/$2/pay" -H 'content-type: application/json' \
    -d "{\"method\":\"card\",\"payerPhone\":\"$3\",\"payerName\":\"Asha Mussa\",\"billing\":$4}"
}
paymobile() {
  curl -s -o "$SNAP/pay.out" -w '%{http_code}' -b "$1" -X POST "$BASE/api/checkout/$2/pay" -H 'content-type: application/json' \
    -d "{\"method\":\"mobile\",\"payerPhone\":\"$3\"}"
}
pout() { jx "$1" < "$SNAP/pay.out"; }
ostatus() { q "select status from \"order\" where id='$1'"; }
tstatus() { q "select status from payment_transaction where order_id='$1' order by created_at desc limit 1"; }
passes() { q "select count(*) from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$1'"; }
# hook body [secret] [ts] → http ; body in $SNAP/hook.out
hook() {
  local body="$1" secret="${2:-$SECRET}" ts="${3:-$(date +%s)}"
  local sig; sig=$(BODY="$body" S="$secret" TS="$ts" node -e 'process.stdout.write("v1="+require("crypto").createHmac("sha256",process.env.S).update(process.env.TS+"."+process.env.BODY).digest("hex"))')
  curl -s -o "$SNAP/hook.out" -w '%{http_code}' -X POST "$BASE/api/webhooks/xbridge/events" -H 'content-type: application/json' \
    -H "X-Bridge-Signature: $sig" -H "X-Bridge-Timestamp: $ts" -H "X-Bridge-Event-Id: e2e" --data-binary "$body"
}
hout() { jx "$1" < "$SNAP/hook.out"; }
received() { # eventId reference value
  printf '{"eventId":"%s","event":"payment.received","occurredAt":"2026-11-18T14:15:45.000Z","kind":"collection","source":"status_poll","door":"push","paymentMethod":"mobile_money","method":"USSD_PUSH","environment":"sandbox","amount":{"currency":"TZS","amountMinor":%s,"exponent":2,"value":"%s.00"},"collectionId":"c-%s","reference":"%s","orderReference":"MOCK-%s","payer":{"msisdnMasked":"+2557****111"}}' \
    "$1" "$(( $3 * 100 ))" "$3" "$1" "$2" "$2"
}
alerts() { q "select count(*) from webhook_event where provider='ops-alert' and dedup_key like '$1:%'"; }
PENDING='{"status":"PENDING","amount":"35000","collectedAmount":"0.00"}'
COMPLETED='{"status":"COMPLETED","amount":"35000","collectedAmount":"35000"}'
run() { # kind → http ; body in $SNAP/run.out
  curl -s -o "$SNAP/run.out" -w '%{http_code}' -b "$SNAP/admin" -X POST "$BASE/api/admin/payments/crosscheck/run" -H 'content-type: application/json' -d "{\"kind\":\"$1\"}"
}
rout() { jx "$1" < "$SNAP/run.out"; }

curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null

echo ""
echo "== 1. PAYMENT METHODS =="
PM=$(curl -s "$BASE/api/payment-methods")
check "card offered, billing required" "$(echo "$PM" | jx 'const c=o.groups.find(g=>g.id==="card");c.enabled+"|"+c.billingRequired')" "true|true"

echo ""
echo "== 2. CARD WITHOUT A FULL ADDRESS → REFUSED, NOTHING WRITTEN =="
O2=$(checkout "$SNAP/c2" 0712000201)
check "no billing → 400" "$(paycard "$SNAP/c2" "$O2" 0712000201 'null')|$(pout 'o.error+":"+o.fields.join(",")')" "400|billing_incomplete:address1,city,stateOrRegion,postcodeOrPobox"
check "missing city → 400 names it" "$(paycard "$SNAP/c2" "$O2" 0712000201 '{"address1":"Plot 1","stateOrRegion":"Dar es Salaam","postcodeOrPobox":"11101","country":"TZ"}')|$(pout 'o.fields.join(",")')" "400|city"
check "  no attempt written, cart still pending" "$(q "select count(*) from payment_transaction where order_id='$O2'"):$(ostatus "$O2")" "0:pending"

echo ""
echo "== 3. CARD WITH THE ADDRESS → CARD PAGE =="
steer "ZORA-$O2-1" "$PENDING"
check "pay 200" "$(paycard "$SNAP/c2" "$O2" 0712000201 "$BILLING")" 200
check "  redirect is the card page (mock → our return page)" "$(pout 'o.redirectUrl.startsWith("https://web.test/pay/card/'"$O2"'?card=return&tx=ZORA-'"$O2"'-1")+"|"+o.redirectUrl.includes("mockcard=1")+"|"+!!o.expiresAt')" "true|true|true"
check "  attempt on /v1 rail, page + expiry stored, reference kept" "$(q "select provider||'|'||(payment_url is not null)::text||'|'||(payment_url_expires_at > now())::text||'|'||order_reference from payment_transaction where order_id='$O2'")" "xbridge_v1c|true|true|MOCK-CARD-ZORA-$O2-1"
check "  stock held ≥ 65 min" "$(q "select (min(expires_at) > now() + interval '65 minutes')::text from inventory_hold where order_id='$O2' and state='held'")" "true"
check "  timeline: pay_requested, gateway_accepted" "$(q "select string_agg(step, '>' order by id) from order_event where order_id='$O2' and step in ('pay_requested','gateway_accepted')")" "pay_requested>gateway_accepted"

echo ""
echo "== 4. STATUS READ (buyer) =="
ST=$(curl -s -b "$SNAP/c2" "$BASE/api/orders/$O2/status")
check "buyer sees the open card attempt + page" "$(echo "$ST" | jx 'o.status+"|"+o.card.attempt+"|"+!!o.card.paymentUrl+"|"+o.eventId')" "pending|pending|true|brunch-vol-09"
check "a stranger sees no card block" "$(curl -s "$BASE/api/orders/$O2/status" | jx 'String(o.card)')" "undefined"
steer "ZORA-$O2-1" "$COMPLETED"
check "x-bridge COMPLETED → paid on the next read" "$(curl -s -b "$SNAP/c2" "$BASE/api/orders/$O2/status" | jx 'o.status+"|"+o.credentials.length')" "paid|1"
check "  attempt successful, one pass" "$(tstatus "$O2"):$(passes "$O2")" "successful:1"

echo ""
echo "== 5. ADMIN SWITCH OFF → CARD HIDDEN AND REFUSED =="
curl -s -o /dev/null -b "$SNAP/admin" -X PUT "$BASE/api/settings/methods-enabled" -H 'content-type: application/json' -d '{"methodsEnabled":{"card":false}}'
sleep 10.5 # /api/payment-methods caches settings for 10 s
check "payment-methods: card disabled" "$(curl -s "$BASE/api/payment-methods" | jx 'o.groups.find(g=>g.id==="card").enabled')" "false"
O5=$(checkout "$SNAP/c5" 0712000205)
check "card pay → 403 method_disabled" "$(paycard "$SNAP/c5" "$O5" 0712000205 "$BILLING")|$(pout 'o.error')" "403|method_disabled"
curl -s -o /dev/null -b "$SNAP/admin" -X PUT "$BASE/api/settings/methods-enabled" -H 'content-type: application/json' -d '{"methodsEnabled":{"card":true}}'

echo ""
echo "== 6. WEBHOOK: SIGNATURE, LATE SUCCESS, DEDUP, UNKNOWN =="
O6=$(checkout "$SNAP/c6" 0712000206)
steer "ZORA-$O6-1" "$PENDING"
check "mobile pay 200" "$(paymobile "$SNAP/c6" "$O6" 0712000206)" 200
q "update payment_transaction set status='expired' where order_id='$O6'" >/dev/null   # our window gave up
B6=$(received evt-6 "ZORA-$O6-1" 35000)
check "unsigned → 401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/webhooks/xbridge/events" -H 'content-type: application/json' --data-binary "$B6")" 401
check "wrong secret → 401" "$(hook "$B6" wrong)" 401
check "timestamp 10 min old → 401 stale" "$(hook "$B6" "$SECRET" $(( $(date +%s) - 600 )))|$(hout 'o.error')" "401|stale"
check "signed payment.received → 200 paid" "$(hook "$B6")|$(hout 'o.orderStatus')" "200|paid"
check "  cart paid, attempt successful, one pass" "$(ostatus "$O6"):$(tstatus "$O6"):$(passes "$O6")" "paid:successful:1"
check "same eventId again → deduped" "$(hook "$B6")|$(hout 'o.deduped')" "200|true"
check "  still one pass" "$(passes "$O6")" 1
check "unknown reference → 200 ignored" "$(hook "$(received evt-unk ZORA-nope-1 5000)")|$(hout 'o.ignored')" "200|unknown_payment"
check "  Needs attention: gateway_unknown_payment" "$(alerts gateway_unknown_payment)" 1
check "refund.* recorded, ignored for now" "$(hook '{"eventId":"evt-r1","event":"refund.succeeded","refund":{"id":"r1"}}')|$(hout 'o.recorded')" "200|true"
check "unhandled event → 200 ignored" "$(hook '{"eventId":"evt-i1","event":"invoice.issued","invoice":{}}')|$(hout 'o.ignored')" "200|unhandled_event"

echo ""
echo "== 7. WEBHOOK ON A FAILED ATTEMPT =="
O7=$(checkout "$SNAP/c7" 0712000207)
steer "ZORA-$O7-1" '{"status":"FAILED","amount":"35000","failureReason":"payer_no_response"}'
paymobile "$SNAP/c7" "$O7" 0712000207 >/dev/null
curl -s -b "$SNAP/c7" "$BASE/api/orders/$O7/status" >/dev/null
check "before: attempt failed, cart failed" "$(tstatus "$O7"):$(ostatus "$O7")" "failed:failed"
check "partial amount on failed → mismatch, nothing applied" "$(hook "$(received evt-7a "ZORA-$O7-1" 10000)")|$(hout 'o.mismatch')" "200|late_partial_on_failed"
check "  still failed:failed, gateway_mismatch raised" "$(tstatus "$O7"):$(ostatus "$O7"):$(alerts gateway_mismatch)" "failed:failed:1"
check "full amount on failed → reopened, paid" "$(hook "$(received evt-7b "ZORA-$O7-1" 35000)")|$(hout 'o.orderStatus+":"+o.lateOnFailed')" "200|paid:true"
check "  attempt successful, one pass, logged as accepted" "$(tstatus "$O7"):$(passes "$O7"):$(q "select count(*) from order_event where order_id='$O7' and step='gateway_answer_accepted'")" "successful:1:1"

echo ""
echo "== 8. CROSS-CHECK RECHECK =="
O8=$(checkout "$SNAP/c8" 0712000208)
steer "ZORA-$O8-1" "$PENDING"
paymobile "$SNAP/c8" "$O8" 0712000208 >/dev/null
q "update payment_transaction set status='expired' where order_id='$O8'" >/dev/null
steer "ZORA-$O8-1" "$COMPLETED"
check "anon run → 401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/admin/payments/crosscheck/run" -H 'content-type: application/json' -d '{"kind":"recheck"}')" 401
check "recheck run 200, settled ≥ 1" "$(run recheck)|$(rout 'o.settled>=1')" "200|true"
check "  cart paid, one pass" "$(ostatus "$O8"):$(passes "$O8")" "paid:1"
O8B=$(checkout "$SNAP/c8b" 0712000218)
steer "ZORA-$O8B-1" "$PENDING"
paymobile "$SNAP/c8b" "$O8B" 0712000218 >/dev/null
q "update payment_transaction set status='expired' where order_id='$O8B'" >/dev/null
check "still-pending answer → checked, stamped" "$(run recheck)|$(q "select gateway_check_count from payment_transaction where order_id='$O8B'")" "200|1"
check "second run right away → skipped (backoff)" "$(run recheck)|$(q "select gateway_check_count from payment_transaction where order_id='$O8B'")" "200|1"

echo ""
echo "== 9. CROSS-CHECK LIST =="
O9=$(checkout "$SNAP/c9" 0712000209)
steer "ZORA-$O9-1" "$PENDING"
paymobile "$SNAP/c9" "$O9" 0712000209 >/dev/null
q "update payment_transaction set status='expired', gateway_checked_at = now() where order_id='$O9'" >/dev/null
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > "$LIST_FILE" <<JSON
[
 {"transactionId":"ZORA-$O9-1","orderReference":"MOCK-ZORA-$O9-1","paymentMethod":"mobile_money","status":"COMPLETED","amount":"35000.00","collectedAmount":"35000.00","currency":"TZS","createdAt":"$NOW"},
 {"transactionId":"SOMEONE-ELSE-1","orderReference":"MREF1","paymentMethod":"mobile_money","status":"COMPLETED","amount":"20000.00","collectedAmount":"20000.00","currency":"TZS","createdAt":"$NOW"},
 {"transactionId":"ZORA-$O6-1","orderReference":"MOCK-ZORA-$O6-1","paymentMethod":"mobile_money","status":"FAILED","amount":"35000.00","collectedAmount":"0.00","currency":"TZS","createdAt":"$NOW"}
]
JSON
M0=$(alerts gateway_mismatch)
check "list run 200: 3 rows, 1 settled, 2 flagged" "$(run list)|$(rout 'o.checked+":"+o.settled+":"+o.flagged')" "200|3:1:2"
check "  our expired attempt → paid" "$(ostatus "$O9"):$(passes "$O9")" "paid:1"
check "  unknown payment flagged" "$(alerts gateway_unknown_payment)" 2
check "  ours paid, x-bridge FAILED → mismatch" "$(( $(alerts gateway_mismatch) - M0 ))" 1
check "  run again → nothing new settled" "$(run list)|$(rout 'o.settled')" "200|0"

echo ""
echo "== 10. ADMIN PAGE DATA =="
check "anon → 401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/payments/crosscheck")" 401
CC=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/payments/crosscheck")
check "runs listed, both kinds" "$(echo "$CC" | jx 'o.runs.some(r=>r.kind==="list")+"|"+o.runs.some(r=>r.kind==="recheck")+"|"+!!o.lastListAt')" "true|true|true"
check "alerts listed with labels' kinds" "$(echo "$CC" | jx 'o.alerts.some(a=>a.kind==="gateway_unknown_payment")+"|"+o.alerts.some(a=>a.kind==="gateway_mismatch")')" "true|true"
check "card availability shown" "$(echo "$CC" | jx 'o.card.available+"|"+o.card.billingRequired')" "true|true"
check "audit entry for a manual run" "$(curl -s -b "$SNAP/admin" "$BASE/api/audit" | jx 'o.filter(a=>a.action==="admin.payments.crosscheck").length>=1')" "true"

echo ""
if [ "$fail" = 0 ]; then echo "card-crosscheck e2e: ALL PASS"; else echo "card-crosscheck e2e: FAILURES (api log: $SNAP/api.log)"; tail -40 "$SNAP/api.log"; exit 1; fi
