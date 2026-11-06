#!/usr/bin/env bash
# BS152 — GET /api/admin/attention, the admin overview's "Needs attention" queue.
# Boots the real API on a throwaway Postgres, seeds one row per queue plus decoys
# that must NOT show up, and checks:
#   1. 401 without an admin session (anonymous and organizer).
#   2. Exact per-kind counts.
#   3. Severities (incl. KYC > 24h promoted to high).
#   4. Ordering: severity first, then oldest first.
#   5. hrefs per kind.
#   6. Decoys absent: abandoned cart, healthy/recent orders, resolved items.
# Harness mirrors admin-orders.e2e.sh. Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-56310}"
API_PORT="${TEST_API_PORT:-4310}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-attn-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-attnsnap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers organizers audit admin events kyc"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

echo "== throwaway Postgres @ :$PG_PORT + migrate + backfill =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_attn
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_attn"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_attn -v ON_ERROR_STOP=1 -c "$1"; }

# Fixed ids so the assertions can name them.
O_SHORT=a0000000-0000-4000-8000-000000000001
O_UNSEAT=a0000000-0000-4000-8000-000000000002
O_NOPASS=a0000000-0000-4000-8000-000000000003
O_STUCK=a0000000-0000-4000-8000-000000000004
O_UNNOTIFIED=a0000000-0000-4000-8000-000000000005
O_DUP=a0000000-0000-4000-8000-000000000006
O_INST=a0000000-0000-4000-8000-000000000007
# decoys
D_ABANDONED=d0000000-0000-4000-8000-000000000001
D_RECENT_PAID=d0000000-0000-4000-8000-000000000002
D_RECENT_STUCK=d0000000-0000-4000-8000-000000000003
D_REFUNDED=d0000000-0000-4000-8000-000000000004
D_INST_DONE=d0000000-0000-4000-8000-000000000005
D_OLD_ALERT=d0000000-0000-4000-8000-000000000006

echo "== seed one row per queue + decoys =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_attn -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into event (id, name) values ('brunch-vol-09','Garden Brunch — Vol. 09') on conflict do nothing;
insert into event (id, name) values ('offshore-001','OFFSHORE — The Daytime Yacht Groove') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-brunch','brunch-vol-09','GA', 40) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-brunch', 50000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-brunch');

insert into customer (id, phone, name) values
  ('c0000000-0000-4000-8000-000000000001','255700000001','Buyer One');

-- helper: an order with one GA line
create temp table seed_orders (id uuid, status text, target bigint, age interval, notified boolean, ev text);
insert into seed_orders values
  ('$O_SHORT',        'payment_short',         100000, '2 hours',    false, 'brunch-vol-09'),
  ('$O_UNSEAT',       'paid_unseatable',       100000, '1 hour',     false, 'brunch-vol-09'),
  ('$O_NOPASS',       'paid',                   50000, '3 hours',    false, 'brunch-vol-09'),
  ('$O_STUCK',        'pending',                50000, '40 minutes', false, 'brunch-vol-09'),
  ('$O_UNNOTIFIED',   'paid',                   50000, '30 minutes', false, 'brunch-vol-09'),
  ('$O_DUP',          'paid',                   50000, '50 minutes', true,  'offshore-001'),
  ('$O_INST',         'installment_defaulted', 150000, '20 days',    false, 'brunch-vol-09'),
  ('$D_ABANDONED',    'pending',                50000, '2 hours',    false, 'brunch-vol-09'),
  ('$D_RECENT_PAID',  'paid',                   50000, '2 minutes',  false, 'brunch-vol-09'),
  ('$D_RECENT_STUCK', 'pending',                50000, '5 minutes',  false, 'brunch-vol-09'),
  ('$D_REFUNDED',     'refunded',               50000, '5 hours',    true,  'brunch-vol-09'),
  ('$D_INST_DONE',    'installment_defaulted', 150000, '30 days',    false, 'brunch-vol-09'),
  ('$D_OLD_ALERT',    'paid',                   50000, '5 days',     true,  'brunch-vol-09');
insert into "order" (id, customer_id, event_id, type, status, target_value, created_at, notified_at)
  select id, 'c0000000-0000-4000-8000-000000000001', ev, 'ga_vip', status, target, now() - age,
         case when notified then now() - age else null end
    from seed_orders;
insert into order_item (order_id, product_tier_id, price_version_id, quantity, unit_price)
  select id, 't-brunch', (select id from price_version where tier_id='t-brunch' limit 1), 1, target from seed_orders;

