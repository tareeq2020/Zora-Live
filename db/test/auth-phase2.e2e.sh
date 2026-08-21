#!/usr/bin/env bash
# BS93 (auth Phase 2) — RBAC guard + dual-path login failure modes, on a THROWAWAY
# local Postgres 17 (NEVER prod). Boots the real API and proves:
#
#   FM2  every login that worked pre-Phase-2 still works, and can hit its org
#        endpoints:
#          · a BACKFILLED email login (app_user, post db/backfill-users.mjs), and
#          · the LEGACY handle+password fallback for an org that has NO app_user
#            yet (prod backfill not run) — verified against organizer.password_hash,
#          · plus the legacy { handle, password } body still accepted as an alias.
#   FM4  a `door`/`viewer` member is REFUSED owner-only endpoints (payout request,
#        event publish, sales) with 403, while still reaching the shared
#        dashboard bootstrap (GET /api/org/me) — and an owner passes all of them.
#   E6   POST /api/me/acting-org switches the acting org (validated against the
#        caller's memberships); switching to a non-member org is 403.
#
# Self-contained (throwaway local Postgres; XBRIDGE_MOCK). bash 3.2 compatible.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55493}"
API_PORT="${TEST_API_PORT:-4193}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-authp2-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-authp2snap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers organizers audit admin events kyc"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

# The API must be built (dist/main.js). Build core + api if missing.
if [ ! -f "$API_DIR/dist/main.js" ]; then
  echo "== building @zora/core + @zora/api (dist missing) =="
  ( cd "$ROOT" && pnpm --filter @zora/core build && pnpm --filter @zora/api build ) >/dev/null
fi

echo "== throwaway Postgres @ :$PG_PORT + migrate + seed entities =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_authp2
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_authp2"
Q() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_authp2 -c "$1" | tr -d '[:space:]'; }
BCRYPT() { NODE_PATH="$API_DIR/node_modules" node -e "console.log(require('bcryptjs').hashSync(process.argv[1],10))" "$1"; }

DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

echo "== boot API (XBRIDGE_MOCK) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

# ── admin login + give o1 (thebrunchcity) a login password BEFORE backfill so the
#    hash carries onto its owner app_user (email login path). ──────────────────
al=$(curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}')
[ "$al" = '{"ok":true}' ] || { echo "  ✗ admin login: $al"; fail=1; }
sp=$(curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}')
echo "$sp" | grep -q '"ok":true' || { echo "  ✗ set o1 password: $sp"; fail=1; }

echo "== run db/backfill-users.mjs (creates app_user + owner memberships) =="
DATABASE_URL="$URL" node "$ROOT/db/backfill-users.mjs" >/dev/null

# ── AFTER backfill: a LEGACY-ONLY org (o9) with a password_hash but NO app_user —
#    this is the "prod backfill not run for this org" case the fallback must cover.
LEGHASH="$(BCRYPT legacypass)"
Q "insert into organizer(id,name,handle,email,status,password_hash,revenue,created_at)
   values ('o9','Legacy Co','legacyco','hi@legacyco.test','active','$LEGHASH',0, now()+interval '2 day');" >/dev/null

# ── a DOOR member of o1 + a VIEWER member of o2 (separate identity, its own login).
DOORHASH="$(BCRYPT doorpass)"
Q "insert into app_user(email,password_hash,username,updated_at) values ('door@example.com','$DOORHASH','door',now());" >/dev/null
DUID="$(Q "select id from app_user where email='door@example.com';")"
Q "insert into organizer_member(user_id,organizer_id,role) values ('$DUID','o1','door');" >/dev/null
Q "insert into organizer_member(user_id,organizer_id,role) values ('$DUID','o2','viewer');" >/dev/null

echo ""
echo "== FM2a — BACKFILLED EMAIL login works + can hit org endpoints =="
lg=$(curl -s -c "$SNAP/owner" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"identifier":"hello@thebrunchcity.co","password":"orgpass123"}')
[ "$lg" = '{"ok":true}' ] && echo "  ✓ email login → ok" || { echo "  ✗ email login: $lg"; fail=1; }
me=$(curl -s -b "$SNAP/owner" "$BASE/api/org/me")
echo "$me" | grep -q '"actingHandle":"thebrunchcity"' && echo "  ✓ /api/org/me acts as thebrunchcity" || { echo "  ✗ /api/org/me: $me"; fail=1; }
c=$(code -b "$SNAP/owner" "$BASE/api/org/summary"); [ "$c" = "200" ] && echo "  ✓ owner GET /api/org/summary → 200" || { echo "  ✗ owner summary → $c"; fail=1; }
c=$(code -b "$SNAP/owner" "$BASE/api/org/events");  [ "$c" = "200" ] && echo "  ✓ owner GET /api/org/events → 200"  || { echo "  ✗ owner events → $c"; fail=1; }
c=$(code -b "$SNAP/owner" "$BASE/api/org/payouts"); [ "$c" = "200" ] && echo "  ✓ owner GET /api/org/payouts → 200" || { echo "  ✗ owner payouts → $c"; fail=1; }

