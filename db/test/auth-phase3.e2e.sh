#!/usr/bin/env bash
# BS94 (auth Phase 3) — TEAM members + invites, on a THROWAWAY local Postgres 17
# (NEVER prod). Boots the real API and proves:
#
#   T1  invite → accept creates the membership, BOTH paths:
#         · NEW user  — no app_user yet → accept with a password creates the
#           identity + the membership and logs them in.
#         · EXISTING user — an app_user already exists → accept (no password)
#           just links the membership.
#   T2  owner/admin-only guard on invite/change-role/remove: a VIEWER member gets
#         403 on all three; the owner passes.
#   T3  the sole-owner guard: removing (or demoting) the last owner is refused 400.
#       And re-inviting an existing member is 409.
#
# Self-contained (throwaway local Postgres; XBRIDGE_MOCK; EMAIL_DRIVER=mock).
# bash 3.2 compatible.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55494}"
API_PORT="${TEST_API_PORT:-4194}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-authp3-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-authp3snap-XXXXXX")"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_authp3
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_authp3"
Q() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_authp3 -c "$1" | tr -d '[:space:]'; }
BCRYPT() { NODE_PATH="$API_DIR/node_modules" node -e "console.log(require('bcryptjs').hashSync(process.argv[1],10))" "$1"; }

DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

echo "== boot API (XBRIDGE_MOCK, EMAIL_DRIVER=mock) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false EMAIL_DRIVER=mock \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

# ── give o1 (thebrunchcity) a login password BEFORE backfill so the hash carries
#    onto its owner app_user (email login path), then run the user backfill. ─────
al=$(curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}')
[ "$al" = '{"ok":true}' ] || { echo "  ✗ admin login: $al"; fail=1; }
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null

echo "== run db/backfill-users.mjs (creates o1 owner app_user + membership) =="
DATABASE_URL="$URL" node "$ROOT/db/backfill-users.mjs" >/dev/null

# owner login (acts as thebrunchcity).
lg=$(curl -s -c "$SNAP/owner" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"identifier":"hello@thebrunchcity.co","password":"orgpass123"}')
[ "$lg" = '{"ok":true}' ] && echo "  ✓ owner login → ok" || { echo "  ✗ owner login: $lg"; fail=1; }
OWNER_UID="$(Q "select id from app_user where lower(email)='hello@thebrunchcity.co';")"

echo ""
echo "== T1a — invite a NEW user, accept with a password, membership created =="
inv=$(curl -s -b "$SNAP/owner" -X POST "$BASE/api/org/members/invite" -H 'content-type: application/json' -d '{"email":"viewer@example.com","role":"viewer"}')
echo "$inv" | grep -q '"ok":true' && echo "  ✓ invite viewer@example.com (viewer) → ok" || { echo "  ✗ invite: $inv"; fail=1; }
# pending invite shows in GET /api/org/members.
ms=$(curl -s -b "$SNAP/owner" "$BASE/api/org/members")
echo "$ms" | grep -q '"email":"viewer@example.com"' && echo "  ✓ GET /api/org/members lists the pending invite" || { echo "  ✗ members list: $ms"; fail=1; }
TOK="$(Q "select token from org_invite where email='viewer@example.com' and accepted_at is null;")"
[ -n "$TOK" ] && echo "  ✓ invite token minted" || { echo "  ✗ no token"; fail=1; }
# the accept page's GET says a NEW user needs a password.
gi=$(curl -s "$BASE/api/org/invites/$TOK")
echo "$gi" | grep -q '"needsPassword":true' && echo "  ✓ GET invite → needsPassword:true (new user)" || { echo "  ✗ show invite: $gi"; fail=1; }
# accept (new user, password) → logs them in.
ac=$(curl -s -c "$SNAP/viewer" -X POST "$BASE/api/org/invites/$TOK/accept" -H 'content-type: application/json' -d '{"password":"viewerpass1"}')
echo "$ac" | grep -q '"organizerHandle":"thebrunchcity"' && echo "  ✓ accept → logged in acting as thebrunchcity" || { echo "  ✗ accept: $ac"; fail=1; }
VUID="$(Q "select id from app_user where lower(email)='viewer@example.com';")"
[ -n "$VUID" ] && echo "  ✓ new app_user created for viewer@example.com" || { echo "  ✗ no app_user for viewer"; fail=1; }
mrole="$(Q "select role from organizer_member where user_id='$VUID' and organizer_id='o1';")"
[ "$mrole" = "viewer" ] && echo "  ✓ organizer_member(o1, viewer) created" || { echo "  ✗ membership role: $mrole"; fail=1; }
acc="$(Q "select count(*)::int from org_invite where token='$TOK' and accepted_at is not null;")"
[ "$acc" = "1" ] && echo "  ✓ invite marked accepted" || { echo "  ✗ invite not marked accepted"; fail=1; }