-- payment attempts
insert into payment_transaction (order_id, transaction_id, method, amount, status, collected_amount, created_at, updated_at) values
  ('$O_SHORT',        'ZORA-short-1',  'mobile', 100000, 'partial',    30000, now() - interval '2 hours',    now() - interval '2 hours'),
  ('$O_UNSEAT',       'ZORA-unseat-1', 'mobile', 100000, 'successful', 100000, now() - interval '1 hour',    now() - interval '1 hour'),
  ('$O_NOPASS',       'ZORA-nopass-1', 'mobile',  50000, 'successful', 50000, now() - interval '3 hours',    now() - interval '3 hours'),
  ('$O_STUCK',        'ZORA-stuck-1',  'mobile',  50000, 'failed',     null,  now() - interval '40 minutes', now() - interval '40 minutes'),
  ('$O_STUCK',        'ZORA-stuck-2',  'mobile',  50000, 'pending',    null,  now() - interval '35 minutes', now() - interval '35 minutes'),
  ('$O_DUP',          'ZORA-dup-1',    'mobile',  50000, 'successful', 50000, now() - interval '50 minutes', now() - interval '50 minutes'),
  ('$O_DUP',          'ZORA-dup-2',    'mobile',  50000, 'successful', 50000, now() - interval '20 minutes', now() - interval '20 minutes'),
  ('$D_RECENT_PAID',  'ZORA-recent-1', 'mobile',  50000, 'successful', 50000, now() - interval '2 minutes',  now() - interval '2 minutes'),
  ('$D_RECENT_STUCK', 'ZORA-rstuck-1', 'mobile',  50000, 'pending',    null,  now() - interval '5 minutes',  now() - interval '5 minutes');

-- credentials: every paid order except the no-pass one (and the 2-min-old one)
insert into credential (order_item_id, seat_index, event_id, tier_id, code, public_ref)
  select oi.id, 0, 'brunch-vol-09', 't-brunch', 'code-' || oi.order_id, 'REF-' || oi.order_id
    from order_item oi
   where oi.order_id in ('$O_UNNOTIFIED', '$O_DUP', '$D_OLD_ALERT', '$D_REFUNDED');

-- ops alerts (dedup_key = kind:orderId:detail)
insert into webhook_event (provider, dedup_key, applied, received_at) values
  ('ops-alert', 'duplicate_collection:$O_DUP:',          true, now() - interval '20 minutes'),
  ('ops-alert', 'receivable_unknown:none:RCV-777',       true, now() - interval '10 minutes'),
  ('ops-alert', 'payment_short:$O_SHORT:',               true, now() - interval '2 hours'),
  ('ops-alert', 'duplicate_collection:$D_REFUNDED:',     true, now() - interval '5 hours'),
  ('ops-alert', 'duplicate_collection:$D_OLD_ALERT:',    true, now() - interval '4 days'),
  ('bridge',    'some-webhook',                          true, now() - interval '10 minutes');

-- payouts: one waiting, one decided
insert into payout (organizer_handle, amount, currency, status, requested_at) values
  ('offshore', 250000, 'TZS', 'requested', now() - interval '5 hours');
insert into payout (organizer_handle, amount, currency, status, requested_at, decided_at, decided_by, reference) values
  ('thebrunchcity', 90000, 'TZS', 'approved', now() - interval '6 hours', now() - interval '5 hours', 'admin', 'TX1');

-- installment plans: one refund pending, one already recorded
insert into installment_plan (order_id, event_id, org_handle, total, service_fee, deposit, count, frequency, final_due,
                              status, refund_due, refund_status, closed_at, created_at) values
  ('$O_INST',     'brunch-vol-09', 'thebrunchcity', 150000, 5000, 50000, 3, 'weekly', current_date,
   'defaulted', 45000, 'pending',  now() - interval '4 hours', now() - interval '20 days'),
  ('$D_INST_DONE','brunch-vol-09', 'thebrunchcity', 150000, 5000, 50000, 3, 'weekly', current_date,
   'defaulted', 45000, 'recorded', now() - interval '10 days', now() - interval '30 days');

-- self-signup organizers: one waiting, one rejected
insert into organizer (id, handle, name, status, kyc_status, source, phone, created_at) values
  ('o-new',  'newwave',  'New Wave Events', 'pending', 'unverified', 'self-signup', '255711000001', now() - interval '1 hour'),
  ('o-rej',  'nopenope', 'Nope Events',     'pending', 'rejected',   'self-signup', '255711000002', now() - interval '2 days');

