#!/usr/bin/env bash
# BS157 — CART OUTCOMES + WHAT X-BRIDGE SENT. Boots the real API on a throwaway
# Postgres (x-bridge MOCK, steered per attempt by XBRIDGE_MOCK_STATUS_FILE) and
# proves:
#
#   1. Migration 0036 adds nullable capture columns and is idempotent.
#   2. Every outcome, seeded for real where the API can (pay, fail, retry, a
#      second cart) and in SQL where it can't (legacy GODIGITAL attempt, comp,
#      door sale, refund, paid-no-seat), shows on the list with the right
#      outcome + detail, and recoveredBy points at the paying cart.
#   3. ?outcome= (SQL rules) returns exactly the rows the list labels with that
#      outcome (JS rules): the two implementations agree on every seeded cart.
#   4. The funnel's outcome counts equal the list's tally for the same scope.
#   5. The detail shows the outcome, its explanation, the stored callback body
#      (sanitized: no secret, masked phone), the last status body and the
#      extracted reason. A same-status poll writes nothing new.
#   6. x-bridge's failureReason (status reply AND collection.updated callback,
#      which names our id `transactionId`): each value maps to its outcome,
#      an unknown value maps to unknown with the raw kept, null/absent → none,
#      first stored reason wins, a later value fills a null.
#   7. Capture is best-effort: with the capture columns dropped, a cart still
#      pays through the webhook and the status read.
#   8. BS159: 0037 adds accepted_at (nullable, idempotent) and the timeout index;
#      initiatePayment sets accepted_at when x-bridge accepts, never on a refusal.
#      An accepted attempt that expires is timed_out even with no reference
#      (accepted_at, or the logged gateway_accepted step). After the cut-over
#      (OUTCOME_ACCEPT_TRACKED_SINCE, moved to 1 day ago here) a no-ref attempt
#      is no_gateway_reference; older ones are card_unavailable (card) or
#      not_recorded; a 422 NO_PROVIDER_FOR_METHOD is card_unavailable /
#      method_unavailable. The SQL filter and the funnel sub-reasons agree.
#
# Style mirrors order-funnel.e2e.sh. Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-56340}"
API_PORT="${TEST_API_PORT:-4340}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-outcome-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-outcomesnap-XXXXXX")"
USER_NAME="$(whoami)"
REJECT_PHONE="0712999999"
STATUS_FILE="$SNAP/status.json"
# BS159: the acceptance cut-over, 1 day ago (rows seeded 2 days ago are "legacy").
CUTOVER="$(node -e 'process.stdout.write(new Date(Date.now()-86400000).toISOString())')"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_outcome
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_outcome"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" settings tiers organizers audit admin events kyc >/dev/null

q() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_outcome -v ON_ERROR_STOP=1 -c "$1"; }
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1 → $2"; else echo "  ✗ $1 → $2 (want $3)"; fail=1; fi; }

echo ""
echo "== 1. MIGRATION 0036 =="
check "webhook_event.payload" "$(q "select data_type from information_schema.columns where table_name='webhook_event' and column_name='payload'")" jsonb
check "payment_transaction capture columns (all nullable)" "$(q "select count(*) from information_schema.columns where table_name='payment_transaction' and column_name in ('gateway_status','gateway_status_at','failure_reason') and is_nullable='YES'")" 3
check "migration is idempotent (re-run)" "$(psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_outcome -v ON_ERROR_STOP=1 -f "$ROOT/db/migrations/0036_gateway_capture.sql" >/dev/null 2>&1 && echo ok)" ok
echo "== 8a. MIGRATION 0037 =="
check "payment_transaction.accepted_at (timestamptz, nullable)" "$(q "select data_type||':'||is_nullable from information_schema.columns where table_name='payment_transaction' and column_name='accepted_at'")" "timestamp with time zone:YES"
check "timeout index exists" "$(q "select count(*) from pg_indexes where indexname='payment_transaction_mobile_created'")" 1
check "0037 is idempotent (re-run)" "$(psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_outcome -v ON_ERROR_STOP=1 -f "$ROOT/db/migrations/0037_attempt_accepted_at.sql" >/dev/null 2>&1 && echo ok)" ok

psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_outcome -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('brunch-vol-09','Garden Brunch — Vol. 09') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-brunch','brunch-vol-09','GA', 80) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-brunch', 50000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-brunch');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-brunch', 80, 80) on conflict do nothing;
update organizer set kyc_status = 'approved' where id in ('o1','o2');
SQL

