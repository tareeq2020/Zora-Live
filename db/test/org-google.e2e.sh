#!/usr/bin/env bash
# BS148 organizer Google sign-in (sign in + sign up), on the SAME callback as BS141.
# Google itself is never reached: we test up to the token exchange, and hand-mint
# the signup ticket (HMAC with the e2e SESSION_SECRET) to drive the register path.
#   1. migration 0034 landed (app_user.google_sub + partial unique index)
#   2. start?intent=org|signup carries the intent (and a sanitized next) in the signed state
#   3. open-redirect `next` values are dropped from the state
#   4. google_off / forged state / mismatched state → the ORGANIZER login page
#   5. a genuine org state passes verification and reaches the token exchange
#   6. admin path unchanged (no intent → admin state, admin error page, password login)
#   7. /api/org/google-signup + /api/org/register lock the email to the ticket and store google_sub
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_PORT="${TEST_PG_PORT:-55748}"; API_PORT="${TEST_API_PORT:-4268}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-og-XXXXXX")"; LOG="$(mktemp)"; JAR="$(mktemp)"; USER_NAME="$(whoami)"; fail=0
cleanup() { lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA" "$JAR"; }
trap cleanup EXIT
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_og
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_og"
PSQL() { psql -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_og -tAc "$1"; }
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" settings admin tiers organizers audit >/dev/null
boot() { lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
  ( cd "$ROOT/apps/api" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true OTP_ECHO=true SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=k PUBLIC_WEB_ORIGIN=https://zorapass.test "$@" node dist/main.js ) >"$LOG" 2>&1 &
  for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done; }
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1 → $2"; else echo "  ✗ $1 → $2 (want $3)"; fail=1; fi; }
loc() { sed -E 's#^https?://[^/]*##'; }
# decode the payload (2nd dot-part) of a state value → its JSON
payload() { node -e 'const s=decodeURIComponent(process.argv[1]).split(".")[1]||"";process.stdout.write(Buffer.from(s,"base64url").toString())' "$1"; }
A="http://localhost:$API_PORT/api"; B="$A/auth/google"

echo "== migration 0034 =="
check "app_user.google_sub column" "$(PSQL "select count(*) from information_schema.columns where table_name='app_user' and column_name='google_sub'")" 1
check "google_sub unique index" "$(PSQL "select count(*) from pg_indexes where indexname='app_user_google_sub_uq'")" 1

echo "== google off =="
boot
check "org start off → dashboard login" "$(curl -s -o /dev/null -w '%{redirect_url}' "$B/start?intent=org" | loc)" "/dashboard/login?error=google_off"
check "signup start off → signup page" "$(curl -s -o /dev/null -w '%{redirect_url}' "$B/start?intent=signup" | loc)" "/dashboard/signup?error=google_off"
check "admin start off unchanged" "$(curl -s -o /dev/null -w '%{redirect_url}' "$B/start" | loc)" "/admin/login?error=google_off"

echo "== google on: start carries intent in the signed state =="
boot GOOGLE_CLIENT_ID=cid.apps.googleusercontent.com GOOGLE_CLIENT_SECRET=sec
check "config on" "$(curl -s $B/config)" '{"enabled":true}'
H=$(curl -s -D - -o /dev/null "$B/start?intent=org&next=%2Fdashboard%2Fevents")
L=$(echo "$H" | grep -i '^location:' | tr -d '\r')
ST=$(echo "$L" | grep -o 'state=[^&]*' | cut -d= -f2)
CK=$(echo "$H" | grep -i '^set-cookie: zora_g_state=' | sed 's/^[Ss]et-[Cc]ookie: zora_g_state=//; s/;.*//' | tr -d '\r')
check "org start → google" "$(echo "$L" | grep -o 'accounts.google.com' | head -1)" accounts.google.com
check "same callback redirect_uri" "$(echo "$L" | grep -c 'redirect_uri=https%3A%2F%2Fzorapass.test%2Fapi%2Fauth%2Fgoogle%2Fcallback')" 1
check "state payload = org + next" "$(payload "$ST")" '{"i":"org","n":"/dashboard/events"}'
check "state cookie = state + mac" "$(echo "$CK" | awk -F. '{print NF}')" 3
check "state cookie httpOnly, path /api/auth/google" "$(echo "$H" | grep -i '^set-cookie: zora_g_state=' | grep -i httponly | grep -ci 'path=/api/auth/google')" 1
SST=$(curl -s -o /dev/null -w '%{redirect_url}' "$B/start?intent=signup" | grep -o 'state=[^&]*' | cut -d= -f2)
check "signup state payload" "$(payload "$SST")" '{"i":"signup","n":null}'
AST=$(curl -s -o /dev/null -w '%{redirect_url}' "$B/start" | grep -o 'state=[^&]*' | cut -d= -f2)
check "no intent → admin state (BS141 default)" "$(payload "$AST")" '{"i":"admin","n":null}'

echo "== next open-redirect rejected =="
for bad in '%2F%2Fevil.com' 'https%3A%2F%2Fevil.com' '%2F%5Cevil.com' 'javascript%3Aalert(1)'; do
  S=$(curl -s -o /dev/null -w '%{redirect_url}' "$B/start?intent=org&next=$bad" | grep -o 'state=[^&]*' | cut -d= -f2)
  check "next=$bad dropped" "$(payload "$S")" '{"i":"org","n":null}'
done

echo "== callback =="
check "no cookie → admin login (unchanged)" "$(curl -s -o /dev/null -w '%{redirect_url}' "$B/callback?code=x&state=abc" | loc)" "/admin/login?error=state"
check "legacy forged cookie → admin login (unchanged)" "$(curl -s -o /dev/null -w '%{redirect_url}' -H 'Cookie: zora_g_state=abc.forged' "$B/callback?code=x&state=abc" | loc)" "/admin/login?error=state"
FORGED="${CK%.*}.forgedmac"
check "org cookie, forged mac → organizer login" "$(curl -s -o /dev/null -w '%{redirect_url}' -H "Cookie: zora_g_state=$FORGED" "$B/callback?code=x&state=$ST" | loc)" "/dashboard/login?error=state"
check "org cookie, state mismatch → organizer login" "$(curl -s -o /dev/null -w '%{redirect_url}' -H "Cookie: zora_g_state=$CK" "$B/callback?code=x&state=$AST" | loc)" "/dashboard/login?error=state"
check "org genuine state, no code → organizer login" "$(curl -s -o /dev/null -w '%{redirect_url}' -H "Cookie: zora_g_state=$CK" "$B/callback?state=$ST" | loc)" "/dashboard/login?error=code"
R=$(curl -s -o /dev/null -w '%{redirect_url}' -H "Cookie: zora_g_state=$CK" "$B/callback?code=fake&state=$ST" | loc)
case "$R" in "/dashboard/login?error=exchange"|"/dashboard/login?error=google_error") check "org genuine state → reaches token exchange" ok ok;; *) check "org genuine state → reaches token exchange" "$R" "/dashboard/login?error=exchange";; esac
check "password admin login still works" "$(curl -s -X POST $A/login -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}')" '{"ok":true}'

