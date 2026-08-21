#!/usr/bin/env bash
# BS95 (auth Phase 3.5) — every path that yields an ORGANIZER also yields a real
# app_user owner + `owner` organizer_member. Boots the real API on a THROWAWAY
# local Postgres 17 (NEVER prod) and proves:
#
#   T1  SELF-SIGNUP now provisions the owner: POST /api/org/register creates an
#       app_user (keyed on lower(email)) + an `owner` membership; the new owner can
#       log in BY EMAIL and hit an owner-only org endpoint (GET /api/org/members).
#   T2  POST /api/admin/organizers (super_admin):
#         · existing owner email → org + `owner` membership directly.
#         · new owner email       → org + a pending `owner` org_invite (email sent).
#         · handle taken → 409, reserved → 400.
#   T3  PUT /api/admin/organizers/:id/owner transfers ownership: the target becomes
#       owner and the PRIOR owner is demoted to admin (never removed). Idempotent if
#       already the owner. A new email → a pending owner invite.
#   T4  Both admin endpoints are super_admin-only: a plain org session → 401/403,
#       anon → 401.
#
# Self-contained (throwaway PG; XBRIDGE_MOCK; OTP_ECHO; EMAIL_DRIVER=mock). bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55495}"
API_PORT="${TEST_API_PORT:-4195}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-authp35-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-authp35snap-XXXXXX")"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_authp35
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_authp35"
Q() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_authp35 -c "$1" | tr -d '[:space:]'; }
BCRYPT() { NODE_PATH="$API_DIR/node_modules" node -e "console.log(require('bcryptjs').hashSync(process.argv[1],10))" "$1"; }

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

# admin session (isAdmin → super_admin in the RBAC guard).
al=$(curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}')
[ "$al" = '{"ok":true}' ] || { echo "  ✗ admin login: $al"; fail=1; }

echo ""
echo "== T1 — SELF-SIGNUP provisions the owner (app_user + owner membership) =="
FOUNDER="founder@sunrise.co"
OTP=$(curl -s -X POST "$BASE/api/otp/request" -H 'content-type: application/json' -d '{"phone":"0713000001"}' | jq_get code)
REG=$(curl -s -c "$SNAP/orga" -X POST "$BASE/api/org/register" -H 'content-type: application/json' \
  -d "{\"phone\":\"0713000001\",\"code\":\"$OTP\",\"name\":\"Sunrise HQ\",\"handle\":\"sunrisehq\",\"email\":\"$FOUNDER\",\"password\":\"sunrise-pass-1\"}")
echo "$REG" | grep -q '"handle":"sunrisehq"' && echo "  ✓ registered sunrisehq" || { echo "  ✗ register: $REG"; fail=1; }

FUID="$(Q "select id from app_user where lower(email)='$FOUNDER';")"
[ -n "$FUID" ] && echo "  ✓ app_user created for $FOUNDER (keyed on lower(email))" || { echo "  ✗ no app_user for founder"; fail=1; }
MROLE="$(Q "select role from organizer_member where user_id='$FUID' and organizer_id='o-sunrisehq';")"
[ "$MROLE" = "owner" ] && echo "  ✓ owner organizer_member(o-sunrisehq)" || { echo "  ✗ membership role: $MROLE"; fail=1; }

# the new owner logs in BY EMAIL …
LG=$(curl -s -c "$SNAP/owner" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d "{\"identifier\":\"$FOUNDER\",\"password\":\"sunrise-pass-1\"}")
[ "$LG" = '{"ok":true}' ] && echo "  ✓ owner logs in by EMAIL" || { echo "  ✗ email login: $LG"; fail=1; }
# … and can hit an OWNER-ONLY org endpoint (GET /api/org/members is owner/admin-only).
MEM=$(code -b "$SNAP/owner" "$BASE/api/org/members")
[ "$MEM" = "200" ] && echo "  ✓ email-owner reaches owner-only GET /api/org/members → 200" || { echo "  ✗ owner-only endpoint → $MEM (want 200)"; fail=1; }

echo ""
echo "== T2 — POST /api/admin/organizers (super_admin) =="
# (a) existing owner email → direct owner membership (the founder now owns a 2nd org).
CR1=$(curl -s -b "$SNAP/admin" -w '\n%{http_code}' -X POST "$BASE/api/admin/organizers" -H 'content-type: application/json' \
  -d "{\"name\":\"Moonrise\",\"handle\":\"moonrise\",\"ownerEmail\":\"$FOUNDER\"}")