echo "== boot API (x-bridge MOCK, status file steering; refuses payer $REJECT_PHONE) =="
boot() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
  ( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true XBRIDGE_MOCK_REJECT_PHONE="$REJECT_PHONE" \
      XBRIDGE_MOCK_STATUS_FILE="$STATUS_FILE" OUTCOME_ACCEPT_TRACKED_SINCE="$CUTOVER" \
      COOKIE_SECURE=false SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
      SMS_DRIVER=mock EMAIL_DRIVER=mock PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >>"$SNAP/api.log" 2>&1 &
  for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
}
boot

BASE="http://localhost:$API_PORT"
jx() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let o;try{o=JSON.parse(s)}catch{process.stdout.write("ERR:"+s.slice(0,160));return}try{process.stdout.write(String(eval(process.argv[1])))}catch(e){process.stdout.write("ERR:"+e.message)}})' "$1"; }
# Steer the mock: the next status read for $1 answers the JSON in $2.
steer() { node -e 'const fs=require("fs");const f=process.argv[1];const m=JSON.parse(fs.readFileSync(f,"utf8"));m[process.argv[2]]=JSON.parse(process.argv[3]);fs.writeFileSync(f,JSON.stringify(m))' "$STATUS_FILE" "$1" "$2"; }

checkout() {
  curl -s -c "$1" -b "$1" -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
    -d "{\"phone\":\"$2\",\"email\":\"$3\",\"ageAttested\":true,\"cart\":[{\"tier\":\"t-brunch\",\"quantity\":1}],\"method\":\"mobile\"}" | jx 'o.orderId'
}
pay() {
  curl -s -o "$SNAP/pay.out" -w '%{http_code}' -b "$1" -X POST "$BASE/api/checkout/$2/pay" -H 'content-type: application/json' \
    -d "{\"method\":\"mobile\",\"payerPhone\":\"$3\"}"
}
status_of() { curl -s -b "$1" "$BASE/api/orders/$2/status" | jx 'o.status'; }
wait_status() { # cookie order want
  for i in $(seq 1 8); do s=$(status_of "$1" "$2"); [ "$s" = "$3" ] && return 0; sleep 0.5; done
  echo "  ✗ $2 never reached $3 (got $s)"; tail -20 "$SNAP/api.log"; return 1
}
hook() { curl -s -X POST "$BASE/api/webhooks/xbridge" -H 'content-type: application/json' -d "$1"; }