echo ""
echo "== FM2b — LEGACY handle+password fallback (org o9 has NO app_user) still works =="
lg=$(curl -s -c "$SNAP/leg" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"identifier":"legacyco","password":"legacypass"}')
[ "$lg" = '{"ok":true}' ] && echo "  ✓ legacy handle login (organizer.password_hash fallback) → ok" || { echo "  ✗ legacy login: $lg"; fail=1; }
me=$(curl -s -b "$SNAP/leg" "$BASE/api/org/me")
echo "$me" | grep -q '"actingHandle":"legacyco"' && echo "  ✓ legacy session acts as legacyco" || { echo "  ✗ legacy /api/org/me: $me"; fail=1; }
# a legacy session (no memberships) is an implicit owner → passes the owner|admin|finance guard.
c=$(code -b "$SNAP/leg" "$BASE/api/org/summary"); [ "$c" = "200" ] && echo "  ✓ legacy (implicit owner) GET /api/org/summary → 200 (no lockout)" || { echo "  ✗ legacy summary → $c"; fail=1; }
# the legacy { handle, password } body is still accepted as an alias for identifier.
lg2=$(curl -s -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}')
[ "$lg2" = '{"ok":true}' ] && echo "  ✓ legacy { handle, password } body still accepted" || { echo "  ✗ { handle } alias: $lg2"; fail=1; }
# wrong password is still refused (401).
c=$(code -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"identifier":"legacyco","password":"nope"}')
[ "$c" = "401" ] && echo "  ✓ wrong password → 401" || { echo "  ✗ wrong password → $c (want 401)"; fail=1; }

echo ""
echo "== FM4 — a DOOR member is REFUSED owner-only endpoints (403), owner is not =="
lg=$(curl -s -c "$SNAP/door" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"identifier":"door@example.com","password":"doorpass"}')
[ "$lg" = '{"ok":true}' ] && echo "  ✓ door member login → ok" || { echo "  ✗ door login: $lg"; fail=1; }
# acting org defaults to o1 (thebrunchcity), where they are 'door'.
me=$(curl -s -b "$SNAP/door" "$BASE/api/org/me")
echo "$me" | grep -q '"actingHandle":"thebrunchcity"' && echo "  ✓ door acts as thebrunchcity" || { echo "  ✗ door /api/org/me: $me"; fail=1; }
# GET /api/org/me is the shared bootstrap — any member may read it (200).
c=$(code -b "$SNAP/door" "$BASE/api/org/me"); [ "$c" = "200" ] && echo "  ✓ door GET /api/org/me → 200 (bootstrap allowed)" || { echo "  ✗ door me → $c"; fail=1; }
# payout REQUEST → 403 (owner|admin|finance only).
c=$(code -b "$SNAP/door" -X POST "$BASE/api/org/payouts" -H 'content-type: application/json' -d '{"amount":1000,"currency":"TZS"}')
[ "$c" = "403" ] && echo "  ✓ door POST /api/org/payouts (request) → 403" || { echo "  ✗ door payout → $c (want 403)"; fail=1; }
# event PUBLISH (sellable create) → 403 (owner|admin only).
c=$(code -b "$SNAP/door" -X POST "$BASE/api/org/events" -H 'content-type: application/json' -d '{"name":"X","sellable":true}')
[ "$c" = "403" ] && echo "  ✓ door POST /api/org/events (publish) → 403" || { echo "  ✗ door publish → $c (want 403)"; fail=1; }
# sales reporting → 403.
c=$(code -b "$SNAP/door" "$BASE/api/org/summary"); [ "$c" = "403" ] && echo "  ✓ door GET /api/org/summary → 403" || { echo "  ✗ door summary → $c (want 403)"; fail=1; }
# the owner is NOT refused the same payout endpoint (proves the guard is role-based,
# not a blanket block — a non-403 here; 400 not_verified/insufficient is fine).
c=$(code -b "$SNAP/owner" -X POST "$BASE/api/org/payouts" -H 'content-type: application/json' -d '{"amount":1000,"currency":"TZS"}')
[ "$c" != "403" ] && echo "  ✓ owner POST /api/org/payouts → $c (NOT 403; guard passed)" || { echo "  ✗ owner payout was 403 (should pass)"; fail=1; }

echo ""
echo "== E6 — POST /api/me/acting-org switches acting org (member-validated) =="
sw=$(curl -s -b "$SNAP/door" -c "$SNAP/door" -X POST "$BASE/api/me/acting-org" -H 'content-type: application/json' -d '{"organizerId":"o2"}')
echo "$sw" | grep -q '"organizerHandle":"offshore"' && echo "  ✓ switch to o2 → acting offshore" || { echo "  ✗ switch: $sw"; fail=1; }
me=$(curl -s -b "$SNAP/door" "$BASE/api/org/me")
echo "$me" | grep -q '"actingHandle":"offshore"' && echo "  ✓ session now acts as offshore" || { echo "  ✗ post-switch me: $me"; fail=1; }
# switching to an org the caller is NOT a member of → 403.
c=$(code -b "$SNAP/door" -X POST "$BASE/api/me/acting-org" -H 'content-type: application/json' -d '{"organizerId":"o3"}')
[ "$c" = "403" ] && echo "  ✓ switch to non-member org o3 → 403" || { echo "  ✗ non-member switch → $c (want 403)"; fail=1; }

echo ""
[ "$fail" = "0" ] || { echo "AUTH PHASE 2 E2E: FAIL"; echo "--- api.log tail ---"; tail -25 "$SNAP/api.log"; exit 1; }
echo "AUTH PHASE 2 E2E: PASS (FM2 backfilled-email + legacy-handle fallback logins · FM4 door refused owner-only 403 · E6 acting-org switch)"
