#!/usr/bin/env bash
# BS134 gate: buyer-facing installment reads (Web Premium v1, F7 / A5 / DD5).
# Throwaway Postgres 17 (NEVER prod), x-bridge MOCK, OTP_ECHO. HTTP only:
#   - GET /api/events/:id/installments + /api/installments/offers — flag-gated,
#     no PII, the card hint figure
#   - GET /api/events/:id/installments/quote — validation, offer gate, and the
#     quote equals the schedule POST /api/checkout/installments then snapshots
#   - GET /api/orders/:id/installments — 401 + NO data without the checkout
#     cookie or an OTP session for the order's own phone; another buyer's OTP
#     session gets 401; the owner sees plan, next due, phone
#   - GET /api/orders/:id/status — the installments block only for the buyer
#   - GET /api/me/installments — the OTP-signed-in buyer's active plans
#   - pay from the pay page charges the NEXT unpaid row (row 2), not the total
# Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_PORT="${TEST_PG_PORT:-55551}"
API_PORT="${TEST_API_PORT:-4251}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-instb-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-instbsnap-XXXXXX")"
USER_NAME="$(whoami)"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

ok()  { echo "  ✓ $1"; }
bad() { echo "  ✗ $1"; fail=1; }

echo "== build @zora/core + @zora/api =="
(cd "$ROOT" && pnpm --filter "@zora/core" build >/dev/null 2>&1)
(cd "$ROOT" && pnpm --filter "@zora/api" build >/dev/null 2>&1)

echo "== throwaway Postgres @ :$PG_PORT + migrate =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_instb
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_instb"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_instb -v ON_ERROR_STOP=1 -c "$1"; }

echo "== seed: event e-inst (GA 50000 · VIP 90000 not offered · Tiny 40000) + offer 30% × 3 monthly =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_instb -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name, venue, date_label) values ('e-inst', 'Installments Test', 'The Slipway', 'Sat 20 Feb');
insert into product_tier (id, event_id, name, capacity) values
  ('t-inst', 'e-inst', 'GA', 10), ('t-other', 'e-inst', 'VIP', 5), ('t-tiny', 'e-inst', 'Tiny', 3);
insert into price_version (tier_id, price, currency, fee_treatment) values
  ('t-inst', 50000, 'TZS', 'passed'), ('t-other', 90000, 'TZS', 'passed'), ('t-tiny', 40000, 'TZS', 'passed');
insert into inventory_pool (product_tier_id, capacity, available_count) values
  ('t-inst', 10, 10), ('t-other', 5, 5), ('t-tiny', 3, 3);
insert into installment_config (event_id, enabled, tiers, deposit_pct, count, frequency, final_due_days_before_event, grace_days)
values ('e-inst', true, '{t-inst,t-tiny}', 30, 3, 'monthly', 7, 3);
insert into collection_store (name, data) values
  ('events', '[{"id":"e-inst","organizerHandle":"inst-org","date":"2027-02-20"}]'),
  ('settings', '{"flags":{}}')
on conflict (name) do update set data = excluded.data;
SQL

echo "== boot API (mock x-bridge, OTP_ECHO) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$ROOT/apps/api" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false OTP_ECHO=true \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key SMS_DRIVER=mock EMAIL_DRIVER=mock \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
BASE="http://localhost:$API_PORT"
jq_get() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(v==null?"":Array.isArray(v)?String(v.length):typeof v==="object"?JSON.stringify(v):String(v))}catch{process.stdout.write("ERR:"+s.slice(0,120))}})' "$1"; }
get() { curl -s -o "$SNAP/out" -w '%{http_code}' "$@"; }

echo "== 1. flag OFF: public reads say not offered =="
CODE=$(get "$BASE/api/events/e-inst/installments")
[ "$CODE" = "200" ] && [ "$(jq_get offered < "$SNAP/out")" = "false" ] && ok "offer → offered:false" || bad "offer flag off: $CODE $(cat "$SNAP/out")"
CODE=$(get "$BASE/api/events/e-inst/installments/quote?tier=t-inst&qty=1")
[ "$CODE" = "200" ] && [ "$(jq_get reason < "$SNAP/out")" = "installments_disabled" ] && ok "quote → offered:false installments_disabled" || bad "quote flag off: $CODE $(cat "$SNAP/out")"
CODE=$(get "$BASE/api/installments/offers?events=e-inst")
[ "$CODE" = "200" ] && grep -q '"offers":{}' "$SNAP/out" && ok "card offers → {}" || bad "offers flag off: $CODE $(cat "$SNAP/out")"

psql_one "update collection_store set data = '{\"flags\":{\"zp_installments\":{\"orgs\":[\"inst-org\"]}}}' where name = 'settings'" >/dev/null
sleep 11 # the public reads cache settings for 10s