echo ""
echo "== seed one cart per outcome =="
# paid: first try
OPAID=$(checkout "$SNAP/c1" 0712000001 p1@example.com); pay "$SNAP/c1" "$OPAID" 0712000001 >/dev/null; wait_status "$SNAP/c1" "$OPAID" paid
# paid_after_retry: FAILED on attempt 1, then attempt 2 pays (same order)
ORETRY=$(checkout "$SNAP/c2" 0712000002 p2@example.com)
steer "ZORA-$ORETRY-1" '{"status":"FAILED"}'
pay "$SNAP/c2" "$ORETRY" 0712000002 >/dev/null; wait_status "$SNAP/c2" "$ORETRY" failed
pay "$SNAP/c2" "$ORETRY" 0712000002 >/dev/null; wait_status "$SNAP/c2" "$ORETRY" paid
# buyer_didnt_complete + reason from the STATUS body (with a phone and a token in it)
ODECL=$(checkout "$SNAP/c3" 0712000003 p3@example.com)
steer "ZORA-$ODECL-1" '{"status":"FAILED","resultDesc":"Request cancelled by user","payerPhone":"+255712000003","token":"tok_SECRET_status"}'
pay "$SNAP/c3" "$ODECL" 0712000003 >/dev/null; wait_status "$SNAP/c3" "$ODECL" failed
# buyer_didnt_complete + reason from the CALLBACK body (status read carries none)
OHOOK=$(checkout "$SNAP/c4" 0712000004 p4@example.com)
steer "ZORA-$OHOOK-1" '{"status":"FAILED"}'
pay "$SNAP/c4" "$OHOOK" 0712000004 >/dev/null
HOOK_OUT=$(hook "{\"event\":\"collection.updated\",\"transactionId\":\"ZORA-$OHOOK-1\",\"status\":\"FAILED\",\"failureReason\":\"payer_cancelled\",\"payerPhone\":\"+255712000004\",\"apiKey\":\"sk_live_SECRET123\",\"signature\":\"sig_SECRET456\"}")
check "webhook 200 body" "$(echo "$HOOK_OUT" | jx 'o.received')" true
check "callback reconciled the cart" "$(q "select status from \"order\" where id='$OHOOK'")" failed
# buyer_didnt_complete: timed_out (push accepted, then reconcile expired it and the hold lapsed)
OTIME=$(checkout "$SNAP/c5" 0712000005 p5@example.com)
steer "ZORA-$OTIME-1" '{"status":"PENDING"}'
pay "$SNAP/c5" "$OTIME" 0712000005 >/dev/null
q "update payment_transaction set status='expired' where order_id='$OTIME'; update inventory_hold set state='released' where order_id='$OTIME'; update \"order\" set status='expired' where id='$OTIME'" >/dev/null
# in_progress: a push still pending (two polls, same status)
OPROG=$(checkout "$SNAP/c6" 0712000006 p6@example.com)
steer "ZORA-$OPROG-1" '{"status":"PENDING","failureReason":null,"payerPhone":"+255712000006"}'
pay "$SNAP/c6" "$OPROG" 0712000006 >/dev/null; status_of "$SNAP/c6" "$OPROG" >/dev/null
AT1=$(q "select gateway_status_at from payment_transaction where order_id='$OPROG'")
sleep 1; status_of "$SNAP/c6" "$OPROG" >/dev/null
AT2=$(q "select gateway_status_at from payment_transaction where order_id='$OPROG'")
# in_progress: a fresh cart with a live hold, nothing started
OOPEN=$(checkout "$SNAP/c7" 0712000007 p7@example.com)
# abandoned: no payment, hold lapsed
OABAN=$(checkout "$SNAP/c8" 0712000008 p8@example.com)
q "update inventory_hold set state='released' where order_id='$OABAN'; update \"order\" set status='expired', created_at=now()-interval '2 hours' where id='$OABAN'" >/dev/null
# system_error (today's shape): x-bridge refused the push; the cart then expired
OREJ=$(checkout "$SNAP/c9" "$REJECT_PHONE" r@example.com); pay "$SNAP/c9" "$OREJ" "$REJECT_PHONE" >/dev/null
q "update inventory_hold set state='released' where order_id='$OREJ'; update \"order\" set status='expired' where id='$OREJ'" >/dev/null
# underpaid
OSHORT=$(checkout "$SNAP/c10" 0712000010 p10@example.com)
steer "ZORA-$OSHORT-1" '{"status":"PARTIAL","amount":"50000","collectedAmount":"20000"}'
pay "$SNAP/c10" "$OSHORT" 0712000010 >/dev/null; wait_status "$SNAP/c10" "$OSHORT" payment_short
# recovered (real): FAILED cart, then the same buyer pays in a NEW cart
ORECA=$(checkout "$SNAP/c11" 0712000011 p11@example.com)
steer "ZORA-$ORECA-1" '{"status":"FAILED"}'
pay "$SNAP/c11" "$ORECA" 0712000011 >/dev/null; wait_status "$SNAP/c11" "$ORECA" failed
sleep 1
ORECB=$(checkout "$SNAP/c12" 0712000011 p11@example.com); pay "$SNAP/c12" "$ORECB" 0712000011 >/dev/null; wait_status "$SNAP/c12" "$ORECB" paid