-- KYC identity queue: one fresh, one past the 24h SLA, one approved
update collection_store set data = json_build_array(
  json_build_object('id','kyc-fresh','ref','KYC-FRESH','status','submitted','fullName','Fresh Person','idType','passport',
                    'attempt',1,'organizerHandle','thebrunchcity','submittedAt', to_char((now() - interval '2 hours') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  json_build_object('id','kyc-late','ref','KYC-LATE','status','in_review','fullName','Late Person','idType','national_id',
                    'attempt',2,'submittedAt', to_char((now() - interval '3 days') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  json_build_object('id','kyc-done','ref','KYC-DONE','status','approved','fullName','Done Person','idType','passport',
                    'attempt',1,'submittedAt', to_char((now() - interval '4 days') at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
)::text where name = 'kyc';
SQL
[ "$(psql_one "select count(*) from collection_store where name='kyc'")" = "1" ] \
  || { echo "  ✗ kyc collection missing after backfill"; exit 1; }
echo "  ✓ seeded"

echo "== boot API (x-bridge MOCK) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    SMS_DRIVER=mock EMAIL_DRIVER=mock \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
BASE="http://localhost:$API_PORT"

echo ""
echo "== 1. ADMIN-ONLY =="
ANON=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/attention")
[ "$ANON" = "401" ] && echo "  ✓ anonymous → 401" || { echo "  ✗ anonymous got HTTP $ANON"; fail=1; }
curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/orgA" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null
ORGHIT=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/orgA" "$BASE/api/admin/attention")
[ "$ORGHIT" = "401" ] && echo "  ✓ organizer session → 401" || { echo "  ✗ organizer got HTTP $ORGHIT"; fail=1; }

CODE=$(curl -s -o "$SNAP/attn.json" -w '%{http_code}' -b "$SNAP/admin" "$BASE/api/admin/attention")
[ "$CODE" = "200" ] || { echo "  ✗ admin got HTTP $CODE: $(head -c 300 "$SNAP/attn.json")"; tail -30 "$SNAP/api.log"; exit 1; }

echo ""
echo "== 2-6. COUNTS · SEVERITY · ORDER · HREFS · DECOYS =="
R=$(F="$SNAP/attn.json" \
  O_SHORT=$O_SHORT O_UNSEAT=$O_UNSEAT O_NOPASS=$O_NOPASS O_STUCK=$O_STUCK O_UNNOTIFIED=$O_UNNOTIFIED O_DUP=$O_DUP O_INST=$O_INST \
  DECOYS="$D_ABANDONED $D_RECENT_PAID $D_RECENT_STUCK $D_REFUNDED $D_INST_DONE $D_OLD_ALERT" node -e '
const t=(n,c)=>{console.log((c?"  ✓ ":"  ✗ ")+n); if(!c) process.exitCode=1;};
const v=JSON.parse(require("fs").readFileSync(process.env.F,"utf8"));
const E=process.env, items=v.items||[], c=v.counts||{};
t("shape: generatedAt + counts + items", typeof v.generatedAt==="string" && typeof c==="object" && Array.isArray(items));
const want={paid_unseatable:1,payment_short:1,paid_no_passes:1,payment_stuck:1,ops_alert:2,payout_request:1,
            installment_refund:1,kyc_review:2,org_signup:1,buyer_not_notified:1};
for (const k of Object.keys(want)) t(`counts.${k} = ${want[k]} (got ${c[k]})`, c[k]===want[k]);
const sum=Object.values(c).reduce((a,b)=>a+b,0);
t(`12 items, matching the counts (got ${items.length})`, items.length===12 && sum===12);

const keys=["id","kind","severity","title","detail","organizerHandle","organizerName","eventName","amount","currency","since","href"];
t("every item carries every field", items.every(i=>keys.every(k=>k in i)));

const by=(kind,pred)=>items.find(i=>i.kind===kind && (!pred||pred(i)));
const sev=(kind,s,pred)=>{const i=by(kind,pred); t(`${kind} is ${s}`, !!i && i.severity===s);};
sev("paid_unseatable","critical"); sev("payment_short","critical"); sev("paid_no_passes","critical");
sev("payment_stuck","high"); sev("ops_alert","high"); sev("payout_request","high"); sev("installment_refund","high");
sev("kyc_review","high",i=>i.id==="kyc_review:kyc-late");
sev("kyc_review","normal",i=>i.id==="kyc_review:kyc-fresh");
sev("org_signup","normal"); sev("buyer_not_notified","normal");

const rank={critical:0,high:1,normal:2};
let ordered=true;
for (let i=1;i<items.length;i++){
  const a=items[i-1], b=items[i];
  if (rank[a.severity]>rank[b.severity] || (a.severity===b.severity && Date.parse(a.since)>Date.parse(b.since))) ordered=false;
}
t("sorted by severity, then oldest first", ordered);
t("first item is the oldest critical (paid, no passes, 3h)", items[0] && items[0].kind==="paid_no_passes");
t("first high item is the KYC past its 24h SLA (3 days)", (items.find(i=>i.severity==="high")||{}).id==="kyc_review:kyc-late");
t("last item is the newest normal (buyer not notified, 30m)", items[items.length-1].kind==="buyer_not_notified");

const href=(i)=>i && i.href;
t("payment_short → order detail", href(by("payment_short"))==="/admin/console/orders/"+E.O_SHORT);
t("paid_unseatable → order detail", href(by("paid_unseatable"))==="/admin/console/orders/"+E.O_UNSEAT);
t("paid_no_passes → order detail", href(by("paid_no_passes"))==="/admin/console/orders/"+E.O_NOPASS);
t("payment_stuck → order detail", href(by("payment_stuck"))==="/admin/console/orders/"+E.O_STUCK);
t("buyer_not_notified → order detail", href(by("buyer_not_notified"))==="/admin/console/orders/"+E.O_UNNOTIFIED);
t("ops alert with an order → that order", href(by("ops_alert",i=>i.title.startsWith("Duplicate")))==="/admin/console/orders/"+E.O_DUP);
t("ops alert without an order → orders list", href(by("ops_alert",i=>!i.title.startsWith("Duplicate")))==="/admin/console/orders");
t("payout → payouts", href(by("payout_request"))==="/admin/console/payouts");
t("installment refund → installments", href(by("installment_refund"))==="/admin/console/installments");
t("kyc → verification", href(by("kyc_review"))==="/admin/console/verification");
t("org sign-up → verification", href(by("org_signup"))==="/admin/console/verification");

const sh=by("payment_short");
t("payment_short shows collected amount + names the event and organizer",
  !!sh && sh.amount===30000 && sh.currency==="TZS" && sh.eventName==="Garden Brunch — Vol. 09" && sh.organizerName==="The Brunch City");
const po=by("payout_request");
t("payout carries amount + organizer name", !!po && po.amount===250000 && po.organizerHandle==="offshore" && po.organizerName==="Offshore Ltd");
const ir=by("installment_refund");
t("installment refund carries refund_due", !!ir && ir.amount===45000);
t("ops alert names the right event (offshore)", (by("ops_alert",i=>i.title.startsWith("Duplicate"))||{}).eventName==="OFFSHORE — The Daytime Yacht Groove");
t("stuck payment is keyed on the latest in-flight attempt", (by("payment_stuck")||{}).id==="payment_stuck:ZORA-stuck-2");

const blob=JSON.stringify(items);
for (const d of E.DECOYS.split(" ")) t(`decoy …${d.slice(-4)} absent`, !blob.includes(d));
t("payment_short ops alert is not listed twice", items.filter(i=>i.href.endsWith(E.O_SHORT)).length===1);
t("approved payout absent", !items.some(i=>i.kind==="payout_request" && i.organizerHandle==="thebrunchcity"));
t("approved KYC absent", !blob.includes("kyc-done"));
t("rejected sign-up absent", !blob.includes("nopenope"));
t("paid-no-passes order is not also listed as not-notified", items.filter(i=>i.href.endsWith(E.O_NOPASS)).length===1);
' 2>&1 || true)
echo "$R"; echo "$R" | grep -q '✗' && fail=1

echo ""
echo "== 7. RESOLVING CLEARS IT =="
psql_one "update payout set status='approved', decided_at=now(), decided_by='admin' where status='requested'" >/dev/null
psql_one "update organizer set kyc_status='approved', status='active' where id='o-new'" >/dev/null
AFTER=$(curl -s -b "$SNAP/admin" "$BASE/api/admin/attention")
R7=$(A="$AFTER" node -e '
const v=JSON.parse(process.env.A);
const ok=v.counts.payout_request===0 && v.counts.org_signup===0 && v.items.length===10;
console.log((ok?"  ✓ ":"  ✗ ")+"approving the payout + sign-up drops both (payouts="+v.counts.payout_request+", signups="+v.counts.org_signup+", items="+v.items.length+")");
' 2>&1 || true)
echo "$R7"; echo "$R7" | grep -q '✗' && fail=1

[ "$fail" = "0" ] || { echo ""; echo "ADMIN ATTENTION E2E: FAIL"; head -c 4000 "$SNAP/attn.json"; echo; tail -30 "$SNAP/api.log"; exit 1; }
echo ""
echo "ADMIN ATTENTION E2E: PASS (admin-only · exact counts · severities · severity-then-age order · hrefs · decoys absent · resolve clears)"
