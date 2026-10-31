#!/usr/bin/env bash
# BS136 — organizer installments (settings + orders view) and the admin refund queue.
# Proves:
#   O1  auth: anon → 401 on every org route; another org → 404 (no existence leak)
#   O2  GET /api/org/events/:id/installments: tiers + defaults; flag off → enabled:false, PUT 403 feature_off
#   O3  PUT validation mirrors the DB CHECKs (count 2–6, one of pct|amount, pct 0–100, grace 0–30,
#       final due 0–365, frequency, unknown tier, unsupported default rule) → 400; valid → saved + audited
#   O4  GET /api/org/installments: only the acting org's plans; KPIs; filter counts; status filter;
#       pending plans not listed; NO buyer phone or email anywhere in the body (name only)
#   O5  POST …/:orderId/remind: 200 once, then 429 + Retry-After the same day; closed plan 409;
#       other org's order 404; junk id 404
#   O6  admin: GET /api/admin/installments/refunds (super_admin only) lists the pending refund with the
#       phone; POST …/refund-recorded needs a reference, books it once (409 after), audited
#
# Throwaway Postgres 17 (NEVER prod). XBRIDGE_MOCK + mock SMS/email. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55541}"
API_PORT="${TEST_API_PORT:-4241}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-instorg-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-instorgsnap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers organizers audit admin events kyc"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

echo "== build @zora/core + @zora/api =="
(cd "$ROOT" && pnpm --filter "@zora/core" build >/dev/null 2>&1)
(cd "$ROOT" && pnpm --filter "@zora/api" build >/dev/null 2>&1)

echo "== throwaway Postgres @ :$PG_PORT + migrate + backfill =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_instorg
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_instorg"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null
psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_instorg -v ON_ERROR_STOP=1 -c "$1"; }

echo "== seed: thebrunchcity owns ev-A (6 plans) · offshore owns ev-B (1 plan) =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_instorg -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id,name,city,status) values ('ev-A','Brunch A','dar','published'),('ev-B','Offshore B','dar','published') on conflict do nothing;
insert into product_tier (id,event_id,name,capacity) values ('t-ga','ev-A','General',50),('t-vip','ev-A','VIP',10),('t-b','ev-B','GA',10) on conflict do nothing;
insert into price_version (tier_id,price,currency,fee_treatment) values ('t-ga',60000,'TZS','passed'),('t-vip',150000,'TZS','passed'),('t-b',60000,'TZS','passed');
update collection_store set data='[{"id":"ev-A","name":"Brunch A","date":"2027-03-20","status":"published","organizerHandle":"thebrunchcity"},{"id":"ev-B","name":"Offshore B","date":"2027-03-21","status":"published","organizerHandle":"offshore"}]' where name='events';
update collection_store set data=(data::jsonb - 'flags')::text where name='settings';

insert into customer (id, phone, email, name) values
  ('00000000-0000-0000-0000-0000000000c1','255712000001','neema@example.com','Neema Kileo'),
  ('00000000-0000-0000-0000-0000000000c2','255712000002','anon@example.com',null),
  ('00000000-0000-0000-0000-0000000000c3','255712000003','grace@example.com','Grace'),
  ('00000000-0000-0000-0000-0000000000c4','255712000004','peter@example.com','Peter Otieno'),
  ('00000000-0000-0000-0000-0000000000c5','255712000005','fatma@example.com','Fatma Ali'),
  ('00000000-0000-0000-0000-0000000000c6','255712000006','other@example.com','Other Buyer'),
  ('00000000-0000-0000-0000-0000000000c7','255712000007','pend@example.com','Pending Person');

-- p1 overdue · p2 due this week · p3 on track · p4 paid in full · p5 released (refund pending) · p6 = ev-B · p7 pending (not listed)
create temp table seed (id uuid, cust text, ev text, tier text, ostatus text, pstatus text, refund text, due2 int, due3 int, paid int);
insert into seed values
  ('00000000-0000-0000-0000-0000000000a1','c1','ev-A','t-ga','installment_active','active','none',-3,27,1),
  ('00000000-0000-0000-0000-0000000000a2','c2','ev-A','t-ga','installment_active','active','none',3,33,1),
  ('00000000-0000-0000-0000-0000000000a3','c3','ev-A','t-ga','installment_active','active','none',30,60,1),
  ('00000000-0000-0000-0000-0000000000a4','c4','ev-A','t-ga','paid','completed','none',-20,-5,3),
  ('00000000-0000-0000-0000-0000000000a5','c5','ev-A','t-ga','installment_defaulted','defaulted','pending',-40,-10,1),
  ('00000000-0000-0000-0000-0000000000a6','c6','ev-B','t-b','installment_active','active','none',3,33,1),
  ('00000000-0000-0000-0000-0000000000a7','c7','ev-A','t-ga','pending','pending','none',30,60,0);

