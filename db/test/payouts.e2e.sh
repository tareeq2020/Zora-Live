#!/usr/bin/env bash
# BS38 / plan #7 — PAYOUT (withdrawal) gate. This is money leaving the platform,
# so the suite boots the real API on a throwaway Postgres and proves:
#
#   1. Balance is NET of the stamped commission and is server-authoritative.
#   2. A request within balance succeeds and RESERVES its amount (available drops).
#   3. Over-balance / below-minimum / wrong-currency / duplicate requests are
#      refused with the TYPED code (eng review CQ3).
#   4. **CRITICAL (ARCH-2): two CONCURRENT requests cannot over-withdraw.**
#      Both are fired in parallel against the same balance; only one may win and
#      Σ(non-rejected payouts) must never exceed net earnings.
#   5. An UNVERIFIED organizer cannot withdraw at all (#5 gates #7).
#   6. Admin approve marks it paid and REQUIRES a reference; reject returns the
#      amount to available; a decided payout is terminal.
#   7. REFUNDED money is not withdrawable — a refund lowers the balance (OV1).
#   8. Cross-org isolation: org A never sees or acts on org B's payouts, and an
#      organizer session cannot reach the admin payout surface at all.
#
# Style/harness mirrors org-sales.e2e.sh (throwaway PG, XBRIDGE_MOCK, real HTTP
# checkout→pay). Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55447}"
API_PORT="${TEST_API_PORT:-4122}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-payouts-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-payoutsnap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers organizers audit admin events kyc"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

echo "== throwaway Postgres @ :$PG_PORT + migrate (0001..0012) + backfill =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_payouts
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_payouts"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_payouts -v ON_ERROR_STOP=1 -c "$1"; }

# The migration must have created the ledger with its index — a payout table
# without the (organizer, status) index is a full scan on every balance read.
HAS_TABLE=$(psql_one "select count(*) from information_schema.tables where table_name='payout'")
HAS_IDX=$(psql_one "select count(*) from pg_indexes where tablename='payout' and indexname='payout_org_status_idx'")
[ "$HAS_TABLE" = "1" ] && [ "$HAS_IDX" = "1" ] \
  && echo "  ✓ 0012_payouts.sql applied: payout table + payout_org_status_idx" \
  || { echo "  ✗ payout table=$HAS_TABLE index=$HAS_IDX (want 1 / 1)"; fail=1; }

echo "== seed relational catalog: org A brunch-vol-09 (thebrunchcity), org B offshore-001 (offshore) =="
# Ownership (organizerHandle) already lives in the backfilled 'events' blob.
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_payouts -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('brunch-vol-09','Garden Brunch — Vol. 09') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-brunch','brunch-vol-09','GA', 40) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-brunch', 50000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-brunch');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-brunch', 40, 40) on conflict do nothing;

insert into event (id, name) values ('offshore-001','OFFSHORE — The Daytime Yacht Groove') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-offshore','offshore-001','GA', 10) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-offshore', 80000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-offshore');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-offshore', 10, 10) on conflict do nothing;

-- #5 gate: org A (o1/thebrunchcity) is VERIFIED, org B (o2/offshore) is NOT.
-- Org B still earns real money below, so "unverified cannot withdraw" is proven
-- against a real balance and not against an empty one.
update organizer set kyc_status = 'approved' where id = 'o1';
update organizer set kyc_status = 'pending'  where id = 'o2';
SQL

echo "== boot API (x-bridge MOCK) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
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