echo "== sign up with Google (ticket) =="
check "no ticket → nothing to prefill" "$(curl -s $A/org/google-signup)" '{"email":null,"name":null}'
check "forged ticket → nothing" "$(curl -s -H 'Cookie: zora_g_signup=eyJzdWIiOiJ4In0.bad' $A/org/google-signup)" '{"email":null,"name":null}'
TICKET=$(cd "$ROOT/apps/api" && SESSION_SECRET=e2e node -e 'const g=require("./dist/auth/google-flow.js");process.stdout.write(g.encodeTicket("e2e",{sub:"g-sub-148",email:"Ama@Example.com",name:"Ama Events",exp:Date.now()+600000}))')
check "ticket → locked email + name" "$(curl -s -H "Cookie: zora_g_signup=$TICKET" $A/org/google-signup)" '{"email":"ama@example.com","name":"Ama Events"}'
PHONE=0712148148
CODE=$(curl -s -X POST $A/otp/request -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).code||"")))')
RH=$(curl -s -D - -c "$JAR" -o /dev/null -w '%{http_code}' -X POST $A/org/register -H "Cookie: zora_g_signup=$TICKET" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\",\"name\":\"Ama Events\",\"handle\":\"amaevents\",\"email\":\"attacker@evil.com\"}")
check "register with ticket → 201/200" "$(echo "$RH" | tail -1 | grep -cE '^20[01]$')" 1
check "ticket cookie cleared" "$(echo "$RH" | grep -i '^set-cookie: zora_g_signup=;' | grep -ci 'path=/api/org')" 1
check "owner user email = Google email (body ignored)" "$(PSQL "select u.email from app_user u join organizer_member m on m.user_id=u.id join organizer o on o.id=m.organizer_id where o.handle='amaevents'")" "ama@example.com"
check "google_sub stored" "$(PSQL "select google_sub from app_user where lower(email)='ama@example.com'")" "g-sub-148"
check "organizer email = Google email" "$(PSQL "select email from organizer where handle='amaevents'")" "ama@example.com"
check "session is an organizer" "$(curl -s -b "$JAR" $A/me | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s);process.stdout.write(m.role+":"+m.organizerHandle+":"+(m.userId?"user":"none"))})')" "organizer:amaevents:user"
check "audit notes via Google" "$(PSQL "select count(*) from collection_store, jsonb_array_elements(data::jsonb) e where name='audit' and e->>'detail' like '%amaevents%via Google%'")" 1
CODE2=$(curl -s -X POST $A/otp/request -H 'content-type: application/json' -d '{"phone":"0712148149"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).code||"")))')
curl -s -o /dev/null -X POST $A/org/register -H 'content-type: application/json' -d "{\"phone\":\"0712148149\",\"code\":\"$CODE2\",\"name\":\"Plain Co\",\"handle\":\"plainco\",\"email\":\"plain@example.com\"}"
check "phone-only signup unchanged (no sub)" "$(PSQL "select coalesce(google_sub,'none') from app_user where lower(email)='plain@example.com'")" "none"

[ "$fail" = 0 ] && echo "ORG GOOGLE E2E: PASS" || { echo "ORG GOOGLE E2E: FAIL"; tail -20 "$LOG"; exit 1; }