insert into "order" (id, customer_id, event_id, status, target_value)
  select id, ('00000000-0000-0000-0000-0000000000' || cust)::uuid, ev, ostatus, 60000 from seed;
insert into order_item (order_id, product_tier_id, price_version_id, quantity, unit_price)
  select s.id, s.tier, (select id from price_version where tier_id = s.tier limit 1), 1, 60000 from seed s;
insert into installment_plan (order_id, event_id, org_handle, total, service_fee, deposit, count, frequency, final_due, grace_days, status, refund_due, refund_status)
  select id, ev, case when ev = 'ev-A' then 'thebrunchcity' else 'offshore' end, 60000, 3000, 20000, 3, 'monthly', '2027-03-13', 2, pstatus,
         case when refund = 'pending' then 17000 else 0 end, refund from seed;
insert into installment_schedule (order_id, n, due_date, amount, status, paid_at, transaction_id)
  select s.id, k.n,
         (now() at time zone 'Africa/Dar_es_Salaam')::date + case k.n when 1 then -50 when 2 then s.due2 else s.due3 end,
         20000,
         case when k.n <= s.paid then 'paid' when s.pstatus = 'defaulted' or (k.n = 2 and s.due2 < 0) then 'missed' else 'due' end,
         case when k.n <= s.paid then now() end,
         case when k.n <= s.paid then 'T-' || s.id || '-' || k.n end
    from seed s cross join (values (1),(2),(3)) k(n);
SQL

echo "== boot API (XBRIDGE_MOCK, mock SMS/email) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key SMS_DRIVER=mock EMAIL_DRIVER=mock \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
BASE="http://localhost:$API_PORT"
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(v==null?"":Array.isArray(v)?String(v.length):String(v))}catch{process.stdout.write("ERR:"+s.slice(0,160))}})' "$1"; }
code() { curl -s -o "$SNAP/body" -w '%{http_code}' "$@"; }
ok() { echo "  ✓ $1"; }
bad() { echo "  ✗ $1"; fail=1; }

curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
for o in o1 o2; do
  curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/$o/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
done
curl -s -c "$SNAP/org" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/off" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"offshore","password":"orgpass123"}' >/dev/null
CFG="$BASE/api/org/events/ev-A/installments"
PUTJ() { code -b "$SNAP/org" -X PUT "$CFG" -H 'content-type: application/json' -d "$1"; }
GOOD='{"enabled":true,"tiers":["t-ga"],"depositPct":33,"count":3,"frequency":"biweekly","finalDueDaysBeforeEvent":7,"graceDays":2}'

echo "== O1 auth + scoping =="
for spec in "GET $CFG" "GET $BASE/api/org/installments" "GET $BASE/api/org/installments/enabled" "POST $BASE/api/org/installments/00000000-0000-0000-0000-0000000000a2/remind"; do
  set -- $spec; C=$(code -X "$1" "$2")
  [ "$C" = "401" ] && ok "anon $1 ${2#$BASE} → 401" || bad "anon $1 ${2#$BASE} → $C"
done
C=$(code -X PUT "$CFG" -H 'content-type: application/json' -d "$GOOD"); [ "$C" = "401" ] && ok "anon PUT config → 401" || bad "anon PUT → $C"
C=$(code -b "$SNAP/off" "$CFG"); [ "$C" = "404" ] && ok "other org GET ev-A config → 404" || bad "other org GET → $C"
C=$(code -b "$SNAP/off" -X PUT "$CFG" -H 'content-type: application/json' -d "$GOOD"); [ "$C" = "404" ] && ok "other org PUT ev-A config → 404" || bad "other org PUT → $C"

echo "== O2 read + flag gate =="
C=$(code -b "$SNAP/org" "$CFG")
[ "$C" = "200" ] && [ "$(jget enabled < "$SNAP/body")" = "false" ] && [ "$(jget tiers < "$SNAP/body")" = "2" ] \
  && [ "$(jget eventDate < "$SNAP/body")" = "2027-03-20" ] && [ "$(jget defaultRule < "$SNAP/body")" = "refund_minus_service_fee" ] \
  && ok "GET config (flag off) → enabled:false, 2 tiers, event date, read-only default rule" || bad "GET config: $C $(cat "$SNAP/body")"