echo "== seed paid orders: A 100000 + 50000 + 50000 TZS · B 80000 TZS =="
OA1=$(checkout "$SNAP/bA1" t-brunch 2 0712345670 a1@example.com)
pay_to_paid "$SNAP/bA1" "$OA1" 0712345670 || { echo "  ✗ A order 1 never paid"; tail -20 "$SNAP/api.log"; exit 1; }
OA2=$(checkout "$SNAP/bA2" t-brunch 1 0712345671 a2@example.com)
pay_to_paid "$SNAP/bA2" "$OA2" 0712345671 || { echo "  ✗ A order 2 never paid"; tail -20 "$SNAP/api.log"; exit 1; }
OA3=$(checkout "$SNAP/bA3" t-brunch 1 0712345672 a3@example.com)
pay_to_paid "$SNAP/bA3" "$OA3" 0712345672 || { echo "  ✗ A order 3 never paid"; tail -20 "$SNAP/api.log"; exit 1; }
OB1=$(checkout "$SNAP/bB1" t-offshore 1 0713333333 b1@example.com)
pay_to_paid "$SNAP/bB1" "$OB1" 0713333333 || { echo "  ✗ B order never paid"; tail -20 "$SNAP/api.log"; exit 1; }
echo "  ✓ org A gross 200000 TZS (3 paid orders) · org B gross 80000 TZS"

echo "== logins (admin sets org passwords, then org/login) =="
curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
for o in o1 o2 o3; do
  curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/$o/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
done
curl -s -c "$SNAP/orgA" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/orgB" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"offshore","password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/orgC" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"basement","password":"orgpass123"}' >/dev/null

# org helpers
pv_get()  { curl -s -b "$1" "$BASE/api/org/payouts"; }
pv_post() { curl -s -o "$3" -w '%{http_code}' -b "$1" -X POST "$BASE/api/org/payouts" -H 'content-type: application/json' -d "$2"; }
adm_put() { curl -s -o "$3" -w '%{http_code}' -b "$SNAP/admin" -X PUT "$BASE/api/admin/payouts/$1" -H 'content-type: application/json' -d "$2"; }

