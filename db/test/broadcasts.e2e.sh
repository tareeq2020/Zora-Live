#!/usr/bin/env bash
# BS43 / plan #2 — BULK SMS + EMAIL. Messaging costs the organizer real money and
# reaches real phones, so the suite boots the real API (and the real worker) on a
# throwaway Postgres and proves:
#
#   1. Migration 0013 applied: broadcast + broadcast_recipient + message_suppression
#      with the drain index (an unindexed queue is a full scan every tick).
#   2. The AUDIENCE COUNT is correct and cheap — per event, per tier, per org.
#   3. **SCOPE ISOLATION: an organizer CANNOT target another organizer's buyers.**
#      Previewing and sending to a foreign event are both refused, nothing is
#      written, and an "all my customers" blast contains none of the other org's
#      phone numbers.
#   4. An UNVERIFIED organizer can compose/preview but CANNOT send (OV5).
#   5. The cost-confirm gate has real numbers: segments × recipients × unit price.
#   6. **OPT-OUT is honoured**: the unsubscribe link suppresses, a GET never
#      unsubscribes on its own, an already-queued message is cancelled, and the
#      next broadcast never materializes that address at all.
#   7. The per-org MONTHLY SMS CAP is enforced server-side (OV5).
#   8. **The worker drains in BOUNDED BATCHES and reconcile keeps running**
#      (ARCH-4) — a large broadcast must never starve payment reconciliation.
#   9. Admin can broadcast at any scope; an organizer session cannot reach the
#      admin surface at all.
#
# Style/harness mirrors payouts.e2e.sh (throwaway PG, XBRIDGE_MOCK, real HTTP
# checkout→pay). Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
WORKER_DIR="$ROOT/apps/worker"
PG_PORT="${TEST_PG_PORT:-55449}"
API_PORT="${TEST_API_PORT:-4124}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-bcast-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-bcastsnap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers organizers audit admin events kyc"
# Small on purpose: the cap test has to be reachable in a handful of sends, and a
# small cap proves the gate the same way a production one does.
CAP=6
fail=0

cleanup() {
  [ -n "${WORKER_PID:-}" ] && kill -9 "$WORKER_PID" 2>/dev/null || true
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

echo "== throwaway Postgres @ :$PG_PORT + migrate (0001..0016) + backfill =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_bcast
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_bcast"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_bcast -v ON_ERROR_STOP=1 -c "$1"; }

echo ""
echo "== 1. MIGRATION 0015 — the queue exists AND is indexed =="
T_B=$(psql_one "select count(*) from information_schema.tables where table_name='broadcast'")
T_R=$(psql_one "select count(*) from information_schema.tables where table_name='broadcast_recipient'")
T_S=$(psql_one "select count(*) from information_schema.tables where table_name='message_suppression'")
[ "$T_B" = "1" ] && [ "$T_R" = "1" ] && [ "$T_S" = "1" ] \
  && echo "  ✓ broadcast + broadcast_recipient + message_suppression created" \
  || { echo "  ✗ tables broadcast=$T_B recipient=$T_R suppression=$T_S (want 1/1/1)"; fail=1; }
I_Q=$(psql_one "select count(*) from pg_indexes where indexname='broadcast_recipient_queue_idx'")
I_S=$(psql_one "select count(*) from pg_indexes where indexname='message_suppression_key'")
I_C=$(psql_one "select count(*) from pg_indexes where indexname='broadcast_sender_created_idx'")
[ "$I_Q" = "1" ] && [ "$I_S" = "1" ] && [ "$I_C" = "1" ] \
  && echo "  ✓ drain index + suppression uniqueness + monthly-cap index in place" \
  || { echo "  ✗ indexes queue=$I_Q suppression=$I_S cap=$I_C (want 1/1/1)"; fail=1; }

echo ""
echo "== seed catalog: org A thebrunchcity (brunch-vol-09: GA + VIP) · org B offshore (offshore-001) =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_bcast -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('brunch-vol-09','Garden Brunch — Vol. 09') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-brunch','brunch-vol-09','GA', 40) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-brunch', 50000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-brunch');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-brunch', 40, 40) on conflict do nothing;

insert into product_tier (id, event_id, name, capacity) values ('t-brunch-vip','brunch-vol-09','VIP', 10) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-brunch-vip', 120000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-brunch-vip');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-brunch-vip', 10, 10) on conflict do nothing;

insert into event (id, name) values ('offshore-001','OFFSHORE — The Daytime Yacht Groove') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-offshore','offshore-001','GA', 10) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-offshore', 80000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-offshore');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-offshore', 10, 10) on conflict do nothing;

