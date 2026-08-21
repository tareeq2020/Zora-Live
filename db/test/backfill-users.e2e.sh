#!/usr/bin/env bash
# BS92 (auth Phase 1) — backfill-users failure modes 1 + 5, on a THROWAWAY local
# Postgres 17 (never prod). Proves:
#   FM1  running db/backfill-users.mjs twice creates no duplicate users or
#        memberships (idempotent), and --revert is the exact inverse.
#   FM5  duplicate `handle` / `handle.co` org rows (same owner email) resolve to
#        ONE owner (one app_user), not two, and the money-bearing duplicate is
#        FLAGGED for a manual merge instead of auto-merged.
# Self-contained — needs only Homebrew initdb/pg_ctl/psql. No Supabase, no prod.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${TEST_PG_PORT:-55471}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-bfusers-XXXXXX")"
USER_NAME="$(whoami)"
fail=0

cleanup() { pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT

echo "== throwaway Postgres @ :$PORT + migrate =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PORT" -U "$USER_NAME" zora_bfusers
URL="postgres://$USER_NAME@127.0.0.1:$PORT/zora_bfusers"
Q() { psql -tA -h 127.0.0.1 -p "$PORT" -U "$USER_NAME" -d zora_bfusers -c "$1" | tr -d '[:space:]'; }

DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null

echo "== seed: admin blob, the four seeded orgs (0009), + a duplicate 'thebrunchcity.co' =="
# Admin magic account (collection_store).
Q "insert into collection_store(name,data) values ('admin','{\"username\":\"admin\",\"passwordHash\":\"\$2a\$10\$adminhash\"}');" >/dev/null
# Give o1 a password so we can assert it carries onto the user.
Q "update organizer set password_hash='\$2a\$10\$o1hash' where id='o1';" >/dev/null
# The D5 collision: a second org sharing o1's owner email + trading name, carrying money.
Q "insert into organizer(id,name,handle,email,status,password_hash,revenue,created_at)
   values ('o5','The Brunch City','thebrunchcity.co','hello@thebrunchcity.co','active','\$2a\$10\$o5hash',5000, now()+interval '1 day');" >/dev/null

ORG_N=$(Q "select count(*) from organizer;")
echo "  seeded organizers: $ORG_N (o1..o4 + the duplicate o5)"

echo ""
echo "== FM1a — first backfill run =="
OUT1=$(DATABASE_URL="$URL" node "$ROOT/db/backfill-users.mjs" 2>&1)
echo "$OUT1" | sed 's/^/    /'
U1=$(Q "select count(*) from app_user;")
M1=$(Q "select count(*) from organizer_member;")
R1=$(Q "select count(*) from user_role where role='super_admin';")
# 4 org owners (o1..o4) + 1 admin user = 5 users (o5 shares o1's email → same user).
[ "$U1" = "5" ] && echo "  ✓ 5 app_user rows (4 org owners + admin; o5 shares o1's user)" || { echo "  ✗ app_user=$U1 (want 5)"; fail=1; }
[ "$M1" = "4" ] && echo "  ✓ 4 owner memberships (o1..o4; o5 flagged, not merged)" || { echo "  ✗ memberships=$M1 (want 4)"; fail=1; }
[ "$R1" = "1" ] && echo "  ✓ admin → exactly one super_admin role" || { echo "  ✗ super_admin roles=$R1 (want 1)"; fail=1; }

echo ""
echo "== FM1b — second run is a no-op (idempotent) =="
OUT2=$(DATABASE_URL="$URL" node "$ROOT/db/backfill-users.mjs" 2>&1)
echo "$OUT2" | sed 's/^/    /'
U2=$(Q "select count(*) from app_user;")
M2=$(Q "select count(*) from organizer_member;")
R2=$(Q "select count(*) from user_role;")
[ "$U2" = "$U1" ] && [ "$M2" = "$M1" ] && [ "$R2" = "1" ] \
  && echo "  ✓ re-run created no duplicate users/memberships/roles ($U2 users / $M2 memberships)" \
  || { echo "  ✗ NOT idempotent: users $U1→$U2, memberships $M1→$M2, roles →$R2"; fail=1; }

echo ""
echo "== FM1c — the owner's password_hash carried onto the user =="
PH=$(Q "select case when u.password_hash='\$2a\$10\$o1hash' then 'carried' else coalesce(u.password_hash,'NULL') end
        from app_user u join organizer_member m on m.user_id=u.id where m.organizer_id='o1';")
[ "$PH" = "carried" ] && echo "  ✓ o1's bcrypt hash is on its owner user" || { echo "  ✗ password_hash=$PH"; fail=1; }

echo ""
echo "== FM5 — duplicate handle/.co → ONE owner, not two; money row flagged =="
# The two org rows (o1, o5) share hello@thebrunchcity.co → the SAME app_user.
OWN=$(Q "select count(distinct u.id) from app_user u where lower(u.email)='hello@thebrunchcity.co';")
[ "$OWN" = "1" ] && echo "  ✓ both org rows resolve to ONE owner user (not two)" || { echo "  ✗ distinct owners=$OWN (want 1)"; fail=1; }
# o5 (the money-bearing duplicate) got NO owner membership — it was flagged, not merged.
O5M=$(Q "select count(*) from organizer_member where organizer_id='o5';")
[ "$O5M" = "0" ] && echo "  ✓ the duplicate o5 has no owner membership (money not auto-merged)" || { echo "  ✗ o5 memberships=$O5M (want 0)"; fail=1; }
echo "$OUT1" | grep -q "MANUAL MERGE NEEDED" && echo "  ✓ backfill logged a clear 'MANUAL MERGE NEEDED' warning" \
  || { echo "  ✗ no manual-merge warning was logged"; fail=1; }
# o1 (the primary) keeps its single owner membership.
O1M=$(Q "select count(*) from organizer_member where organizer_id='o1';")
[ "$O1M" = "1" ] && echo "  ✓ the primary o1 keeps exactly one owner membership" || { echo "  ✗ o1 memberships=$O1M (want 1)"; fail=1; }

echo ""
echo "== FM1d — --revert is the exact inverse =="
DATABASE_URL="$URL" node "$ROOT/db/backfill-users.mjs" --revert | sed 's/^/    /'
AFTER=$(Q "select (select count(*) from app_user)||'/'||(select count(*) from organizer_member)||'/'||(select count(*) from user_role);")
[ "$AFTER" = "0/0/0" ] && echo "  ✓ revert emptied users/memberships/roles ($AFTER)" || { echo "  ✗ after revert: $AFTER (want 0/0/0)"; fail=1; }
# …and re-applying after a revert lands the same state (reversible + re-runnable).
DATABASE_URL="$URL" node "$ROOT/db/backfill-users.mjs" >/dev/null
REDO=$(Q "select (select count(*) from app_user)||'/'||(select count(*) from organizer_member);")
[ "$REDO" = "5/4" ] && echo "  ✓ re-applying after revert restores the same state (5 users / 4 memberships)" \
  || { echo "  ✗ re-apply after revert: $REDO (want 5/4)"; fail=1; }

echo ""
[ "$fail" = "0" ] || { echo "BACKFILL-USERS E2E: FAIL"; exit 1; }
echo "BACKFILL-USERS E2E: PASS (FM1 idempotent + reversible backfill · password carried · FM5 duplicate orgs → one owner, money row flagged not merged)"
