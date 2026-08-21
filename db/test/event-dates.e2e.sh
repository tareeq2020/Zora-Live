#!/usr/bin/env bash
# BS101 — structured event dates for the "This Weekend" filter. Throwaway Postgres
# 17 (NEVER prod). Proves:
#   #1  db/backfill-event-dates.mjs parses free-text dateLabels → ISO `date` on the
#       blob ("Sun 30 Aug" → 2026-08-30; "Sat 12 – Mon 14 Sep" → 2026-09-12),
#       leaves already-dated events alone, and reports unparseable ones.
#   #2  the org API round-trips `date`: POST /api/org/events with a date persists
#       it and GET /api/org/events returns it (so the editor can hydrate it).
#   #3  public /api/events exposes `date` (so discover can compute the weekend).
#   #4  a malformed date → 400 date_invalid (never a silently unfiltered event).
#
# The weekend math + label parser themselves are unit-tested (tsx); this covers
# the DB + HTTP wiring. Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55502}"
API_PORT="${TEST_API_PORT:-4202}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-evdates-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-evdatessnap-XXXXXX")"
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

echo "== throwaway Postgres @ :$PG_PORT + migrate + backfill =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_evdates
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_evdates"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_evdates -v ON_ERROR_STOP=1 -c "$1"; }

echo "== seed events with free-text labels + NO structured date (org verified) =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_evdates -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
update organizer set kyc_status='approved' where handle='thebrunchcity';
update collection_store set data = '[
  {"id":"e-aug","name":"Apricot Crush","city":"dar","status":"published","dateLabel":"Sun 30 Aug","organizerHandle":"thebrunchcity"},
  {"id":"e-sep-range","name":"Weekendar","city":"zanzibar","status":"published","dateLabel":"Sat 12 – Mon 14 Sep","organizerHandle":"thebrunchcity"},
  {"id":"e-dated","name":"Already Dated","city":"dar","status":"published","dateLabel":"Fri 1 May","date":"2027-05-01","organizerHandle":"thebrunchcity"},
  {"id":"e-tba","name":"No Date","city":"dar","status":"published","dateLabel":"TBA","organizerHandle":"thebrunchcity"}
]' where name='events';
SQL

echo ""
echo "== #1 — backfill parses labels → ISO date =="
DATABASE_URL="$URL" node "$ROOT/db/backfill-event-dates.mjs" 2>/dev/null | grep -E '(skipped|could not|[0-9] ->)' | sed 's/^/    /' || true
AUG=$(psql_one "select data::jsonb->0->>'date' from collection_store where name='events'")
SEP=$(psql_one "select data::jsonb->1->>'date' from collection_store where name='events'")
DATED=$(psql_one "select data::jsonb->2->>'date' from collection_store where name='events'")
TBA=$(psql_one "select coalesce(data::jsonb->3->>'date','NULL') from collection_store where name='events'")
YEAR=$(date +%Y)
[ "$AUG" = "$YEAR-08-30" ] || [ "$AUG" = "$((YEAR+1))-08-30" ] && echo "  ✓ 'Sun 30 Aug' → $AUG" || { echo "  ✗ aug=$AUG"; fail=1; }
echo "$SEP" | grep -q -- "-09-12" && echo "  ✓ 'Sat 12 – Mon 14 Sep' → $SEP (first day of range)" || { echo "  ✗ sep=$SEP"; fail=1; }
[ "$DATED" = "2027-05-01" ] && echo "  ✓ already-dated event left untouched ($DATED)" || { echo "  ✗ dated=$DATED"; fail=1; }
[ "$TBA" = "NULL" ] && echo "  ✓ unparseable 'TBA' left with no date (reported, not guessed)" || { echo "  ✗ tba=$TBA"; fail=1; }

echo ""
echo "== boot API (x-bridge MOCK) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
BASE="http://localhost:$API_PORT"

echo ""
echo "== #3 — public /api/events exposes the structured date =="
PUB=$(curl -s "$BASE/api/events" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);const e=(Array.isArray(a)?a:a.events||[]).find(x=>x.id==="e-aug");process.stdout.write(e&&e.date?e.date:"NONE")})')
echo "$PUB" | grep -q -- "-08-30" && echo "  ✓ /api/events carries date=$PUB for the discover filter" || { echo "  ✗ public date=$PUB"; fail=1; }

echo ""
echo "== #2/#4 — org API round-trips date; malformed → 400 =="
curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/org" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null

# malformed date → 400 date_invalid
BADC=$(curl -s -o "$SNAP/bad" -w '%{http_code}' -b "$SNAP/org" -X POST "$BASE/api/org/events" -H 'content-type: application/json' \
  -d '{"name":"Bad","dateLabel":"whenever","date":"31/12/2026","city":"dar","venue":"V","category":"Party","priceFrom":1000,"seated":false,"sellable":true,"idempotencyKey":"bad-1","tiers":[{"name":"GA","price":1000,"capacity":10}]}')
[ "$BADC" = "400" ] && grep -q '"date_invalid"' "$SNAP/bad" && echo "  ✓ malformed date → 400 date_invalid" || { echo "  ✗ bad date: HTTP $BADC $(cat "$SNAP/bad")"; fail=1; }

# valid create with a date → 200 and GET returns it
CR=$(curl -s -b "$SNAP/org" -X POST "$BASE/api/org/events" -H 'content-type: application/json' \
  -d '{"name":"Dated Drop","dateLabel":"Sat 5 Sep","date":"2026-09-05","city":"dar","venue":"V","category":"Party","priceFrom":1000,"seated":false,"sellable":true,"idempotencyKey":"ok-1","tiers":[{"name":"GA","price":1000,"capacity":10}]}')
NEWID=$(echo "$CR" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).id||"")}catch{process.stdout.write("")}})')
GOT=$(curl -s -b "$SNAP/org" "$BASE/api/org/events" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);const e=(Array.isArray(a)?a:a.events||[]).find(x=>x.id==="'"$NEWID"'");process.stdout.write(e&&e.date?e.date:"NONE")})')
[ "$GOT" = "2026-09-05" ] && echo "  ✓ POST then GET /api/org/events round-trips date=$GOT (editor can hydrate it)" || { echo "  ✗ round-trip date=$GOT"; fail=1; }

echo ""
[ "$fail" = "0" ] && echo "EVENT DATES E2E: PASS" || echo "EVENT DATES E2E: FAIL"
exit $fail