C=$(code -b "$SNAP/org" "$BASE/api/org/installments/enabled"); [ "$(jget enabled < "$SNAP/body")" = "false" ] && ok "nav gate: enabled:false" || bad "enabled: $(cat "$SNAP/body")"
C=$(PUTJ "$GOOD"); [ "$C" = "403" ] && grep -q feature_off "$SNAP/body" && ok "PUT with flag off → 403 feature_off" || bad "PUT flag off → $C $(cat "$SNAP/body")"
psql_one "update collection_store set data = jsonb_set(data::jsonb, '{flags}', '{\"zp_installments\":{\"orgs\":[\"thebrunchcity\"]}}')::text where name = 'settings'" >/dev/null
C=$(code -b "$SNAP/org" "$BASE/api/org/installments/enabled"); [ "$(jget enabled < "$SNAP/body")" = "true" ] && ok "flag on for org → enabled:true" || bad "enabled on: $(cat "$SNAP/body")"
C=$(code -b "$SNAP/off" "$BASE/api/org/installments/enabled"); [ "$(jget enabled < "$SNAP/body")" = "false" ] && ok "other org stays enabled:false" || bad "other enabled: $(cat "$SNAP/body")"

echo "== O3 validation (mirrors the DB CHECKs) =="
check400() { # label json expected-error
  C=$(PUTJ "$2"); [ "$C" = "400" ] && grep -q "$3" "$SNAP/body" && ok "$1 → 400 $3" || bad "$1 → $C $(cat "$SNAP/body")"
}
check400 "count 7" '{"enabled":true,"depositPct":30,"count":7,"frequency":"monthly","finalDueDaysBeforeEvent":7,"graceDays":2}' count_range
check400 "count 1" '{"enabled":true,"depositPct":30,"count":1,"frequency":"monthly","finalDueDaysBeforeEvent":7,"graceDays":2}' count_range
check400 "pct and amount" '{"enabled":true,"depositPct":30,"depositAmount":5000,"count":3,"frequency":"monthly","finalDueDaysBeforeEvent":7,"graceDays":2}' deposit_one_of_pct_or_amount
check400 "pct 100" '{"enabled":true,"depositPct":100,"count":3,"frequency":"monthly","finalDueDaysBeforeEvent":7,"graceDays":2}' deposit_pct_range
check400 "grace 31" '{"enabled":true,"depositPct":30,"count":3,"frequency":"monthly","finalDueDaysBeforeEvent":7,"graceDays":31}' grace_days_range
check400 "final due 400" '{"enabled":true,"depositPct":30,"count":3,"frequency":"monthly","finalDueDaysBeforeEvent":400,"graceDays":2}' final_due_days_range
check400 "frequency daily" '{"enabled":true,"depositPct":30,"count":3,"frequency":"daily","finalDueDaysBeforeEvent":7,"graceDays":2}' frequency_invalid
check400 "tier of another event" '{"enabled":true,"tiers":["t-b"],"depositPct":30,"count":3,"frequency":"monthly","finalDueDaysBeforeEvent":7,"graceDays":2}' unknown_tier
check400 "keep-deposit rule" '{"enabled":true,"depositPct":30,"count":3,"frequency":"monthly","finalDueDaysBeforeEvent":7,"graceDays":2,"defaultRule":"keep_deposit"}' default_rule_unsupported
C=$(PUTJ "$GOOD"); [ "$C" = "200" ] && ok "valid offer → 200" || bad "valid PUT → $C $(cat "$SNAP/body")"
ROW=$(psql_one "select enabled, tiers, deposit_pct, count, frequency, final_due_days_before_event, grace_days from installment_config where event_id='ev-A'")
[ "$ROW" = "t|{t-ga}|33.00|3|biweekly|7|2" ] && ok "installment_config row saved ($ROW)" || bad "config row: $ROW"
C=$(code -b "$SNAP/org" "$CFG"); [ "$(jget config.frequency < "$SNAP/body")" = "biweekly" ] && [ "$(jget configured < "$SNAP/body")" = "true" ] && ok "GET returns the saved offer" || bad "GET after save: $(cat "$SNAP/body")"
psql_one "select data from collection_store where name='audit'" | grep -q org_installments_saved && ok "save audited (org_installments_saved)" || bad "save not audited"