-- OV5 gate: org A is VERIFIED, org B is NOT. Org B still gets real buyers below,
-- so "unverified cannot send" is proven against a real audience, not an empty one.
update organizer set kyc_status = 'approved' where id = 'o1';
update organizer set kyc_status = 'pending'  where id = 'o2';
SQL

echo "== boot API (x-bridge MOCK, sms/email MOCK, monthly SMS cap = $CAP) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    SMS_DRIVER=mock EMAIL_DRIVER=mock SMS_UNIT_COST=25 BROADCAST_SMS_MONTHLY_CAP=$CAP \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done

BASE="http://localhost:$API_PORT"
jq_get() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const k=process.argv[1].split(".");let v=o;for(const p of k)v=v?.[p];process.stdout.write(v==null?"":Array.isArray(v)?String(v.length):String(v))}catch{process.stdout.write("ERR:"+s.slice(0,120))}})' "$1"; }

checkout() {
  local jar="$1" tier="$2" qty="$3" phone="$4" email="$5"
  curl -s -c "$jar" -b "$jar" -X POST "$BASE/api/checkout" -H 'content-type: application/json' \
    -d "{\"phone\":\"$phone\",\"email\":\"$email\",\"ageAttested\":true,\"cart\":[{\"tier\":\"$tier\",\"quantity\":$qty}],\"method\":\"mobile\"}" | jq_get orderId
}
pay_to_paid() {
  local jar="$1" order="$2" phone="$3"
  curl -s -b "$jar" -X POST "$BASE/api/checkout/$order/pay" -H 'content-type: application/json' \
    -d "{\"method\":\"mobile\",\"payerPhone\":\"$phone\"}" >/dev/null
  for i in $(seq 1 8); do
    local s; s=$(curl -s -b "$jar" "$BASE/api/orders/$order/status" | jq_get status)
    [ "$s" = "paid" ] && return 0
    sleep 1
  done
  return 1
}

echo "== seed buyers: A = 3 people (one on VIP) · B = 2 people =="
OA1=$(checkout "$SNAP/bA1" t-brunch     1 0712345670 a1@example.com); pay_to_paid "$SNAP/bA1" "$OA1" 0712345670 || { echo "  ✗ A1 never paid"; tail -20 "$SNAP/api.log"; exit 1; }
OA2=$(checkout "$SNAP/bA2" t-brunch     1 0712345671 a2@example.com); pay_to_paid "$SNAP/bA2" "$OA2" 0712345671 || { echo "  ✗ A2 never paid"; exit 1; }
OA3=$(checkout "$SNAP/bA3" t-brunch-vip 1 0712345672 a3@example.com); pay_to_paid "$SNAP/bA3" "$OA3" 0712345672 || { echo "  ✗ A3 never paid"; exit 1; }
OB1=$(checkout "$SNAP/bB1" t-offshore   1 0713333331 b1@example.com); pay_to_paid "$SNAP/bB1" "$OB1" 0713333331 || { echo "  ✗ B1 never paid"; exit 1; }
OB2=$(checkout "$SNAP/bB2" t-offshore   1 0713333332 b2@example.com); pay_to_paid "$SNAP/bB2" "$OB2" 0713333332 || { echo "  ✗ B2 never paid"; exit 1; }
# An UNPAID cart — an abandoned checkout must NOT be in anyone's audience.
ONP=$(checkout "$SNAP/bNP" t-brunch 1 0714444444 nope@example.com)
echo "  ✓ 3 paid buyers on org A (2 GA + 1 VIP) · 2 on org B · 1 abandoned cart"

echo "== logins =="
curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
for o in o1 o2 o3; do
  curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/$o/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
done
curl -s -c "$SNAP/orgA" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/orgB" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"offshore","password":"orgpass123"}' >/dev/null

prev()  { curl -s -o "$3" -w '%{http_code}' -b "$1" -X POST "$BASE/api/org/broadcasts/preview"   -H 'content-type: application/json' -d "$2"; }
send()  { curl -s -o "$3" -w '%{http_code}' -b "$1" -X POST "$BASE/api/org/broadcasts"           -H 'content-type: application/json' -d "$2"; }
aprev() { curl -s -o "$2" -w '%{http_code}' -b "$SNAP/admin" -X POST "$BASE/api/admin/broadcasts/preview" -H 'content-type: application/json' -d "$1"; }
asend() { curl -s -o "$2" -w '%{http_code}' -b "$SNAP/admin" -X POST "$BASE/api/admin/broadcasts"         -H 'content-type: application/json' -d "$1"; }

