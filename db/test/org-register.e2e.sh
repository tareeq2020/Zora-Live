#!/usr/bin/env bash
# BS41 / plan #4 + #5 — ORGANIZER SELF-REGISTRATION + VERIFICATION gate.
#
# This is the door into the platform: whoever walks through it can eventually
# take money from the public. So the suite boots the real API on a throwaway
# Postgres and proves the door only opens the way it is supposed to:
#
#   1. Migration 0013 landed (source / phone / review columns + queue index).
#   2. Handle availability is honest BEFORE anyone commits: free / taken /
#      reserved / too-short, over the same rules the register endpoint enforces.
#   3. A valid SMS code creates a PENDING organizer (status pending, kyc
#      unverified, source self-signup) and mints a working organizer session.
#   4. Handle collision → 409, reserved handle → 400 — and neither one BURNS the
#      single-use code (the checks run before the OTP is consumed).
#   5. A wrong code → 401 wrong_code. A REPLAYED (already consumed) code → 401
#      expired. Neither creates a row.
#   6. THE GATES: a pending org can save a DRAFT but cannot publish a sellable
#      drop (403 kyc_required) and cannot request a payout (not_verified).
#   7. The self-signup shows up in the SAME admin queue as KYC, marked
#      source=self-signup, and is invisible to an organizer session (401).
#   8. Approve flips status→active + kyc→approved, takes effect WITHOUT a new
#      login, and publishing then succeeds.
#   9. Reject records a standardized reason, keeps status pending (not a ban),
#      surfaces the existing KYC reject copy on /api/org/me, and keeps the drop
#      gate shut.
#  10. Cross-org isolation: one self-signup cannot touch another's drop, and the
#      organizer endpoints refuse to decide on a staff-created org.
#  11. Every decision is in the audit trail.
#
# Style/harness mirrors org-events.e2e.sh + payouts.e2e.sh (throwaway PG,
# XBRIDGE_MOCK, real HTTP). OTP_ECHO=true is the e2e-only switch that returns the
# SMS code in the /api/otp/request body — it is never set in production.
# Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55448}"
API_PORT="${TEST_API_PORT:-4123}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-orgreg-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-orgregsnap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers organizers audit admin events kyc"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

echo "== throwaway Postgres @ :$PG_PORT + migrate (0001..0013) + backfill =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_orgreg
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_orgreg"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

psql_q() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_orgreg -c "$1"; }

echo ""
echo "== 0. MIGRATION 0013 — the self-signup columns exist =="
COLS=$(psql_q "select count(*) from information_schema.columns
                where table_name='organizer'
                  and column_name in ('source','phone','reviewed_at','reviewed_by','verification_reason');")
IDX=$(psql_q "select count(*) from pg_indexes where tablename='organizer' and indexname='organizer_source_idx';")
[ "$COLS" = "5" ] && [ "$IDX" = "1" ] \
  && echo "  ✓ 0013 applied: source/phone/reviewed_at/reviewed_by/verification_reason + organizer_source_idx" \
  || { echo "  ✗ 0013: columns=$COLS (want 5) index=$IDX (want 1)"; fail=1; }
# The seeded orgs must be untouched — source stays NULL so GET /api/organizers is
# byte-identical to the golden fixture (pg-parity diffs it).
SEEDED_SRC=$(psql_q "select count(*) from organizer where source is not null;")
[ "$SEEDED_SRC" = "0" ] && echo "  ✓ seeded organizers carry source=NULL (no response-shape drift)" \
  || { echo "  ✗ $SEEDED_SRC seeded organizers already have a source"; fail=1; }

echo ""
echo "== boot API (XBRIDGE_MOCK + OTP_ECHO) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    OTP_ECHO=true SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
jq_get() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=Array.isArray(v)&&/^\d+$/.test(p)?v[+p]:v?.[p];process.stdout.write(v==null?"":Array.isArray(v)?String(v.length):String(v))}catch{process.stdout.write("ERR:"+s.slice(0,160))}})' "$1"; }
# POST helper that returns "<http_code> <body>" so a test can assert both.
post() { # post <cookiejar|-> <path> <json>
  local jar="$1" path="$2" body="$3"
  if [ "$jar" = "-" ]; then
    curl -s -w '\n%{http_code}' -X POST "$BASE$path" -H 'content-type: application/json' -d "$body"
  else
    curl -s -w '\n%{http_code}' -b "$jar" -c "$jar" -X POST "$BASE$path" -H 'content-type: application/json' -d "$body"
  fi
}
body_of() { printf '%s' "$1" | sed '$d'; }
code_of() { printf '%s' "$1" | tail -1; }

curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"zora2026"}' >/dev/null

echo ""
echo "== 1. HANDLE AVAILABILITY — the picker tells the truth before anyone commits =="
FREE=$(curl -s "$BASE/api/org/handle-available?handle=sunrisecollective")
TAKEN=$(curl -s "$BASE/api/org/handle-available?handle=Basement")   # mixed case on purpose
RESV=$(curl -s "$BASE/api/org/handle-available?handle=dashboard")
SHORT=$(curl -s "$BASE/api/org/handle-available?handle=ab")
[ "$(echo "$FREE" | jq_get available)" = "true" ] \
  && echo "  ✓ unused handle → available" || { echo "  ✗ free: $FREE"; fail=1; }
[ "$(echo "$TAKEN" | jq_get available)" = "false" ] && [ "$(echo "$TAKEN" | jq_get reason)" = "taken" ] \
  && echo "  ✓ existing handle → taken (case-insensitive: 'Basement' matches 'basement')" \
  || { echo "  ✗ taken: $TAKEN"; fail=1; }
[ "$(echo "$RESV" | jq_get reason)" = "reserved" ] \
  && echo "  ✓ reserved route handle 'dashboard' → reserved" || { echo "  ✗ reserved: $RESV"; fail=1; }
[ "$(echo "$SHORT" | jq_get reason)" = "too_short" ] \
  && echo "  ✓ 2-char handle → too_short" || { echo "  ✗ short: $SHORT"; fail=1; }

