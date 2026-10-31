#!/usr/bin/env bash
# BS115 (A9) floor-plan auth gate. Boots the real API on a throwaway Postgres and proves:
#   1. GET /api/floorplan + GET /api/events/:id/floorplan stay public (200).
#   2. PUT /api/events/:id/floorplan — anon 401, another organizer 403, the
#      owning organizer 200 (and the plan reads back), admin impersonating the
#      owner 200.
#   3. PUT /api/floorplan (global fallback plan) — anon 401, organizer 401,
#      admin 200.
# Self-contained (throwaway local Postgres; XBRIDGE_MOCK). bash 3.2 compatible.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55453}"
API_PORT="${TEST_API_PORT:-4128}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-fp-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-fpsnap-XXXXXX")"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_fp
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_fp"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

echo "== boot API (XBRIDGE_MOCK) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
check() { # label got want
  if [ "$2" = "$3" ]; then echo "  ✓ $1 → $2"; else echo "  ✗ $1 → $2 (want $3)"; fail=1; fi
}
PLAN='{"space":{"w":1600,"h":900},"zones":[{"id":"z1","name":"GA FLOOR","type":"ga","x":10,"y":10,"w":200,"h":100,"capacity":150}]}'
put() { curl -s -o /dev/null -w "%{http_code}" -X PUT -H 'content-type: application/json' -d "$PLAN" "$@"; }

echo "== sessions =="
al=$(curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}')
[ "$al" = '{"ok":true}' ] || { echo "  ✗ admin login: $al"; fail=1; }
sp=$(curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}')
echo "$sp" | grep -q '"ok":true' || { echo "  ✗ set organizer password: $sp"; fail=1; }
ol=$(curl -s -c "$SNAP/org" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}')
[ "$ol" = '{"ok":true}' ] || { echo "  ✗ org login: $ol"; fail=1; }

echo "== 1. GETs stay public =="
check "anon GET /api/floorplan" "$(code "$BASE/api/floorplan")" 200
check "anon GET /api/events/brunch-vol-09/floorplan" "$(code "$BASE/api/events/brunch-vol-09/floorplan")" 200

echo "== 2. PUT /api/events/:id/floorplan =="
check "anon PUT brunch-vol-09" "$(put "$BASE/api/events/brunch-vol-09/floorplan")" 401
check "plain admin (no impersonation) PUT brunch-vol-09" "$(put -b "$SNAP/admin" "$BASE/api/events/brunch-vol-09/floorplan")" 401
check "thebrunchcity PUT offshore-001 (another org's event)" "$(put -b "$SNAP/org" "$BASE/api/events/offshore-001/floorplan")" 403
check "thebrunchcity PUT offshore (slug alias, another org's)" "$(put -b "$SNAP/org" "$BASE/api/events/offshore/floorplan")" 403
check "thebrunchcity PUT unknown event" "$(put -b "$SNAP/org" "$BASE/api/events/no-such-event/floorplan")" 403
off=$(curl -s "$BASE/api/events/offshore-001/floorplan")
if echo "$off" | grep -q 'GA FLOOR'; then echo "  ✗ rejected PUT leaked into offshore-001 plan"; fail=1; else echo "  ✓ offshore-001 plan untouched by the rejected PUTs"; fi
check "thebrunchcity PUT brunch-vol-09 (owner)" "$(put -b "$SNAP/org" "$BASE/api/events/brunch-vol-09/floorplan")" 200
got=$(curl -s "$BASE/api/events/brunch-vol-09/floorplan")
if echo "$got" | grep -q 'GA FLOOR'; then echo "  ✓ owner's plan reads back"; else echo "  ✗ plan read-back: $got"; fail=1; fi
curl -s -b "$SNAP/admin" -c "$SNAP/imp" -X POST "$BASE/api/organizers/o2/impersonate" >/dev/null
check "admin impersonating offshore PUT offshore-001" "$(put -b "$SNAP/imp" "$BASE/api/events/offshore-001/floorplan")" 200

echo "== 3. PUT /api/floorplan (global fallback plan) =="
check "anon PUT /api/floorplan" "$(put "$BASE/api/floorplan")" 401
check "organizer PUT /api/floorplan" "$(put -b "$SNAP/org" "$BASE/api/floorplan")" 401
curl -s -c "$SNAP/admin2" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
check "admin PUT /api/floorplan" "$(put -b "$SNAP/admin2" "$BASE/api/floorplan")" 200

[ "$fail" = "0" ] || { echo ""; echo "FLOORPLAN AUTH E2E: FAIL"; tail -20 "$SNAP/api.log"; exit 1; }
echo ""
echo "FLOORPLAN AUTH E2E: PASS (public GETs + owner-only event PUT + admin-only global PUT)"
