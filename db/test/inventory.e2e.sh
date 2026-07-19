#!/usr/bin/env bash
# PR-6 gate: atomic inventory invariants + credential signing. Self-contained
# (throwaway local Postgres; no Supabase). bash 3.2 compatible. Proves the
# oversell defense and the credential HMAC round-trip.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_PORT="${TEST_PG_PORT:-55435}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-inv-XXXXXX")"
USER_NAME="$(whoami)"

cleanup() { pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT

echo "== throwaway Postgres @ :$PG_PORT + migrate (0001..0003) =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_inv
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_inv"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null

echo "== atomic inventory invariants =="
PSQL="psql -q -h 127.0.0.1 -p $PG_PORT -U $USER_NAME -d zora_inv -v ON_ERROR_STOP=1"
$PSQL >/dev/null <<'SQL'
-- seed: an event + two tiers with pools (cap 2 and cap 1)
insert into event (id, name) values ('e-test', 'Test Event') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values
  ('t-test',  'e-test', 'GA', 2),
  ('t-test2', 'e-test', 'VIP', 1) on conflict do nothing;
insert into inventory_pool (product_tier_id, capacity, available_count) values
  ('t-test', 2, 2), ('t-test2', 1, 1) on conflict do nothing;
SQL

$PSQL <<'SQL'
do $$
declare h uuid; n int; av int; sc int; rc int;
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); o3 uuid := gen_random_uuid(); b1 uuid := gen_random_uuid();
begin
  -- hold 1 -> available 2->1
  h := place_inventory_hold('t-test', o1, 1, 900);  assert h is not null, 'hold1 should succeed';
  select available_count into av from inventory_pool where product_tier_id='t-test'; assert av = 1, 'avail=1 after hold1, got '||av;
  -- hold 2 -> available 1->0
  h := place_inventory_hold('t-test', o2, 1, 900);  assert h is not null, 'hold2 should succeed';
  select available_count into av from inventory_pool where product_tier_id='t-test'; assert av = 0, 'avail=0 after hold2, got '||av;
  -- OVERSELL: hold 3 -> NULL, available stays 0
  h := place_inventory_hold('t-test', o3, 1, 900);  assert h is null, 'oversell hold3 must be NULL';
  select available_count into av from inventory_pool where product_tier_id='t-test'; assert av = 0, 'avail stays 0 on oversell';
  -- convert o1 -> sold+1, available UNCHANGED
  n := convert_order_holds(o1); assert n = 1, 'convert o1 = 1';
  select available_count, sold_count into av, sc from inventory_pool where product_tier_id='t-test';
  assert av = 0, 'convert must NOT touch available'; assert sc = 1, 'sold=1 after convert';
  -- release o2 -> available 0->1
  perform release_order_holds(o2);
  select available_count, sold_count into av, sc from inventory_pool where product_tier_id='t-test';
  assert av = 1, 'release restores avail=1, got '||av; assert sc = 1, 'sold unchanged on release';
  -- idempotent: converting already-released holds = 0
  n := convert_order_holds(o2); assert n = 0, 'convert of released = 0';
  -- reservation quartet on the last available unit
  h := reserve_inventory('t-test','booking', b1, 1, 3600); assert h is not null, 'reserve ok';
  select available_count, reserved_count into av, rc from inventory_pool where product_tier_id='t-test';
  assert av = 0 and rc = 1, 'reserve moves available->reserved';
  n := convert_reservation('booking', b1); assert n = 1, 'convert reservation = 1';
  select available_count, sold_count, reserved_count into av, sc, rc from inventory_pool where product_tier_id='t-test';
  assert av = 0 and sc = 2 and rc = 0, 'reservation->sold; av='||av||' sc='||sc||' rc='||rc;
  -- ceiling invariant holds throughout
  assert (select available_count+sold_count+blocked_count+reserved_count from inventory_pool where product_tier_id='t-test') <= 2, 'ceiling breached';
  -- sweep of an already-expired reservation (ttl -1) on the VIP pool
  h := reserve_inventory('t-test2','order', gen_random_uuid(), 1, -1); assert h is not null, 'expired reserve ok';
  select available_count into av from inventory_pool where product_tier_id='t-test2'; assert av = 0, 'reserved down';
  n := sweep_expired_reservations(); assert n >= 1, 'sweep releases >=1';
  select available_count, reserved_count into av, rc from inventory_pool where product_tier_id='t-test2';
  assert av = 1 and rc = 0, 'sweep restores avail=1 rc=0';
  raise notice 'INVENTORY: all invariants hold';
end $$;
SQL
echo "  ✓ hold / oversell-NULL / convert-keeps-available / release / reservation / sweep"
echo "  ✓ capacity_not_exceeded CHECK held throughout"

echo "== credential signing (HMAC round-trip + rotation + tamper) =="
node -e '
const c = require("'"$ROOT"'/packages/core/dist/credentials.js");
const claims = { code: c.generateCode(), tier: "GA", eventId: "e-test", tableId: null };
const K1 = "key-one", K2 = "key-two";
const sig = c.signCredential(claims, K1);
if (!c.verifyCredential(claims, sig, [K1])) throw new Error("verify with signing key failed");
if (!c.verifyCredential(claims, sig, [K2, K1])) throw new Error("rotation: verify with key in list failed");
if (c.verifyCredential(claims, sig, [K2])) throw new Error("must NOT verify under wrong key");
if (c.verifyCredential({ ...claims, tier: "VIP" }, sig, [K1])) throw new Error("tampered claims must fail");
if (c.verifyCredential(claims, "zz", [K1])) throw new Error("bad hex must fail");
const qr = c.qrPayload(claims.code, sig);
if (!qr.startsWith("zora:")) throw new Error("QR scheme wrong");
if (!/^ZORA-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(c.generatePublicRef())) throw new Error("public ref format wrong");
console.log("  ✓ sign/verify, key-list rotation, tamper + bad-hex rejected, QR + public_ref format");
'

echo ""
echo "PR-6 INVENTORY + CREDENTIALS: PASS"