echo ""
echo "== 2. REGISTER with a valid SMS code → PENDING organizer + a real session =="
PHONE_A="0712000001"
OTP_A=$(curl -s -X POST "$BASE/api/otp/request" -H 'content-type: application/json' -d "{\"phone\":\"$PHONE_A\"}" | jq_get code)
[ -n "$OTP_A" ] && [ ${#OTP_A} = 6 ] || { echo "  ✗ no OTP echoed for $PHONE_A"; fail=1; }

R=$(curl -s -c "$SNAP/orga" -w '\n%{http_code}' -X POST "$BASE/api/org/register" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE_A\",\"code\":\"$OTP_A\",\"name\":\"Sunrise Collective\",\"handle\":\"sunrisecollective\",\"password\":\"sunrise-pass-1\"}")
RB=$(body_of "$R"); RC=$(code_of "$R")
[ "$RC" = "201" ] || [ "$RC" = "200" ] || { echo "  ✗ register → HTTP $RC: $RB"; fail=1; }
[ "$(echo "$RB" | jq_get status)" = "pending" ] && [ "$(echo "$RB" | jq_get kycStatus)" = "unverified" ] \
  && echo "  ✓ POST /api/org/register → status=pending kycStatus=unverified" \
  || { echo "  ✗ register body: $RB"; fail=1; }

ROW=$(psql_q "select status||'/'||kyc_status||'/'||source||'/'||phone from organizer where handle='sunrisecollective';")
[ "$ROW" = "pending/unverified/self-signup/255712000001" ] \
  && echo "  ✓ row landed: $ROW (phone normalized to the consumer MSISDN shape)" \
  || { echo "  ✗ organizer row: '$ROW'"; fail=1; }

# The password is hashed, never stored or echoed in the clear.
HASH=$(psql_q "select case when password_hash like '\$2%' then 'bcrypt' else coalesce(password_hash,'NULL') end from organizer where handle='sunrisecollective';")
[ "$HASH" = "bcrypt" ] && echo "  ✓ password stored as a bcrypt hash" || { echo "  ✗ password_hash=$HASH"; fail=1; }
echo "$RB" | grep -q 'passwordHash' && { echo "  ✗ register response leaked passwordHash"; fail=1; } \
  || echo "  ✓ register response carries no passwordHash"

# The minted cookie is the SAME shape /api/org/login mints — /api/org/me works.
ME=$(curl -s -b "$SNAP/orga" "$BASE/api/org/me")
[ "$(echo "$ME" | jq_get actingHandle)" = "sunrisecollective" ] \
  && [ "$(echo "$ME" | jq_get role)" = "organizer" ] \
  && [ "$(echo "$ME" | jq_get source)" = "self-signup" ] \
  && [ "$(echo "$ME" | jq_get status)" = "pending" ] \
  && echo "  ✓ the register cookie is a working organizer session (/api/org/me)" \
  || { echo "  ✗ /api/org/me: $ME"; fail=1; }

# And the password they chose actually signs them back in — no dead end.
LOGIN=$(code -X POST "$BASE/api/org/login" -H 'content-type: application/json' \
  -d '{"handle":"sunrisecollective","password":"sunrise-pass-1"}')
[ "$LOGIN" = "200" ] || [ "$LOGIN" = "201" ] \
  && echo "  ✓ they can sign back in at /api/org/login with the handle + password" \
  || { echo "  ✗ org login after register → $LOGIN"; fail=1; }

echo ""
echo "== 3. A CONSUMED code cannot be replayed =="
REPLAY=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/org/register" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE_A\",\"code\":\"$OTP_A\",\"name\":\"Copycat\",\"handle\":\"copycatcollective\",\"password\":\"copycat-pass-1\"}")
[ "$(code_of "$REPLAY")" = "401" ] && [ "$(body_of "$REPLAY" | jq_get error)" = "expired" ] \
  && echo "  ✓ replayed code → 401 expired" || { echo "  ✗ replay: $REPLAY"; fail=1; }
N_COPY=$(psql_q "select count(*) from organizer where handle='copycatcollective';")
[ "$N_COPY" = "0" ] && echo "  ✓ no organizer row created by the refused registration" \
  || { echo "  ✗ a row was created anyway"; fail=1; }

echo ""
echo "== 4. HANDLE COLLISION + RESERVED are refused — and do NOT burn the code =="
PHONE_B="0712000002"
OTP_B=$(curl -s -X POST "$BASE/api/otp/request" -H 'content-type: application/json' -d "{\"phone\":\"$PHONE_B\"}" | jq_get code)

# 'basement' (o3), not 'offshore' — offshore is BOTH a seeded handle and a
# reserved word, so it would prove the reserved branch, not the collision one.
DUP=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/org/register" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE_B\",\"code\":\"$OTP_B\",\"name\":\"Not Basement\",\"handle\":\"Basement\",\"password\":\"another-pass-1\"}")
[ "$(code_of "$DUP")" = "409" ] && [ "$(body_of "$DUP" | jq_get error)" = "handle_taken" ] \
  && echo "  ✓ taken handle → 409 handle_taken (normalized: 'Basement' collides with 'basement')" \
  || { echo "  ✗ collision: $DUP"; fail=1; }

RES=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/org/register" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE_B\",\"code\":\"$OTP_B\",\"name\":\"Squatter\",\"handle\":\"Dashboard\",\"password\":\"another-pass-1\"}")
[ "$(code_of "$RES")" = "400" ] && [ "$(body_of "$RES" | jq_get error)" = "handle_reserved" ] \
  && echo "  ✓ reserved handle → 400 handle_reserved (normalized: 'Dashboard')" \
  || { echo "  ✗ reserved: $RES"; fail=1; }

# 'storefront' is in the web middleware's RESERVED_TOP; the API list had to become
# a superset of it or the handle would be registrable and then unreachable.
RES2=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/org/register" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE_B\",\"code\":\"$OTP_B\",\"name\":\"Squatter Two\",\"handle\":\"storefront\",\"password\":\"another-pass-1\"}")
[ "$(body_of "$RES2" | jq_get error)" = "handle_reserved" ] \
  && echo "  ✓ middleware RESERVED_TOP entry 'storefront' is reserved server-side too" \
  || { echo "  ✗ storefront: $RES2"; fail=1; }

