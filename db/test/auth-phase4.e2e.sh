#!/usr/bin/env bash
# BS96 (auth Phase 4) — the management surfaces the model was missing. Boots the
# real API on a THROWAWAY local Postgres 17 (NEVER prod) and proves:
#
#   T1  VERIFY ANY organizer — PUT /api/admin/organizers/:id/verification (super_admin)
#       flips a SEEDED org's organizer.kyc_status via the SAME recordVerification the
#       self-signup queue uses, so the payout gate unlocks (GET /api/org/payouts
#       verified:false → true). Idempotent. Reject sets kyc_status=rejected + reason.
#   T2  CHANGE PASSWORD — POST /api/me/password: wrong current → 401; correct → 200,
#       and the new password logs the user in on BOTH the email path AND the legacy
#       handle path (the acting organizer.password_hash is mirrored). min 8 enforced.
#   T3  ADMIN LIST — GET /api/organizers carries each org's OWNER email + real
#       kyc_status (the identity behind the org + the truth, not the mock).
#   T4  GUARDS — the verify endpoint is super_admin-only (org session → 401/403,
#       anon → 401); a refused call never mutates verification.
#
# Self-contained (throwaway PG; XBRIDGE_MOCK; OTP_ECHO; EMAIL_DRIVER=mock). bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55496}"
API_PORT="${TEST_API_PORT:-4196}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-authp4-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-authp4snap-XXXXXX")"
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

echo "== throwaway Postgres @ :$PG_PORT + migrate + seed entities =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_authp4
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_authp4"
Q() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_authp4 -c "$1" | tr -d '[:space:]'; }

DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

echo "== boot API (XBRIDGE_MOCK, OTP_ECHO, EMAIL_DRIVER=mock) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    OTP_ECHO=true EMAIL_DRIVER=mock SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
jq_get() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=Array.isArray(v)&&/^\d+$/.test(p)?v[+p]:v?.[p];process.stdout.write(v==null?"":String(v))}catch{process.stdout.write("ERR:"+s.slice(0,160))}})' "$1"; }
# extract a field from the /api/organizers array for a given id: field_for_id <id> <field>
field_for_id() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const r=a.find(x=>x.id===process.argv[1]);process.stdout.write(r==null?"NOROW":(r[process.argv[2]]==null?"null":String(r[process.argv[2]])))}catch{process.stdout.write("ERR")}})' "$1" "$2"; }

# admin session (isAdmin → super_admin in the RBAC guard).
al=$(curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}')
[ "$al" = '{"ok":true}' ] || { echo "  ✗ admin login: $al"; fail=1; }

echo ""
echo "== T1 — verify ANY organizer (seeded o1, kyc_status NULL) unlocks the payout gate =="
K0="$(Q "select coalesce(kyc_status,'NULL') from organizer where id='o1';")"
[ "$K0" = "NULL" ] && echo "  ✓ o1 (thebrunchcity) starts kyc_status NULL — the reported bug" || echo "  · o1 kyc_status starts: $K0"

# payout gate BEFORE approval (admin impersonates o1 → GET /api/org/payouts).
curl -s -b "$SNAP/admin" -c "$SNAP/admin" -X POST "$BASE/api/organizers/o1/impersonate" >/dev/null
V0=$(curl -s -b "$SNAP/admin" "$BASE/api/org/payouts" | jq_get verified)
[ "$V0" = "false" ] && echo "  ✓ payout gate LOCKED before approval (verified:false)" || { echo "  ✗ pre-approval verified: $V0 (want false)"; fail=1; }
curl -s -b "$SNAP/admin" -c "$SNAP/admin" -X POST "$BASE/api/impersonate/exit" >/dev/null

# approve o1 via the super-admin verify-any-org endpoint.
AP=$(curl -s -b "$SNAP/admin" -w '\n%{http_code}' -X PUT "$BASE/api/admin/organizers/o1/verification" -H 'content-type: application/json' -d '{"decision":"approve"}')
APB=$(printf '%s' "$AP" | sed '$d'); APC=$(printf '%s' "$AP" | tail -1)
[ "$APC" = "200" ] && [ "$(echo "$APB" | jq_get kycStatus)" = "approved" ] && echo "  ✓ approve → 200 kycStatus:approved" || { echo "  ✗ approve: $AP"; fail=1; }
ROW="$(Q "select status||'/'||kyc_status from organizer where id='o1';")"
[ "$ROW" = "active/approved" ] && echo "  ✓ o1 row now active/approved (organizer.kyc_status flipped)" || { echo "  ✗ o1 row: $ROW"; fail=1; }

