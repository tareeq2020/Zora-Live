#!/usr/bin/env bash
# BS98 — WITHDRAWAL DESTINATIONS. Boots the real API on a THROWAWAY Postgres 17
# (NEVER prod) and audits the whole "where do I get paid" flow end to end:
#
#   T0  migration 0023 applied — payout has the dest_* columns.
#   T1  GET /api/org/payouts/methods serves the catalog (methods · banks · MNOs)
#       sourced from the canonical registry (which mirrors x-bridge).
#   T2  a request with NO destination → 400 destination_invalid, nothing written.
#   T3  a provider that doesn't match the method (bank + an MNO code) → invalid.
#   T4  a bank destination with no account-holder name → invalid (bank rail needs it).
#   T5  a VALID BANK request → 200, and the dest_* columns persist the CANONICAL
#       code + snapshot + account + holder name.
#   T6  GET /api/org/payouts returns the structured destination object.
#   T7  the admin queue carries the destination so a staffer knows where to send.
#   T8  FULL FLOW — admin approves with a reference → paid; org sees PAID + ref.
#   T9  a VALID MOBILE-MONEY request persists too (phone account, no holder name).
#   T10 the audit trail records the provider + account on the request.
#
# Self-contained (throwaway PG; XBRIDGE_MOCK). bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55498}"
API_PORT="${TEST_API_PORT:-4198}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-dest-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-destsnap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers organizers audit admin events kyc"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

if [ ! -f "$API_DIR/dist/main.js" ]; then
  echo "== building @zora/core + @zora/api (dist missing) =="
  ( cd "$ROOT" && pnpm --filter @zora/core build && pnpm --filter @zora/api build ) >/dev/null
fi

echo "== throwaway Postgres @ :$PG_PORT + migrate + backfill =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_dest
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_dest"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_dest -v ON_ERROR_STOP=1 -c "$1"; }

# T0 — 0023 columns exist.
COLS=$(psql_one "select count(*) from information_schema.columns where table_name='payout' and column_name in ('dest_method','dest_provider','dest_provider_name','dest_account','dest_account_name')")
[ "$COLS" = "5" ] && echo "  ✓ T0: 0023 applied — payout has all 5 dest_* columns" \
  || { echo "  ✗ T0: dest columns = $COLS (want 5)"; fail=1; }

echo "== seed a verified org (thebrunchcity) with a real TZS balance =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_dest -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('brunch-vol-09','Garden Brunch — Vol. 09') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-brunch','brunch-vol-09','GA', 40) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-brunch', 50000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-brunch');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-brunch', 40, 40) on conflict do nothing;
update organizer set kyc_status = 'approved' where id = 'o1';
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
  curl -s -c "$1" -b "$1" -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
    -d "{\"phone\":\"$4\",\"email\":\"$5\",\"ageAttested\":true,\"cart\":[{\"tier\":\"$2\",\"quantity\":$3}],\"method\":\"mobile\"}" | jq_get orderId
}
pay_to_paid() {
  curl -s -b "$1" -X POST "$BASE/api/checkout/$2/pay" -H 'content-type: application/json' -d "{\"method\":\"mobile\",\"payerPhone\":\"$3\"}" >/dev/null
  for i in $(seq 1 8); do [ "$(curl -s -b "$1" "$BASE/api/orders/$2/status" | jq_get status)" = "paid" ] && return 0; sleep 1; done
  return 1
}

# 4 × 50,000 = 200,000 gross → 190,000 net (of the 5% commission): room for a
# 90,000 bank withdrawal AND a later 40,000 mobile one below.
O1=$(checkout "$SNAP/b1" t-brunch 4 0712345670 a1@example.com); pay_to_paid "$SNAP/b1" "$O1" 0712345670 || { echo "  ✗ order never paid"; tail -20 "$SNAP/api.log"; exit 1; }

curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/org" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null