BADCODE=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/org/register" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE_B\",\"code\":\"000000\",\"name\":\"Wrong Code\",\"handle\":\"wrongcodeco\",\"password\":\"another-pass-1\"}")
[ "$(code_of "$BADCODE")" = "401" ] && [ "$(body_of "$BADCODE" | jq_get error)" = "wrong_code" ] \
  && echo "  ✓ wrong code → 401 wrong_code" || { echo "  ✗ bad code: $BADCODE"; fail=1; }

# THE POINT: after three refusals the ORIGINAL code still works. A typo'd handle
# must not cost the user a fresh SMS.
R2=$(curl -s -c "$SNAP/orgb" -w '\n%{http_code}' -X POST "$BASE/api/org/register" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE_B\",\"code\":\"$OTP_B\",\"name\":\"Night Market Co\",\"handle\":\"nightmarketco\",\"password\":\"night-pass-12\"}")
[ "$(body_of "$R2" | jq_get handle)" = "nightmarketco" ] \
  && echo "  ✓ the same code still registers after the refusals (validation runs BEFORE the OTP is consumed)" \
  || { echo "  ✗ register B: $R2"; fail=1; }

echo ""
echo "== 5. THE GATES — a pending org drafts, but cannot publish or withdraw =="
DRAFT=$(curl -s -b "$SNAP/orga" -X POST "$BASE/api/org/events" -H 'content-type: application/json' \
  -d '{"name":"Sunrise Vol. 1","sellable":false}')
DRAFT_ID=$(echo "$DRAFT" | jq_get id)
[ -n "$DRAFT_ID" ] && [ "$(echo "$DRAFT" | jq_get status)" = "draft" ] \
  && echo "  ✓ pending org CAN save a draft ($DRAFT_ID)" || { echo "  ✗ draft: $DRAFT"; fail=1; }

SELL=$(curl -s -b "$SNAP/orga" -w '\n%{http_code}' -X POST "$BASE/api/org/events" -H 'content-type: application/json' \
  -d '{"name":"Sunrise Sellable","dateLabel":"SAT 12 SEP 2026","city":"dar","venue":"The Roof","category":"party",
       "priceFrom":30000,"seated":false,"sellable":true,"tiers":[{"name":"GA","price":30000,"capacity":50}]}')
[ "$(code_of "$SELL")" = "403" ] && [ "$(body_of "$SELL" | jq_get error)" = "kyc_required" ] \
  && echo "  ✓ pending org CANNOT publish a sellable drop → 403 kyc_required (I6 catches self-signups)" \
  || { echo "  ✗ sellable while pending: $SELL"; fail=1; }

PUB_UP=$(curl -s -b "$SNAP/orga" -w '\n%{http_code}' -X PUT "$BASE/api/org/events/$DRAFT_ID" -H 'content-type: application/json' \
  -d '{"name":"Sunrise Vol. 1","dateLabel":"SAT 12 SEP 2026","city":"dar","venue":"The Roof","category":"party",
       "priceFrom":30000,"seated":false,"sellable":true,"tiers":[{"name":"GA","price":30000,"capacity":50}]}')
[ "$(code_of "$PUB_UP")" = "403" ] && [ "$(body_of "$PUB_UP" | jq_get error)" = "kyc_required" ] \
  && echo "  ✓ …and cannot publish the draft either (draft → published is gated too)" \
  || { echo "  ✗ draft publish while pending: $PUB_UP"; fail=1; }

PAYOUT=$(curl -s -b "$SNAP/orga" -w '\n%{http_code}' -X POST "$BASE/api/org/payouts" -H 'content-type: application/json' \
  -d '{"amount":10000,"currency":"TZS"}')