# SQL-only shapes. Legacy GODIGITAL: attempt stuck 'created', no order_reference, cart expired.
OLEG=$(q "with c as (insert into customer (phone, email) values ('255712000020','leg@example.com') returning id)
          insert into \"order\" (customer_id, event_id, type, status, target_value, created_at)
          select id, 'brunch-vol-09', 'ga_vip', 'expired', 50000, now() - interval '2 days' from c returning id" | head -1)
q "insert into payment_transaction (order_id, transaction_id, method, fsp_id, amount, status, created_at, updated_at)
   values ('$OLEG', 'ZORA-$OLEG-1', 'mobile', 'GODIGITAL', 50000, 'created', now() - interval '2 days', now() - interval '2 days')" >/dev/null
# Recovered by PHONE only: two customer rows, same number written two ways.
OPHA=$(q "with c as (insert into customer (phone, email) values ('+255 712 000 030','a30@example.com') returning id)
          insert into \"order\" (customer_id, event_id, type, status, target_value, created_at)
          select id, 'brunch-vol-09', 'ga_vip', 'expired', 50000, now() - interval '3 days' from c returning id" | head -1)
OPHB=$(q "with c as (insert into customer (phone, email) values ('0712000030','b30@example.com') returning id)
          insert into \"order\" (customer_id, event_id, type, status, target_value, created_at)
          select id, 'brunch-vol-09', 'ga_vip', 'paid', 50000, now() - interval '3 days' + interval '2 hours' from c returning id" | head -1)
# NOT recovered: the same number paid, but 25h later.
OLATE=$(q "with c as (insert into customer (phone, email) values ('0712000040','l40@example.com') returning id)
           insert into \"order\" (customer_id, event_id, type, status, target_value, created_at)
           select id, 'brunch-vol-09', 'ga_vip', 'expired', 50000, now() - interval '4 days' from c returning id" | head -1)
q "insert into \"order\" (customer_id, event_id, type, status, target_value, created_at)
   select customer_id, event_id, 'ga_vip', 'paid', 50000, created_at + interval '25 hours' from \"order\" where id='$OLATE'" >/dev/null
OLATEB=$(q "select id from \"order\" where customer_id=(select customer_id from \"order\" where id='$OLATE') and status='paid'")
mk() { # status type channel → id (customer per row)
  q "with c as (insert into customer (phone, email) values ('2557130000$1','x$1@example.com') returning id)
     insert into \"order\" (customer_id, event_id, type, status, target_value, channel)
     select id, 'brunch-vol-09', '$3', '$2', 50000, '$4' from c returning id" | head -1
}
OUNSEAT=$(mk 51 paid_unseatable ga_vip online)
OREF=$(mk 52 refunded ga_vip online)
OCOMP=$(mk 53 paid comp online)
ODOOR=$(mk 54 paid ga_vip gate_cash)
# x-bridge failureReason, every value: R_<code> via the status reply, C_<code> via
# the collection.updated callback (after a PENDING read stored null first).
CODES="payer_no_response payer_cancelled insufficient_funds wrong_pin invalid_number provider_error unknown sim_swap_detected"
n=10
for code in $CODES; do
  n=$((n+1)); ph="07121000$n"
  o=$(checkout "$SNAP/r$n" "$ph" "r$n@example.com")
  steer "ZORA-$o-1" "{\"status\":\"FAILED\",\"failureReason\":\"$code\"}"
  pay "$SNAP/r$n" "$o" "$ph" >/dev/null; wait_status "$SNAP/r$n" "$o" failed
  echo "R $code $o" >> "$SNAP/codes.txt"
  n=$((n+1)); ph="07121000$n"
  o=$(checkout "$SNAP/r$n" "$ph" "r$n@example.com")
  steer "ZORA-$o-1" '{"status":"PENDING","failureReason":null}'
  pay "$SNAP/r$n" "$o" "$ph" >/dev/null; status_of "$SNAP/r$n" "$o" >/dev/null
  steer "ZORA-$o-1" '{"status":"FAILED","failureReason":null}'
  hook "{\"event\":\"collection.updated\",\"transactionId\":\"ZORA-$o-1\",\"orderReference\":null,\"status\":\"FAILED\",\"failureReason\":\"$code\",\"amount\":\"50000.00\"}" >/dev/null
  echo "C $code $o" >> "$SNAP/codes.txt"
done
# First reason wins: the status reply said wrong_pin, a late callback says payer_cancelled.
OFIRST=$(checkout "$SNAP/c30" 0712100099 f99@example.com)
steer "ZORA-$OFIRST-1" '{"status":"FAILED","failureReason":"wrong_pin"}'
pay "$SNAP/c30" "$OFIRST" 0712100099 >/dev/null; wait_status "$SNAP/c30" "$OFIRST" failed
hook "{\"event\":\"collection.updated\",\"transactionId\":\"ZORA-$OFIRST-1\",\"status\":\"FAILED\",\"failureReason\":\"payer_cancelled\"}" >/dev/null
# BS159 shapes (SQL). mkx: an expired cart with one attempt; $1 phone suffix, $2 age, $3 method, $4 extra cols, $5 values.
mkx() {
  local o
  o=$(q "with c as (insert into customer (phone, email) values ('2557140000$1','y$1@example.com') returning id)
         insert into \"order\" (customer_id, event_id, type, status, target_value, created_at)
         select id, 'brunch-vol-09', 'ga_vip', 'expired', 50000, now() - interval '$2' from c returning id" | head -1)
  q "insert into payment_transaction (order_id, transaction_id, method, amount, status, created_at, updated_at${4:-})
     values ('$o', 'ZORA-$o-1', '$3', 50000, 'expired', now() - interval '$2', now() - interval '$2'${5:-})" >/dev/null
  echo "$o"
}
NOPROV='x-bridge /collection/card failed: 422 {"statusCode":422,"code":"NO_PROVIDER_FOR_METHOD","message":"No provider for method"}'
OCARDOLD=$(mkx 01 '2 days' card)                                              # legacy card, no ref, no error
OBILLOLD=$(mkx 02 '2 days' billpay)                                           # legacy billpay
OMOBNEW=$(mkx 03 '1 hour' mobile)                                             # after cut-over, never accepted
OCARD422=$(mkx 04 '1 hour' card ", error, error_at" ", '$NOPROV', now()")     # today's card failure
OMOB422=$(mkx 05 '1 hour' mobile ", error, error_at" ", '$NOPROV', now()")    # same error on mobile
OACCNOREF=$(mkx 06 '1 hour' mobile ", accepted_at" ", now() - interval '59 minutes'") # accepted, no ref, expired
OLOGNOREF=$(mkx 07 '1 hour' mobile)                                           # accept only in order_event (BS153 log)
q "insert into order_event (order_id, at, step, transaction_id) values ('$OLOGNOREF', now() - interval '59 minutes', 'gateway_accepted', 'ZORA-$OLOGNOREF-1')" >/dev/null
echo "  ✓ seeded 44 carts"

echo ""
echo "== 2. LIST: OUTCOME PER CART =="
curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
LIST=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders?limit=200&organizer=thebrunchcity")
echo "$LIST" > "$SNAP/list.json"
oc() { echo "$LIST" | jx "(r=>r?[r.outcome,r.outcomeDetail,r.recoveredBy].map(x=>x==null?'-':x).join('|'):'missing')(o.orders.find(x=>x.id==='$1'))"; }
check "paid, first try" "$(oc "$OPAID")" "paid|-|-"
check "paid after a failed attempt on the same cart" "$(oc "$ORETRY")" "paid_after_retry|-|-"
check "no failureReason key: fallback text kept raw, mapped to unknown" "$(oc "$ODECL")" "buyer_didnt_complete|unknown|-"
check "fallback raw reason on the row" "$(echo "$LIST" | jx "o.orders.find(x=>x.id==='$ODECL').outcomeReason")" "Request cancelled by user"
check "collection.updated callback (transactionId) sets the reason" "$(oc "$OHOOK")" "buyer_didnt_complete|payer_cancelled|-"
check "recovered cart keeps its underlying story" "$(oc "$ORECA" | cut -d'|' -f2)" buyer_didnt_complete
while read -r via code o; do
  case "$code" in
    provider_error) want="system_error|provider_error|-" ;;
    payer_no_response|payer_cancelled|insufficient_funds|wrong_pin|invalid_number|unknown) want="buyer_didnt_complete|$code|-" ;;
    *) want="buyer_didnt_complete|unknown|-" ;;
  esac
  check "failureReason=$code via $([ "$via" = R ] && echo 'status reply' || echo callback)" "$(oc "$o")" "$want"
  check "  raw value stored ($code)" "$(q "select failure_reason from payment_transaction where order_id='$o'")" "$code"
done < "$SNAP/codes.txt"
check "first reason wins over a later one" "$(q "select failure_reason from payment_transaction where order_id='$OFIRST'")" wrong_pin
check "null failureReason on a PENDING read stores nothing" "$(q "select coalesce(failure_reason,'null') from payment_transaction where order_id='$OPROG'")" null
check "paid attempts carry no reason" "$(q "select count(*) from payment_transaction where status='successful' and failure_reason is not null")" 0
check "timed out" "$(oc "$OTIME")" "buyer_didnt_complete|timed_out|-"
check "push still pending" "$(oc "$OPROG")" "in_progress|-|-"
check "fresh cart, live hold" "$(oc "$OOPEN")" "in_progress|-|-"
check "abandoned" "$(oc "$OABAN")" "abandoned|expired|-"
check "refused by x-bridge" "$(oc "$OREJ")" "system_error|gateway_refused|-"
check "legacy GODIGITAL (created, no ref, expired) → not_recorded" "$(oc "$OLEG")" "system_error|not_recorded|-"
check "legacy card (expired, no ref) → card_unavailable" "$(oc "$OCARDOLD")" "system_error|card_unavailable|-"
check "legacy billpay (expired, no ref) → not_recorded" "$(oc "$OBILLOLD")" "system_error|not_recorded|-"
check "after cut-over, never accepted → no_gateway_reference" "$(oc "$OMOBNEW")" "system_error|no_gateway_reference|-"
check "422 NO_PROVIDER_FOR_METHOD on card → card_unavailable" "$(oc "$OCARD422")" "system_error|card_unavailable|-"
check "422 NO_PROVIDER_FOR_METHOD on mobile → method_unavailable" "$(oc "$OMOB422")" "system_error|method_unavailable|-"
check "accepted_at, no ref, expired → timed out (not refused)" "$(oc "$OACCNOREF")" "buyer_didnt_complete|timed_out|-"
check "logged gateway_accepted, no ref, expired → timed out" "$(oc "$OLOGNOREF")" "buyer_didnt_complete|timed_out|-"
check "list attempt carries acceptedAt from the log" "$(echo "$LIST" | jx "!!o.orders.find(x=>x.id==='$OLOGNOREF').attempts[0].acceptedAt")" true
check "accepted_at set when x-bridge accepts" "$(q "select (accepted_at is not null)::text from payment_transaction where order_id='$OPAID'")" true
check "accepted_at set on every accepted API attempt" "$(q "select count(*) from payment_transaction where order_reference is not null and accepted_at is null")" 0
check "accepted_at stays null on a refusal" "$(q "select coalesce(accepted_at::text,'null') from payment_transaction where order_id='$OREJ'")" null
check "underpaid" "$(oc "$OSHORT")" "underpaid|-|-"
check "failed cart recovered by a second cart" "$(oc "$ORECA")" "recovered|buyer_didnt_complete|$ORECB"
check "the recovering cart is plain paid" "$(oc "$ORECB")" "paid|-|-"
check "recovered by phone only (two customer rows)" "$(oc "$OPHA")" "recovered|abandoned|$OPHB"
check "paid 25h later is not a recovery" "$(oc "$OLATE")" "abandoned|expired|-"
check "paid, no seat" "$(oc "$OUNSEAT")" "paid_unseatable|-|-"
check "refunded" "$(oc "$OREF")" "refunded|-|-"
check "comp" "$(oc "$OCOMP")" "comp|-|-"
check "door sale" "$(oc "$ODOOR")" "door_sale|-|-"
check "raw status still on the row" "$(echo "$LIST" | jx "o.orders.find(x=>x.id==='$ORECA').status")" failed
check "filters publish the outcomes" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/filters" | jx 'o.outcomes.length+":"+o.outcomes.find(x=>x.id==="system_error").label')" "12:System error (not the buyer)"

echo ""
echo "== 3. ?outcome= (SQL) AGREES WITH THE ROWS (JS) =="
AGREE=agree
for k in paid paid_after_retry recovered in_progress abandoned system_error buyer_didnt_complete underpaid paid_unseatable refunded comp door_sale; do
  GOT=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders?limit=200&organizer=thebrunchcity&outcome=$k" | jx "o.orders.every(x=>x.outcome==='$k')+':'+o.orders.map(x=>x.id).sort().join(',')")
  WANT=$(echo "$LIST" | jx "'true:'+o.orders.filter(x=>x.outcome==='$k').map(x=>x.id).sort().join(',')")
  if [ "$GOT" != "$WANT" ]; then AGREE="disagree"; echo "    $k: sql=$GOT js=$WANT"; fi
done
check "every outcome filter = the rows with that outcome" "$AGREE" agree
check "unknown outcome is ignored" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders?limit=200&organizer=thebrunchcity&outcome=nope" | jx 'o.orders.length')" "$(echo "$LIST" | jx 'o.orders.length')"
check "outcome + status filters combine" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders?limit=200&outcome=recovered&status=failed" | jx 'o.orders.map(x=>x.id).join()')" "$ORECA"

echo ""
echo "== 4. FUNNEL OUTCOME COUNTS = THE LIST'S TALLY =="
F=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/funnel?days=7&org=thebrunchcity")
echo "$F" > "$SNAP/funnel.json"
check "funnel outcomes match the list" "$(node -e '
const fs=require("fs");
const list=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).orders;
const f=JSON.parse(fs.readFileSync(process.argv[2],"utf8")).outcomes;
const t={}; for (const r of list) t[r.outcome]=(t[r.outcome]||0)+1;
const bad=Object.keys({...t,...f}).filter(k=>(t[k]||0)!==(f[k]||0)||!(k in f));
process.stdout.write(bad.length?"differ:"+bad.join(","):"same")' "$SNAP/list.json" "$SNAP/funnel.json")" same
check "funnel recovered count" "$(echo "$F" | jx 'o.outcomes.recovered')" 2
check "funnel system_error count (refused, 3 legacy, 3 after cut-over, provider_error ×2)" "$(echo "$F" | jx 'o.outcomes.system_error')" 9
check "funnel buyer_didnt_complete count" "$(echo "$F" | jx 'o.outcomes.buyer_didnt_complete')" 20
check "funnel system_error sub-reasons" "$(echo "$F" | jx 'Object.entries(o.outcomeDetails.system_error).sort().map(([k,v])=>k+"="+v).join(",")')" "card_unavailable=2,gateway_refused=1,method_unavailable=1,no_gateway_reference=1,not_recorded=2,provider_error=2"
check "funnel sub-reasons = the list's tally per detail" "$(node -e '
const fs=require("fs");
const list=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).orders;
const f=JSON.parse(fs.readFileSync(process.argv[2],"utf8")).outcomeDetails;
const t={}; for (const r of list) if (r.outcomeDetail!=null) { t[r.outcome]??={}; t[r.outcome][r.outcomeDetail]=(t[r.outcome][r.outcomeDetail]||0)+1; }
const norm=(m)=>JSON.stringify(Object.keys(m).sort().map(k=>[k,Object.entries(m[k]).sort()]));
process.stdout.write(norm(t)===norm(f)?"same":"differ "+norm(t)+" vs "+norm(f))' "$SNAP/list.json" "$SNAP/funnel.json")" same
check "funnel sub-reasons: cancelled by buyer" "$(echo "$F" | jx 'o.outcomeDetails.buyer_didnt_complete.payer_cancelled')" 3
check "funnel sub-reasons: unknown (incl. unrecognised + fallback text)" "$(echo "$F" | jx 'o.outcomeDetails.buyer_didnt_complete.unknown')" 5
check "funnel sub-reasons: provider_error under system_error" "$(echo "$F" | jx 'o.outcomeDetails.system_error.provider_error')" 2
check "funnel sub-reasons: timed out (our expiry + 2 accepted with no ref)" "$(echo "$F" | jx 'o.outcomeDetails.buyer_didnt_complete.timed_out')" 3
check "funnel sub-reasons add up" "$(echo "$F" | jx 'Object.entries(o.outcomeDetails).every(([k,m])=>Object.values(m).reduce((a,b)=>a+b,0)<=o.outcomes[k])')" true
check "funnel keeps the old drop-off block" "$(echo "$F" | jx 'typeof o.dropoff.expiredNoAttempt+typeof o.stages.length')" numbernumber
check "other org: no outcomes" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/funnel?days=7&org=offshore" | jx 'Object.values(o.outcomes).reduce((a,b)=>a+b,0)')" 0

