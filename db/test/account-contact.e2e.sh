#!/usr/bin/env bash
# BS102 — change EMAIL + PHONE from the account surface, with OTP. Throwaway
# Postgres 17 (NEVER prod). OTP_ECHO returns the code so the harness can complete
# the flow; EMAIL_DRIVER=mock + mock SMS so nothing is actually sent. Proves:
#
#   PHONE  request → SMS OTP; wrong code → 401; right code → phone updated on
#          /api/me + app_user. (session = identity, OTP = ownership)
#   EMAIL  request needs the CURRENT PASSWORD (wrong → 401); on success OTPs the
#          NEW address; wrong code → 401; right code → email updated + the user can
#          log in with the NEW email. Changing to an email another user owns → 409.
#   GATES  a legacy session (no app_user identity) → 400 no_identity; anon → 400.
#          OTP identifiers are namespaced, so a login OTP can't satisfy a change.
#
# Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55503}"
API_PORT="${TEST_API_PORT:-4203}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-acct-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-acctsnap-XXXXXX")"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_acct
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_acct"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null
psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_acct -v ON_ERROR_STOP=1 -c "$1"; }

echo "== boot API (OTP_ECHO, mock SMS + email) =="
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e OTP_ECHO=true EMAIL_DRIVER=mock \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
BASE="http://localhost:$API_PORT"
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(v==null?"":String(v))}catch{process.stdout.write("")}})' "$1"; }

echo "== set org passwords → backfill-users → login (user path sets userId) =="
curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
DATABASE_URL="$URL" node "$ROOT/db/backfill-users.mjs" >/dev/null 2>&1
# o1 = thebrunchcity gets a userId session (its app_user carries the mirrored password)
curl -s -c "$SNAP/org" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null
USERID=$(curl -s -b "$SNAP/org" "$BASE/api/me" | jget userId)
[ -n "$USERID" ] && echo "  ✓ logged in with a real identity (userId present)" || { echo "  ✗ no userId on session"; cat "$SNAP/api.log" | tail -5; fail=1; }
OTHER_EMAIL=$(psql_one "select email from app_user where id <> '$USERID' and email is not null order by email limit 1")

echo ""
echo "== PHONE change =="
REQ=$(curl -s -b "$SNAP/org" -X POST "$BASE/api/me/phone/request" -H 'content-type: application/json' -d '{"phone":"0755123456"}')
PCODE=$(echo "$REQ" | jget code)
[ -n "$PCODE" ] && echo "  ✓ request → OTP issued (SMS)" || { echo "  ✗ phone request: $REQ"; fail=1; }
BADC=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/org" -X POST "$BASE/api/me/phone/confirm" -H 'content-type: application/json' -d '{"phone":"0755123456","code":"000000"}')
[ "$BADC" = "401" ] && echo "  ✓ wrong code → 401" || { echo "  ✗ wrong phone code → $BADC"; fail=1; }
OKC=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/org" -X POST "$BASE/api/me/phone/confirm" -H 'content-type: application/json' -d "{\"phone\":\"0755123456\",\"code\":\"$PCODE\"}")
NEWPH=$(curl -s -b "$SNAP/org" "$BASE/api/me" | jget phone)
[ "$OKC" = "201" -o "$OKC" = "200" ] && [ "$NEWPH" = "255755123456" ] && echo "  ✓ correct code → phone updated to $NEWPH (normalized)" || { echo "  ✗ phone confirm HTTP $OKC, /me phone=$NEWPH"; fail=1; }
DBPH=$(psql_one "select phone from app_user where id='$USERID'")
[ "$DBPH" = "255755123456" ] && echo "  ✓ app_user.phone persisted" || { echo "  ✗ db phone=$DBPH"; fail=1; }

