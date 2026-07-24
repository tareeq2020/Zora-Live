#!/usr/bin/env bash
# PR-BS6 gate: the Apricot Crush seed lands the event + a split-enabled table tier
# and is idempotent. Self-contained throwaway Postgres.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_PORT="${TEST_PG_PORT:-55440}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-seed-XXXXXX")"
USER_NAME="$(whoami)"
cleanup() { pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT

echo "== throwaway Postgres @ :$PG_PORT + migrate (0001..0007) =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_seed
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_seed"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
psql -q "$URL" -v ON_ERROR_STOP=1 -c "insert into organizer (handle, name, status) values ('thebrunchcity','The Brunch City','active') on conflict do nothing;" >/dev/null

echo "== run seed (twice — must be idempotent) =="
DATABASE_URL="$URL" node "$ROOT/db/seed-apricot-crush.mjs" >/dev/null
DATABASE_URL="$URL" node "$ROOT/db/seed-apricot-crush.mjs" >/dev/null

echo "== assert =="
fail=0
q() { psql -tAq "$URL" -c "$1" | tr -d '[:space:]'; }
[ "$(q "select status from event where id='apricot-crush'")" = "published" ] && echo "  ✓ event published" || { echo "  ✗ event"; fail=1; }
[ "$(q "select split_enabled from product_tier where id='apricot-crush-table'")" = "t" ] && echo "  ✓ table tier split_enabled" || { echo "  ✗ split_enabled"; fail=1; }
[ "$(q "select kind from product_tier where id='apricot-crush-table'")" = "table" ] && echo "  ✓ table tier kind=table" || { echo "  ✗ kind"; fail=1; }
[ "$(q "select price from price_version where tier_id='apricot-crush-table'")" = "900000" ] && echo "  ✓ table price 900000" || { echo "  ✗ price"; fail=1; }
[ "$(q "select capacity from inventory_pool where product_tier_id='apricot-crush-table'")" = "16" ] && echo "  ✓ table pool cap 16" || { echo "  ✗ pool"; fail=1; }
[ "$(q "select count(*) from price_version where tier_id='apricot-crush-table'")" = "1" ] && echo "  ✓ single price_version (idempotent)" || { echo "  ✗ dup price_version"; fail=1; }
DUP=$(node -e "const {execSync}=require('child_process');const d=execSync(\"psql -tAq '$URL' -c \\\"select data from collection_store where name='events'\\\"\").toString();const a=JSON.parse(d);console.log(a.filter(e=>e.id==='apricot-crush').length)")
[ "$DUP" = "1" ] && echo "  ✓ exactly one apricot-crush in events blob (idempotent)" || { echo "  ✗ blob dup: $DUP"; fail=1; }
SPLIT=$(node -e "const {execSync}=require('child_process');const d=execSync(\"psql -tAq '$URL' -c \\\"select data from collection_store where name='events'\\\"\").toString();const a=JSON.parse(d);const e=a.find(x=>x.id==='apricot-crush');console.log(!!(e&&e.webCheckout&&e.webCheckout.tiers.find(t=>t.tierId==='apricot-crush-table'&&t.split)))")
[ "$SPLIT" = "true" ] && echo "  ✓ webCheckout has split:true on the table tier" || { echo "  ✗ webCheckout split flag"; fail=1; }

[ "$fail" = "0" ] && echo "" && echo "PR-BS6 APRICOT CRUSH SEED: PASS" || { echo "SEED TEST FAILED"; exit 1; }