# payout gate AFTER approval — the SAME check now unlocked.
curl -s -b "$SNAP/admin" -c "$SNAP/admin" -X POST "$BASE/api/organizers/o1/impersonate" >/dev/null
V1=$(curl -s -b "$SNAP/admin" "$BASE/api/org/payouts" | jq_get verified)
[ "$V1" = "true" ] && echo "  ✓ payout gate UNLOCKED after approval (verified:true)" || { echo "  ✗ post-approval verified: $V1 (want true)"; fail=1; }
curl -s -b "$SNAP/admin" -c "$SNAP/admin" -X POST "$BASE/api/impersonate/exit" >/dev/null

# idempotent: approving again stays approved.
AP2=$(curl -s -b "$SNAP/admin" -X PUT "$BASE/api/admin/organizers/o1/verification" -H 'content-type: application/json' -d '{"decision":"approve"}')
[ "$(echo "$AP2" | jq_get kycStatus)" = "approved" ] && echo "  ✓ re-approve is idempotent (still approved)" || { echo "  ✗ idempotent: $AP2"; fail=1; }

# reject o2 with a reason.
RJ=$(curl -s -b "$SNAP/admin" -X PUT "$BASE/api/admin/organizers/o2/verification" -H 'content-type: application/json' -d '{"decision":"reject","reason":"missing_docs"}')
[ "$(echo "$RJ" | jq_get kycStatus)" = "rejected" ] && echo "  ✓ reject → kycStatus:rejected" || { echo "  ✗ reject: $RJ"; fail=1; }
RR="$(Q "select kyc_status||'/'||coalesce(verification_reason,'') from organizer where id='o2';")"
[ "$RR" = "rejected/missing_docs" ] && echo "  ✓ o2 rejected with reason stored" || { echo "  ✗ o2 row: $RR"; fail=1; }

# invalid decision → 400, unknown org → 404.
c=$(code -b "$SNAP/admin" -X PUT "$BASE/api/admin/organizers/o1/verification" -H 'content-type: application/json' -d '{"decision":"maybe"}')
[ "$c" = "400" ] && echo "  ✓ invalid decision → 400" || { echo "  ✗ invalid decision → $c (want 400)"; fail=1; }
c=$(code -b "$SNAP/admin" -X PUT "$BASE/api/admin/organizers/o-nope/verification" -H 'content-type: application/json' -d '{"decision":"approve"}')
[ "$c" = "404" ] && echo "  ✓ unknown org → 404" || { echo "  ✗ unknown org → $c (want 404)"; fail=1; }

echo ""
echo "== T2 — POST /api/me/password (change + mirror; email + handle login) =="
FOUNDER="founder@sunrise.co"
OTP=$(curl -s -X POST "$BASE/api/otp/request" -H 'content-type: application/json' -d '{"phone":"0713000001"}' | jq_get code)
curl -s -X POST "$BASE/api/org/register" -H 'content-type: application/json' \
  -d "{\"phone\":\"0713000001\",\"code\":\"$OTP\",\"name\":\"Sunrise HQ\",\"handle\":\"sunrisehq\",\"email\":\"$FOUNDER\",\"password\":\"sunrise-pass-1\"}" >/dev/null
LG=$(curl -s -c "$SNAP/owner" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d "{\"identifier\":\"$FOUNDER\",\"password\":\"sunrise-pass-1\"}")
[ "$LG" = '{"ok":true}' ] && echo "  ✓ owner logged in (session with userId + acting org)" || { echo "  ✗ owner login: $LG"; fail=1; }

# wrong current → 401.
c=$(code -b "$SNAP/owner" -X POST "$BASE/api/me/password" -H 'content-type: application/json' -d '{"currentPassword":"WRONG","newPassword":"newsecret9"}')
[ "$c" = "401" ] && echo "  ✓ wrong current password → 401" || { echo "  ✗ wrong current → $c (want 401)"; fail=1; }
# too short → 400.
c=$(code -b "$SNAP/owner" -X POST "$BASE/api/me/password" -H 'content-type: application/json' -d '{"currentPassword":"sunrise-pass-1","newPassword":"short"}')
[ "$c" = "400" ] && echo "  ✓ new password < 8 chars → 400" || { echo "  ✗ short password → $c (want 400)"; fail=1; }
# anon → 401.
c=$(code -X POST "$BASE/api/me/password" -H 'content-type: application/json' -d '{"currentPassword":"x","newPassword":"newsecret9"}')
[ "$c" = "401" ] && echo "  ✓ unauthenticated → 401" || { echo "  ✗ anon → $c (want 401)"; fail=1; }