echo ""
echo "== 5. DETAIL: OUTCOME, EXPLANATION, WHAT X-BRIDGE SENT =="
DR=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$ORECA")
check "recovered detail: outcome + link" "$(echo "$DR" | jx 'o.outcome+"|"+o.recoveredBy')" "recovered|$ORECB"
check "recovered detail: explanation" "$(echo "$DR" | jx '/not a lost sale/i.test(o.outcomeExplanation)')" true
DS=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$OREJ")
check "system error explanation names us, not the buyer" "$(echo "$DS" | jx '/not the buyer/.test(o.outcomeExplanation)')" true
check "card_unavailable explanation" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$OCARD422" | jx '/Card isn.t available at x-bridge/.test(o.outcomeExplanation)')" true
check "not_recorded explanation" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$OLEG" | jx '/6 Nov/.test(o.outcomeExplanation)')" true
check "accepted-no-ref timeline shows the gateway took it" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$OACCNOREF" | jx 'o.stageReached')" gateway_accepted
DH=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$OHOOK")
check "callback payload stored" "$(echo "$DH" | jx 'o.callbacks.length+":"+o.callbacks[0].payload.failureReason+":"+o.callbacks[0].payload.event')" "1:payer_cancelled:collection.updated"
check "callback payload: no secret" "$(echo "$DH" | jx 'JSON.stringify(o.callbacks).includes("SECRET")')" false
check "callback payload: secret keys redacted" "$(echo "$DH" | jx 'o.callbacks[0].payload.apiKey+","+o.callbacks[0].payload.signature')" "[redacted],[redacted]"
check "callback payload: phone masked" "$(echo "$DH" | jx 'o.callbacks[0].payload.payerPhone')" "**********004"
check "stored row never had the secret" "$(q "select count(*) from webhook_event where payload::text like '%SECRET%' or payload::text like '%712000004%'")" 0
check "reason extracted onto the attempt" "$(echo "$DH" | jx 'o.attempts[0].failureReason')" payer_cancelled
check "detail explanation for a cancelled prompt" "$(echo "$DH" | jx 'o.outcomeExplanation')" "The buyer cancelled the payment prompt."
check "last status body on the attempt" "$(echo "$DH" | jx 'o.attempts[0].gatewayStatus.status')" FAILED
DD=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$ODECL")
check "status body: fallback reason extracted (no failureReason key)" "$(echo "$DD" | jx 'o.attempts[0].failureReason')" "Request cancelled by user"
check "unknown reason: explanation quotes the raw text" "$(echo "$DD" | jx '/Request cancelled by user/.test(o.outcomeExplanation)')" true
check "status body: token redacted, phone masked" "$(echo "$DD" | jx 'o.attempts[0].gatewayStatus.token+","+o.attempts[0].gatewayStatus.payerPhone')" "[redacted],**********003"
check "status body never stored raw" "$(q "select count(*) from payment_transaction where gateway_status::text like '%SECRET%' or gateway_status::text like '%712000003%'")" 0
check "same-status poll writes nothing new" "$( [ -n "$AT1" ] && [ "$AT1" = "$AT2" ] && echo same || echo "differs($AT1/$AT2)")" same
check "list rows carry no status bodies" "$(echo "$LIST" | jx 'o.orders.every(r=>r.attempts.every(a=>a.gatewayStatus===undefined))')" true
check "retry detail: 1 failed attempt" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/orders/$ORETRY" | jx 'o.outcomeExplanation')" "Paid after 1 failed attempt on this cart."