echo "== 2. flag ON: offer + card hint =="
CODE=$(get "$BASE/api/events/e-inst/installments")
[ "$CODE" = "200" ] && [ "$(jq_get offered < "$SNAP/out")" = "true" ] && [ "$(jq_get count < "$SNAP/out")" = "3" ] \
  && [ "$(jq_get perPayment < "$SNAP/out")" = "13334" ] && [ "$(jq_get finalDue < "$SNAP/out")" = "2027-02-13" ] \
  && ok "offer → 3 payments, hint 13,334 (cheapest offered tier 40,000 ÷ 3, rounded up), last payment 2027-02-13" || bad "offer on: $CODE $(cat "$SNAP/out")"
grep -q '255\|phone\|email' "$SNAP/out" && bad "offer leaks PII: $(cat "$SNAP/out")" || ok "offer carries no PII"
CODE=$(get "$BASE/api/installments/offers?events=e-inst,nope,e-inst")
[ "$CODE" = "200" ] && [ "$(jq_get offers.e-inst.count < "$SNAP/out")" = "3" ] && [ -z "$(jq_get offers.nope < "$SNAP/out")" ] \
  && ok "card offers → only the event with an offer" || bad "offers on: $CODE $(cat "$SNAP/out")"

echo "== 3. quote: validation, offer gate, maths =="
CODE=$(get "$BASE/api/events/e-inst/installments/quote?tier=t-inst&qty=0"); [ "$CODE" = "400" ] && ok "qty 0 → 400" || bad "qty 0: $CODE"
CODE=$(get "$BASE/api/events/e-inst/installments/quote?tier=t-inst,t-tiny&qty=1"); [ "$CODE" = "400" ] && ok "tier/qty length mismatch → 400" || bad "mismatch: $CODE"
CODE=$(get "$BASE/api/events/e-inst/installments/quote?tier=t-other&qty=1")
[ "$CODE" = "200" ] && [ "$(jq_get reason < "$SNAP/out")" = "not_offered" ] && ok "tier outside the offer → not_offered" || bad "not offered: $CODE $(cat "$SNAP/out")"
CODE=$(get "$BASE/api/events/e-inst/installments/quote?tier=t-inst&qty=2")
QDEP=$(jq_get deposit < "$SNAP/out"); QTOT=$(jq_get total < "$SNAP/out"); QSCH=$(jq_get schedule < "$SNAP/out")
QROWS=$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(o.schedule.map(r=>r.n+":"+r.amount).join(","))' "$SNAP/out")
[ "$CODE" = "200" ] && [ "$QTOT" = "100000" ] && [ "$QDEP" = "30000" ] && [ "$QSCH" = "3" ] && [ "$(jq_get graceDays < "$SNAP/out")" = "3" ] \
  && ok "2 × GA → total 100,000, deposit 30,000, 3 rows ($QROWS), grace 3" || bad "quote: $CODE $(cat "$SNAP/out")"

echo "== 4. checkout snapshots the quoted schedule =="
CODE=$(curl -s -o "$SNAP/co" -w '%{http_code}' -c "$SNAP/jar" -X POST "$BASE/api/checkout/installments" -H 'content-type: application/json' \
  -d '{"phone":"0712000001","email":"i@example.com","ageAttested":true,"cart":[{"tier":"t-inst","quantity":2}]}')
ORDER=$(jq_get orderId < "$SNAP/co")
CROWS=$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(o.installments.schedule.map(r=>r.n+":"+r.amount).join(","))' "$SNAP/co")
[ "$CODE" = "200" ] && [ "$CROWS" = "$QROWS" ] && [ "$(jq_get installments.deposit < "$SNAP/co")" = "$QDEP" ] \
  && ok "order $ORDER schedule ($CROWS) = quote" || bad "checkout vs quote: $CODE $(cat "$SNAP/co") quote=$QROWS"

echo "== 5. pay page read: no data without proof =="
CODE=$(get "$BASE/api/orders/$ORDER/installments")
[ "$CODE" = "401" ] && [ "$(jq_get error < "$SNAP/out")" = "verify_required" ] && ok "no cookie → 401 verify_required" || bad "no cookie: $CODE $(cat "$SNAP/out")"
grep -q '255712\|amount\|deposit\|Installments Test' "$SNAP/out" && bad "401 body leaks data: $(cat "$SNAP/out")" || ok "401 body carries no amounts / phone / event"
CODE=$(get "$BASE/api/orders/00000000-0000-4000-8000-000000000000/installments")
[ "$CODE" = "401" ] && ok "unknown order → the same 401 (no existence oracle)" || bad "unknown order: $CODE"
CODE=$(get "$BASE/api/orders/not-a-uuid/installments"); [ "$CODE" = "404" ] && ok "malformed id → 404" || bad "malformed: $CODE"
CODE=$(get -b "$SNAP/jar" "$BASE/api/orders/$ORDER/installments")
[ "$CODE" = "200" ] && [ "$(jq_get eventName < "$SNAP/out")" = "Installments Test" ] && [ "$(jq_get next.n < "$SNAP/out")" = "1" ] \
  && [ "$(jq_get next.amount < "$SNAP/out")" = "30000" ] && [ "$(jq_get phone < "$SNAP/out")" = "255712000001" ] \
  && [ "$(jq_get passCount < "$SNAP/out")" = "2" ] && [ -z "$(jq_get customerId < "$SNAP/out")" ] \
  && ok "checkout cookie → 200: event, 2 passes, next = deposit 30,000, phone; no customerId" || bad "with cookie: $CODE $(cat "$SNAP/out")"