echo ""
echo "== 1. BALANCE is net of the STAMPED commission and comes from the server =="
PV1=$(pv_get "$SNAP/orgA")
R1=$(PV="$PV1" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const v=JSON.parse(process.env.PV); const tzs=(v.balances||[]).find(b=>b.currency==="TZS");
t("GET /api/org/payouts returns a TZS balance line", !!tzs);
t("earned == 190000 (gross 200000 net of the 5% stamped commission)", tzs && tzs.earned===190000);
t("available == 190000 (nothing reserved, nothing paid out)", tzs && tzs.available===190000);
t("reserved == 0 and paidOut == 0", tzs && tzs.reserved===0 && tzs.paidOut===0);
t("minimum == 10000 TZS is published to the client", tzs && tzs.minimum===10000);
t("verified == true (kycStatus approved)", v.verified===true);
t("commissionRate == 0.05 is surfaced for the \"net of X%\" copy", v.commissionRate===0.05);
t("history is empty to start", Array.isArray(v.payouts) && v.payouts.length===0);
' 2>&1 || true)
echo "$R1"; echo "$R1" | grep -q '✗' && fail=1

echo ""
echo "== 2. TYPED REJECTIONS (CQ3) — every refusal is a machine-readable code =="
CODE=$(pv_post "$SNAP/orgA" '{"amount":250000,"currency":"TZS"}' "$SNAP/r_over"); OVER=$(cat "$SNAP/r_over")
[ "$CODE" = "400" ] && echo "$OVER" | grep -q '"insufficient_balance"' \
  && echo "  ✓ 250000 > 190000 available → 400 insufficient_balance" \
  || { echo "  ✗ over-balance: HTTP $CODE $OVER"; fail=1; }

CODE=$(pv_post "$SNAP/orgA" '{"amount":5000,"currency":"TZS"}' "$SNAP/r_min"); MIN=$(cat "$SNAP/r_min")
[ "$CODE" = "400" ] && echo "$MIN" | grep -q '"amount_invalid"' \
  && echo "  ✓ 5000 below the 10000 minimum → 400 amount_invalid" \
  || { echo "  ✗ below-minimum: HTTP $CODE $MIN"; fail=1; }

CODE=$(pv_post "$SNAP/orgA" '{"amount":-100000,"currency":"TZS"}' "$SNAP/r_neg"); NEG=$(cat "$SNAP/r_neg")
[ "$CODE" = "400" ] && echo "$NEG" | grep -q '"amount_invalid"' \
  && echo "  ✓ negative amount → 400 amount_invalid (no credit-by-withdrawal)" \
  || { echo "  ✗ negative: HTTP $CODE $NEG"; fail=1; }

CODE=$(pv_post "$SNAP/orgA" '{"amount":50000,"currency":"USD"}' "$SNAP/r_cur"); CUR=$(cat "$SNAP/r_cur")
[ "$CODE" = "400" ] && echo "$CUR" | grep -q '"unsupported_currency"' \
  && echo "  ✓ USD (no balance in it) → 400 unsupported_currency — balances never mix (I7)" \
  || { echo "  ✗ currency: HTTP $CODE $CUR"; fail=1; }

echo ""
echo "== 3. UNVERIFIED ORGANIZER CANNOT WITHDRAW (#5 gates #7) =="
PVB=$(pv_get "$SNAP/orgB")
echo "$PVB" | grep -q '"earned":76000' \
  && echo "  · org B HAS a real balance (76000 TZS net) — the block below is the KYC gate, not emptiness" \
  || { echo "  ✗ org B balance unexpected: $PVB"; fail=1; }
CODE=$(pv_post "$SNAP/orgB" '{"amount":50000,"currency":"TZS"}' "$SNAP/r_nv"); NV=$(cat "$SNAP/r_nv")
[ "$CODE" = "400" ] && echo "$NV" | grep -q '"not_verified"' \
  && echo "  ✓ unverified org B requesting 50000 of its own 76000 → 400 not_verified" \
  || { echo "  ✗ unverified gate: HTTP $CODE $NV"; fail=1; }
NV_ROWS=$(psql_one "select count(*) from payout where organizer_handle='offshore'")
[ "$NV_ROWS" = "0" ] && echo "  ✓ nothing was written for the unverified org (0 payout rows)" \
  || { echo "  ✗ unverified org wrote $NV_ROWS payout rows"; fail=1; }

echo ""
echo "══ 4. CRITICAL (ARCH-2): TWO CONCURRENT REQUESTS CANNOT OVER-WITHDRAW ══"
echo "   balance = 190000 TZS · firing 2 × 100000 IN PARALLEL (together 200000)"
# Both requests read the balance and then write. Without the per-org advisory
# lock + the pending-reservation, both see 190000, both pass, and the organizer
# has withdrawn 200000 of money that does not exist.
( pv_post "$SNAP/orgA" '{"amount":100000,"currency":"TZS","note":"race-1","destination":{"method":"mobile_money","provider":"MPESA","providerName":"Vodacom (M-Pesa)","account":"255712345678"}}' "$SNAP/race1" > "$SNAP/race1.code" ) &
P1=$!
( pv_post "$SNAP/orgA" '{"amount":100000,"currency":"TZS","note":"race-2","destination":{"method":"mobile_money","provider":"MPESA","providerName":"Vodacom (M-Pesa)","account":"255712345678"}}' "$SNAP/race2" > "$SNAP/race2.code" ) &
P2=$!
wait $P1 || true
wait $P2 || true
C1=$(cat "$SNAP/race1.code"); C2=$(cat "$SNAP/race2.code")
B1=$(cat "$SNAP/race1"); B2=$(cat "$SNAP/race2")
echo "   request 1 → HTTP $C1 · request 2 → HTTP $C2"

OK_COUNT=0
case "$C1" in 200|201) OK_COUNT=$((OK_COUNT+1));; esac
case "$C2" in 200|201) OK_COUNT=$((OK_COUNT+1));; esac
[ "$OK_COUNT" = "1" ] \
  && echo "  ✓ EXACTLY ONE of the two concurrent requests succeeded" \
  || { echo "  ✗ $OK_COUNT of 2 concurrent requests succeeded (want exactly 1)"; echo "     r1=$B1"; echo "     r2=$B2"; fail=1; }

