#!/usr/bin/env bash
# Deploy smoke — verify the DEPLOYED web origin actually reaches the backend.
#
# This is the layer local /qa never exercises: the Vercel /api/* rewrite proxy
# (next.config.js) + the serverless server-side fetch, both of which bake API_URL
# at build time. A misconfigured API_URL (missing / private / localhost) ships a
# green build whose every /api/* 404s with x-vercel-error: DNS_HOSTNAME_RESOLVED_PRIVATE.
# Run this against the live origin after every deploy.
#
#   apps/web/test/deploy-smoke.sh [BASE_URL]
#   BASE_URL defaults to the production Vercel origin.
set -euo pipefail

BASE="${1:-https://zora-web-omega.vercel.app}"
fail=0
echo "== deploy smoke @ $BASE =="

# 1) The API proxy must reach the backend and return the events list (proves the
#    rewrite target is the public API AND the events.js/collection_store fix is live).
code=$(curl -s -o /tmp/zora-smoke-events.json -w '%{http_code}' "$BASE/api/events?cb=$RANDOM")
n=$(node -e 'try{const d=JSON.parse(require("fs").readFileSync("/tmp/zora-smoke-events.json","utf8"));process.stdout.write(Array.isArray(d)?String(d.length):"-1")}catch{process.stdout.write("-1")}')
if [ "$code" = "200" ] && [ "$n" -gt 0 ] 2>/dev/null; then
  echo "  ✓ GET /api/events -> 200, $n events (proxy reaches backend)"
else
  echo "  ✗ GET /api/events -> HTTP $code, array=$n (proxy NOT reaching backend)"
  err=$(curl -s -D - -o /dev/null "$BASE/api/events" | grep -i '^x-vercel-error:' || true)
  [ -n "$err" ] && echo "     $err  <- API_URL is missing/private in the deployed build"
  fail=1
fi

# 2) The org-login route must exist through the proxy (404 here = proxy dead, not
#    bad creds). Bad creds return 401/400; a dead proxy returns 404.
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/org/login" \
  -H 'content-type: application/json' --data-raw '{"handle":"__smoke__","password":"__smoke__"}')
if [ "$code" = "404" ]; then
  echo "  ✗ POST /api/org/login -> 404 (proxy dead — route unreachable)"; fail=1
else
  echo "  ✓ POST /api/org/login -> $code (route reachable through proxy)"
fi

# 3) A server-rendered page that fetches the API must NOT render the not-found
#    branch (proves the serverless runtime API_URL works, not just the rewrite).
if curl -s "$BASE/events/offshore" | grep -q "could not be found"; then
  echo "  ✗ GET /events/offshore renders 'could not be found' (server-side fetch to API failed)"; fail=1
else
  echo "  ✓ GET /events/offshore renders event data (server-side fetch works)"
fi

echo ""
[ "$fail" = "0" ] && { echo "DEPLOY SMOKE: PASS"; exit 0; } || { echo "DEPLOY SMOKE: FAIL"; exit 1; }