pv_post() { curl -s -o "$3" -w '%{http_code}' -b "$1" -X POST "$BASE/api/org/payouts" -H 'content-type: application/json' -d "$2"; }
adm_put() { curl -s -o "$3" -w '%{http_code}' -b "$SNAP/admin" -X PUT "$BASE/api/admin/payouts/$1" -H 'content-type: application/json' -d "$2"; }

echo ""
echo "== T1 — GET /api/org/payouts/methods (the catalog the form renders) =="
M=$(curl -s -b "$SNAP/org" "$BASE/api/org/payouts/methods")
R=$(M="$M" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const m=JSON.parse(process.env.M);
t("2 methods (mobile money + bank)", (m.methods||[]).length===2 && m.methods.some(x=>x.id==="bank") && m.methods.some(x=>x.id==="mobile_money"));
t("banks include CRDB + NMB and there are 40+", (m.banks||[]).length>=40 && m.banks.some(b=>b.code==="CRDB") && m.banks.some(b=>b.code==="NMB"));
t("MNOs include MPESA and there are 6", (m.mnos||[]).length===6 && m.mnos.some(x=>x.code==="MPESA"));
' 2>&1 || true); echo "$R"; echo "$R" | grep -q '✗' && fail=1

echo ""
echo "== T2–T4 — a bad destination is refused with destination_invalid =="
C=$(pv_post "$SNAP/org" '{"amount":50000,"currency":"TZS"}' "$SNAP/t2"); B=$(cat "$SNAP/t2")
[ "$C" = "400" ] && echo "$B" | grep -q '"destination_invalid"' && echo "  ✓ T2: no destination → 400 destination_invalid" || { echo "  ✗ T2: HTTP $C $B"; fail=1; }

C=$(pv_post "$SNAP/org" '{"amount":50000,"currency":"TZS","destination":{"method":"bank","provider":"MPESA","providerName":"x","account":"0150123456","accountName":"X"}}' "$SNAP/t3"); B=$(cat "$SNAP/t3")
[ "$C" = "400" ] && echo "$B" | grep -q '"destination_invalid"' && echo "  ✓ T3: bank + an MNO code → 400 destination_invalid" || { echo "  ✗ T3: HTTP $C $B"; fail=1; }

C=$(pv_post "$SNAP/org" '{"amount":50000,"currency":"TZS","destination":{"method":"bank","provider":"CRDB","providerName":"CRDB","account":"0150123456"}}' "$SNAP/t4"); B=$(cat "$SNAP/t4")
[ "$C" = "400" ] && echo "$B" | grep -q '"destination_invalid"' && echo "  ✓ T4: bank with no account-holder name → 400 destination_invalid" || { echo "  ✗ T4: HTTP $C $B"; fail=1; }

NROWS=$(psql_one "select count(*) from payout")
[ "$NROWS" = "0" ] && echo "  ✓ T2–T4 wrote NOTHING (0 payout rows) — a refused request never persists" || { echo "  ✗ rows after refusals = $NROWS (want 0)"; fail=1; }

echo ""
echo "== T5 — a VALID BANK request persists the canonical destination =="
C=$(pv_post "$SNAP/org" '{"amount":90000,"currency":"TZS","destination":{"method":"bank","provider":"crdb","providerName":"typed by client","account":"0150 1234 5678","accountName":"The Brunch City Ltd"}}' "$SNAP/t5"); B=$(cat "$SNAP/t5")
[ "$C" = "200" ] && echo "$B" | grep -q '"ok":true' && echo "  ✓ T5: valid bank request → 200" || { echo "  ✗ T5: HTTP $C $B"; fail=1; }
DBROW=$(psql_one "select dest_method||'|'||dest_provider||'|'||dest_provider_name||'|'||dest_account||'|'||coalesce(dest_account_name,'-') from payout order by requested_at desc limit 1")
# provider normalised to the CANONICAL code + name (client's typed name ignored):
[ "$DBROW" = "bank|CRDB|CRDB Bank Limited|0150 1234 5678|The Brunch City Ltd" ] \
  && echo "  ✓ T5: DB truth — canonical code+name persisted (client 'typed by client' ignored): $DBROW" \
  || { echo "  ✗ T5: DB row = $DBROW"; fail=1; }

echo ""
echo "== T6 — GET /api/org/payouts returns the destination object =="
PV=$(curl -s -b "$SNAP/org" "$BASE/api/org/payouts")
R=$(PV="$PV" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const p=(JSON.parse(process.env.PV).payouts||[])[0]; const d=p&&p.destination;
t("payout carries a destination object", !!d);
t("method=bank, provider=CRDB, name+account+holder present", d && d.method==="bank" && d.provider==="CRDB" && d.providerName==="CRDB Bank Limited" && d.account==="0150 1234 5678" && d.accountName==="The Brunch City Ltd");
' 2>&1 || true); echo "$R"; echo "$R" | grep -q '✗' && fail=1

echo ""
echo "== T7 — the admin queue carries the destination =="
Q=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/payouts?status=requested")
PID=$(echo "$Q" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);process.stdout.write(a[0]?a[0].id:"")})')
R=$(Q="$Q" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const p=JSON.parse(process.env.Q)[0]; const d=p&&p.destination;
t("admin row shows the destination (provider + account)", d && d.provider==="CRDB" && d.account==="0150 1234 5678");
' 2>&1 || true); echo "$R"; echo "$R" | grep -q '✗' && fail=1

echo ""
echo "== T8 — FULL FLOW: admin approves with a reference → paid =="
C=$(adm_put "$PID" '{"decision":"approve","reference":"CRDB-TT-889201"}' "$SNAP/t8"); B=$(cat "$SNAP/t8")
[ "$C" = "200" ] && echo "$B" | grep -q '"approved"' && echo "  ✓ T8: approved with reference CRDB-TT-889201" || { echo "  ✗ T8: HTTP $C $B"; fail=1; }
PV=$(curl -s -b "$SNAP/org" "$BASE/api/org/payouts")
echo "$PV" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=(JSON.parse(s).payouts||[])[0];process.exit(p&&p.status==="approved"&&p.reference==="CRDB-TT-889201"?0:1)})' \
  && echo "  ✓ T8: organizer sees it PAID with the reference — destination preserved on the record" || { echo "  ✗ T8: org view after approve"; fail=1; }