echo "== O4 orders list: scoping, KPIs, filters, no PII =="
C=$(code -b "$SNAP/org" "$BASE/api/org/installments")
B="$(cat "$SNAP/body")"
[ "$C" = "200" ] && ok "GET /api/org/installments → 200" || bad "list → $C $B"
[ "$(jget counts.all <<<"$B")" = "5" ] && [ "$(jget counts.overdue <<<"$B")" = "1" ] && [ "$(jget counts.due_week <<<"$B")" = "1" ] \
  && [ "$(jget counts.on_track <<<"$B")" = "1" ] && [ "$(jget counts.paid <<<"$B")" = "1" ] && [ "$(jget counts.released <<<"$B")" = "1" ] \
  && ok "counts: 5 plans = 1 overdue · 1 due this week · 1 on track · 1 paid · 1 released (pending + other org excluded)" || bad "counts: $(jget counts <<<"$B") $B"
# collected = 3 active×20000 + completed 60000 (released excluded) = 120000; to collect = 3×40000
[ "$(jget kpis.collected <<<"$B")" = "120000" ] && [ "$(jget kpis.toCollect <<<"$B")" = "120000" ] && [ "$(jget kpis.openPlans <<<"$B")" = "3" ] \
  && [ "$(jget kpis.dueThisWeek <<<"$B")" = "1" ] && [ "$(jget kpis.overdue <<<"$B")" = "1" ] && [ "$(jget kpis.graceDays <<<"$B")" = "2" ] \
  && ok "KPIs: collected 120000 · to collect 120000 · 3 open · 1 due this week · 1 overdue · grace 2" || bad "kpis: $B"
echo "$B" | grep -q '0000000000a6' && bad "other org's plan leaked" || ok "offshore's plan is not listed"
echo "$B" | grep -q '0000000000a7' && bad "pending plan listed" || ok "plan without a cleared deposit is not listed"
echo "$B" | grep -Eq '2557120000|@example\.com|"phone"|"email"' && bad "buyer phone/email in the org list: $B" || ok "no buyer phone or email in the body"
echo "$B" | grep -q '"Neema K."' && echo "$B" | grep -q '"buyer":"Buyer"' && ok "buyer shown as \"Neema K.\" (and \"Buyer\" with no name)" || bad "buyer names: $B"
[ "$(jget rows.0.status <<<"$B")" = "overdue" ] && [ -n "$(jget rows.0.graceEnds <<<"$B")" ] && ok "most urgent first: overdue row with grace end" || bad "first row: $(jget rows.0.status <<<"$B")"
C=$(code -b "$SNAP/org" "$BASE/api/org/installments?status=overdue"); [ "$(jget rows < "$SNAP/body")" = "1" ] && [ "$(jget counts.all < "$SNAP/body")" = "5" ] && ok "?status=overdue → 1 row (counts still whole)" || bad "filter: $(cat "$SNAP/body")"
C=$(code -b "$SNAP/org" "$BASE/api/org/installments?status=nope"); [ "$C" = "400" ] && ok "?status=nope → 400" || bad "bad status → $C"
C=$(code -b "$SNAP/org" "$BASE/api/org/installments?event=ev-B"); [ "$C" = "404" ] && ok "?event=<other org's event> → 404" || bad "foreign event → $C"
C=$(code -b "$SNAP/org" "$BASE/api/org/installments?event=ev-A"); [ "$(jget counts.all < "$SNAP/body")" = "5" ] && ok "?event=ev-A → 5" || bad "event filter: $(cat "$SNAP/body")"
C=$(code -b "$SNAP/off" "$BASE/api/org/installments"); [ "$(jget counts.all < "$SNAP/body")" = "1" ] && ok "offshore sees only its own plan" || bad "offshore list: $(cat "$SNAP/body")"

