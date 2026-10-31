#!/usr/bin/env bash
# BS123 analytics beacon: views + daily-unique visitors + source buckets, bots
# ignored, malformed input 204 with nothing stored, no raw ids stored.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_PORT="${TEST_PG_PORT:-55473}"; API_PORT="${TEST_API_PORT:-4148}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-an-XXXXXX")"; SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-ansnap-XXXXXX")"
USER_NAME="$(whoami)"; fail=0
cleanup() { lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA" "$SNAP"; }
trap cleanup EXIT
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_an
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_an"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" settings >/dev/null
( cd "$ROOT/apps/api" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=k node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
B="http://localhost:$API_PORT/api/v/track"; UA='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1 → $2"; else echo "  ✗ $1 → $2 (want $3)"; fail=1; fi; }
post() { curl -s -o /dev/null -w '%{http_code}' -X POST "$B" -H 'content-type: application/json' -A "$1" -d "$2"; }
q() { psql "$URL" -tAc "$1"; }
check "storefront view" "$(post "$UA" '{"kind":"storefront","org":"thebrunchcity","anonId":"a1","referrer":"https://l.instagram.com"}')" 204
post "$UA" '{"kind":"storefront","org":"thebrunchcity","anonId":"a1","referrer":"https://l.instagram.com"}' >/dev/null
post "$UA" '{"kind":"storefront","org":"thebrunchcity","anonId":"a2","utm":"whatsapp"}' >/dev/null
post "$UA" '{"kind":"event","org":"thebrunchcity","event":"brunch-vol-09","anonId":"a1"}' >/dev/null
check "bot ignored (still 204)" "$(post 'facebookexternalhit/1.1' '{"kind":"storefront","org":"thebrunchcity","anonId":"bot"}')" 204
check "malformed 204" "$(post "$UA" '{"kind":"nope","org":"x y"}')" 204
check "instagram views" "$(q "select views from analytics_daily where kind='storefront' and source='instagram'")" 2
check "instagram unique visitors" "$(q "select visitors from analytics_daily where kind='storefront' and source='instagram'")" 1
check "whatsapp via utm" "$(q "select views from analytics_daily where source='whatsapp'")" 1
check "event view direct" "$(q "select views||'/'||source from analytics_daily where kind='event' and event_id='brunch-vol-09'")" "1/direct"
check "bot not stored" "$(q "select coalesce(sum(views),0) from analytics_daily")" 4
check "no raw anon id stored" "$(q "select count(*) from analytics_visitor_day where visitor_hash in ('a1','a2')")" 0
[ "$fail" = 0 ] && echo "ANALYTICS E2E: PASS" || { echo "ANALYTICS E2E: FAIL"; tail -20 "$SNAP/api.log"; exit 1; }