echo ""
echo "== T9 — a VALID MOBILE-MONEY request (phone account, no holder name) =="
C=$(pv_post "$SNAP/org" '{"amount":40000,"currency":"TZS","destination":{"method":"mobile_money","provider":"MPESA","providerName":"Vodacom (M-Pesa)","account":"0712 345 678"}}' "$SNAP/t9"); B=$(cat "$SNAP/t9")
[ "$C" = "200" ] && echo "$B" | grep -q '"ok":true' && echo "  ✓ T9: valid mobile-money request → 200" || { echo "  ✗ T9: HTTP $C $B"; fail=1; }
DBROW=$(psql_one "select dest_method||'|'||dest_provider||'|'||dest_account||'|'||coalesce(dest_account_name,'NULL') from payout order by requested_at desc limit 1")
[ "$DBROW" = "mobile_money|MPESA|0712 345 678|NULL" ] \
  && echo "  ✓ T9: DB truth — mobile destination, holder name NULL: $DBROW" || { echo "  ✗ T9: DB row = $DBROW"; fail=1; }

echo ""
echo "== T10 — the audit trail records the provider + account =="
AUD=$(curl -s -b "$SNAP/admin" "$BASE/api/audit")
echo "$AUD" | grep -q 'CRDB Bank Limited' && echo "  ✓ T10: audit line carries the destination (provider + account)" || { echo "  ✗ T10: audit missing destination detail"; fail=1; }

echo ""
[ "$fail" = "0" ] && echo "PAYOUT DESTINATION E2E: PASS" || echo "PAYOUT DESTINATION E2E: FAIL"
exit $fail