echo ""
echo "== 7. CAPTURE FAILURES NEVER BREAK A PAYMENT =="
q "alter table webhook_event drop column payload; alter table payment_transaction drop column gateway_status, drop column failure_reason" >/dev/null
# Fresh API: a database without the capture columns (no cached statements from before).
boot
OCAP=$(checkout "$SNAP/c20" 0712000060 p60@example.com)
steer "ZORA-$OCAP-1" '{"status":"COMPLETED","amount":"50000","collectedAmount":"50000","reason":"x"}'
pay "$SNAP/c20" "$OCAP" 0712000060 >/dev/null
HOOK2=$(hook "{\"transid\":\"ZORA-$OCAP-1\",\"status\":\"COMPLETED\"}")
check "webhook still 200" "$(echo "$HOOK2" | jx 'o.received')" true
check "cart paid with the capture columns gone" "$(q "select status from \"order\" where id='$OCAP'")" paid
check "attempt successful" "$(q "select status from payment_transaction where order_id='$OCAP'")" successful
check "callback still deduped + applied" "$(q "select applied from webhook_event where transaction_id='ZORA-$OCAP-1'")" t
check "passes issued" "$(q "select count(*) from credential c join order_item oi on oi.id=c.order_item_id where oi.order_id='$OCAP'")" 1
OCAP2=$(checkout "$SNAP/c21" 0712000061 p61@example.com)
pay "$SNAP/c21" "$OCAP2" 0712000061 >/dev/null
check "status read still pays (no webhook)" "$(status_of "$SNAP/c21" "$OCAP2")" paid
check "capture skips were logged, not thrown" "$(grep -c 'capture skipped' "$SNAP/api.log" | awk '{print ($1>0)?"yes":"no"}')" yes

echo ""
[ "$fail" = "0" ] || { echo "CART OUTCOMES E2E: FAIL"; tail -40 "$SNAP/api.log"; exit 1; }
echo "CART OUTCOMES E2E: PASS (0036 + 0037 idempotent · accepted_at on accept · honest system-error reasons · every outcome on the list · SQL filter = JS rows · funnel counts = list · callback + status bodies stored sanitized with a reason · capture failures never break a payment)"
