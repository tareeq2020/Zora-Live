#!/usr/bin/env bash
# BS106 (#183) — ORGANIZER-provisioned scanning. Throwaway Postgres 17 (NEVER
# prod). The scan engine is unchanged; this proves an org can provision its own
# door staff, scoped to its own events, and nothing leaks across orgs:
#
#   T1  owner creates a scanner for an OWNED event → 200 + code + role + scope.
#   T2  that code logs into /api/scan/session and the session is scoped to that event.
#   T3  create with no eventId → 400 event_required (never a NULL/all-events scope).
#   T4  create against an event the org does NOT own → 404.
#   T5  rotate → new code; the door person's live session dies; new code works.
#   T6  revoke → the code stops minting sessions.
#   T7  admin-created scanners (organizer_handle NULL) never appear in the org list,
#       and an org cannot rotate one → 404.
#   T8  another org can neither see nor rotate this org's scanner → 404.
#
# Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55505}"
API_PORT="${TEST_API_PORT:-4205}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-oscan-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-oscansnap-XXXXXX")"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_oscan
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_oscan"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null
psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_oscan -v ON_ERROR_STOP=1 -c "$1"; }

[ "$(psql_one "select count(*) from information_schema.columns where table_name='scanner_user' and column_name='organizer_handle'")" = "1" ] \
  && echo "  ✓ 0026 applied — scanner_user.organizer_handle present" || { echo "  ✗ column missing"; fail=1; }

echo "== seed: thebrunchcity owns ev-A · offshore owns ev-B =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_oscan -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name, city, status) values ('ev-A','Brunch A','dar','published'),('ev-B','Offshore B','dar','published') on conflict do nothing;
update collection_store set data='[
  {"id":"ev-A","name":"Brunch A","city":"dar","status":"published","organizerHandle":"thebrunchcity"},
  {"id":"ev-B","name":"Offshore B","city":"dar","status":"published","organizerHandle":"offshore"}
]' where name='events';
SQL

echo "== boot API =="
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
BASE="http://localhost:$API_PORT"
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(v==null?"":String(v))}catch{process.stdout.write("")}})' "$1"; }
jlen() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);process.stdout.write(String(Array.isArray(a)?a.length:-1))}catch{process.stdout.write("-1")}})'; }

curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o2/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/org" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/off" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"offshore","password":"orgpass123"}' >/dev/null

echo ""
echo "== T1 — create a scanner for an OWNED event =="
R=$(curl -s -b "$SNAP/org" -X POST "$BASE/api/org/scanners" -H 'content-type: application/json' -d '{"name":"Juma Gate A","contact":"0712345678","eventId":"ev-A","role":"supervisor"}')
CODE=$(echo "$R" | jget code); SID=$(echo "$R" | jget id)
[ -n "$CODE" ] && [ "$(echo "$R" | jget role)" = "supervisor" ] && [ "$(echo "$R" | jget eventScope)" = "ev-A" ] && echo "  ✓ created → code issued, role=supervisor, scope=ev-A" || { echo "  ✗ create: $R"; fail=1; }
[ "$(psql_one "select organizer_handle from scanner_user where id='$SID'")" = "thebrunchcity" ] && echo "  ✓ owned by thebrunchcity" || { echo "  ✗ owner wrong"; fail=1; }

echo ""
echo "== T2 — the code logs into /scan, scoped to ev-A =="
SESS=$(curl -s -X POST "$BASE/api/scan/session" -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}")
TOKEN=$(echo "$SESS" | jget token)
[ -n "$TOKEN" ] && echo "  ✓ code → scanner session token" || { echo "  ✗ session: $SESS"; fail=1; }
ME=$(curl -s -H "authorization: Bearer $TOKEN" "$BASE/api/scan/me")
[ "$(echo "$ME" | jget scanner.eventScope)" = "ev-A" ] && echo "  ✓ session scoped to ev-A" || { echo "  ✗ /scan/me: $ME"; fail=1; }

