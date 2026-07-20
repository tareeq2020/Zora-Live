#!/usr/bin/env bash
# MT1 org-scoping spine gate. Boots the real API on a throwaway Postgres and proves:
#   1. OrganizerGuard matrix on GET /api/org/me — real organizer 200, admin
#      impersonating 200 (acting as that org), plain admin 401, anon 401.
#   2. Ownership (OrgScopeService.ownedEventIds / assertOwnsEvent) — org A cannot
#      resolve org B's event (404), and does resolve its own.
#   3. Public-read status filter (C5) — a draft + an archived event are ABSENT from
#      /api/events and 404 on /api/events/:id, while the status-less legacy events
#      stay visible.
# Self-contained (throwaway local Postgres; XBRIDGE_MOCK). bash 3.2 compatible.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55438}"
API_PORT="${TEST_API_PORT:-4113}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-org-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-orgsnap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers organizers audit admin events kyc"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

echo "== throwaway Postgres @ :$PG_PORT + migrate (0001..0005) + backfill =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_org
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_org"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

echo "== inject a draft + an archived event into the 'events' blob (real EntityStore) =="
cat > "$SNAP/seed-status.js" <<'JS'
const { EntityStore } = require(process.env.API_DIR + '/dist/storage/entity-store.js');
(async () => {
  const es = new EntityStore();
  const events = await es.read('events', []);
  events.push({ id: 'draft-ev',    name: 'Draft Event',    city: 'dar', organizerHandle: 'offshore', status: 'draft',    priceFrom: 10000 });
  events.push({ id: 'archived-ev', name: 'Archived Event', city: 'dar', organizerHandle: 'offshore', status: 'archived', priceFrom: 10000 });
  await es.write('events', events);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
JS
API_DIR="$API_DIR" DATABASE_URL="$URL" node "$SNAP/seed-status.js"

echo "== boot API (XBRIDGE_MOCK) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

echo "== 1. OrganizerGuard matrix on GET /api/org/me =="
# anon → 401
c=$(code "$BASE/api/org/me")
[ "$c" = "401" ] && echo "  ✓ anon → 401" || { echo "  ✗ anon → $c (want 401)"; fail=1; }

# admin login
al=$(curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}')
[ "$al" = '{"ok":true}' ] || { echo "  ✗ admin login: $al"; fail=1; }

# plain admin (no impersonation) → 401
c=$(code -b "$SNAP/admin" "$BASE/api/org/me")
[ "$c" = "401" ] && echo "  ✓ plain admin (no impersonation) → 401" || { echo "  ✗ plain admin → $c (want 401)"; fail=1; }

# give organizer o1 (thebrunchcity) a login credential (admin-only route)
sp=$(curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}')
echo "$sp" | grep -q '"ok":true' || { echo "  ✗ set organizer password: $sp"; fail=1; }

# real organizer session → 200 acting as thebrunchcity, not impersonating
ol=$(curl -s -c "$SNAP/org" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}')
[ "$ol" = '{"ok":true}' ] || { echo "  ✗ org login: $ol"; fail=1; }
me_org=$(curl -s -b "$SNAP/org" "$BASE/api/org/me")
if echo "$me_org" | grep -q '"actingHandle":"thebrunchcity"' && echo "$me_org" | grep -q '"impersonating":null'; then
  echo "  ✓ real organizer → 200 actingHandle=thebrunchcity, impersonating=null"
else echo "  ✗ organizer /api/org/me: $me_org"; fail=1; fi

# admin impersonating o2 (offshore) → 200 acting as offshore
curl -s -b "$SNAP/admin" -c "$SNAP/admin" -X POST "$BASE/api/organizers/o2/impersonate" >/dev/null
me_imp=$(curl -s -b "$SNAP/admin" "$BASE/api/org/me")
if echo "$me_imp" | grep -q '"actingHandle":"offshore"' && echo "$me_imp" | grep -q '"impersonating"'; then
  echo "  ✓ admin impersonating → 200 actingHandle=offshore (via impersonation)"
else echo "  ✗ impersonating /api/org/me: $me_imp"; fail=1; fi

echo "== 2. Ownership — org A cannot resolve org B's event (OrgScopeService) =="
cat > "$SNAP/ownership.js" <<'JS'
const { EntityStore } = require(process.env.API_DIR + '/dist/storage/entity-store.js');
const { OrgScopeService } = require(process.env.API_DIR + '/dist/org/org-scope.service.js');
(async () => {
  const svc = new OrgScopeService(new EntityStore());
  const owned = await svc.ownedEventIds('offshore');
  const ownsOwn = owned.includes('offshore-001');
  const excludesOther = !owned.includes('brunch-vol-09');
  let resolvedOwn = false, threw404 = false;
  try { const ev = await svc.assertOwnsEvent('offshore', 'offshore-001'); resolvedOwn = !!ev && ev.id === 'offshore-001'; } catch (e) {}
  try { await svc.assertOwnsEvent('offshore', 'brunch-vol-09'); }
  catch (e) { threw404 = typeof e.getStatus === 'function' && e.getStatus() === 404; }
  const ok = ownsOwn && excludesOther && resolvedOwn && threw404;
  console.log('  ' + (ok ? '✓' : '✗') + ' ownedEventIds/assertOwnsEvent: ' +
    JSON.stringify({ ownsOwn, excludesOther, resolvedOwn, threw404 }));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
JS
if API_DIR="$API_DIR" DATABASE_URL="$URL" node "$SNAP/ownership.js"; then :; else fail=1; fi

echo "== 3. Public-read status filter (C5) =="
listing=$(curl -s "$BASE/api/events")
n=$(echo "$listing" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(Array.isArray(d)?String(d.length):"ERR")')
# 7 status-less legacy events stay visible; draft-ev + archived-ev filtered out.
[ "$n" = "7" ] && echo "  ✓ /api/events → 7 events (status-less legacy events present)" || { echo "  ✗ /api/events count = $n (want 7)"; fail=1; }
if echo "$listing" | grep -q 'draft-ev' || echo "$listing" | grep -q 'archived-ev'; then
  echo "  ✗ /api/events leaks a draft/archived event"; fail=1
else echo "  ✓ /api/events excludes the draft + archived events"; fi
# a known status-less legacy event is still individually reachable
c=$(code "$BASE/api/events/offshore-001"); [ "$c" = "200" ] && echo "  ✓ /api/events/offshore-001 → 200 (legacy status-less)" || { echo "  ✗ /api/events/offshore-001 → $c"; fail=1; }
c=$(code "$BASE/api/events/draft-ev");    [ "$c" = "404" ] && echo "  ✓ /api/events/draft-ev → 404 (hidden draft)" || { echo "  ✗ /api/events/draft-ev → $c (want 404)"; fail=1; }
c=$(code "$BASE/api/events/archived-ev"); [ "$c" = "404" ] && echo "  ✓ /api/events/archived-ev → 404 (hidden archived)" || { echo "  ✗ /api/events/archived-ev → $c (want 404)"; fail=1; }

[ "$fail" = "0" ] || { echo ""; echo "ORG SCOPE E2E: FAIL"; cat "$SNAP/api.log" | tail -20; exit 1; }
echo ""
echo "ORG SCOPE E2E: PASS (guard matrix + ownership 404 + public-read status filter)"