CR1B=$(printf '%s' "$CR1" | sed '$d'); CR1C=$(printf '%s' "$CR1" | tail -1)
{ [ "$CR1C" = "201" ] || [ "$CR1C" = "200" ]; } && [ "$(echo "$CR1B" | jq_get owner)" = "member" ] \
  && echo "  ✓ existing owner email → org + owner:'member' ($CR1C)" || { echo "  ✗ create existing: $CR1"; fail=1; }
ROW="$(Q "select status||'/'||kyc_status||'/'||source from organizer where id='o-moonrise';")"
[ "$ROW" = "pending/unverified/admin" ] && echo "  ✓ moonrise row: $ROW (draft/unverified)" || { echo "  ✗ moonrise row: $ROW"; fail=1; }
M2="$(Q "select role from organizer_member where user_id='$FUID' and organizer_id='o-moonrise';")"
[ "$M2" = "owner" ] && echo "  ✓ founder is owner of moonrise (one user, two orgs)" || { echo "  ✗ moonrise owner role: $M2"; fail=1; }

# (b) new owner email → org + pending OWNER invite (no membership yet).
CR2=$(curl -s -b "$SNAP/admin" -X POST "$BASE/api/admin/organizers" -H 'content-type: application/json' \
  -d '{"name":"Starlight","handle":"starlight","ownerEmail":"newowner@example.com"}')
[ "$(echo "$CR2" | jq_get owner)" = "invited" ] && echo "  ✓ new owner email → owner:'invited'" || { echo "  ✗ create new: $CR2"; fail=1; }
INVROLE="$(Q "select role from org_invite where organizer_id='o-starlight' and lower(email)='newowner@example.com' and accepted_at is null;")"
[ "$INVROLE" = "owner" ] && echo "  ✓ pending OWNER org_invite minted for starlight" || { echo "  ✗ owner invite role: $INVROLE"; fail=1; }
NOMEM="$(Q "select count(*)::int from organizer_member where organizer_id='o-starlight';")"
[ "$NOMEM" = "0" ] && echo "  ✓ no membership until the invite is accepted" || { echo "  ✗ starlight has $NOMEM members already"; fail=1; }

# (c) handle taken → 409, reserved → 400, bad email → 400.
c=$(code -b "$SNAP/admin" -X POST "$BASE/api/admin/organizers" -H 'content-type: application/json' -d '{"name":"Dup","handle":"moonrise","ownerEmail":"x@example.com"}')
[ "$c" = "409" ] && echo "  ✓ taken handle → 409" || { echo "  ✗ taken handle → $c (want 409)"; fail=1; }
c=$(code -b "$SNAP/admin" -X POST "$BASE/api/admin/organizers" -H 'content-type: application/json' -d '{"name":"Resv","handle":"dashboard","ownerEmail":"x@example.com"}')
[ "$c" = "400" ] && echo "  ✓ reserved handle → 400" || { echo "  ✗ reserved handle → $c (want 400)"; fail=1; }
c=$(code -b "$SNAP/admin" -X POST "$BASE/api/admin/organizers" -H 'content-type: application/json' -d '{"name":"NoEmail","handle":"noemailco","ownerEmail":"nope"}')
[ "$c" = "400" ] && echo "  ✓ invalid owner email → 400" || { echo "  ✗ bad email → $c (want 400)"; fail=1; }

echo ""
echo "== T3 — PUT /api/admin/organizers/:id/owner transfers + demotes prior owner =="
# a second existing identity to transfer moonrise to.
THASH="$(BCRYPT transfereepass)"
Q "insert into app_user(email,password_hash,username,updated_at) values ('transferee@example.com','$THASH','transferee',now());" >/dev/null
TUID="$(Q "select id from app_user where lower(email)='transferee@example.com';")"
TR=$(curl -s -b "$SNAP/admin" -X PUT "$BASE/api/admin/organizers/o-moonrise/owner" -H 'content-type: application/json' -d '{"email":"transferee@example.com"}')
[ "$(echo "$TR" | jq_get owner)" = "assigned" ] && echo "  ✓ transfer → owner:'assigned'" || { echo "  ✗ transfer: $TR"; fail=1; }
NEWOWN="$(Q "select role from organizer_member where user_id='$TUID' and organizer_id='o-moonrise';")"
[ "$NEWOWN" = "owner" ] && echo "  ✓ transferee is now owner of moonrise" || { echo "  ✗ new owner role: $NEWOWN"; fail=1; }
PRIOR="$(Q "select role from organizer_member where user_id='$FUID' and organizer_id='o-moonrise';")"
[ "$PRIOR" = "admin" ] && echo "  ✓ prior owner (founder) demoted to admin (never orphaned)" || { echo "  ✗ prior owner role: $PRIOR (want admin)"; fail=1; }
ONECNT="$(Q "select count(*)::int from organizer_member where organizer_id='o-moonrise' and role='owner';")"
[ "$ONECNT" = "1" ] && echo "  ✓ moonrise has exactly one owner" || { echo "  ✗ owner count: $ONECNT"; fail=1; }