[ "$(body_of "$PAYOUT" | jq_get error)" = "not_verified" ] \
  && echo "  ✓ pending org CANNOT request a withdrawal → not_verified (#5 gates #7)" \
  || { echo "  ✗ payout while pending: $PAYOUT"; fail=1; }

echo ""
echo "== 6. THE QUEUE — one queue, marked self-signup, admin-only =="
Q=$(curl -s -b "$SNAP/admin" "$BASE/api/kyc/organizers")
[ "$(echo "$Q" | jq_get length)" = "2" ] || [ "$(echo "$Q" | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(a.length))')" = "2" ] \
  && echo "  ✓ both self-signups are in GET /api/kyc/organizers" || { echo "  ✗ queue: $Q"; fail=1; }
echo "$Q" | grep -q '"source":"self-signup"' \
  && echo "  ✓ each row carries the source:'self-signup' marker" || { echo "  ✗ no marker: $Q"; fail=1; }
echo "$Q" | grep -q '"phone":"255712000001"' \
  && echo "  ✓ the verified phone is on the row the reviewer decides from" || { echo "  ✗ no phone: $Q"; fail=1; }
echo "$Q" | grep -q 'password' && { echo "  ✗ queue leaked a password field"; fail=1; } \
  || echo "  ✓ the queue carries no password material"

ORG_Q=$(code -b "$SNAP/orga" "$BASE/api/kyc/organizers")
[ "$ORG_Q" = "401" ] && echo "  ✓ an ORGANIZER session cannot read the queue → 401" \
  || { echo "  ✗ organizer read the admin queue → $ORG_Q"; fail=1; }
ANON_APPROVE=$(code -X POST "$BASE/api/kyc/organizers/o-sunrisecollective/approve")
[ "$ANON_APPROVE" = "401" ] && echo "  ✓ anon cannot approve → 401" \
  || { echo "  ✗ anon approve → $ANON_APPROVE"; fail=1; }
ORG_APPROVE=$(code -b "$SNAP/orga" -X POST "$BASE/api/kyc/organizers/o-sunrisecollective/approve")
[ "$ORG_APPROVE" = "401" ] && echo "  ✓ an organizer cannot approve THEMSELVES → 401" \
  || { echo "  ✗ self-approve → $ORG_APPROVE"; fail=1; }

# The endpoint is for self-signups only — it is not a second way to flip any org.
STAFF=$(curl -s -b "$SNAP/admin" -w '\n%{http_code}' -X POST "$BASE/api/kyc/organizers/o1/approve")
[ "$(code_of "$STAFF")" = "400" ] && [ "$(body_of "$STAFF" | jq_get error)" = "not_a_self_signup" ] \
  && echo "  ✓ a staff-created org (o1) is refused here → 400 not_a_self_signup" \
  || { echo "  ✗ staff org approve: $STAFF"; fail=1; }

echo ""
echo "== 7. APPROVE → active/approved, effective WITHOUT a new login, publishing works =="
APP=$(curl -s -b "$SNAP/admin" -X POST "$BASE/api/kyc/organizers/o-sunrisecollective/approve")
[ "$(echo "$APP" | jq_get status)" = "active" ] && [ "$(echo "$APP" | jq_get kycStatus)" = "approved" ] \
  && echo "  ✓ approve → status=active kycStatus=approved" || { echo "  ✗ approve: $APP"; fail=1; }
DBROW=$(psql_q "select status||'/'||kyc_status||'/'||coalesce(reviewed_by,'?') from organizer where handle='sunrisecollective';")
[ "$DBROW" = "active/approved/admin" ] && echo "  ✓ the row records the decision + reviewer ($DBROW)" \
  || { echo "  ✗ row after approve: $DBROW"; fail=1; }

# The session cookie still says kycStatus:unverified — the gate must read the ROW,
# so an approval takes effect on the next request, not the next login.
ME_A=$(curl -s -b "$SNAP/orga" "$BASE/api/org/me")
[ "$(echo "$ME_A" | jq_get kycStatus)" = "approved" ] \
  && echo "  ✓ /api/org/me reports approved on the OLD cookie (no re-login needed)" \
  || { echo "  ✗ /api/org/me after approve: $ME_A"; fail=1; }

