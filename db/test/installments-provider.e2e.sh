#!/usr/bin/env bash
# BS133 gate: installment provider adapter (x-bridge /v1 receivables behind
# XBRIDGE_V1, /collection/* + mock by default) and the signed receivable webhook.
# Throwaway Postgres 17 (NEVER prod), x-bridge MOCK.
#   1. installments-provider.harness.cjs — signature, rails, push rate limit,
#      webhook allocation / dedup / reprocess / overpaid / expired, refusals.
#   2. HTTP: POST /api/webhooks/xbridge/receivables — unsigned 401, signed 200
#      (allocates), replay deduped; pay route returns 429 + Retry-After on the cap.
# Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_PORT="${TEST_PG_PORT:-55534}"
API_PORT="${TEST_API_PORT:-4234}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-instp-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-instpsnap-XXXXXX")"
USER_NAME="$(whoami)"
SECRET="e2e-webhook-secret"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

echo "== build @zora/core + @zora/api =="
(cd "$ROOT" && pnpm --filter "@zora/core" build >/dev/null 2>&1)
(cd "$ROOT" && pnpm --filter "@zora/api" build >/dev/null 2>&1)

echo "== throwaway Postgres @ :$PG_PORT + migrate =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_instp
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_instp"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_instp -v ON_ERROR_STOP=1 -c "$1"; }

psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_instp -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('e-prov', 'Provider Test');
insert into product_tier (id, event_id, name, capacity) values ('t-prov', 'e-prov', 'GA', 20);
insert into price_version (tier_id, price, currency, fee_treatment) values ('t-prov', 60000, 'TZS', 'passed');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-prov', 20, 20);
insert into installment_config (event_id, enabled, deposit_pct, count, frequency, final_due_days_before_event, grace_days)
values ('e-prov', true, 25, 3, 'monthly', 7, 3);
SQL
[ "$(psql_one "select count(*) from information_schema.columns where table_name='payment_transaction' and column_name='provider'")" = "1" ] \
  && echo "  ✓ 0033: payment_transaction.provider" || { echo "  ✗ 0033 missing"; fail=1; }

echo "== 1. core harness =="
DATABASE_URL="$URL" TICKET_SIGNING_KEY="test-key-1" PG_PREPARE=false XBRIDGE_MOCK=true SMS_DRIVER=mock EMAIL_DRIVER=mock \
  XBRIDGE_WEBHOOK_SECRET="$SECRET" node "$ROOT/db/test/installments-provider.harness.cjs" || fail=1

echo "== 2. HTTP webhook + pay-route cap =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$ROOT/apps/api" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true XBRIDGE_V1=1 XBRIDGE_WEBHOOK_SECRET="$SECRET" \
    COOKIE_SECURE=false SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key SMS_DRIVER=mock EMAIL_DRIVER=mock \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
BASE="http://localhost:$API_PORT"

# An installment order created through core, paid through the HTTP pay route (v1 rail).
ORDER=$(DATABASE_URL="$URL" PG_PREPARE=false node -e '
const c = require(process.argv[1]);
(async () => { const sql = c.db(); const cfg = await c.readInstallmentConfig(sql, "e-prov");
  const r = await c.createInstallmentOrder(sql, { phone: "255700000299", email: "h@b.tz", cart: [{ tier: "t-prov", quantity: 1 }],
    feeRate: 0, holdTtl: 900, config: cfg, eventDate: "2027-03-01", today: "2026-11-01" });
  process.stdout.write(r.orderId); await sql.end(); })();' "$ROOT/packages/core/dist/index.js")
PAY=$(curl -s -X POST "$BASE/api/checkout/$ORDER/pay" -H 'content-type: application/json' -d '{"method":"mobile","payerPhone":"0700000299"}')
TXN=$(echo "$PAY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).transactionId||""))')
RCV=$(psql_one "select receivable_id from installment_plan where order_id = '$ORDER'")
[ -n "$TXN" ] && [ "$RCV" = "MOCK-RCV-$ORDER" ] && echo "  ✓ HTTP pay on the v1 rail opened receivable $RCV" || { echo "  ✗ pay: $PAY rcv=$RCV"; fail=1; }

BODY="{\"id\":\"evt_http_1\",\"type\":\"receivable.partially_paid\",\"data\":{\"receivable\":{\"id\":\"$RCV\"},\"payment\":{\"id\":\"p1\",\"idempotencyKey\":\"$TXN\",\"amount\":15000}}}"
SIG=$(BODY="$BODY" S="$SECRET" node -e 'process.stdout.write("v1="+require("crypto").createHmac("sha256",process.env.S).update(process.env.BODY).digest("hex"))')
CODE=$(curl -s -o "$SNAP/w0" -w '%{http_code}' -X POST "$BASE/api/webhooks/xbridge/receivables" -H 'content-type: application/json' --data-binary "$BODY")
[ "$CODE" = "401" ] && echo "  ✓ unsigned webhook → 401" || { echo "  ✗ unsigned: $CODE $(cat "$SNAP/w0")"; fail=1; }
CODE=$(curl -s -o "$SNAP/w1" -w '%{http_code}' -X POST "$BASE/api/webhooks/xbridge/receivables" -H 'content-type: application/json' -H "X-Bridge-Signature: $SIG" --data-binary "$BODY")
ST=$(psql_one "select status from \"order\" where id = '$ORDER'")
[ "$CODE" = "200" ] && [ "$ST" = "installment_active" ] && echo "  ✓ signed webhook → 200, deposit allocated → installment_active" || { echo "  ✗ signed: $CODE $(cat "$SNAP/w1") status=$ST"; fail=1; }
CODE=$(curl -s -o "$SNAP/w2" -w '%{http_code}' -X POST "$BASE/api/webhooks/xbridge/receivables" -H 'content-type: application/json' -H "X-Bridge-Signature: $SIG" --data-binary "$BODY")
[ "$CODE" = "200" ] && grep -q '"deduped":true' "$SNAP/w2" && echo "  ✓ replay → 200 deduped" || { echo "  ✗ replay: $CODE $(cat "$SNAP/w2")"; fail=1; }

# push cap over HTTP: three failed pushes for row 2 inside the window, then a 4th → 429.
psql_one "insert into payment_transaction (order_id, transaction_id, method, amount, status, schedule_n) select '$ORDER', 'CAP-'||g, 'mobile', 1, 'failed', 2 from generate_series(1,3) g" >/dev/null
CODE=$(curl -s -D "$SNAP/h3" -o "$SNAP/p3" -w '%{http_code}' -X POST "$BASE/api/checkout/$ORDER/pay" -H 'content-type: application/json' -d '{"method":"mobile","payerPhone":"0700000299"}')
[ "$CODE" = "429" ] && grep -qi '^retry-after:' "$SNAP/h3" && grep -q push_rate_limited "$SNAP/p3" \
  && echo "  ✓ 4th push in 10 min → 429 push_rate_limited + Retry-After" || { echo "  ✗ cap: $CODE $(cat "$SNAP/p3")"; fail=1; }

[ "$fail" = "0" ] || { echo ""; echo "INSTALLMENT PROVIDER E2E: FAIL"; tail -30 "$SNAP/api.log"; exit 1; }
echo ""
echo "BS133 INSTALLMENT PROVIDER E2E: PASS"
