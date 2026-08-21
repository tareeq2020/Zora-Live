#!/usr/bin/env bash
# BS92 (auth Phase 1) — failure mode 3: approving via EITHER KYC queue flips
# organizer.kyc_status, so the payout + publish gates unlock and the admin can no
# longer diverge from the gate. Boots the REAL API on a THROWAWAY local Postgres 17
# (never prod), over real HTTP. Mirrors db/test/org-register.e2e.sh.
#
#   Path A — the ORGANIZER queue (POST /api/kyc/organizers/:id/approve): already
#            routed through recordVerification; asserted here for parity.
#   Path B — the IDENTITY-DOCUMENT queue (POST /api/kyc/:id/approve): the fix — the
#            record now carries the submitting org's handle, and approve routes it
#            through the SAME recordVerification transition.
#   Path C — an identity record with NO org link (predates the fix) is FLAGGED
#            (audit kyc_org_link_missing), the document still approves, but no org is
#            silently changed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55472}"
API_PORT="${TEST_API_PORT:-4127}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-kycver-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-kycversnap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers organizers audit admin events kyc"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_kycver
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_kycver"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

psql_q() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_kycver -c "$1"; }

echo "== boot API (XBRIDGE_MOCK + OTP_ECHO) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    OTP_ECHO=true SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
jq_get() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=Array.isArray(v)&&/^\d+$/.test(p)?v[+p]:v?.[p];process.stdout.write(v==null?"":Array.isArray(v)?String(v.length):String(v))}catch{process.stdout.write("ERR:"+s.slice(0,160))}})' "$1"; }
body_of() { printf '%s' "$1" | sed '$d'; }
code_of() { printf '%s' "$1" | tail -1; }

# admin session (backfilled from data/admin.json — password 'zora2026')
curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"zora2026"}' >/dev/null

# Register a self-signup org, echo its cookie jar path + handle. Returns handle.
register() { # register <jar> <handle> <phone>
  local jar="$1" handle="$2" phone="$3"
  local otp
  otp=$(curl -s -X POST "$BASE/api/otp/request" -H 'content-type: application/json' -d "{\"phone\":\"$phone\"}" | jq_get code)
  curl -s -c "$jar" -X POST "$BASE/api/org/register" -H 'content-type: application/json' \
    -d "{\"phone\":\"$phone\",\"code\":\"$otp\",\"name\":\"$handle\",\"handle\":\"$handle\",\"password\":\"pass-word-12\"}" >/dev/null
}

echo ""
echo "== setup — two pending self-signup orgs (A via org queue, B via identity queue) =="
register "$SNAP/orga" "orgqueueco" "0712000101"
register "$SNAP/orgb" "identityco" "0712000102"
A_STATUS=$(psql_q "select kyc_status from organizer where handle='orgqueueco';" | tr -d '[:space:]')
B_STATUS=$(psql_q "select kyc_status from organizer where handle='identityco';" | tr -d '[:space:]')
[ "$A_STATUS" = "unverified" ] && [ "$B_STATUS" = "unverified" ] \
  && echo "  ✓ both orgs start kyc_status=unverified (gates locked)" || { echo "  ✗ A=$A_STATUS B=$B_STATUS"; fail=1; }

# A sellable-publish attempt used as the gate probe for a given org cookie.
publish_probe() { # publish_probe <jar> <name>
  curl -s -b "$1" -w '\n%{http_code}' -X POST "$BASE/api/org/events" -H 'content-type: application/json' \
    -d "{\"name\":\"$2\",\"dateLabel\":\"SAT 12 SEP 2026\",\"city\":\"dar\",\"venue\":\"The Roof\",\"category\":\"party\",\"priceFrom\":30000,\"seated\":false,\"sellable\":true,\"idempotencyKey\":\"$2\",\"tiers\":[{\"name\":\"GA\",\"price\":30000,\"capacity\":50}]}"
}
payout_probe() { curl -s -b "$1" -w '\n%{http_code}' -X POST "$BASE/api/org/payouts" -H 'content-type: application/json' -d '{"amount":10000,"currency":"TZS"}'; }

echo ""
echo "== PATH A — approve via the ORGANIZER queue flips the gate =="
A_PUB0=$(publish_probe "$SNAP/orga" "A Locked")
[ "$(body_of "$A_PUB0" | jq_get error)" = "kyc_required" ] && echo "  ✓ before: publish → 403 kyc_required" || { echo "  ✗ A publish pre: $A_PUB0"; fail=1; }
A_PAY0=$(payout_probe "$SNAP/orga")
[ "$(body_of "$A_PAY0" | jq_get error)" = "not_verified" ] && echo "  ✓ before: payout → not_verified" || { echo "  ✗ A payout pre: $A_PAY0"; fail=1; }

