#!/usr/bin/env bash
# BS47 per-organizer theme gate. Boots the real API on a throwaway Postgres and
# proves the bug is actually fixed, not just moved:
#   1. GET with no handle -> platform default (back-compat, no 500).
#   2. GET ?handle=thebrunchcity -> their real customization (backfilled from
#      the legacy collection_store blob via db/backfill.mjs's syncThemeTable).
#   3. GET ?handle=offshore -> offshore's OWN name, NOT thebrunchcity's brand —
#      this is the exact bug: before BS47 every organizer read the same row.
#   4. PUT is no longer unauthenticated — anon PUT -> 401.
#   5. An organizer's PUT changes ONLY their own row; another organizer's GET
#      is provably unaffected (isolation), and a PUT body claiming a different
#      handle cannot redirect the write (server derives the target from the
#      session, never the body).
# Self-contained (throwaway local Postgres). bash 3.2 compatible.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55442}"
API_PORT="${TEST_API_PORT:-4117}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-theme-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-themesnap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers organizers theme audit admin events kyc"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

echo "== throwaway Postgres @ :$PG_PORT + migrate + backfill (organizers before theme) =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_theme
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_theme"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

echo "== boot API =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

echo "== 1. GET with no handle -> platform default, no 500 =="
d=$(curl -s "$BASE/api/storefront-theme")
echo "$d" | grep -q '"handle":"thebrunchcity"' && echo "  ✓ no-handle GET -> platform default" || { echo "  ✗ no-handle GET: $d"; fail=1; }

echo "== 2. GET ?handle=thebrunchcity -> their real backfilled customization =="
d=$(curl -s "$BASE/api/storefront-theme?handle=thebrunchcity")
if echo "$d" | grep -q '"accent":"#027404"' && echo "$d" | grep -q '"brandName":"The Brunch City"'; then
  echo "  ✓ thebrunchcity's real theme (accent #027404) backfilled from the legacy blob"
else echo "  ✗ thebrunchcity theme: $d"; fail=1; fi

echo "== 3. GET ?handle=offshore -> OFFSHORE'S OWN brand, not thebrunchcity's (THE BUG) =="
d=$(curl -s "$BASE/api/storefront-theme?handle=offshore")
if echo "$d" | grep -q '"handle":"offshore"' && ! echo "$d" | grep -q 'Brunch City' && ! echo "$d" | grep -q '#027404'; then
  echo "  ✓ offshore gets its own default theme, no thebrunchcity bleed-through"
else echo "  ✗ offshore theme leaked thebrunchcity's branding: $d"; fail=1; fi

echo "== 4. PUT is no longer unauthenticated =="
c=$(code -X PUT "$BASE/api/storefront-theme" -H 'content-type: application/json' -d '{"accent":"#000000"}')
[ "$c" = "401" ] && echo "  ✓ anon PUT -> 401" || { echo "  ✗ anon PUT -> $c (want 401)"; fail=1; }

echo "== 5. an organizer's PUT changes ONLY their own row (isolation) =="
al=$(curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}')
echo "$al" | grep -q '"ok":true' || { echo "  ✗ admin login: $al"; fail=1; }
sp=$(curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}')
echo "$sp" | grep -q '"ok":true' || { echo "  ✗ set o1 password: $sp"; fail=1; }
ol=$(curl -s -c "$SNAP/org1" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}')
echo "$ol" | grep -q '"ok":true' || { echo "  ✗ org1 login: $ol"; fail=1; }

# thebrunchcity publishes a new accent
pr=$(curl -s -b "$SNAP/org1" -X PUT "$BASE/api/storefront-theme" -H 'content-type: application/json' -d '{"accent":"#ABCDEF","brandName":"The Brunch City"}')
echo "$pr" | grep -q '"ok":true' && echo "  ✓ thebrunchcity PUT -> ok" || { echo "  ✗ thebrunchcity PUT: $pr"; fail=1; }
d=$(curl -s "$BASE/api/storefront-theme?handle=thebrunchcity")
echo "$d" | grep -q '"accent":"#ABCDEF"' && echo "  ✓ thebrunchcity's own GET reflects the new accent" || { echo "  ✗ thebrunchcity GET after PUT: $d"; fail=1; }

# admin impersonates o2 (offshore) and tries to PUT a body that CLAIMS thebrunchcity's handle
curl -s -b "$SNAP/admin" -c "$SNAP/imp" -X POST "$BASE/api/organizers/o2/impersonate" >/dev/null
pr2=$(curl -s -b "$SNAP/imp" -X PUT "$BASE/api/storefront-theme" -H 'content-type: application/json' -d '{"accent":"#111111","handle":"thebrunchcity","brandName":"Hijacked"}')
echo "$pr2" | grep -q '"ok":true' && echo "  ✓ offshore (impersonated) PUT -> ok" || { echo "  ✗ offshore PUT: $pr2"; fail=1; }

d1=$(curl -s "$BASE/api/storefront-theme?handle=thebrunchcity")
d2=$(curl -s "$BASE/api/storefront-theme?handle=offshore")
if echo "$d1" | grep -q '"accent":"#ABCDEF"' && ! echo "$d1" | grep -q 'Hijacked'; then
  echo "  ✓ thebrunchcity's theme UNCHANGED — a body-supplied handle cannot redirect another organizer's write"
else echo "  ✗ thebrunchcity's theme was overwritten by offshore's PUT: $d1"; fail=1; fi
if echo "$d2" | grep -q '"accent":"#111111"' && echo "$d2" | grep -q '"handle":"offshore"'; then
  echo "  ✓ the write actually landed on offshore's OWN row (session-derived, body ignored)"
else echo "  ✗ offshore's own theme did not update: $d2"; fail=1; fi

[ "$fail" = "0" ] || { echo ""; echo "THEME E2E: FAIL"; cat "$SNAP/api.log" | tail -20; exit 1; }
echo ""
echo "THEME E2E: PASS (default fallback + real backfill + no cross-organizer bleed + PUT auth-gated + session-derived write target, body handle ignored)"