SELL2=$(curl -s -b "$SNAP/orga" -w '\n%{http_code}' -X POST "$BASE/api/org/events" -H 'content-type: application/json' \
  -d '{"name":"Sunrise Sellable","dateLabel":"SAT 12 SEP 2026","city":"dar","venue":"The Roof","category":"party",
       "priceFrom":30000,"seated":false,"sellable":true,"idempotencyKey":"sunrise-1",
       "tiers":[{"name":"GA","price":30000,"capacity":50}]}')
SELL_ID=$(body_of "$SELL2" | jq_get id)
[ "$(body_of "$SELL2" | jq_get status)" = "published" ] && [ -n "$SELL_ID" ] \
  && echo "  ✓ the SAME request that was 403 now publishes ($SELL_ID)" \
  || { echo "  ✗ publish after approve: $SELL2"; fail=1; }
# …and it is really provisioned, not just a blob edit.
N_POOL=$(psql_q "select count(*) from inventory_pool p join product_tier t on t.id=p.product_tier_id where t.event_id='$SELL_ID';")
[ "$N_POOL" = "1" ] && echo "  ✓ tickets are genuinely on sale (inventory_pool provisioned)" \
  || { echo "  ✗ inventory_pool rows=$N_POOL"; fail=1; }

echo ""
echo "== 8. REJECT → a reason, the existing KYC copy, and the gate stays shut =="
NORSN=$(curl -s -b "$SNAP/admin" -w '\n%{http_code}' -X POST "$BASE/api/kyc/organizers/o-nightmarketco/reject" \
  -H 'content-type: application/json' -d '{"note":"no reason code"}')
[ "$(code_of "$NORSN")" = "400" ] && [ "$(body_of "$NORSN" | jq_get error)" = "reason_required" ] \
  && echo "  ✓ reject without a standardized reason → 400 reason_required" \
  || { echo "  ✗ reject w/o reason: $NORSN"; fail=1; }

REJ=$(curl -s -b "$SNAP/admin" -X POST "$BASE/api/kyc/organizers/o-nightmarketco/reject" \
  -H 'content-type: application/json' -d '{"code":"name_mismatch","note":"phone owner ≠ trading name"}')
[ "$(echo "$REJ" | jq_get kycStatus)" = "rejected" ] && [ "$(echo "$REJ" | jq_get status)" = "pending" ] \
  && echo "  ✓ reject → kycStatus=rejected, status stays pending (a rejection is 'not yet', not a ban)" \
  || { echo "  ✗ reject: $REJ"; fail=1; }
RSN=$(psql_q "select verification_reason from organizer where handle='nightmarketco';")
case "$RSN" in name_mismatch*) echo "  ✓ the reason code + note are recorded ($RSN)";; *) echo "  ✗ verification_reason='$RSN'"; fail=1;; esac

ME_B=$(curl -s -b "$SNAP/orgb" "$BASE/api/org/me")
echo "$ME_B" | grep -q 'does not match your account' \
  && echo "  ✓ /api/org/me returns the EXISTING KYC reject copy for that code" \
  || { echo "  ✗ no user-facing reason: $ME_B"; fail=1; }
echo "$ME_B" | grep -q 'phone owner' && { echo "  ✗ the internal note leaked to the organizer"; fail=1; } \
  || echo "  ✓ the internal audit note is NOT shown to the organizer"

REJ_SELL=$(curl -s -b "$SNAP/orgb" -w '\n%{http_code}' -X POST "$BASE/api/org/events" -H 'content-type: application/json' \
  -d '{"name":"Night Market Sellable","dateLabel":"SAT 19 SEP 2026","city":"dar","venue":"Kariakoo","category":"party",
       "priceFrom":20000,"seated":false,"sellable":true,"tiers":[{"name":"GA","price":20000,"capacity":20}]}')
[ "$(code_of "$REJ_SELL")" = "403" ] \
  && echo "  ✓ a rejected org still cannot publish → 403" || { echo "  ✗ rejected publish: $REJ_SELL"; fail=1; }
