#!/usr/bin/env bash
# BS162: deploy hand-off for the singleton worker.
#   1. a second worker started while the first holds the lock WAITS (standby),
#      it does not exit (Render read every exit as "service failed").
#   2. SIGTERM on the first releases the lock and exits 0 promptly.
#   3. the standby takes over within the retry interval.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_PORT="${TEST_PG_PORT:-56390}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-whand-XXXXXX")"
LOGS="$(mktemp -d "${TMPDIR:-/tmp}/zora-whandlog-XXXXXX")"
USER_NAME="$(whoami)"
fail=0; P1=""; P2=""
cleanup() { [ -n "$P1" ] && kill -9 "$P1" 2>/dev/null || true; [ -n "$P2" ] && kill -9 "$P2" 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA" "$LOGS"; }
trap cleanup EXIT
ok() { echo "  ✓ $1"; }; bad() { echo "  ✗ $1"; fail=1; }

echo "== build core + worker; throwaway Postgres @ :$PG_PORT + migrate =="
(cd "$ROOT" && pnpm --filter "@zora/core" build >/dev/null 2>&1 && pnpm --filter "@zora/worker..." build >/dev/null 2>&1)
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_wh
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_wh"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null

# exec so $! is the node process itself (SIGTERM must reach the worker).
run_worker() { ( cd "$ROOT/apps/worker" && exec env DATABASE_URL="$URL" XBRIDGE_MOCK=true SMS_DRIVER=mock EMAIL_DRIVER=mock \
  WORKER_LOCK_RETRY_MS=500 PG_POOL_MAX=4 node dist/main.js ) >"$1" 2>&1 & }
wait_for() { for i in $(seq 1 60); do grep -q "$2" "$1" 2>/dev/null && return 0; sleep 0.25; done; return 1; }

echo "== 1. first worker takes the lock =="
run_worker "$LOGS/w1.log"; P1=$!
wait_for "$LOGS/w1.log" "advisory lock acquired" && ok "worker 1 owns the loops" || bad "worker 1 never acquired the lock"

echo "== 2. second worker waits instead of exiting =="
run_worker "$LOGS/w2.log"; P2=$!
wait_for "$LOGS/w2.log" "standby" && ok "worker 2 is in standby" || bad "worker 2 did not report standby"
sleep 2
kill -0 "$P2" 2>/dev/null && ok "worker 2 is still running after 2 s (no exit = no 'service failed')" || bad "worker 2 exited"
grep -q "advisory lock acquired" "$LOGS/w2.log" && bad "worker 2 took the lock while worker 1 held it" || ok "worker 2 did not take the lock early"

echo "== 3. SIGTERM on worker 1 releases the lock and exits 0 =="
T0=$(date +%s)
kill -TERM "$P1"
set +e; wait "$P1"; RC=$?; set -e; P1=""
[ "$RC" = "0" ] && ok "worker 1 exited 0 on SIGTERM" || bad "worker 1 exit code $RC"
grep -q "stopped cleanly, lock released" "$LOGS/w1.log" && ok "worker 1 logged a clean stop with the lock released" || bad "worker 1 no clean-stop line"

echo "== 4. standby takes over promptly =="
wait_for "$LOGS/w2.log" "advisory lock acquired after" && ok "worker 2 took over ($(( $(date +%s) - T0 ))s after SIGTERM)" || bad "worker 2 never took over"

echo "== 5. SIGTERM on a standby worker also exits 0 (Render may stop it mid-wait) =="
run_worker "$LOGS/w3.log"; P3=$!
wait_for "$LOGS/w3.log" "standby" || true
kill -TERM "$P3"; set +e; wait "$P3"; RC3=$?; set -e
[ "$RC3" = "0" ] && ok "standby worker exited 0 on SIGTERM" || bad "standby worker exit code $RC3"

kill -TERM "$P2" 2>/dev/null; set +e; wait "$P2"; set -e; P2=""
echo ""
[ "$fail" = 0 ] && echo "WORKER HANDOFF E2E: PASS (standby instead of exit · clean SIGTERM release · prompt takeover)" || { echo "WORKER HANDOFF E2E: FAIL"; for f in "$LOGS"/*.log; do echo "--- $f"; tail -5 "$f"; done; exit 1; }