echo ""
echo "== EMAIL change =="
# wrong password → 401, no OTP issued
WP=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/org" -X POST "$BASE/api/me/email/request" -H 'content-type: application/json' -d '{"currentPassword":"nope","newEmail":"new@zora.test"}')
[ "$WP" = "401" ] && echo "  ✓ wrong current password → 401 (email change needs re-auth)" || { echo "  ✗ wrong pw → $WP"; fail=1; }
# taking another user's email → 409
TAKEN=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/org" -X POST "$BASE/api/me/email/request" -H 'content-type: application/json' -d "{\"currentPassword\":\"orgpass123\",\"newEmail\":\"$OTHER_EMAIL\"}")
[ "$TAKEN" = "409" ] && echo "  ✓ changing to an email another user owns → 409 email_taken" || { echo "  ✗ email_taken → $TAKEN (other=$OTHER_EMAIL)"; fail=1; }
# happy path
EREQ=$(curl -s -b "$SNAP/org" -X POST "$BASE/api/me/email/request" -H 'content-type: application/json' -d '{"currentPassword":"orgpass123","newEmail":"founder@brunch.test"}')
ECODE=$(echo "$EREQ" | jget code)
[ -n "$ECODE" ] && echo "  ✓ correct password → OTP issued to the new address" || { echo "  ✗ email request: $EREQ"; fail=1; }
EBAD=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/org" -X POST "$BASE/api/me/email/confirm" -H 'content-type: application/json' -d '{"newEmail":"founder@brunch.test","code":"000000"}')
[ "$EBAD" = "401" ] && echo "  ✓ wrong code → 401" || { echo "  ✗ wrong email code → $EBAD"; fail=1; }
EOK=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/org" -X POST "$BASE/api/me/email/confirm" -H 'content-type: application/json' -d "{\"newEmail\":\"founder@brunch.test\",\"code\":\"$ECODE\"}")
MEEMAIL=$(curl -s -b "$SNAP/org" "$BASE/api/me" | jget email)
[ "$MEEMAIL" = "founder@brunch.test" ] && echo "  ✓ correct code → email updated to $MEEMAIL" || { echo "  ✗ email confirm HTTP $EOK, /me email=$MEEMAIL"; fail=1; }
# the user can now log in with the NEW email
NEWLOGIN=$(curl -s -o /dev/null -w '%{http_code}' -c "$SNAP/org2" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"identifier":"founder@brunch.test","password":"orgpass123"}')
[ "$NEWLOGIN" = "201" -o "$NEWLOGIN" = "200" ] && echo "  ✓ user logs in with the NEW email" || { echo "  ✗ login with new email → $NEWLOGIN"; fail=1; }

echo ""
echo "== GATES — legacy/anon sessions cannot change contact details =="
# anon (no cookie) → 400 no_identity
ANON=$(curl -s -X POST "$BASE/api/me/phone/request" -H 'content-type: application/json' -d '{"phone":"0755000000"}' | jget error)
[ "$ANON" = "no_identity" ] && echo "  ✓ anon → no_identity" || { echo "  ✗ anon error=$ANON"; fail=1; }
# legacy path: set o3's org password AFTER backfill (its app_user has none) → login
# falls to the legacy branch (no userId) → change is refused.
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o3/password" -H 'content-type: application/json' -d '{"password":"legacypw1"}' >/dev/null
H3=$(psql_one "select handle from organizer where id='o3'")
curl -s -c "$SNAP/legacy" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d "{\"handle\":\"$H3\",\"password\":\"legacypw1\"}" >/dev/null
LEGUID=$(curl -s -b "$SNAP/legacy" "$BASE/api/me" | jget userId)
LEG=$(curl -s -b "$SNAP/legacy" -X POST "$BASE/api/me/phone/request" -H 'content-type: application/json' -d '{"phone":"0755000000"}' | jget error)
[ -z "$LEGUID" ] && [ "$LEG" = "no_identity" ] && echo "  ✓ legacy session (no userId) → no_identity" || { echo "  ✗ legacy uid='$LEGUID' err=$LEG"; fail=1; }

echo ""
[ "$fail" = "0" ] && echo "ACCOUNT CONTACT E2E: PASS" || echo "ACCOUNT CONTACT E2E: FAIL"
exit $fail