# correct → 200.
CP=$(curl -s -b "$SNAP/owner" -X POST "$BASE/api/me/password" -H 'content-type: application/json' -d '{"currentPassword":"sunrise-pass-1","newPassword":"newsecret9"}')
[ "$CP" = '{"ok":true}' ] && echo "  ✓ correct current → password changed" || { echo "  ✗ change: $CP"; fail=1; }

# old password no longer works.
c=$(code -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d "{\"identifier\":\"$FOUNDER\",\"password\":\"sunrise-pass-1\"}")
[ "$c" = "401" ] && echo "  ✓ old password rejected after change" || { echo "  ✗ old password still works → $c"; fail=1; }
# new password logs in by EMAIL …
LE=$(curl -s -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d "{\"identifier\":\"$FOUNDER\",\"password\":\"newsecret9\"}")
[ "$LE" = '{"ok":true}' ] && echo "  ✓ new password logs in by EMAIL" || { echo "  ✗ email login: $LE"; fail=1; }
# … and by the legacy HANDLE path (organizer.password_hash mirrored → same login).
LH=$(curl -s -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"identifier":"sunrisehq","password":"newsecret9"}')
[ "$LH" = '{"ok":true}' ] && echo "  ✓ new password logs in by HANDLE" || { echo "  ✗ handle login: $LH"; fail=1; }
# the acting organizer.password_hash was mirrored (not left stale).
MIR="$(Q "select case when password_hash is null then 'NULL' else 'set' end from organizer where id='o-sunrisehq';")"
[ "$MIR" = "set" ] && echo "  ✓ organizer.password_hash mirrored on the acting org" || { echo "  ✗ mirror: $MIR"; fail=1; }

echo ""
echo "== T3 — GET /api/organizers carries owner email + real kyc_status =="
LIST=$(curl -s -b "$SNAP/admin" "$BASE/api/organizers")
SUNOWN=$(printf '%s' "$LIST" | field_for_id o-sunrisehq owner)
[ "$SUNOWN" = "$FOUNDER" ] && echo "  ✓ o-sunrisehq owner = $FOUNDER" || { echo "  ✗ sunrise owner: $SUNOWN (want $FOUNDER)"; fail=1; }
SUNCNT=$(printf '%s' "$LIST" | field_for_id o-sunrisehq memberCount)
[ "$SUNCNT" = "1" ] && echo "  ✓ o-sunrisehq memberCount = 1" || { echo "  ✗ sunrise memberCount: $SUNCNT (want 1)"; fail=1; }
O1KYC=$(printf '%s' "$LIST" | field_for_id o1 kycStatus)
[ "$O1KYC" = "approved" ] && echo "  ✓ o1 kycStatus = approved (real, post-T1)" || { echo "  ✗ o1 kycStatus: $O1KYC (want approved)"; fail=1; }
O1OWN=$(printf '%s' "$LIST" | field_for_id o1 owner)
[ "$O1OWN" = "null" ] && echo "  ✓ o1 owner = null (no app_user yet — the 'no user tied' case surfaces)" || { echo "  ✗ o1 owner: $O1OWN (want null)"; fail=1; }

echo ""
echo "== T4 — verify endpoint is super_admin-only =="
# the owner session ($SNAP/owner) is a user/owner, NOT a super_admin.
c=$(code -b "$SNAP/owner" -X PUT "$BASE/api/admin/organizers/o3/verification" -H 'content-type: application/json' -d '{"decision":"approve"}')
{ [ "$c" = "401" ] || [ "$c" = "403" ]; } && echo "  ✓ org session PUT .../verification → $c" || { echo "  ✗ org session verify → $c (want 401/403)"; fail=1; }
c=$(code -X PUT "$BASE/api/admin/organizers/o3/verification" -H 'content-type: application/json' -d '{"decision":"approve"}')
[ "$c" = "401" ] && echo "  ✓ anon PUT .../verification → 401" || { echo "  ✗ anon verify → $c (want 401)"; fail=1; }
# o3 was never approved by the refused calls.
O3="$(Q "select coalesce(kyc_status,'NULL') from organizer where id='o3';")"
[ "$O3" = "NULL" ] && echo "  ✓ o3 verification untouched by refused calls" || { echo "  ✗ o3 kyc_status changed: $O3"; fail=1; }

echo ""
[ "$fail" = "0" ] || { echo "AUTH PHASE 4 E2E: FAIL"; echo "--- api.log tail ---"; tail -25 "$SNAP/api.log"; exit 1; }
echo "AUTH PHASE 4 E2E: PASS (T1 verify-any-org flips kyc_status + unlocks payout gate, idempotent, reject+reason · T2 change-password 401/400/anon guards + email & handle login on the new (mirrored) password · T3 admin list owner+kyc_status · T4 verify super_admin-only)"
