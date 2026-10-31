#!/usr/bin/env bash
# BS141 admin Google sign-in: config flag, start redirect + state cookie,
# callback rejects a forged/missing state. (Google itself is not called.)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_PORT="${TEST_PG_PORT:-55483}"; API_PORT="${TEST_API_PORT:-4158}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-g-XXXXXX")"; LOG="$(mktemp)"; USER_NAME="$(whoami)"; fail=0
cleanup() { lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_g
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_g"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" settings admin >/dev/null
boot() { lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
  ( cd "$ROOT/apps/api" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=k PUBLIC_WEB_ORIGIN=https://zorapass.test "$@" node dist/main.js ) >"$LOG" 2>&1 &
  for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done; }
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1 → $2"; else echo "  ✗ $1 → $2 (want $3)"; fail=1; fi; }
B="http://localhost:$API_PORT/api/auth/google"
boot
check "config off without creds" "$(curl -s $B/config)" '{"enabled":false}'
check "start off → login" "$(curl -s -o /dev/null -w '%{redirect_url}' $B/start | sed 's#.*/admin#/admin#')" "/admin/login?error=google_off"
boot GOOGLE_CLIENT_ID=cid.apps.googleusercontent.com GOOGLE_CLIENT_SECRET=sec
check "config on" "$(curl -s $B/config)" '{"enabled":true}'
H=$(curl -s -D - -o /dev/null $B/start)
check "start → google" "$(echo "$H" | grep -i '^location:' | grep -o 'accounts.google.com' | head -1)" accounts.google.com
check "redirect_uri is web origin" "$(echo "$H" | grep -i '^location:' | grep -o 'redirect_uri=https%3A%2F%2Fzorapass.test%2Fapi%2Fauth%2Fgoogle%2Fcallback' | head -1 | wc -l | tr -d ' ')" 1
check "state cookie set httpOnly" "$(echo "$H" | grep -i '^set-cookie: zora_g_state=' | grep -ci httponly)" 1
check "callback no cookie → state error" "$(curl -s -o /dev/null -w '%{redirect_url}' "$B/callback?code=x&state=abc" | sed 's#.*/admin#/admin#')" "/admin/login?error=state"
check "callback forged cookie → state error" "$(curl -s -o /dev/null -w '%{redirect_url}' -H 'Cookie: zora_g_state=abc.forged' "$B/callback?code=x&state=abc" | sed 's#.*/admin#/admin#')" "/admin/login?error=state"
check "password login still works" "$(curl -s -X POST http://localhost:$API_PORT/api/login -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}')" '{"ok":true}'
[ "$fail" = 0 ] && echo "ADMIN GOOGLE E2E: PASS" || { echo "ADMIN GOOGLE E2E: FAIL"; tail -20 "$LOG"; exit 1; }