APP_A=$(curl -s -b "$SNAP/admin" -X POST "$BASE/api/kyc/organizers/o-orgqueueco/approve")
[ "$(echo "$APP_A" | jq_get kycStatus)" = "approved" ] && echo "  ✓ org-queue approve → kycStatus=approved" || { echo "  ✗ org approve: $APP_A"; fail=1; }
A_ROW=$(psql_q "select kyc_status from organizer where handle='orgqueueco';" | tr -d '[:space:]')
[ "$A_ROW" = "approved" ] && echo "  ✓ organizer.kyc_status='approved' in the DB" || { echo "  ✗ A row=$A_ROW"; fail=1; }
A_PUB1=$(publish_probe "$SNAP/orga" "A Unlocked")
[ "$(body_of "$A_PUB1" | jq_get status)" = "published" ] && echo "  ✓ after: the SAME publish now succeeds" || { echo "  ✗ A publish post: $A_PUB1"; fail=1; }
A_PAY1=$(payout_probe "$SNAP/orga")
[ "$(body_of "$A_PAY1" | jq_get error)" != "not_verified" ] && echo "  ✓ after: payout no longer not_verified" || { echo "  ✗ A payout post: $A_PAY1"; fail=1; }

echo ""
echo "== PATH B — approve via the IDENTITY-DOCUMENT queue flips the SAME gate (the fix) =="
# Seed an identity KYC record LINKED to org B (organizerHandle stamped at submit).
# We insert the blob directly (the upload path needs Supabase; the gate flip does not).
psql_q "update collection_store set data='[{\"id\":\"recB0001\",\"ref\":\"KYC-B\",\"status\":\"submitted\",\"organizerHandle\":\"identityco\",\"idType\":\"passport\",\"country\":\"TZ\",\"fullName\":\"Ida N. Tity\",\"documents\":[],\"events\":[]}]' where name='kyc';" >/dev/null
B_PUB0=$(publish_probe "$SNAP/orgb" "B Locked")
[ "$(body_of "$B_PUB0" | jq_get error)" = "kyc_required" ] && echo "  ✓ before: publish → 403 kyc_required" || { echo "  ✗ B publish pre: $B_PUB0"; fail=1; }

# The identity record is in the admin queue, carrying its org link.
Q=$(curl -s -b "$SNAP/admin" "$BASE/api/kyc")
echo "$Q" | grep -q '"organizerHandle":"identityco"' && echo "  ✓ the identity record carries organizerHandle=identityco" || { echo "  ✗ queue: $Q"; fail=1; }

APP_B=$(curl -s -b "$SNAP/admin" -X POST "$BASE/api/kyc/recB0001/approve")
[ "$(echo "$APP_B" | jq_get status)" = "approved" ] && echo "  ✓ identity-doc approve → record status=approved" || { echo "  ✗ B approve: $APP_B"; fail=1; }
B_ROW=$(psql_q "select kyc_status||'/'||coalesce(reviewed_by,'?') from organizer where handle='identityco';" | tr -d '[:space:]')
[ "$B_ROW" = "approved/admin" ] && echo "  ✓ organizer.kyc_status flipped to 'approved' by the DOCUMENT approve" || { echo "  ✗ B row=$B_ROW (the divergence would leave this 'unverified')"; fail=1; }
B_PUB1=$(publish_probe "$SNAP/orgb" "B Unlocked")
[ "$(body_of "$B_PUB1" | jq_get status)" = "published" ] && echo "  ✓ after: publish now succeeds (gate unlocked via the identity queue)" || { echo "  ✗ B publish post: $B_PUB1"; fail=1; }
B_PAY1=$(payout_probe "$SNAP/orgb")
[ "$(body_of "$B_PAY1" | jq_get error)" != "not_verified" ] && echo "  ✓ after: payout no longer not_verified" || { echo "  ✗ B payout post: $B_PAY1"; fail=1; }

echo ""
echo "== PATH C — an UNLINKED identity record is flagged, never guessed =="
psql_q "update collection_store set data='[{\"id\":\"recC0001\",\"ref\":\"KYC-C\",\"status\":\"submitted\",\"organizerHandle\":null,\"idType\":\"passport\",\"country\":\"TZ\",\"fullName\":\"Orphan Doc\",\"documents\":[],\"events\":[]}]' where name='kyc';" >/dev/null
APP_C=$(curl -s -b "$SNAP/admin" -X POST "$BASE/api/kyc/recC0001/approve")
[ "$(echo "$APP_C" | jq_get status)" = "approved" ] && echo "  ✓ the document still approves" || { echo "  ✗ C approve: $APP_C"; fail=1; }
AUD=$(curl -s -b "$SNAP/admin" "$BASE/api/audit")
echo "$AUD" | grep -q 'kyc_org_link_missing' && echo "  ✓ the missing org link is FLAGGED in the audit trail (no org guessed)" || { echo "  ✗ no kyc_org_link_missing audit entry"; fail=1; }

echo ""
[ "$fail" = "0" ] || { echo "KYC VERIFICATION E2E: FAIL"; echo "---- api.log tail ----"; tail -30 "$SNAP/api.log"; exit 1; }
echo "KYC VERIFICATION E2E: PASS (failure mode 3 — BOTH KYC queues flip organizer.kyc_status → payout+publish unlock; unlinkable records flagged, never guessed)"