echo "== 6. status: installments block only for the buyer =="
curl -s "$BASE/api/orders/$ORDER/status" > "$SNAP/st"
grep -q '"installments"' "$SNAP/st" && bad "status leaks installments without cookie: $(cat "$SNAP/st")" || ok "status without cookie → no installments block"
curl -s -b "$SNAP/jar" "$BASE/api/orders/$ORDER/status" > "$SNAP/st"
[ "$(jq_get installments.count < "$SNAP/st")" = "3" ] && ok "status with cookie → installments block" || bad "status with cookie: $(cat "$SNAP/st")"

echo "== 7. SMS-OTP: another buyer is refused, the owner gets in =="
otp_login() { # phone jar
  local c; c=$(curl -s -X POST "$BASE/api/otp/request" -H 'content-type: application/json' -d "{\"phone\":\"$1\"}" | jq_get code)
  curl -s -o /dev/null -c "$2" -X POST "$BASE/api/otp/verify" -H 'content-type: application/json' -d "{\"phone\":\"$1\",\"code\":\"$c\"}"
}
otp_login 0712999999 "$SNAP/other"
CODE=$(get -b "$SNAP/other" "$BASE/api/orders/$ORDER/installments")
[ "$CODE" = "401" ] && ok "another buyer's OTP session → 401" || bad "other buyer: $CODE $(cat "$SNAP/out")"
otp_login 0712000001 "$SNAP/owner"
CODE=$(get -b "$SNAP/owner" "$BASE/api/orders/$ORDER/installments")
[ "$CODE" = "200" ] && [ "$(jq_get orderId < "$SNAP/out")" = "$ORDER" ] && ok "owner's OTP session (no checkout cookie) → 200" || bad "owner otp: $CODE $(cat "$SNAP/out")"
CODE=$(get "$BASE/api/me/installments"); [ "$CODE" = "401" ] && ok "me/installments signed out → 401" || bad "me signed out: $CODE"

echo "== 8. deposit cleared (simulated) → pay page pays row 2 =="
TXN1=$(psql_one "select transaction_id from payment_transaction where order_id = '$ORDER' limit 1" || true)
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_instb -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into payment_transaction (transaction_id, order_id, method, fsp_id, amount, status, schedule_n)
  values ('t-dep-$ORDER', '$ORDER', 'mobile', 'MOCK', 30000, 'successful', 1);
update installment_schedule set status = 'paid', paid_at = now(), transaction_id = 't-dep-$ORDER' where order_id = '$ORDER' and n = 1;
update installment_plan set status = 'active' where order_id = '$ORDER';
update "order" set status = 'installment_active' where id = '$ORDER';
SQL
CODE=$(get -b "$SNAP/owner" "$BASE/api/me/installments")
[ "$CODE" = "200" ] && [ "$(jq_get plans < "$SNAP/out")" = "1" ] && [ "$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const p=o.plans[0];process.stdout.write(p.paidCount+"/"+p.count+" next "+p.nextAmount)' "$SNAP/out")" = "1/3 next 35000" ] \
  && ok "me/installments → 1 plan, 1/3 paid, next 35,000" || bad "me: $CODE $(cat "$SNAP/out")"
CODE=$(get -b "$SNAP/owner" "$BASE/api/orders/$ORDER/installments")
[ "$(jq_get next.n < "$SNAP/out")" = "2" ] && [ "$(jq_get plan.paidCount < "$SNAP/out")" = "1" ] && ok "pay view → next = row 2, 1 of 3 paid" || bad "pay view active: $(cat "$SNAP/out")"
PAY=$(curl -s -X POST "$BASE/api/checkout/$ORDER/pay" -H 'content-type: application/json' -d '{"method":"mobile","payerPhone":"0712000001"}')
TXN=$(echo "$PAY" | jq_get transactionId)
ROW=$(psql_one "select schedule_n || ':' || amount from payment_transaction where transaction_id = '$TXN'")
[ "$ROW" = "2:35000" ] && ok "pay from the pay page charges row 2 (35,000), not the 100,000 total" || bad "pay row 2: $PAY row=$ROW"

[ "$fail" = "0" ] || { echo ""; echo "INSTALLMENTS BUYER E2E: FAIL"; tail -30 "$SNAP/api.log"; exit 1; }
echo ""
echo "BS134 INSTALLMENTS BUYER E2E: PASS"
