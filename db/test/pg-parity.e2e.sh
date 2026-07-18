#!/usr/bin/env bash
# Postgres parity gate. EntityStore is Postgres-only now, so we prove the flip is
# byte-safe against COMMITTED golden fixtures (captured from the old JSON backend
# in db/test/golden/). Backfill a throwaway local Postgres from data/*.json, boot
# the api against it, and assert each endpoint is byte-identical to its fixture.
# Self-contained (throwaway local Postgres; no Supabase). bash 3.2 compatible.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GOLDEN="$ROOT/db/test/golden"
PG_PORT="${TEST_PG_PORT:-55434}"
API_PORT="${TEST_API_PORT:-4109}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-pg-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-snap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers placements theme agents floorplan tickets organizers audit admin kyc media"

# parallel arrays: public endpoint -> fixture file
PUB_PATHS=(/api/settings /api/tiers /api/placements /api/storefront-theme /api/floorplan "/api/tickets/ZORA-OFF1-4471-88AK.svg")
PUB_FIX=(settings.json tiers.json placements.json storefront-theme.json floorplan.json ticket.svg)
# authed endpoint -> fixture (login exercises the migrated 'admin' collection)
AUTH_PATHS=(/api/agents /api/organizers /api/audit /api/kyc)
AUTH_FIX=(agents.json organizers.json audit.json kyc.json)

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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_test
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_test"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

echo "== boot api on Postgres =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.5
( cd "$ROOT/apps/api" && env PORT="$API_PORT" ZORA_DATA_DIR="$ROOT/data" DATABASE_URL="$URL" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 25); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
jar="$SNAP/jar"
login=$(curl -s -c "$jar" -X POST "http://localhost:$API_PORT/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}')
[ "$login" = '{"ok":true}' ] || { echo "FAIL: admin login (from Postgres) returned: $login"; exit 1; }

echo "== diff endpoints vs golden fixtures =="
fail=0
check() { # $1 path, $2 fixture, $3 optional -b jar
  local out="$SNAP/out"; curl -s ${3:+-b "$jar"} "http://localhost:$API_PORT$1" > "$out"
  if diff -q "$out" "$GOLDEN/$2" >/dev/null; then
    echo "  ✓ $1  ($(wc -c < "$GOLDEN/$2" | tr -d ' ') bytes)"
  else echo "  ✗ $1 DIFFERS from golden/$2"; diff "$GOLDEN/$2" "$out" | head -6; fail=1; fi
}
echo "  ✓ /api/login (admin from Postgres) -> {ok:true}"
i=0
while [ $i -lt ${#PUB_PATHS[@]} ]; do check "${PUB_PATHS[$i]}" "${PUB_FIX[$i]}"; i=$((i+1)); done
i=0
while [ $i -lt ${#AUTH_PATHS[@]} ]; do check "${AUTH_PATHS[$i]}" "${AUTH_FIX[$i]}" jar; i=$((i+1)); done

# /api/media has fs-derived 'modified' mtimes -> strip before comparing (golden fixture is also stripped)
curl -s -b "$jar" "http://localhost:$API_PORT/api/media" \
  | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));a.forEach(x=>delete x.modified);process.stdout.write(JSON.stringify(a))' > "$SNAP/media-norm"
if diff -q "$SNAP/media-norm" "$GOLDEN/media.json" >/dev/null; then
  echo "  ✓ /api/media  ($(wc -c < "$GOLDEN/media.json" | tr -d ' ') bytes, modified-stripped)"
else echo "  ✗ /api/media DIFFERS"; diff "$GOLDEN/media.json" "$SNAP/media-norm" | head -6; fail=1; fi

echo "== session: impersonation round-trip (signed cookie carries the claim) =="
curl -s -b "$jar" -c "$jar" -X POST "http://localhost:$API_PORT/api/organizers/o1/impersonate" >/dev/null
imp=$(curl -s -b "$jar" "http://localhost:$API_PORT/api/impersonation")
echo "$imp" | grep -q '"handle":"thebrunchcity"' && echo "  ✓ impersonate -> cookie carries claim" || { echo "  ✗ impersonate: $imp"; fail=1; }
curl -s -b "$jar" -c "$jar" -X POST "http://localhost:$API_PORT/api/impersonate/exit" >/dev/null
imp2=$(curl -s -b "$jar" "http://localhost:$API_PORT/api/impersonation")
[ "$imp2" = '{"impersonating":null}' ] && echo "  ✓ exit -> claim cleared" || { echo "  ✗ exit: $imp2"; fail=1; }

[ "$fail" = "0" ] || { echo ""; echo "PG PARITY: FAIL"; exit 1; }
echo ""
echo "PG PARITY: PASS (api-on-Postgres == golden fixtures for all $(( ${#PUB_PATHS[@]} + ${#AUTH_PATHS[@]} )) endpoints + admin login)"