# idempotent: transferring to the same (sole) owner → unchanged.
TR2=$(curl -s -b "$SNAP/admin" -X PUT "$BASE/api/admin/organizers/o-moonrise/owner" -H 'content-type: application/json' -d '{"email":"transferee@example.com"}')
[ "$(echo "$TR2" | jq_get owner)" = "unchanged" ] && echo "  ✓ re-assign the same owner → owner:'unchanged' (idempotent)" || { echo "  ✗ idempotent transfer: $TR2"; fail=1; }

# transfer to a NEW (non-existent) email → owner invite, prior owner untouched (no orphan window).
TR3=$(curl -s -b "$SNAP/admin" -X PUT "$BASE/api/admin/organizers/o-moonrise/owner" -H 'content-type: application/json' -d '{"email":"brandnew@example.com"}')
[ "$(echo "$TR3" | jq_get owner)" = "invited" ] && echo "  ✓ transfer to a new email → owner:'invited'" || { echo "  ✗ new-email transfer: $TR3"; fail=1; }
NEWINV="$(Q "select role from org_invite where organizer_id='o-moonrise' and lower(email)='brandnew@example.com' and accepted_at is null;")"
[ "$NEWINV" = "owner" ] && echo "  ✓ pending owner invite minted for brandnew@example.com" || { echo "  ✗ new owner invite: $NEWINV"; fail=1; }
STILLOWN="$(Q "select role from organizer_member where user_id='$TUID' and organizer_id='o-moonrise';")"
[ "$STILLOWN" = "owner" ] && echo "  ✓ current owner kept until the invitee accepts (never ownerless)" || { echo "  ✗ current owner changed early: $STILLOWN"; fail=1; }

# missing org → 404.
c=$(code -b "$SNAP/admin" -X PUT "$BASE/api/admin/organizers/o-nope/owner" -H 'content-type: application/json' -d '{"email":"x@example.com"}')
[ "$c" = "404" ] && echo "  ✓ unknown org → 404" || { echo "  ✗ unknown org → $c (want 404)"; fail=1; }

echo ""
echo "== T4 — admin endpoints are super_admin-only =="
# a plain ORG session ($SNAP/orga = the sunrisehq organizer) is NOT super_admin.
c=$(code -b "$SNAP/orga" -X POST "$BASE/api/admin/organizers" -H 'content-type: application/json' -d '{"name":"Sneak","handle":"sneakco","ownerEmail":"x@example.com"}')
{ [ "$c" = "401" ] || [ "$c" = "403" ]; } && echo "  ✓ org session POST /api/admin/organizers → $c" || { echo "  ✗ org session create → $c (want 401/403)"; fail=1; }
c=$(code -b "$SNAP/orga" -X PUT "$BASE/api/admin/organizers/o-moonrise/owner" -H 'content-type: application/json' -d '{"email":"x@example.com"}')
{ [ "$c" = "401" ] || [ "$c" = "403" ]; } && echo "  ✓ org session PUT .../owner → $c" || { echo "  ✗ org session transfer → $c (want 401/403)"; fail=1; }
c=$(code -X POST "$BASE/api/admin/organizers" -H 'content-type: application/json' -d '{"name":"Anon","handle":"anonco","ownerEmail":"x@example.com"}')
[ "$c" = "401" ] && echo "  ✓ anon POST /api/admin/organizers → 401" || { echo "  ✗ anon create → $c (want 401)"; fail=1; }
# the sneaky org was never created.
SNEAK="$(Q "select count(*)::int from organizer where handle in ('sneakco','anonco');")"
[ "$SNEAK" = "0" ] && echo "  ✓ no organizer created by the refused calls" || { echo "  ✗ a refused call still created a row"; fail=1; }

echo ""
[ "$fail" = "0" ] || { echo "AUTH PHASE 3.5 E2E: FAIL"; echo "--- api.log tail ---"; tail -25 "$SNAP/api.log"; exit 1; }
echo "AUTH PHASE 3.5 E2E: PASS (T1 signup provisions owner + email login + owner-only endpoint · T2 admin create existing→member / new→owner-invite / handle guards · T3 transfer demotes prior owner to admin, idempotent, new-email invite · T4 super_admin-only)"