echo "== O5 send reminder (1 / day / order) =="
R="$BASE/api/org/installments/00000000-0000-0000-0000-0000000000a2/remind"
C=$(code -b "$SNAP/org" -X POST "$R"); [ "$C" = "200" ] && ok "first reminder → 200 $(cat "$SNAP/body")" || bad "remind → $C $(cat "$SNAP/body")"
C=$(curl -s -D "$SNAP/h" -o "$SNAP/body" -w '%{http_code}' -b "$SNAP/org" -X POST "$R")
[ "$C" = "429" ] && grep -qi '^retry-after: [0-9]' "$SNAP/h" && grep -q already_reminded_today "$SNAP/body" && ok "second reminder same day → 429 + Retry-After" || bad "second remind → $C $(cat "$SNAP/body")"
C=$(code -b "$SNAP/org" "$BASE/api/org/installments"); grep -q '"remindedToday":true' "$SNAP/body" && ok "list marks remindedToday" || bad "remindedToday missing"
C=$(code -b "$SNAP/org" -X POST "$BASE/api/org/installments/00000000-0000-0000-0000-0000000000a4/remind"); [ "$C" = "409" ] && ok "paid-in-full plan → 409" || bad "completed remind → $C"
C=$(code -b "$SNAP/org" -X POST "$BASE/api/org/installments/00000000-0000-0000-0000-0000000000a6/remind"); [ "$C" = "404" ] && ok "other org's order → 404" || bad "foreign remind → $C"
C=$(code -b "$SNAP/org" -X POST "$BASE/api/org/installments/not-a-uuid/remind"); [ "$C" = "404" ] && ok "junk order id → 404" || bad "junk remind → $C"
N=$(psql_one "select count(*) from webhook_event where provider='installment-org-remind'")
[ "$N" = "1" ] && ok "exactly one reminder latch row" || bad "latch rows: $N"

echo "== O6 admin refund queue =="
C=$(code -b "$SNAP/org" "$BASE/api/admin/installments/refunds"); [ "$C" = "401" ] || [ "$C" = "403" ] && ok "organizer → $C on admin refunds" || bad "org on admin → $C"
C=$(code "$BASE/api/admin/installments/refunds"); [ "$C" = "401" ] && ok "anon → 401 on admin refunds" || bad "anon admin → $C"
C=$(code -b "$SNAP/admin" "$BASE/api/admin/installments/refunds")
[ "$C" = "200" ] && [ "$(jget refunds < "$SNAP/body")" = "1" ] && [ "$(jget refunds.0.refundDue < "$SNAP/body")" = "17000" ] && [ "$(jget refunds.0.buyerPhone < "$SNAP/body")" = "255712000005" ] \
  && ok "admin sees 1 pending refund (17000 to 255712000005)" || bad "admin refunds: $C $(cat "$SNAP/body")"
RR="$BASE/api/admin/installments/00000000-0000-0000-0000-0000000000a5/refund-recorded"
C=$(code -b "$SNAP/org" -X POST "$RR" -H 'content-type: application/json' -d '{"reference":"x"}'); [ "$C" = "401" ] || [ "$C" = "403" ] && ok "organizer can't record a refund ($C)" || bad "org record → $C"
C=$(code -b "$SNAP/admin" -X POST "$RR" -H 'content-type: application/json' -d '{}'); [ "$C" = "400" ] && ok "no reference → 400" || bad "no ref → $C"
C=$(code -b "$SNAP/admin" -X POST "$RR" -H 'content-type: application/json' -d '{"reference":"MPESA-QX12"}'); [ "$C" = "200" ] && [ "$(jget refunded < "$SNAP/body")" = "17000" ] && ok "refund recorded → 200 (17000)" || bad "record → $C $(cat "$SNAP/body")"
C=$(code -b "$SNAP/admin" -X POST "$RR" -H 'content-type: application/json' -d '{"reference":"again"}'); [ "$C" = "409" ] && ok "second record → 409 no_refund_pending" || bad "re-record → $C"
C=$(code -b "$SNAP/admin" -X POST "$BASE/api/admin/installments/00000000-0000-0000-0000-0000000000ff/refund-recorded" -H 'content-type: application/json' -d '{"reference":"x"}'); [ "$C" = "404" ] && ok "unknown order → 404" || bad "unknown → $C"
ROW=$(psql_one "select p.refund_status || '|' || o.refunded_amount from installment_plan p join \"order\" o on o.id = p.order_id where p.order_id='00000000-0000-0000-0000-0000000000a5'")
[ "$ROW" = "recorded|17000" ] && ok "plan refund_status recorded, order refunded_amount 17000" || bad "after record: $ROW"
psql_one "select data from collection_store where name='audit'" | grep -q installment_refund_recorded && ok "refund audited (installment_refund_recorded)" || bad "refund not audited"
C=$(code -b "$SNAP/admin" "$BASE/api/admin/installments/refunds"); [ "$(jget refunds < "$SNAP/body")" = "0" ] && ok "queue empty afterwards" || bad "queue: $(cat "$SNAP/body")"

[ "$fail" = "0" ] || { echo ""; echo "INSTALLMENTS-ORG E2E: FAIL"; tail -30 "$SNAP/api.log"; exit 1; }
echo ""
echo "BS136 INSTALLMENTS-ORG E2E: PASS"
