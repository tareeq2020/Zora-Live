#!/usr/bin/env bash
# BS50 "mega event" pin gate. Boots the real API on a throwaway Postgres and
# proves:
#   1. Unauthenticated PUT /api/events/:id/mega -> 401.
#   2. Setting mega=true on offshore-001 (dar) -> that event carries mega:true
#      on the public /api/events read discover.tsx consumes directly.
#   3. Setting mega=true on basement-001 (ALSO dar) un-pins offshore-001 — at
#      most one mega event per city.
#   4. Setting mega=true on palmwine-festival (lagos) does NOT touch
#      basement-001's dar pin — cities are independent.
#   5. Unsetting (mega=false) removes the flag without touching any other
#      event.
#   6. Unknown event id -> 404.
# Self-contained (throwaway local Postgres). bash 3.2 compatible.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55444}"
API_PORT="${TEST_API_PORT:-4119}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-mega-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-megasnap-XXXXXX")"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_mega
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_mega"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

echo "== boot API =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
mega_of() { curl -s "$BASE/api/events" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s);const e=a.find(x=>x.id==='$1');process.stdout.write(e&&e.mega?'true':'false')})"; }

echo "== 1. unauthenticated PUT -> 401 =="
c=$(code -X PUT "$BASE/api/events/offshore-001/mega" -H 'content-type: application/json' -d '{"mega":true}')
[ "$c" = "401" ] && echo "  ✓ anon PUT -> 401" || { echo "  ✗ anon PUT -> $c (want 401)"; fail=1; }

al=$(curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}')
echo "$al" | grep -q '"ok":true' || { echo "  ✗ admin login: $al"; fail=1; }

echo "== 2. set offshore-001 (dar) as mega -> shows on the public /api/events read =="
pr=$(curl -s -b "$SNAP/admin" -X PUT "$BASE/api/events/offshore-001/mega" -H 'content-type: application/json' -d '{"mega":true}')
echo "$pr" | grep -q '"mega":true' && echo "  ✓ PUT -> ok" || { echo "  ✗ PUT: $pr"; fail=1; }
[ "$(mega_of offshore-001)" = "true" ] && echo "  ✓ offshore-001.mega=true on /api/events" || { echo "  ✗ offshore-001 not mega on public read"; fail=1; }

echo "== 3. basement-001 (ALSO dar) becomes mega -> offshore-001 un-pinned (per-city invariant) =="
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/events/basement-001/mega" -H 'content-type: application/json' -d '{"mega":true}' >/dev/null
[ "$(mega_of basement-001)" = "true" ] && echo "  ✓ basement-001.mega=true" || { echo "  ✗ basement-001 not mega"; fail=1; }
[ "$(mega_of offshore-001)" = "false" ] && echo "  ✓ offshore-001 auto-unpinned (same city, one mega at a time)" || { echo "  ✗ offshore-001 still mega — invariant broken"; fail=1; }

echo "== 4. palmwine-festival (lagos) becomes mega -> basement-001's DAR pin is UNTOUCHED =="
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/events/palmwine-festival/mega" -H 'content-type: application/json' -d '{"mega":true}' >/dev/null
[ "$(mega_of palmwine-festival)" = "true" ] && echo "  ✓ palmwine-festival.mega=true" || { echo "  ✗ palmwine-festival not mega"; fail=1; }
[ "$(mega_of basement-001)" = "true" ] && echo "  ✓ basement-001 (dar) STILL mega — cities are independent" || { echo "  ✗ basement-001 was wrongly cleared by a different city's pin"; fail=1; }

echo "== 5. unpin basement-001 -> only that event changes =="
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/events/basement-001/mega" -H 'content-type: application/json' -d '{"mega":false}' >/dev/null
[ "$(mega_of basement-001)" = "false" ] && echo "  ✓ basement-001 unpinned" || { echo "  ✗ basement-001 still mega"; fail=1; }
[ "$(mega_of palmwine-festival)" = "true" ] && echo "  ✓ palmwine-festival (lagos) untouched by dar's unpin" || { echo "  ✗ palmwine-festival wrongly cleared"; fail=1; }

echo "== 6. unknown event id -> 404 =="
c=$(code -b "$SNAP/admin" -X PUT "$BASE/api/events/does-not-exist/mega" -H 'content-type: application/json' -d '{"mega":true}')
[ "$c" = "404" ] && echo "  ✓ unknown id -> 404" || { echo "  ✗ unknown id -> $c (want 404)"; fail=1; }

[ "$fail" = "0" ] || { echo ""; echo "MEGA EVENT E2E: FAIL"; cat "$SNAP/api.log" | tail -20; exit 1; }
echo ""
echo "MEGA EVENT E2E: PASS (auth-gated · public read carries mega · per-city invariant · cities independent · unpin · 404)"