echo ""
echo "== 2. AUDIENCE COUNT is correct (and is one aggregate — no rows materialized) =="
CODE=$(prev "$SNAP/orgA" '{"scope":{"kind":"event","eventId":"brunch-vol-09"},"bodySms":"Doors at 13:00."}' "$SNAP/p_ev")
P_EV=$(cat "$SNAP/p_ev")
R2=$(P="$P_EV" C="$CODE" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const v=JSON.parse(process.env.P), a=v.audience||{};
t("HTTP 200 on preview", process.env.C==="200");
t("event audience = 3 people (every paid buyer of brunch-vol-09)", a.people===3);
t("sms = 3 addressable phones", a.sms===3);
t("email = 3 addressable emails", a.email===3);
t("suppressed = 0 to start", a.suppressed===0);
t("the ABANDONED cart is NOT in the audience (paid buyers only)", a.people===3);
t("scope label names the event, not an id", /Garden Brunch/.test(v.scopeLabel||""));
' 2>&1 || true)
echo "$R2"; echo "$R2" | grep -q '✗' && fail=1
QUEUED_NOW=$(psql_one "select count(*) from broadcast_recipient")
[ "$QUEUED_NOW" = "0" ] && echo "  ✓ PERF-2: previewing materialized ZERO recipient rows" \
  || { echo "  ✗ preview wrote $QUEUED_NOW recipient rows"; fail=1; }

CODE=$(prev "$SNAP/orgA" '{"scope":{"kind":"tier","eventId":"brunch-vol-09","tierId":"t-brunch-vip"},"bodySms":"VIP entrance is the side gate."}' "$SNAP/p_tier")
echo "$(cat "$SNAP/p_tier")" | grep -q '"people":1' \
  && echo "  ✓ tier audience (VIP) = 1 — the tier filter really narrows" \
  || { echo "  ✗ tier audience: $(cat "$SNAP/p_tier")"; fail=1; }

CODE=$(prev "$SNAP/orgA" '{"scope":{"kind":"org_all"},"bodySms":"Hi"}' "$SNAP/p_all")
echo "$(cat "$SNAP/p_all")" | grep -q '"people":3' \
  && echo "  ✓ \"all my customers\" = 3 — org A's OWN buyers only, not the platform's 5" \
  || { echo "  ✗ org_all audience: $(cat "$SNAP/p_all")"; fail=1; }

echo ""
echo "══ 3. SCOPE ISOLATION — AN ORG CANNOT TARGET ANOTHER ORG'S BUYERS ══"
CODE=$(prev "$SNAP/orgA" '{"scope":{"kind":"event","eventId":"offshore-001"},"bodySms":"Poaching your list"}' "$SNAP/p_x")
XP=$(cat "$SNAP/p_x")
[ "$CODE" = "400" ] && echo "$XP" | grep -q '"scope_forbidden"' \
  && echo "  ✓ org A PREVIEWING org B's event → 400 scope_forbidden (no count leaked either)" \
  || { echo "  ✗ cross-org preview: HTTP $CODE $XP"; fail=1; }

CODE=$(send "$SNAP/orgA" '{"scope":{"kind":"event","eventId":"offshore-001"},"channel":"sms","bodySms":"Poaching your list","senderId":"BRUNCH"}' "$SNAP/s_x")
XS=$(cat "$SNAP/s_x")
[ "$CODE" = "403" ] && echo "$XS" | grep -q '"scope_forbidden"' \
  && echo "  ✓ org A SENDING to org B's event → 403 scope_forbidden" \
  || { echo "  ✗ cross-org send: HTTP $CODE $XS"; fail=1; }
X_ROWS=$(psql_one "select count(*) from broadcast")
[ "$X_ROWS" = "0" ] && echo "  ✓ nothing was written — 0 broadcast rows after the attempt" \
  || { echo "  ✗ the refused cross-org send wrote $X_ROWS broadcast rows"; fail=1; }

# The tier back door: a real tier id, but of an event org A does not own.
CODE=$(send "$SNAP/orgA" '{"scope":{"kind":"tier","eventId":"offshore-001","tierId":"t-offshore"},"channel":"sms","bodySms":"x","senderId":"BRUNCH"}' "$SNAP/s_x2")
[ "$CODE" = "403" ] && echo "  ✓ the tier route is closed too (foreign event + real tier id → 403)" \
  || { echo "  ✗ cross-org tier send: HTTP $CODE $(cat "$SNAP/s_x2")"; fail=1; }

# And the "everything I own" scope must not quietly include anyone else.
CODE=$(prev "$SNAP/orgB" '{"scope":{"kind":"org_all"},"bodySms":"Hi"}' "$SNAP/p_ball")
echo "$(cat "$SNAP/p_ball")" | grep -q '"people":2' \
  && echo "  ✓ org B's own \"all my customers\" = 2 (its buyers, never org A's 3)" \
  || { echo "  ✗ org B org_all: $(cat "$SNAP/p_ball")"; fail=1; }

echo ""
echo "== 4. UNVERIFIED ORG: composes and previews, but CANNOT SEND (OV5) =="
CODE=$(prev "$SNAP/orgB" '{"scope":{"kind":"event","eventId":"offshore-001"},"bodySms":"See you Saturday."}' "$SNAP/p_nv")
[ "$CODE" = "200" ] && echo "$(cat "$SNAP/p_nv")" | grep -q '"people":2' \
  && echo "  · unverified org B HAS a real audience (2) and can preview it — the block below is the KYC gate, not emptiness" \
  || { echo "  ✗ unverified preview: HTTP $CODE $(cat "$SNAP/p_nv")"; fail=1; }
CODE=$(send "$SNAP/orgB" '{"scope":{"kind":"event","eventId":"offshore-001"},"channel":"sms","bodySms":"See you Saturday.","senderId":"OFFSHORE"}' "$SNAP/s_nv")
NV=$(cat "$SNAP/s_nv")
[ "$CODE" = "400" ] && echo "$NV" | grep -q '"not_verified"' \
  && echo "  ✓ unverified org B sending to its OWN 2 buyers → 400 not_verified" \
  || { echo "  ✗ unverified gate: HTTP $CODE $NV"; fail=1; }
NV_ROWS=$(psql_one "select count(*) from broadcast where sender_handle='offshore'")
[ "$NV_ROWS" = "0" ] && echo "  ✓ nothing queued for the unverified org (0 broadcast rows)" \
  || { echo "  ✗ unverified org wrote $NV_ROWS broadcast rows"; fail=1; }

echo ""
echo "== 5. COST-CONFIRM GATE — the number shown BEFORE send is enabled =="
LONG="$(node -e 'process.stdout.write("A".repeat(200))')"
CODE=$(prev "$SNAP/orgA" "{\"scope\":{\"kind\":\"event\",\"eventId\":\"brunch-vol-09\"},\"bodySms\":\"$LONG\"}" "$SNAP/p_cost")
R5=$(P="$(cat "$SNAP/p_cost")" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const v=JSON.parse(process.env.P), c=v.cost||{};
t("a 200-character SMS is 2 SEGMENTS — the composer must say so before send", c.segments===2);
t("units = segments x recipients = 2 x 3 = 6 billable messages", c.units===6);
t("unit cost comes from config (25 TZS), never a hard-coded guess", c.unitCost===25);
t("total = 150 TZS and is shown in TZS", c.total===150 && c.currency==="TZS");
t("the monthly allowance rides along so the UI can block before the server does",
  v.cap && v.cap.limit===6 && v.cap.used===0 && v.cap.remaining===6);
' 2>&1 || true)
echo "$R5"; echo "$R5" | grep -q '✗' && fail=1

echo ""
echo "== 6. SEND #1 — queued, not sent inline (ARCH-4) =="
CODE=$(send "$SNAP/orgA" '{"scope":{"kind":"event","eventId":"brunch-vol-09"},"channel":"both","subject":"Doors at 13:00","bodySms":"Brunch City: doors 13:00. Bring ID.","bodyEmail":"Doors open at 13:00 sharp.\n\nBring ID.","senderId":"BRUNCH"}' "$SNAP/s1")
S1=$(cat "$SNAP/s1")
BID1=$(echo "$S1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).broadcast.id)}catch{process.stdout.write("")}})')
R6=$(S="$S1" C="$CODE" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const v=JSON.parse(process.env.S), b=v.broadcast||{};
t("HTTP 200", process.env.C==="200");
t("status is QUEUED — the request did not fan out inline", b.status==="queued");
t("3 sms + 3 email recipients materialized", b.smsCount===3 && b.emailCount===3);
t("audienceCount records the 3 PEOPLE it was aimed at", b.audienceCount===3);
t("aggregate counters start at zero (D4 — the worker fills them)",
  b.sentCount===0 && b.failedCount===0 && b.skippedCount===0);
t("the sender ID recipients will see is stored", b.senderId==="BRUNCH");
' 2>&1 || true)
echo "$R6"; echo "$R6" | grep -q '✗' && fail=1
Q1=$(psql_one "select count(*) from broadcast_recipient where broadcast_id='$BID1' and status='queued'")
[ "$Q1" = "6" ] && echo "  ✓ 6 rows sitting in the queue, none sent yet (the worker is not running)" \
  || { echo "  ✗ queued rows = $Q1 (want 6)"; fail=1; }
# Dedup is per person per channel: nobody is queued twice.
DUPES=$(psql_one "select count(*) from (select address, channel from broadcast_recipient where broadcast_id='$BID1' group by 1,2 having count(*)>1) d")
[ "$DUPES" = "0" ] && echo "  ✓ deduped per person per channel (0 duplicate addresses)" \
  || { echo "  ✗ $DUPES duplicated addresses queued"; fail=1; }
# Isolation, at the row level: org B's buyers must not appear anywhere.
LEAK=$(psql_one "select count(*) from broadcast_recipient where address in ('255713333331','255713333332','b1@example.com','b2@example.com')")
[ "$LEAK" = "0" ] && echo "  ✓ ISOLATION AT THE ROW LEVEL: 0 of org B's addresses in org A's queue" \
  || { echo "  ✗ $LEAK org-B addresses leaked into org A's broadcast"; fail=1; }

echo ""
echo "══ 7. OPT-OUT IS HONOURED ══"
TOKEN=$(psql_one "select unsubscribe_token from broadcast_recipient where broadcast_id='$BID1' and channel='sms' and address='255712345672'")
[ -n "$TOKEN" ] && echo "  · buyer a3 (255712345672) has unsubscribe token ${TOKEN:0:6}…" \
  || { echo "  ✗ no unsubscribe token on the queued row"; fail=1; }

# A GET must DESCRIBE, never act — mail scanners follow every link in a message.
GETU=$(curl -s "$BASE/api/unsubscribe/$TOKEN")
SUP_AFTER_GET=$(psql_one "select count(*) from message_suppression")
echo "$GETU" | grep -q '"unsubscribed":false' && [ "$SUP_AFTER_GET" = "0" ] \
  && echo "  ✓ GET describes the target and does NOT unsubscribe (link scanners can't opt people out)" \
  || { echo "  ✗ GET side-effected: $GETU (suppressions=$SUP_AFTER_GET)"; fail=1; }
echo "$GETU" | grep -q '\*\*\*' \
  && echo "  ✓ the address is MASKED on the public page — a leaked link publishes nothing" \
  || { echo "  ✗ unmasked address on the public unsubscribe page: $GETU"; fail=1; }

POSTU=$(curl -s -X POST "$BASE/api/unsubscribe/$TOKEN" -H 'content-type: application/json' -d '{}')
echo "$POSTU" | grep -q '"unsubscribed":true' \
  && echo "  ✓ POST confirms the opt-out" || { echo "  ✗ POST unsubscribe: $POSTU"; fail=1; }
SUP=$(psql_one "select channel||'|'||address||'|'||coalesce(scope_handle,'PLATFORM') from message_suppression")
[ "$SUP" = "sms|255712345672|thebrunchcity" ] \
  && echo "  ✓ suppression is SCOPED to the organizer ($SUP) — opting out of one promoter is not opting out of Zora" \
  || { echo "  ✗ suppression row: $SUP"; fail=1; }

# The message already in the queue is cancelled, not sent and apologized for.
SKIPPED=$(psql_one "select status from broadcast_recipient where broadcast_id='$BID1' and channel='sms' and address='255712345672'")
[ "$SKIPPED" = "skipped" ] \
  && echo "  ✓ the ALREADY-QUEUED sms to that number flipped to 'skipped' before the worker could send it" \
  || { echo "  ✗ queued row status after unsubscribe = $SKIPPED (want skipped)"; fail=1; }
# Channel-specific: they opted out of SMS, not of email.
STILL=$(psql_one "select status from broadcast_recipient where broadcast_id='$BID1' and channel='email' and address='a3@example.com'")
[ "$STILL" = "queued" ] \
  && echo "  ✓ their EMAIL is untouched — the opt-out was for the sms channel they clicked from" \
  || { echo "  ✗ email row status = $STILL (want queued)"; fail=1; }

# Idempotent: clicking twice is a success, not an error a human has to interpret.
POSTU2=$(curl -s -X POST "$BASE/api/unsubscribe/$TOKEN" -H 'content-type: application/json' -d '{}')
SUP_N=$(psql_one "select count(*) from message_suppression")
echo "$POSTU2" | grep -q '"unsubscribed":true' && [ "$SUP_N" = "1" ] \
  && echo "  ✓ unsubscribing twice is idempotent (still exactly 1 suppression row)" \
  || { echo "  ✗ double unsubscribe: $POSTU2 rows=$SUP_N"; fail=1; }
BADU=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/unsubscribe/deadbeefdeadbeef")
[ "$BADU" = "404" ] && echo "  ✓ an unknown token → 404 with no detail (no probing which tokens are real)" \
  || { echo "  ✗ unknown token → HTTP $BADU"; fail=1; }

echo ""
echo "== 8. THE SUPPRESSED PERSON DROPS OUT OF THE NEXT AUDIENCE =="
CODE=$(prev "$SNAP/orgA" '{"scope":{"kind":"event","eventId":"brunch-vol-09"},"bodySms":"Late change: doors 14:00."}' "$SNAP/p_after")
R8=$(P="$(cat "$SNAP/p_after")" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const a=JSON.parse(process.env.P).audience||{};
t("sms drops 3 -> 2 (the opted-out number is gone)", a.sms===2);
t("email is STILL 3 — the opt-out was channel-specific", a.email===3);
t("suppressed:1 is surfaced, so the composer can SAY so instead of silently sending to fewer", a.suppressed===1);
' 2>&1 || true)
echo "$R8"; echo "$R8" | grep -q '✗' && fail=1

CODE=$(send "$SNAP/orgA" '{"scope":{"kind":"event","eventId":"brunch-vol-09"},"channel":"sms","bodySms":"Late change: doors 14:00.","senderId":"BRUNCH"}' "$SNAP/s2")
BID2=$(cat "$SNAP/s2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).broadcast.id)}catch{process.stdout.write("")}})')
OPTED=$(psql_one "select count(*) from broadcast_recipient where broadcast_id='$BID2' and address='255712345672'")
N2=$(psql_one "select count(*) from broadcast_recipient where broadcast_id='$BID2'")
[ "$OPTED" = "0" ] && [ "$N2" = "2" ] \
  && echo "  ✓ the next broadcast NEVER MATERIALIZES the opted-out address (2 rows, not 3)" \
  || { echo "  ✗ suppressed address queued=$OPTED, total rows=$N2 (want 0 / 2)"; fail=1; }

echo ""
echo "== 9. MONTHLY SMS CAP IS ENFORCED SERVER-SIDE (OV5) =="
USED=$(psql_one "select count(*) from broadcast_recipient r join broadcast b on b.id=r.broadcast_id where b.sender_handle='thebrunchcity' and r.channel='sms' and b.created_at >= date_trunc('month', now())")
echo "  · allowance $CAP · used $USED (3 from send #1 + 2 from send #2)"
CODE=$(send "$SNAP/orgA" '{"scope":{"kind":"event","eventId":"brunch-vol-09"},"channel":"sms","bodySms":"One more thing.","senderId":"BRUNCH"}' "$SNAP/s_cap")
CAPR=$(cat "$SNAP/s_cap")
[ "$CODE" = "400" ] && echo "$CAPR" | grep -q '"monthly_cap_exceeded"' \
  && echo "  ✓ a send needing 2 SMS with 1 left → 400 monthly_cap_exceeded" \
  || { echo "  ✗ cap gate: HTTP $CODE $CAPR"; fail=1; }
echo "$CAPR" | grep -q 'allowance' \
  && echo "  ✓ the refusal SAYS why and by how much (blocked + reason, per the design spec)" \
  || { echo "  ✗ cap message is not explanatory: $CAPR"; fail=1; }
CAP_ROWS=$(psql_one "select count(*) from broadcast where sender_handle='thebrunchcity'")
[ "$CAP_ROWS" = "2" ] && echo "  ✓ the capped send wrote nothing (still 2 broadcasts, not 3)" \
  || { echo "  ✗ capped send left $CAP_ROWS broadcast rows (want 2)"; fail=1; }
# Email is not capped — the cap exists because SMS costs money.
CODE=$(send "$SNAP/orgA" '{"scope":{"kind":"event","eventId":"brunch-vol-09"},"channel":"email","subject":"Menu","bodyEmail":"The brunch menu is up."}' "$SNAP/s_mail")
[ "$CODE" = "200" ] \
  && echo "  ✓ an EMAIL-only broadcast still goes through — the cap is about SMS spend, not about silencing the org" \
  || { echo "  ✗ email-only send after cap: HTTP $CODE $(cat "$SNAP/s_mail")"; fail=1; }

echo ""
echo "== 10. ADMIN can broadcast at ANY scope · the surface is admin-only =="
CODE=$(aprev '{"scope":{"kind":"platform"},"bodySms":"Zora maintenance tonight."}' "$SNAP/ap_all")
echo "$(cat "$SNAP/ap_all")" | grep -q '"people":6' \
  && echo "  ✓ admin platform scope = 6 people (every customer, including the abandoned cart's — admin messages USERS, not just buyers)" \
  || { echo "  ✗ admin platform audience: $(cat "$SNAP/ap_all")"; fail=1; }
CODE=$(aprev '{"scope":{"kind":"organizer","organizerHandle":"offshore"},"bodySms":"hi"}' "$SNAP/ap_org")
echo "$(cat "$SNAP/ap_org")" | grep -q '"people":2' \
  && echo "  ✓ admin by-organizer scope reaches org B's 2 buyers (what an org cannot do, staff can)" \
  || { echo "  ✗ admin by-organizer: $(cat "$SNAP/ap_org")"; fail=1; }
CODE=$(asend '{"scope":{"kind":"organizer","organizerHandle":"offshore"},"channel":"email","subject":"Zora notice","bodyEmail":"A platform notice.","senderId":"ZORA"}' "$SNAP/as1")
[ "$CODE" = "200" ] && echo "  ✓ admin queued a by-organizer email broadcast" \
  || { echo "  ✗ admin send: HTTP $CODE $(cat "$SNAP/as1")"; fail=1; }
ADM_CAP=$(psql_one "select count(*) from broadcast where sender_handle='admin'")
[ "$ADM_CAP" = "1" ] && echo "  ✓ admin sends are booked under their own sender — org allowances are untouched" \
  || { echo "  ✗ admin broadcast rows = $ADM_CAP"; fail=1; }

ORG_ADMIN=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/orgA" "$BASE/api/admin/broadcasts")
[ "$ORG_ADMIN" = "401" ] && echo "  ✓ organizer session → GET /api/admin/broadcasts 401" \
  || { echo "  ✗ organizer reached the admin broadcast surface: HTTP $ORG_ADMIN"; fail=1; }
ORG_ASEND=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/orgA" -X POST "$BASE/api/admin/broadcasts" -H 'content-type: application/json' -d '{"scope":{"kind":"platform"},"channel":"sms","bodySms":"x","senderId":"X"}')
[ "$ORG_ASEND" = "401" ] && echo "  ✓ organizer POSTing a PLATFORM broadcast → 401 (no privilege escalation via the admin scope)" \
  || { echo "  ✗ organizer reached the admin send: HTTP $ORG_ASEND"; fail=1; }
ANON=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/org/broadcasts")
[ "$ANON" = "401" ] && echo "  ✓ anonymous → GET /api/org/broadcasts 401" \
  || { echo "  ✗ anon reached the org surface: HTTP $ANON"; fail=1; }

echo ""
echo "== 11. HISTORY is per-sender (no cross-org read) =="
HA=$(curl -s -b "$SNAP/orgA" "$BASE/api/org/broadcasts")
HB=$(curl -s -b "$SNAP/orgB" "$BASE/api/org/broadcasts")
R11=$(A="$HA" B="$HB" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const a=JSON.parse(process.env.A), b=JSON.parse(process.env.B);
t("org A history has its 3 broadcasts", (a.broadcasts||[]).length===3);
t("every row in org A history belongs to org A", (a.broadcasts||[]).every(x=>x.senderHandle==="thebrunchcity"));
t("org B history is EMPTY — it never sent one, and cannot read org A history", (b.broadcasts||[]).length===0);
t("org A is shown as verified; org B is not", a.verified===true && b.verified===false);
// The invariant is ISOLATION, not a fixed count: thebrunchcity legitimately owns
// more than one event, so each org must see its own and NONE belonging to anyone else.
t("the composer is offered ONLY the events that org owns",
  (a.events||[]).length>0 && (b.events||[]).length>0 &&
  (a.events||[]).some(e=>e.id==="brunch-vol-09") &&
  (a.events||[]).every(e=>e.id!=="offshore-001") &&
  (b.events||[]).every(e=>e.id==="offshore-001"));
t("the allowance is reported to the client so the UI can block early", a.cap && a.cap.limit===6);
' 2>&1 || true)
echo "$R11"; echo "$R11" | grep -q '✗' && fail=1

echo ""
echo "══ 12. ARCH-4: THE WORKER DRAINS IN BOUNDED BATCHES AND RECONCILE KEEPS RUNNING ══"
PENDING=$(psql_one "select count(*) from broadcast_recipient where status='queued'")
echo "   $PENDING recipients queued · batch=3 · broadcast tick 200ms · reconcile tick 300ms"
# The point of the test: a large broadcast must be an interleaved trickle, not a
# job that owns the worker. If drainBroadcasts looped until empty, the whole
# queue would go out in ONE batch line and reconcile would not tick in between.
( cd "$WORKER_DIR" && env DATABASE_URL="$URL" SMS_DRIVER=mock EMAIL_DRIVER=mock \
    XBRIDGE_MOCK=true PUBLIC_ORIGIN="http://localhost:$API_PORT" \
    BROADCAST_BATCH=3 BROADCAST_TICK_MS=200 BROADCAST_RATE_MS=0 RECONCILE_MS=300 WORKER_DEBUG=1 \
    node dist/main.js ) >"$SNAP/worker.log" 2>&1 &
WORKER_PID=$!
for i in $(seq 1 40); do
  LEFT=$(psql_one "select count(*) from broadcast_recipient where status in ('queued','sending')")
  [ "$LEFT" = "0" ] && break
  sleep 0.5
done
sleep 0.8
{ kill -9 "$WORKER_PID"; wait "$WORKER_PID"; } >/dev/null 2>&1 || true
WORKER_PID=""

BATCHES=$(grep -c 'broadcast-batch:' "$SNAP/worker.log" || true)
MAXCLAIM=$(grep -o 'claimed=[0-9]*' "$SNAP/worker.log" | cut -d= -f2 | sort -n | tail -1)
[ "${BATCHES:-0}" -ge 2 ] \
  && echo "  ✓ the queue drained over $BATCHES SEPARATE batches — not one unbounded job" \
  || { echo "  ✗ only ${BATCHES:-0} batch line(s) — the drain is not bounded per tick"; fail=1; }
[ -n "$MAXCLAIM" ] && [ "$MAXCLAIM" -le 3 ] \
  && echo "  ✓ no tick claimed more than BROADCAST_BATCH ($MAXCLAIM ≤ 3)" \
  || { echo "  ✗ a tick claimed $MAXCLAIM (> the batch bound of 3)"; fail=1; }

# Reconcile must have ticked BETWEEN the first and last broadcast batch — that is
# the actual anti-starvation claim, and the reason the loops are separate.
INTERLEAVE=$(node -e '
const fs=require("fs");
const lines=fs.readFileSync(process.argv[1],"utf8").split("\n");
const bi=lines.map((l,i)=>({l,i})).filter(x=>/broadcast-batch:/.test(x.l)).map(x=>x.i);
if(bi.length<2){process.stdout.write("0");process.exit(0)}
const first=bi[0],last=bi[bi.length-1];
const rec=lines.map((l,i)=>({l,i})).filter(x=>/\] reconcile:/.test(x.l) && x.i>first && x.i<last);
process.stdout.write(String(rec.length));
' "$SNAP/worker.log")
[ "${INTERLEAVE:-0}" -ge 1 ] \
  && echo "  ✓ PAYMENT RECONCILIATION TICKED $INTERLEAVE TIME(S) WHILE THE BROADCAST WAS DRAINING — no starvation" \
  || { echo "  ✗ reconcile never ran between the first and last broadcast batch (money loop starved)"; fail=1; }

LEFT=$(psql_one "select count(*) from broadcast_recipient where status in ('queued','sending')")
SENT=$(psql_one "select count(*) from broadcast_recipient where status='sent'")
SKIP=$(psql_one "select count(*) from broadcast_recipient where status='skipped'")
[ "$LEFT" = "0" ] && echo "  ✓ the whole queue drained ($SENT sent · $SKIP skipped · 0 left)" \
  || { echo "  ✗ $LEFT recipients still queued after the drain"; fail=1; }
SENT_TO_OPTOUT=$(psql_one "select count(*) from broadcast_recipient where address='255712345672' and channel='sms' and status='sent'")
[ "$SENT_TO_OPTOUT" = "0" ] \
  && echo "  ✓ THE OPTED-OUT NUMBER WAS NEVER SENT TO (0 sent rows for it)" \
  || { echo "  ✗ the opted-out number received $SENT_TO_OPTOUT message(s)"; fail=1; }

echo ""
echo "== 13. AGGREGATE COUNTS land on the broadcast (D4) =="
AGG=$(curl -s -b "$SNAP/orgA" "$BASE/api/org/broadcasts")
R13=$(A="$AGG" ID="$BID1" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const v=JSON.parse(process.env.A);
const b=(v.broadcasts||[]).find(x=>x.id===process.env.ID);
t("broadcast #1 is found in history", !!b);
t("status flipped queued -> sent", b && b.status==="sent");
t("sentCount = 5 (3 email + 2 sms; the third sms was skipped)", b && b.sentCount===5);
t("skippedCount = 1 records the opt-out honestly", b && b.skippedCount===1);
t("failedCount = 0", b && b.failedCount===0);
t("completedAt is stamped", b && !!b.completedAt);
t("every history row still reports its aggregate sent/failed (D4, not per-recipient)",
  (v.broadcasts||[]).every(x=>typeof x.sentCount==="number" && typeof x.failedCount==="number"));
' 2>&1 || true)
echo "$R13"; echo "$R13" | grep -q '✗' && fail=1

AUD=$(curl -s -b "$SNAP/admin" "$BASE/api/audit")
echo "$AUD" | grep -q 'broadcast.send' \
  && echo "  ✓ audit trail carries broadcast.send" \
  || { echo "  ✗ audit trail missing broadcast entries"; fail=1; }

[ "$fail" = "0" ] || { echo ""; echo "BROADCASTS E2E: FAIL"; tail -40 "$SNAP/api.log"; echo "--- worker ---"; tail -30 "$SNAP/worker.log" 2>/dev/null; exit 1; }
echo ""
echo "BROADCASTS E2E: PASS (SCOPE ISOLATION — an org cannot target another org's buyers · audience count correct · OPT-OUT honoured at count/queue/send · unverified org blocked · monthly SMS cap enforced · cost-confirm figures · WORKER DRAINS IN BOUNDED BATCHES with reconcile still running · aggregate sent/failed)"