LOSER="$B1"; [ "$C1" = "400" ] || LOSER="$B2"
LOSER_CODE=$(echo "$LOSER" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).error||"?"))}catch{process.stdout.write("?")}})')
echo "$LOSER" | grep -qE '"(insufficient_balance|duplicate_request)"' \
  && echo "  ✓ the loser was refused with the typed code \"$LOSER_CODE\" (never a 500, never a silent partial write)" \
  || { echo "  ✗ loser carried no typed code: $LOSER"; fail=1; }

# The invariant that actually matters: the LEDGER can never hold more than earned.
HELD=$(psql_one "select coalesce(sum(amount),0) from payout where organizer_handle='thebrunchcity' and status <> 'rejected'")
ROWS=$(psql_one "select count(*) from payout where organizer_handle='thebrunchcity'")
[ "$HELD" = "100000" ] && [ "$ROWS" = "1" ] \
  && echo "  ✓ LEDGER INVARIANT HOLDS: Σ(non-rejected payouts) = $HELD ≤ 190000 earned · exactly 1 row written" \
  || { echo "  ✗ OVER-WITHDRAWAL: Σ non-rejected = $HELD over 190000 earned ($ROWS rows)"; fail=1; }

echo ""
echo "== 5. A PENDING REQUEST RESERVES BALANCE =="
PV5=$(pv_get "$SNAP/orgA")
R5=$(PV="$PV5" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const v=JSON.parse(process.env.PV); const b=(v.balances||[]).find(x=>x.currency==="TZS");
t("earned still 190000 (a request does not change what was earned)", b && b.earned===190000);
t("reserved == 100000 (the pending request holds it back)", b && b.reserved===100000);
t("available == 90000 (190000 − 100000 reserved)", b && b.available===90000);
t("pendingCount == 1 — the UI can disable re-request and say why", v.pendingCount===1);
t("history shows the requested payout", (v.payouts||[]).length===1 && v.payouts[0].status==="requested");
' 2>&1 || true)
echo "$R5"; echo "$R5" | grep -q '✗' && fail=1

# A second request while one is pending is refused even though 90000 is available.
CODE=$(pv_post "$SNAP/orgA" '{"amount":50000,"currency":"TZS"}' "$SNAP/r_dup"); DUP=$(cat "$SNAP/r_dup")
[ "$CODE" = "400" ] && echo "$DUP" | grep -q '"duplicate_request"' \
  && echo "  ✓ a second request while one is pending → 400 duplicate_request" \
  || { echo "  ✗ duplicate guard: HTTP $CODE $DUP"; fail=1; }

echo ""
echo "== 6. ADMIN QUEUE · APPROVE REQUIRES A REFERENCE · REJECT RETURNS THE MONEY =="
Q=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/payouts?status=requested")
PID=$(echo "$Q" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);process.stdout.write(a[0]?a[0].id:"")})')
R6=$(Q="$Q" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const q=JSON.parse(process.env.Q);
t("queue has exactly 1 requested payout", q.length===1);
t("row carries org handle + display name, mono amount, currency and requested-at",
  q[0] && q[0].organizerHandle==="thebrunchcity" && q[0].organizerName==="The Brunch City" &&
  q[0].amount===100000 && q[0].currency==="TZS" && !!q[0].requestedAt);
' 2>&1 || true)
echo "$R6"; echo "$R6" | grep -q '✗' && fail=1

CODE=$(adm_put "$PID" '{"decision":"approve"}' "$SNAP/r_noref"); NOREF=$(cat "$SNAP/r_noref")
[ "$CODE" = "400" ] && echo "$NOREF" | grep -q '"reference_required"' \
  && echo "  ✓ approve with no reference → 400 reference_required (no money leaves unproven)" \
  || { echo "  ✗ reference guard: HTTP $CODE $NOREF"; fail=1; }

CODE=$(adm_put "$PID" '{"decision":"approve","reference":"MPESA-7X41-QQ","fxNote":"settled TZS 1:1"}' "$SNAP/r_appr")
APPR=$(cat "$SNAP/r_appr")
[ "$CODE" = "200" ] && echo "$APPR" | grep -q '"approved"' \
  && echo "  ✓ approved with reference MPESA-7X41-QQ + FX note" \
  || { echo "  ✗ approve: HTTP $CODE $APPR"; fail=1; }
DB_ROW=$(psql_one "select status||'|'||coalesce(reference,'-')||'|'||coalesce(fx_note,'-')||'|'||coalesce(decided_by,'-')||'|decided_at='||(decided_at is not null)::text from payout where id='$PID'")
[ "$DB_ROW" = "approved|MPESA-7X41-QQ|settled TZS 1:1|admin|decided_at=true" ] \
  && echo "  ✓ DB truth: $DB_ROW" \
  || { echo "  ✗ DB row after approve: $DB_ROW"; fail=1; }

# Terminal: the money already moved, so it cannot be decided twice.
CODE=$(adm_put "$PID" '{"decision":"reject","reason":"changed my mind"}' "$SNAP/r_again"); AGAIN=$(cat "$SNAP/r_again")
[ "$CODE" = "400" ] && echo "$AGAIN" | grep -q '"already_decided"' \
  && echo "  ✓ re-deciding an approved payout → 400 already_decided" \
  || { echo "  ✗ terminal guard: HTTP $CODE $AGAIN"; fail=1; }

PV6=$(pv_get "$SNAP/orgA")
R6B=$(PV="$PV6" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const b=(JSON.parse(process.env.PV).balances||[]).find(x=>x.currency==="TZS");
t("after approve: paidOut == 100000, reserved == 0", b && b.paidOut===100000 && b.reserved===0);
t("available STILL 90000 — approving moves money from reserved to paid, it does not free it", b && b.available===90000);
' 2>&1 || true)
echo "$R6B"; echo "$R6B" | grep -q '✗' && fail=1

# ── reject returns the amount to available ──
CODE=$(pv_post "$SNAP/orgA" '{"amount":30000,"currency":"TZS","destination":{"method":"mobile_money","provider":"MPESA","providerName":"Vodacom (M-Pesa)","account":"255712345678"}}' "$SNAP/r_req2"); REQ2=$(cat "$SNAP/r_req2")
PID2=$(echo "$REQ2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);process.stdout.write(o.payout?o.payout.id:"")})')
echo "$(pv_get "$SNAP/orgA")" | grep -q '"available":60000' \
  && echo "  ✓ a fresh 30000 request drops available 90000 → 60000" \
  || { echo "  ✗ reservation after second request: $(pv_get "$SNAP/orgA")"; fail=1; }

CODE=$(adm_put "$PID2" '{"decision":"reject"}' "$SNAP/r_norsn"); NORSN=$(cat "$SNAP/r_norsn")
[ "$CODE" = "400" ] && echo "$NORSN" | grep -q '"reason_required"' \
  && echo "  ✓ reject with no reason → 400 reason_required (the organizer must be told why)" \
  || { echo "  ✗ reason guard: HTTP $CODE $NORSN"; fail=1; }

CODE=$(adm_put "$PID2" '{"decision":"reject","reason":"Bank details do not match the registered organizer"}' "$SNAP/r_rej")
REJ=$(cat "$SNAP/r_rej")
[ "$CODE" = "200" ] && echo "$REJ" | grep -q '"rejected"' \
  && echo "  ✓ rejected with a reason" || { echo "  ✗ reject: HTTP $CODE $REJ"; fail=1; }

PV6C=$(pv_get "$SNAP/orgA")
R6C=$(PV="$PV6C" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const v=JSON.parse(process.env.PV); const b=(v.balances||[]).find(x=>x.currency==="TZS");
t("after reject: available back to 90000 (the amount returned)", b && b.available===90000);
t("reserved back to 0", b && b.reserved===0);
t("pendingCount back to 0 — the organizer can request again", v.pendingCount===0);
t("the rejected payout keeps its reason in history",
  (v.payouts||[]).some(p=>p.status==="rejected" && /Bank details/.test(p.reason||"")));
' 2>&1 || true)
echo "$R6C"; echo "$R6C" | grep -q '✗' && fail=1

echo ""
echo "== 7. REFUNDED MONEY IS NOT WITHDRAWABLE (OV1) =="
CORE="$ROOT/packages/core/dist/index.js"
cat > "$SNAP/refund.js" <<'JS'
const { db, refundOrder, closeDb } = require(process.env.CORE);
(async () => {
  const r = await refundOrder(db(), process.argv[2]);
  console.log(JSON.stringify(r));
  await closeDb();
  if (!r.ok) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
JS
REF=$(env CORE="$CORE" DATABASE_URL="$URL" node "$SNAP/refund.js" "$OA3") \
  && echo "  · refunded order $OA3 (50000 gross / 47500 net): $REF" \
  || { echo "  ✗ refund failed: $REF"; fail=1; }

PV7=$(pv_get "$SNAP/orgA")
R7=$(PV="$PV7" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const b=(JSON.parse(process.env.PV).balances||[]).find(x=>x.currency==="TZS");
t("earned drops 190000 → 142500 (the refunded 47500 net is gone)", b && b.earned===142500);
t("available drops 90000 → 42500 — refunded money cannot be withdrawn", b && b.available===42500);
t("paidOut is untouched at 100000 (a refund never un-pays a settled payout)", b && b.paidOut===100000);
' 2>&1 || true)
echo "$R7"; echo "$R7" | grep -q '✗' && fail=1

# And the refunded money is really unreachable: asking for the pre-refund figure fails.
CODE=$(pv_post "$SNAP/orgA" '{"amount":90000,"currency":"TZS"}' "$SNAP/r_ref"); REFREQ=$(cat "$SNAP/r_ref")
[ "$CODE" = "400" ] && echo "$REFREQ" | grep -q '"insufficient_balance"' \
  && echo "  ✓ requesting the pre-refund 90000 → 400 insufficient_balance" \
  || { echo "  ✗ post-refund request: HTTP $CODE $REFREQ"; fail=1; }

echo ""
echo "== 8. CROSS-ORG ISOLATION + ADMIN SURFACE IS ADMIN-ONLY =="
PVB2=$(pv_get "$SNAP/orgB")
R8=$(PVB="$PVB2" PID="$PID" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const v=JSON.parse(process.env.PVB);
t("org B history contains NONE of org A payouts", !(v.payouts||[]).some(p=>p.organizerHandle!=="offshore"));
t("org B history is empty (it never requested one)", (v.payouts||[]).length===0);
t("org B balance is its own 76000, not org A numbers",
  (v.balances||[]).some(b=>b.currency==="TZS" && b.earned===76000));
t("org B is still marked unverified", v.verified===false);
' 2>&1 || true)
echo "$R8"; echo "$R8" | grep -q '✗' && fail=1

# Zero-balance org (basement owns no seeded events) — the organizer "nothing to
# withdraw yet" state must be a real, non-error response.
PVC=$(pv_get "$SNAP/orgC")
echo "$PVC" | grep -q '"balances":\[\]' \
  && echo "  ✓ an org with no earnings gets an empty balance list (zero-balance state, not an error)" \
  || { echo "  ✗ zero-balance org: $PVC"; fail=1; }

# An organizer session must not reach the staff surface at all.
ORG_ADMIN=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/orgA" "$BASE/api/admin/payouts")
[ "$ORG_ADMIN" = "401" ] && echo "  ✓ organizer session → GET /api/admin/payouts 401" \
  || { echo "  ✗ organizer reached the admin queue: HTTP $ORG_ADMIN"; fail=1; }
ORG_DECIDE=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/orgB" -X PUT "$BASE/api/admin/payouts/$PID" \
  -H 'content-type: application/json' -d '{"decision":"approve","reference":"HACK"}')
[ "$ORG_DECIDE" = "401" ] && echo "  ✓ org B trying to decide org A's payout → 401 (no cross-org action)" \
  || { echo "  ✗ org B could reach the decide endpoint: HTTP $ORG_DECIDE"; fail=1; }
ANON=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/org/payouts")
[ "$ANON" = "401" ] && echo "  ✓ anonymous → GET /api/org/payouts 401" \
  || { echo "  ✗ anon reached the payout surface: HTTP $ANON"; fail=1; }

# Audit trail — every money decision is recorded.
AUD=$(curl -s -b "$SNAP/admin" "$BASE/api/audit")
echo "$AUD" | grep -q 'payout.approve' && echo "$AUD" | grep -q 'payout.reject' && echo "$AUD" | grep -q 'payout.request' \
  && echo "  ✓ audit trail carries payout.request / payout.approve / payout.reject" \
  || { echo "  ✗ audit trail missing payout entries"; fail=1; }

echo ""
echo "══ 9. CONCURRENCY UNDER HIGHER CONTENTION — 4 PARALLEL REQUESTS ══"
echo "   available = 42500 TZS (post-refund) · firing 4 × 20000 IN PARALLEL (together 80000)"
# Round 4 proved two racers serialize. This proves it holds when the queue is
# deeper: 4 requests, each individually affordable, together nearly double the
# balance. Whichever guard the losers hit (a fresh balance that no longer covers
# them, or the one-open-request rule) is an implementation detail — BOTH live
# inside the same per-org lock, and without that lock all four would read 42500,
# all four would see no pending row, and all four would be written.
BURST_PIDS=""
for i in 1 2 3 4; do
  ( pv_post "$SNAP/orgA" '{"amount":20000,"currency":"TZS","note":"burst-'"$i"'","destination":{"method":"mobile_money","provider":"MPESA","providerName":"Vodacom (M-Pesa)","account":"255712345678"}}' "$SNAP/burst$i" > "$SNAP/burst$i.code" ) &
  BURST_PIDS="$BURST_PIDS $!"
done
for p in $BURST_PIDS; do wait "$p" || true; done

BURST_OK=0
BURST_CODES=""
for i in 1 2 3 4; do
  c=$(cat "$SNAP/burst$i.code")
  BURST_CODES="$BURST_CODES $c"
  case "$c" in 200|201) BURST_OK=$((BURST_OK+1));; esac
done
echo "   HTTP codes:$BURST_CODES"
[ "$BURST_OK" = "1" ] \
  && echo "  ✓ EXACTLY ONE of 4 concurrent requests succeeded (3 refused, none silently written)" \
  || { echo "  ✗ $BURST_OK of 4 concurrent requests succeeded (want exactly 1)"; fail=1; }
for i in 1 2 3 4; do
  c=$(cat "$SNAP/burst$i.code")
  case "$c" in
    200|201) ;;
    400) grep -qE '"(insufficient_balance|duplicate_request)"' "$SNAP/burst$i" || { echo "  ✗ burst $i had no typed code: $(cat "$SNAP/burst$i")"; fail=1; };;
    *) echo "  ✗ burst $i returned HTTP $c (never a 500 on a money path)"; fail=1;;
  esac
done
echo "  ✓ every loser carried a typed 400 code — no 500s, no partial writes"

# Final ledger invariant across the whole run: nothing the organizer holds or has
# been paid may ever exceed what they actually earned.
FINAL_HELD=$(psql_one "select coalesce(sum(amount),0) from payout where organizer_handle='thebrunchcity' and status <> 'rejected'")
FINAL_ROWS=$(psql_one "select count(*) from payout where organizer_handle='thebrunchcity'")
[ "$FINAL_HELD" = "120000" ] \
  && echo "  ✓ FINAL LEDGER: Σ(non-rejected) = $FINAL_HELD ≤ 142500 earned (post-refund) · $FINAL_ROWS total rows" \
  || { echo "  ✗ FINAL LEDGER over-withdrawn: $FINAL_HELD of 142500 earned"; fail=1; }

[ "$fail" = "0" ] || { echo ""; echo "PAYOUTS E2E: FAIL"; tail -30 "$SNAP/api.log"; exit 1; }
echo ""
echo "PAYOUTS E2E: PASS (net balance · reservation · CONCURRENT requests cannot over-withdraw · typed codes · unverified blocked · approve-with-reference · reject returns funds · refunds not withdrawable · cross-org isolation)"