echo ""
echo "== T1b — invite an EXISTING user, accept WITHOUT a password, membership linked =="
EXHASH="$(BCRYPT existingpass)"
Q "insert into app_user(email,password_hash,username,updated_at) values ('existing@example.com','$EXHASH','existing',now());" >/dev/null
EXUID="$(Q "select id from app_user where lower(email)='existing@example.com';")"
inv=$(curl -s -b "$SNAP/owner" -X POST "$BASE/api/org/members/invite" -H 'content-type: application/json' -d '{"email":"existing@example.com","role":"finance"}')
echo "$inv" | grep -q '"ok":true' && echo "  ✓ invite existing@example.com (finance) → ok" || { echo "  ✗ invite: $inv"; fail=1; }
TOK2="$(Q "select token from org_invite where email='existing@example.com' and accepted_at is null;")"
gi=$(curl -s "$BASE/api/org/invites/$TOK2")
echo "$gi" | grep -q '"needsPassword":false' && echo "  ✓ GET invite → needsPassword:false (existing user)" || { echo "  ✗ show invite: $gi"; fail=1; }
ac=$(curl -s -c "$SNAP/existing" -X POST "$BASE/api/org/invites/$TOK2/accept" -H 'content-type: application/json' -d '{}')
echo "$ac" | grep -q '"organizerHandle":"thebrunchcity"' && echo "  ✓ accept (no password) → logged in" || { echo "  ✗ accept: $ac"; fail=1; }
mrole="$(Q "select role from organizer_member where user_id='$EXUID' and organizer_id='o1';")"
[ "$mrole" = "finance" ] && echo "  ✓ existing user linked as finance (no new identity)" || { echo "  ✗ membership role: $mrole"; fail=1; }

echo ""
echo "== T2 — owner/admin-only guard: a VIEWER is refused invite/change-role/remove (403) =="
# the viewer session (from T1a) acts as thebrunchcity where they are 'viewer'.
c=$(code -b "$SNAP/viewer" -X POST "$BASE/api/org/members/invite" -H 'content-type: application/json' -d '{"email":"x@example.com","role":"viewer"}')
[ "$c" = "403" ] && echo "  ✓ viewer POST /api/org/members/invite → 403" || { echo "  ✗ viewer invite → $c (want 403)"; fail=1; }
c=$(code -b "$SNAP/viewer" -X PUT "$BASE/api/org/members/$EXUID" -H 'content-type: application/json' -d '{"role":"door"}')
[ "$c" = "403" ] && echo "  ✓ viewer PUT /api/org/members/:id → 403" || { echo "  ✗ viewer change-role → $c (want 403)"; fail=1; }
c=$(code -b "$SNAP/viewer" -X DELETE "$BASE/api/org/members/$EXUID")
[ "$c" = "403" ] && echo "  ✓ viewer DELETE /api/org/members/:id → 403" || { echo "  ✗ viewer remove → $c (want 403)"; fail=1; }
c=$(code -b "$SNAP/viewer" "$BASE/api/org/members")
[ "$c" = "403" ] && echo "  ✓ viewer GET /api/org/members → 403 (list is owner/admin-only)" || { echo "  ✗ viewer list → $c (want 403)"; fail=1; }
# the owner passes the same change-role (finance → door) and remove.
c=$(code -b "$SNAP/owner" -X PUT "$BASE/api/org/members/$EXUID" -H 'content-type: application/json' -d '{"role":"door"}')
[ "$c" = "200" ] && echo "  ✓ owner PUT /api/org/members/:id (finance→door) → 200" || { echo "  ✗ owner change-role → $c (want 200)"; fail=1; }
c=$(code -b "$SNAP/owner" -X DELETE "$BASE/api/org/members/$VUID")
[ "$c" = "200" ] && echo "  ✓ owner DELETE /api/org/members/:id (remove viewer) → 200" || { echo "  ✗ owner remove → $c (want 200)"; fail=1; }

echo ""
echo "== T3 — sole-owner guard + duplicate-invite conflict =="
# removing the last owner (owner removing themselves) → 400 sole_owner.
rm=$(curl -s -b "$SNAP/owner" -X DELETE "$BASE/api/org/members/$OWNER_UID")
echo "$rm" | grep -q '"sole_owner"' && echo "  ✓ remove the sole owner → 400 sole_owner" || { echo "  ✗ sole-owner remove: $rm"; fail=1; }
c=$(code -b "$SNAP/owner" -X DELETE "$BASE/api/org/members/$OWNER_UID")
[ "$c" = "400" ] && echo "  ✓ (status 400)" || { echo "  ✗ sole-owner remove → $c (want 400)"; fail=1; }
# demoting the sole owner → 400 sole_owner.
c=$(code -b "$SNAP/owner" -X PUT "$BASE/api/org/members/$OWNER_UID" -H 'content-type: application/json' -d '{"role":"viewer"}')
[ "$c" = "400" ] && echo "  ✓ demote the sole owner → 400" || { echo "  ✗ sole-owner demote → $c (want 400)"; fail=1; }
# inviting a role of 'owner' is rejected (never via invite).
c=$(code -b "$SNAP/owner" -X POST "$BASE/api/org/members/invite" -H 'content-type: application/json' -d '{"email":"o@example.com","role":"owner"}')
[ "$c" = "400" ] && echo "  ✓ invite role=owner → 400 (owner never via invite)" || { echo "  ✗ owner-invite → $c (want 400)"; fail=1; }
# re-inviting an EXISTING member (existing@example.com is now a member) → 409.
c=$(code -b "$SNAP/owner" -X POST "$BASE/api/org/members/invite" -H 'content-type: application/json' -d '{"email":"existing@example.com","role":"viewer"}')
[ "$c" = "409" ] && echo "  ✓ invite an existing member → 409" || { echo "  ✗ dup-invite → $c (want 409)"; fail=1; }

echo ""
[ "$fail" = "0" ] || { echo "AUTH PHASE 3 E2E: FAIL"; echo "--- api.log tail ---"; tail -25 "$SNAP/api.log"; exit 1; }
echo "AUTH PHASE 3 E2E: PASS (T1 invite→accept new+existing user · T2 owner/admin-only guard 403 · T3 sole-owner + dup-invite guards)"