echo ""
echo "== T3 — no event → 400 event_required (never a NULL/all-events scope) =="
C=$(curl -s -o "$SNAP/ne" -w '%{http_code}' -b "$SNAP/org" -X POST "$BASE/api/org/scanners" -H 'content-type: application/json' -d '{"name":"X","contact":"x@y.z"}')
[ "$C" = "400" ] && grep -q '"event_required"' "$SNAP/ne" && echo "  ✓ 400 event_required" || { echo "  ✗ no-event HTTP $C $(cat "$SNAP/ne")"; fail=1; }

echo ""
echo "== T4 — create against an event the org does NOT own → 404 =="
C=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/org" -X POST "$BASE/api/org/scanners" -H 'content-type: application/json' -d '{"name":"X","contact":"x@y.z","eventId":"ev-B"}')
[ "$C" = "404" ] && echo "  ✓ foreign event → 404" || { echo "  ✗ foreign event → $C"; fail=1; }

echo ""
echo "== T5 — rotate: new code, old session dies, new code works =="
sleep 1.1   # code-rotation invalidation is second-granular (token cv = floor(code_rotated_at/1000)); cross a second boundary so rotation post-dates the T2 mint
R2=$(curl -s -b "$SNAP/org" -X POST "$BASE/api/org/scanners/$SID/rotate")
CODE2=$(echo "$R2" | jget code)
[ -n "$CODE2" ] && [ "$CODE2" != "$CODE" ] && echo "  ✓ rotated to a new code" || { echo "  ✗ rotate: $R2"; fail=1; }
DEAD=$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $TOKEN" "$BASE/api/scan/me")
[ "$DEAD" = "401" ] && echo "  ✓ the pre-rotation session is now 401 (door person signed out)" || { echo "  ✗ old session still live: $DEAD"; fail=1; }
NEWSESS=$(curl -s -X POST "$BASE/api/scan/session" -H 'content-type: application/json' -d "{\"code\":\"$CODE2\"}")
[ -n "$(echo "$NEWSESS" | jget token)" ] && echo "  ✓ the new code mints a session" || { echo "  ✗ new code failed: $NEWSESS"; fail=1; }

echo ""
echo "== T6 — revoke: the code stops working =="
curl -s -b "$SNAP/org" -X POST "$BASE/api/org/scanners/$SID/revoke" >/dev/null
RC=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/scan/session" -H 'content-type: application/json' -d "{\"code\":\"$CODE2\"}")
[ "$RC" = "401" ] && echo "  ✓ revoked code → 401 at /scan/session" || { echo "  ✗ revoked code still works: $RC"; fail=1; }

echo ""
echo "== T7 — admin scanners are invisible + untouchable to the org =="
ADM=$(curl -s -b "$SNAP/admin" -X POST "$BASE/api/agents" -H 'content-type: application/json' -d '{"name":"Platform Agent","contact":"a@zora.co","role":"agent"}')
ADM_ID=$(echo "$ADM" | jget id)
LIST=$(curl -s -b "$SNAP/org" "$BASE/api/org/scanners")
echo "$LIST" | grep -q "$ADM_ID" && { echo "  ✗ admin scanner leaked into the org list"; fail=1; } || echo "  ✓ admin-created scanner NOT in the org list"
C=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/org" -X POST "$BASE/api/org/scanners/$ADM_ID/rotate")
[ "$C" = "404" ] && echo "  ✓ org cannot rotate an admin scanner → 404" || { echo "  ✗ org rotated admin scanner → $C"; fail=1; }

echo ""
echo "== T8 — cross-org isolation =="
OFFLIST=$(curl -s -b "$SNAP/off" "$BASE/api/org/scanners" | jlen)
[ "$OFFLIST" = "0" ] && echo "  ✓ offshore sees none of thebrunchcity's scanners (list empty)" || { echo "  ✗ offshore list=$OFFLIST"; fail=1; }
C=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/off" -X POST "$BASE/api/org/scanners/$SID/rotate")
[ "$C" = "404" ] && echo "  ✓ offshore cannot rotate thebrunchcity's scanner → 404" || { echo "  ✗ cross-org rotate → $C"; fail=1; }

echo ""
[ "$fail" = "0" ] && echo "ORG SCANNERS E2E: PASS" || echo "ORG SCANNERS E2E: FAIL"
exit $fail