REJ_DRAFT=$(curl -s -b "$SNAP/orgb" -X POST "$BASE/api/org/events" -H 'content-type: application/json' \
  -d '{"name":"Night Market Draft","sellable":false}')
REJ_DRAFT_ID=$(echo "$REJ_DRAFT" | jq_get id)
[ -n "$REJ_DRAFT_ID" ] && echo "  ✓ …but keeps drafting (their work is not destroyed)" \
  || { echo "  ✗ rejected draft: $REJ_DRAFT"; fail=1; }

# A rejected org can still be approved later — no second signup.
REAPP=$(curl -s -b "$SNAP/admin" -X POST "$BASE/api/kyc/organizers/o-nightmarketco/approve")
[ "$(echo "$REAPP" | jq_get kycStatus)" = "approved" ] && [ "$(echo "$REAPP" | jq_get rejection)" = "" ] \
  && echo "  ✓ a later approve clears the stale rejection reason" || { echo "  ✗ re-approve: $REAPP"; fail=1; }

echo ""
echo "== 9. CROSS-ORG ISOLATION =="
X_PUT=$(code -b "$SNAP/orgb" -X PUT "$BASE/api/org/events/$SELL_ID" -H 'content-type: application/json' -d '{"name":"Stolen"}')
[ "$X_PUT" = "404" ] && echo "  ✓ org B editing org A's drop → 404" || { echo "  ✗ cross-org PUT → $X_PUT"; fail=1; }
X_DEL=$(code -b "$SNAP/orga" -X DELETE "$BASE/api/org/events/$REJ_DRAFT_ID")
[ "$X_DEL" = "404" ] && echo "  ✓ org A deleting org B's draft → 404" || { echo "  ✗ cross-org DELETE → $X_DEL"; fail=1; }
A_EVENTS=$(curl -s -b "$SNAP/orga" "$BASE/api/org/events" | grep -c 'nightmarketco' || true)
[ "$A_EVENTS" = "0" ] && echo "  ✓ org A's event list contains nothing of org B's" \
  || { echo "  ✗ org A sees org B's events"; fail=1; }

echo ""
echo "== 10. AUDIT — every registration and decision is on the record =="
AUD=$(curl -s -b "$SNAP/admin" "$BASE/api/audit")
for act in org_self_register org_verify_approve org_verify_reject; do
  echo "$AUD" | grep -q "\"$act\"" && echo "  ✓ $act logged" || { echo "  ✗ $act missing from the audit trail"; fail=1; }
done

echo ""
echo "== 11. NO SHAPE DRIFT — GET /api/organizers still matches the golden fixture for seeded orgs =="
SEEDED=$(curl -s -b "$SNAP/admin" "$BASE/api/organizers" \
  | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(JSON.stringify(a.filter(o=>["o1","o2","o3","o4"].includes(o.id))))')
diff <(printf '%s' "$SEEDED") "$ROOT/db/test/golden/organizers.json" >/dev/null \
  && echo "  ✓ the four seeded organizers are byte-identical to golden/organizers.json" \
  || { echo "  ✗ /api/organizers drifted for seeded orgs"; diff <(printf '%s' "$SEEDED") "$ROOT/db/test/golden/organizers.json" | head -4; fail=1; }
curl -s -b "$SNAP/admin" "$BASE/api/organizers" | grep -q '"source":"self-signup"' \
  && echo "  ✓ …while self-registered orgs DO carry the source marker" \
  || { echo "  ✗ self-signup orgs are missing source in /api/organizers"; fail=1; }

echo ""
[ "$fail" = "0" ] || { echo "ORG REGISTER E2E: FAIL"; echo "---- api.log tail ----"; tail -30 "$SNAP/api.log"; exit 1; }
echo "ORG REGISTER E2E: PASS (handle availability · pending self-signup + session · collision/reserved/bad-code/replay refused without burning the code · drafts allowed, publish + withdraw gated · one admin queue with the self-signup marker · approve unlocks selling without a re-login · reject carries the KYC copy · cross-org isolation · audited · no response-shape drift)"
