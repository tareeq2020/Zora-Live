#!/usr/bin/env bash
# BS42 / plan #1 — THE DOOR. Two-step scanning + scanner users/roles.
#
# The gate is the one surface where a bug is visible to a queue of angry people,
# so this suite boots the real API on a throwaway Postgres and proves:
#
#   1. Migration 0014 landed: the scan lifecycle on the EXISTING credential.state
#      (OV4 — no parallel column), scanner_user with its ACTIVE-code unique index,
#      and the scan_auth_attempt ledger.
#   2. Scanner users are real rows with a ROLE and an event SCOPE, created only
#      from the admin panel (ARCH-3).
#   3. A valid QR scans → state 'scanned', with who and when.
#   4. **REPLAY: the same QR twice → 409 carrying the prior actor + time.**
#   5. A forged signature is refused and changes nothing.
#   6. Wrong event / out of scope are refused (scope is enforced server-side).
#   7. **ROLE GATE: an agent CANNOT confirm; a supervisor CANNOT verify.**
#   8. Supervisor confirm moves scanned → wristband_issued; every other source
#      state is refused (invalid transition).
#   9. OV6 SELECTIVITY: a plain GA pass is admitted by the agent alone and never
#      enters the supervisor queue; a flagged or table pass does.
#  10. A revoked code cannot mint a session.
#  11. **OV4 BRUTE FORCE: guessing triggers a lockout — per code AND per source —
#      and while locked even the CORRECT code is refused.**
#
# Style/harness mirrors payouts.e2e.sh (throwaway PG, XBRIDGE_MOCK, real HTTP
# checkout→pay). Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-55452}"
API_PORT="${TEST_API_PORT:-4131}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-scan-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-scansnap-XXXXXX")"
USER_NAME="$(whoami)"
ENTITIES="settings tiers organizers audit admin events kyc agents"
fail=0

cleanup() {
  lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SNAP"
}
trap cleanup EXIT

echo "== throwaway Postgres @ :$PG_PORT + migrate (0001..0014) + backfill =="
initdb -D "$DATA" -U "$USER_NAME" --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$DATA" -l "$DATA/pg.log" -w start >/dev/null
for i in $(seq 1 40); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 0.25; done
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_scan
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_scan"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" $ENTITIES >/dev/null

psql_one() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_scan -v ON_ERROR_STOP=1 -c "$1"; }

echo ""
echo "== 1. MIGRATION 0014 — the lifecycle rides credential.state (OV4) =="
COLS=$(psql_one "select count(*) from information_schema.columns where table_name='credential' and column_name in ('scanned_at','scanned_by','scanned_by_name','confirmed_at','confirmed_by','confirmed_by_name','requires_confirm')")
[ "$COLS" = "7" ] \
  && echo "  ✓ credential gained the scan lifecycle columns (who/when scanned + who/when confirmed + requires_confirm)" \
  || { echo "  ✗ credential scan columns = $COLS (want 7)"; fail=1; }

# OV4 is a NEGATIVE requirement as much as a positive one: there must be no
# second, parallel state column that can disagree with credential.state.
PARALLEL=$(psql_one "select count(*) from information_schema.columns where table_name='credential' and column_name in ('scan_state','scan_status')")
[ "$PARALLEL" = "0" ] \
  && echo "  ✓ NO parallel scan_state column — one credential, one state (OV4)" \
  || { echo "  ✗ a parallel scan-state column exists"; fail=1; }

CHK=$(psql_one "select count(*) from pg_constraint where conname='credential_state_valid'")
[ "$CHK" = "1" ] && echo "  ✓ credential_state_valid CHECK pins the state set" \
  || { echo "  ✗ credential_state_valid missing"; fail=1; }
# The database, not the application, refuses a nonsense state.
BADSTATE=$(psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_scan \
  -c "insert into credential (code, state) values ('bogus-state-probe','teleported')" 2>&1 || true)
echo "$BADSTATE" | grep -q 'credential_state_valid' \
  && echo "  ✓ an unknown state is rejected by the CHECK, not by hoping" \
  || { echo "  ✗ an unknown credential state was accepted: $BADSTATE"; fail=1; }

SU_TABLE=$(psql_one "select count(*) from information_schema.tables where table_name='scanner_user'")
SU_IDX=$(psql_one "select count(*) from pg_indexes where tablename='scanner_user' and indexname='scanner_user_active_code_uq'")
[ "$SU_TABLE" = "1" ] && [ "$SU_IDX" = "1" ] \
  && echo "  ✓ scanner_user table + the ACTIVE-code unique index (one live code = one person)" \
  || { echo "  ✗ scanner_user table=$SU_TABLE index=$SU_IDX (want 1 / 1)"; fail=1; }

AT_TABLE=$(psql_one "select count(*) from information_schema.tables where table_name='scan_auth_attempt'")
[ "$AT_TABLE" = "1" ] && echo "  ✓ scan_auth_attempt ledger present (the lockout's memory)" \
  || { echo "  ✗ scan_auth_attempt missing"; fail=1; }

SEEDED=$(psql_one "select count(*) from scanner_user")
[ "$SEEDED" -ge 2 ] \
  && echo "  ✓ the legacy 'agents' blob backfilled into scanner_user ($SEEDED rows) — no door staff lost in the move" \
  || { echo "  ✗ scanner_user backfill = $SEEDED rows (want >= 2)"; fail=1; }

echo ""
echo "== seed catalog: brunch-vol-09 (the door under test) + offshore-001 (another door) =="
psql -q -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_scan -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into event (id, name) values ('brunch-vol-09','Garden Brunch — Vol. 09') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-brunch','brunch-vol-09','GA', 40) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-brunch', 50000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-brunch');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-brunch', 40, 40) on conflict do nothing;

insert into event (id, name) values ('offshore-001','OFFSHORE — The Daytime Yacht Groove') on conflict do nothing;
insert into product_tier (id, event_id, name, capacity) values ('t-offshore','offshore-001','GA', 10) on conflict do nothing;
insert into price_version (tier_id, price, currency) select 't-offshore', 80000, 'TZS'
  where not exists (select 1 from price_version where tier_id='t-offshore');
insert into inventory_pool (product_tier_id, capacity, available_count) values ('t-offshore', 10, 10) on conflict do nothing;
SQL

echo "== boot API (x-bridge MOCK, TRUST_PROXY so the per-source lockout is testable) =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key TRUST_PROXY=true \
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

echo "== buy real passes (6 × brunch, 1 × offshore) so every QR below is a genuine signed credential =="
OB=$(checkout "$SNAP/b1" t-brunch 6 0712345670 door1@example.com)
pay_to_paid "$SNAP/b1" "$OB" 0712345670 || { echo "  ✗ brunch order never paid"; tail -20 "$SNAP/api.log"; exit 1; }
OO=$(checkout "$SNAP/b2" t-offshore 1 0713333333 door2@example.com)
pay_to_paid "$SNAP/b2" "$OO" 0713333333 || { echo "  ✗ offshore order never paid"; tail -20 "$SNAP/api.log"; exit 1; }

# Pull the QR payloads exactly as credentials.qrPayload builds them: zora:<code>:<sig>
qr_at() { psql_one "select 'zora:'||code||':'||signature from credential where event_id='$1' order by public_ref limit 1 offset $2"; }
id_at() { psql_one "select id from credential where event_id='$1' order by public_ref limit 1 offset $2"; }
QR_GA=$(qr_at brunch-vol-09 0);       ID_GA=$(id_at brunch-vol-09 0)
QR_FLAG=$(qr_at brunch-vol-09 1);     ID_FLAG=$(id_at brunch-vol-09 1)
QR_TABLE=$(qr_at brunch-vol-09 2);    ID_TABLE=$(id_at brunch-vol-09 2)
QR_UNSCANNED=$(qr_at brunch-vol-09 3);ID_UNSCANNED=$(id_at brunch-vol-09 3)
QR_OFFSHORE=$(qr_at offshore-001 0)
# Two brunch passes are deliberately left UNTOUCHED (offsets 4 and 5) so the
# invalid-transition and revoked-pass cases below have a genuine `issued` row.
N_CREDS=$(psql_one "select count(*) from credential")
[ -n "$QR_GA" ] && [ -n "$QR_OFFSHORE" ] && [ "$N_CREDS" = "7" ] \
  && echo "  ✓ 7 signed credentials issued (6 brunch + 1 offshore)" \
  || { echo "  ✗ credentials were not issued (count=$N_CREDS)"; fail=1; }

# OV6 fixtures: one credential FLAGGED by ops (a comp), one carrying a TABLE.
# Both must take the second person; the plain GA one must not.
psql_one "update credential set requires_confirm = true where id = '$ID_FLAG'" >/dev/null
psql_one "update credential set table_no = 'T-04' where id = '$ID_TABLE'" >/dev/null

echo ""
echo "== 2. SCANNER USERS ARE ADMIN-ISSUED ROWS WITH A ROLE + SCOPE (ARCH-3) =="
curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"zora2026"}' >/dev/null

mk_user() { # name role scope -> prints the JSON
  curl -s -b "$SNAP/admin" -X POST "$BASE/api/agents" -H 'content-type: application/json' \
    -d "{\"name\":\"$1\",\"contact\":\"$4\",\"role\":\"$2\",\"eventScope\":\"$3\"}"
}
A_JSON=$(mk_user "Door Agent A" agent brunch-vol-09 "+255700111000")
S_JSON=$(mk_user "Supervisor S" supervisor brunch-vol-09 "+255700111001")
W_JSON=$(mk_user "Roaming Agent W" agent "All events" "+255700111002")
R_JSON=$(mk_user "Fired Agent R" agent brunch-vol-09 "+255700111003")

A_CODE=$(echo "$A_JSON" | jq_get code); A_ID=$(echo "$A_JSON" | jq_get id)
S_CODE=$(echo "$S_JSON" | jq_get code); S_ID=$(echo "$S_JSON" | jq_get id)
W_CODE=$(echo "$W_JSON" | jq_get code)
R_CODE=$(echo "$R_JSON" | jq_get code); R_ID=$(echo "$R_JSON" | jq_get id)

R2=$(A="$A_JSON" S="$S_JSON" W="$W_JSON" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const a=JSON.parse(process.env.A), s=JSON.parse(process.env.S), w=JSON.parse(process.env.W);
t("agent created with role=agent and eventScope=brunch-vol-09", a.role==="agent" && a.eventScope==="brunch-vol-09");
t("supervisor created with role=supervisor", s.role==="supervisor");
t("a 6-digit code is issued and shown to the admin (that is the panel'"'"'s job)", /^\d{6}$/.test(a.code));
t("agent and supervisor got DIFFERENT codes", a.code!==s.code);
t("\"All events\" normalises to an unscoped user (eventScope null)", w.eventScope===null && w.event==="All events");
t("the legacy response shape survives (id/name/contact/via/event/code/status/expiresAt)",
  !!a.id && !!a.name && !!a.contact && !!a.via && !!a.event && !!a.status && !!a.expiresAt);
' 2>&1 || true)
echo "$R2"; echo "$R2" | grep -q '✗' && fail=1

# Roles are DB-constrained, not merely validated in a form.
BADROLE=$(curl -s -o /dev/null -w '%{http_code}' -b "$SNAP/admin" -X POST "$BASE/api/agents" \
  -H 'content-type: application/json' -d '{"name":"X","contact":"x@y.z","role":"superuser"}')
[ "$BADROLE" = "400" ] && echo "  ✓ an unknown role is refused (400) — there are exactly two" \
  || { echo "  ✗ unknown role accepted: HTTP $BADROLE"; fail=1; }

# The panel's own promise: only an admin session may issue a code.
ANON_MK=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/agents" \
  -H 'content-type: application/json' -d '{"name":"Ghost","contact":"g@h.i"}')
[ "$ANON_MK" = "401" ] && echo "  ✓ anonymous cannot mint a scanner user (401) — codes come only from the admin panel" \
  || { echo "  ✗ anon minted a scanner user: HTTP $ANON_MK"; fail=1; }

echo ""
echo "== 3. CODE → SCOPED SESSION =="
sess() { # code [xff] -> body
  curl -s -X POST "$BASE/api/scan/session" -H 'content-type: application/json' \
    -H "x-forwarded-for: ${2:-10.0.0.1}" -d "{\"code\":\"$1\"}"
}
sess_code() { # code xff -> http status
  curl -s -o "$3" -w '%{http_code}' -X POST "$BASE/api/scan/session" -H 'content-type: application/json' \
    -H "x-forwarded-for: $2" -d "{\"code\":\"$1\"}"
}
A_SESS=$(sess "$A_CODE"); A_TOKEN=$(echo "$A_SESS" | jq_get token)
S_SESS=$(sess "$S_CODE"); S_TOKEN=$(echo "$S_SESS" | jq_get token)
W_SESS=$(sess "$W_CODE"); W_TOKEN=$(echo "$W_SESS" | jq_get token)

R3=$(A="$A_SESS" S="$S_SESS" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const a=JSON.parse(process.env.A), s=JSON.parse(process.env.S);
t("the agent code returns a token", typeof a.token==="string" && a.token.length>40);
t("the session carries the ROLE the admin assigned", a.scanner.role==="agent" && s.scanner.role==="supervisor");
t("the session carries the EVENT SCOPE", a.scanner.eventScope==="brunch-vol-09");
t("the session expires (a door shift, not forever)", !!a.expiresAt && new Date(a.expiresAt) > new Date());
t("no admin/organizer fields leak into a scanner session",
  !("isAdmin" in a.scanner) && !("organizerHandle" in a.scanner));
' 2>&1 || true)
echo "$R3"; echo "$R3" | grep -q '✗' && fail=1

# A scanner session is NOT an admin session.
SCAN_ADMIN=$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $A_TOKEN" "$BASE/api/agents")
[ "$SCAN_ADMIN" = "401" ] \
  && echo "  ✓ a scanner token cannot reach the admin surface (GET /api/agents → 401)" \
  || { echo "  ✗ scanner token reached /api/agents: HTTP $SCAN_ADMIN"; fail=1; }
NO_TOKEN=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/scan/verify" \
  -H 'content-type: application/json' -d "{\"qr\":\"$QR_GA\"}")
[ "$NO_TOKEN" = "401" ] && echo "  ✓ /api/scan/verify with no session → 401" \
  || { echo "  ✗ anon reached /api/scan/verify: HTTP $NO_TOKEN"; fail=1; }

verify() { # token qr outfile -> http status
  curl -s -o "$3" -w '%{http_code}' -X POST "$BASE/api/scan/verify" \
    -H 'content-type: application/json' -H "authorization: Bearer $1" -d "{\"qr\":\"$2\"}"
}
confirm() { # token credentialId outfile -> http status
  curl -s -o "$3" -w '%{http_code}' -X POST "$BASE/api/scan/confirm" \
    -H 'content-type: application/json' -H "authorization: Bearer $1" -d "{\"credentialId\":\"$2\"}"
}

echo ""
echo "== 4. A VALID QR SCANS — and the agent alone is the gate (OV6) =="
CODE=$(verify "$A_TOKEN" "$QR_GA" "$SNAP/v_ok"); VOK=$(cat "$SNAP/v_ok")
R4=$(V="$VOK" C="$CODE" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const v=JSON.parse(process.env.V);
t("HTTP 200", process.env.C==="200");
t("outcome = valid → the PWA paints the SOLID GREEN takeover", v.outcome==="valid");
t("the pass carries what the door reads: event, tier, holder, ref",
  v.pass && v.pass.eventName==="Garden Brunch — Vol. 09" && v.pass.tierName==="GA" && !!v.pass.publicRef);
t("state is now scanned", v.pass.state==="scanned");
t("requiresConfirm = false — plain GA does NOT wait on a supervisor (OV6)", v.pass.requiresConfirm===false);
t("no PII beyond the holder name (no phone, no email, no money)",
  !("phone" in v.pass) && !("email" in v.pass) && !("amount" in v.pass));
' 2>&1 || true)
echo "$R4"; echo "$R4" | grep -q '✗' && fail=1

DB_GA=$(psql_one "select state||'|'||coalesce(scanned_by,'-')||'|'||coalesce(scanned_by_name,'-')||'|at='||(scanned_at is not null)::text from credential where id='$ID_GA'")
[ "$DB_GA" = "scanned|$A_ID|Door Agent A|at=true" ] \
  && echo "  ✓ DB truth: $DB_GA (who scanned it and when are recorded, not inferred)" \
  || { echo "  ✗ DB row after scan: $DB_GA"; fail=1; }

echo ""
echo "══ 5. REPLAY — THE SAME QR TWICE ══"
echo "   (a screenshot forwarded to a friend, or two agents on two doors)"
CODE=$(verify "$A_TOKEN" "$QR_GA" "$SNAP/v_replay"); REPLAY=$(cat "$SNAP/v_replay")
R5=$(V="$REPLAY" C="$CODE" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const v=JSON.parse(process.env.V);
t("HTTP 409 — the pass is real, the STATE says no", process.env.C==="409");
t("error = already_scanned", v.error==="already_scanned");
t("the reason is plain English, not a code the agent has to decode", /already scanned/i.test(v.message||""));
t("PRIOR ACTOR is returned — the agent can say WHO let them in", v.priorActor==="Door Agent A");
t("PRIOR TIME is returned", !!v.priorAt && !isNaN(Date.parse(v.priorAt)));
t("outcome = already_used → SOLID RED takeover", v.outcome==="already_used");
' 2>&1 || true)
echo "$R5"; echo "$R5" | grep -q '✗' && fail=1

SCAN_COUNT=$(psql_one "select count(*) from credential where id='$ID_GA' and state='scanned'")
STILL=$(psql_one "select coalesce(scanned_by_name,'-') from credential where id='$ID_GA'")
[ "$SCAN_COUNT" = "1" ] && [ "$STILL" = "Door Agent A" ] \
  && echo "  ✓ the replay changed NOTHING — the first scan still owns the row" \
  || { echo "  ✗ the replay mutated the credential (scanned_by_name=$STILL)"; fail=1; }

echo ""
echo "══ 5b. CONCURRENT double-scan — two doors, one pass, at the same instant ══"
# The sequential replay above is the easy case. This is the race the row lock
# exists for: without SELECT … FOR UPDATE both requests read 'issued' and both
# write, and two people walk in on one ticket.
( verify "$A_TOKEN" "$QR_UNSCANNED" "$SNAP/race1" > "$SNAP/race1.code" ) & P1=$!
( verify "$A_TOKEN" "$QR_UNSCANNED" "$SNAP/race2" > "$SNAP/race2.code" ) & P2=$!
wait $P1 || true; wait $P2 || true
C1=$(cat "$SNAP/race1.code"); C2=$(cat "$SNAP/race2.code")
echo "   scan 1 → HTTP $C1 · scan 2 → HTTP $C2"
RACE_OK=0
[ "$C1" = "200" ] && RACE_OK=$((RACE_OK+1))
[ "$C2" = "200" ] && RACE_OK=$((RACE_OK+1))
[ "$RACE_OK" = "1" ] \
  && echo "  ✓ EXACTLY ONE of two simultaneous scans won" \
  || { echo "  ✗ $RACE_OK of 2 concurrent scans succeeded (want exactly 1)"; cat "$SNAP/race1"; cat "$SNAP/race2"; fail=1; }
LOSER="$SNAP/race1"; [ "$C1" = "200" ] && LOSER="$SNAP/race2"
grep -q '"already_scanned"' "$LOSER" \
  && echo "  ✓ the loser got 409 already_scanned — never a 500, never a second admission" \
  || { echo "  ✗ the loser carried no already_scanned code: $(cat "$LOSER")"; fail=1; }

echo ""
echo "== 6. A FORGED SIGNATURE IS REFUSED =="
# Flip the last hex digit of a real signature: the code is genuine, the HMAC is not.
FORGED=$(psql_one "select 'zora:'||code||':'||(left(signature, length(signature)-1) || (case when right(signature,1)='a' then 'b' else 'a' end)) from credential where id='$ID_UNSCANNED'")
CODE=$(verify "$A_TOKEN" "$FORGED" "$SNAP/v_forge"); FORGE=$(cat "$SNAP/v_forge")
[ "$CODE" = "422" ] && echo "$FORGE" | grep -q '"invalid_signature"' \
  && echo "  ✓ tampered signature → 422 invalid_signature (the HMAC is the gate, not the code)" \
  || { echo "  ✗ forged signature: HTTP $CODE $FORGE"; fail=1; }

CODE=$(verify "$A_TOKEN" "zora:not-a-real-code:deadbeef" "$SNAP/v_nomatch"); NOMATCH=$(cat "$SNAP/v_nomatch")
[ "$CODE" = "404" ] && echo "$NOMATCH" | grep -q '"not_found"' \
  && echo "  ✓ an unknown code → 404 not_found (the NO MATCH state)" \
  || { echo "  ✗ unknown code: HTTP $CODE $NOMATCH"; fail=1; }

CODE=$(verify "$A_TOKEN" "https://example.com/some-other-qr" "$SNAP/v_junk"); JUNK=$(cat "$SNAP/v_junk")
[ "$CODE" = "422" ] && echo "$JUNK" | grep -q '"malformed_qr"' \
  && echo "  ✓ a random non-Zora QR → 422 malformed_qr (not a 500)" \
  || { echo "  ✗ junk QR: HTTP $CODE $JUNK"; fail=1; }

echo ""
echo "== 7. WRONG EVENT / OUT OF SCOPE — the scope is enforced on the SERVER =="
CODE=$(verify "$A_TOKEN" "$QR_OFFSHORE" "$SNAP/v_scope"); SCOPE=$(cat "$SNAP/v_scope")
[ "$CODE" = "403" ] && echo "$SCOPE" | grep -q '"out_of_scope"' \
  && echo "  ✓ a brunch-scoped agent scanning an OFFSHORE pass → 403 out_of_scope" \
  || { echo "  ✗ scope gate: HTTP $CODE $SCOPE"; fail=1; }
OFF_STATE=$(psql_one "select state from credential where event_id='offshore-001'")
[ "$OFF_STATE" = "issued" ] \
  && echo "  ✓ the other event's pass was NOT consumed by the refused scan" \
  || { echo "  ✗ out-of-scope scan mutated the pass: $OFF_STATE"; fail=1; }

# The unscoped roaming agent CAN scan it — but naming a different door is refused.
WRONG=$(curl -s -o "$SNAP/v_wrong" -w '%{http_code}' -X POST "$BASE/api/scan/verify" \
  -H 'content-type: application/json' -H "authorization: Bearer $W_TOKEN" \
  -d "{\"qr\":\"$QR_OFFSHORE\",\"eventId\":\"brunch-vol-09\"}")
[ "$WRONG" = "422" ] && grep -q '"wrong_event"' "$SNAP/v_wrong" \
  && echo "  ✓ an unscoped agent standing at the brunch door → 422 wrong_event for an offshore pass" \
  || { echo "  ✗ wrong-event gate: HTTP $WRONG $(cat "$SNAP/v_wrong")"; fail=1; }

echo ""
echo "══ 8. THE ROLE GATE — an agent CANNOT confirm ══"
CODE=$(confirm "$A_TOKEN" "$ID_GA" "$SNAP/c_role"); ROLEBLOCK=$(cat "$SNAP/c_role")
[ "$CODE" = "403" ] && echo "$ROLEBLOCK" | grep -q '"wrong_role"' \
  && echo "  ✓ AGENT → POST /api/scan/confirm = 403 wrong_role (one person cannot be both halves of a two-step)" \
  || { echo "  ✗ ROLE GATE BREACHED: HTTP $CODE $ROLEBLOCK"; fail=1; }
STILL_SCANNED=$(psql_one "select state from credential where id='$ID_GA'")
[ "$STILL_SCANNED" = "scanned" ] && echo "  ✓ the refused confirm wrote nothing (state still scanned)" \
  || { echo "  ✗ the agent's confirm changed state to $STILL_SCANNED"; fail=1; }

# ...and the gate runs BOTH ways: a supervisor is not a scanning agent.
CODE=$(verify "$S_TOKEN" "$QR_FLAG" "$SNAP/v_sup"); SUPVER=$(cat "$SNAP/v_sup")
[ "$CODE" = "403" ] && echo "$SUPVER" | grep -q '"wrong_role"' \
  && echo "  ✓ SUPERVISOR → POST /api/scan/verify = 403 wrong_role" \
  || { echo "  ✗ supervisor could scan: HTTP $CODE $SUPVER"; fail=1; }

echo ""
echo "== 9. OV6 SELECTIVITY — only the risky passes wait for the second person =="
CODE=$(verify "$A_TOKEN" "$QR_FLAG" "$SNAP/v_flag"); FLAG=$(cat "$SNAP/v_flag")
[ "$CODE" = "200" ] && echo "$FLAG" | grep -q '"needs_supervisor"' \
  && echo "  ✓ a FLAGGED (comp) pass scans to outcome=needs_supervisor → the AURA takeover" \
  || { echo "  ✗ flagged pass: HTTP $CODE $FLAG"; fail=1; }
CODE=$(verify "$A_TOKEN" "$QR_TABLE" "$SNAP/v_table"); TABLE=$(cat "$SNAP/v_table")
[ "$CODE" = "200" ] && echo "$TABLE" | grep -q '"needs_supervisor"' \
  && echo "  ✓ a TABLE pass scans to outcome=needs_supervisor (tables always take two people)" \
  || { echo "  ✗ table pass: HTTP $CODE $TABLE"; fail=1; }

PEND=$(curl -s -H "authorization: Bearer $S_TOKEN" "$BASE/api/scan/pending")
R9=$(P="$PEND" GA="$ID_GA" FL="$ID_FLAG" TB="$ID_TABLE" node -e '
const t=(n,c)=>console.log((c?"  ✓ ":"  ✗ ")+n)||(c?0:process.exitCode=1);
const p=JSON.parse(process.env.P); const ids=(p.pending||[]).map(x=>x.credentialId);
t("the supervisor queue holds the flagged pass", ids.includes(process.env.FL));
t("the supervisor queue holds the table pass", ids.includes(process.env.TB));
t("the plain GA pass is NOT in the queue — it was already admitted (OV6)", !ids.includes(process.env.GA));
t("the queue is marked selective so the UI can say so", p.selective===true);
t("the queue is oldest-first (the person standing there longest)",
  (p.pending||[]).every((x,i,a)=>i===0||new Date(a[i-1].scannedAt)<=new Date(x.scannedAt)));
' 2>&1 || true)
echo "$R9"; echo "$R9" | grep -q '✗' && fail=1

echo ""
echo "== 10. SUPERVISOR CONFIRM: scanned → wristband_issued · every other source refused =="
CODE=$(confirm "$S_TOKEN" "$ID_FLAG" "$SNAP/c_ok"); COK=$(cat "$SNAP/c_ok")
[ "$CODE" = "200" ] && echo "$COK" | grep -q '"wristband_issued"' \
  && echo "  ✓ supervisor confirm → state wristband_issued" \
  || { echo "  ✗ confirm: HTTP $CODE $COK"; fail=1; }
DB_FLAG=$(psql_one "select state||'|'||coalesce(confirmed_by,'-')||'|'||coalesce(confirmed_by_name,'-')||'|at='||(confirmed_at is not null)::text from credential where id='$ID_FLAG'")
[ "$DB_FLAG" = "wristband_issued|$S_ID|Supervisor S|at=true" ] \
  && echo "  ✓ DB truth: $DB_FLAG — both halves of the two-step are on the row" \
  || { echo "  ✗ DB row after confirm: $DB_FLAG"; fail=1; }
FIRST_HALF=$(psql_one "select coalesce(scanned_by_name,'-') from credential where id='$ID_FLAG'")
[ "$FIRST_HALF" = "Door Agent A" ] \
  && echo "  ✓ the AGENT's half survives the confirm (the audit answer is 'A scanned, S confirmed')" \
  || { echo "  ✗ the agent's half was overwritten: $FIRST_HALF"; fail=1; }

# ── invalid transitions ──
CODE=$(confirm "$S_TOKEN" "$ID_FLAG" "$SNAP/c_twice"); TWICE=$(cat "$SNAP/c_twice")
[ "$CODE" = "409" ] && echo "$TWICE" | grep -q '"already_confirmed"' \
  && echo "  ✓ confirming twice → 409 already_confirmed (one wristband per pass)" \
  || { echo "  ✗ double confirm: HTTP $CODE $TWICE"; fail=1; }

NEVER=$(psql_one "select id from credential where event_id='offshore-001'")
CODE=$(confirm "$S_TOKEN" "$NEVER" "$SNAP/c_never"); NEVERR=$(cat "$SNAP/c_never")
[ "$CODE" = "403" ] && echo "$NEVERR" | grep -q '"out_of_scope"' \
  && echo "  ✓ a supervisor cannot confirm outside their event scope → 403 out_of_scope" \
  || { echo "  ✗ supervisor scope: HTTP $CODE $NEVERR"; fail=1; }

# An ISSUED pass has never been scanned — confirming it would let the supervisor
# admit a guest alone, which is the exact fraud the two-step exists to stop.
UNSEEN=$(psql_one "select id from credential where event_id='brunch-vol-09' and state='issued' order by public_ref limit 1")
if [ -n "$UNSEEN" ]; then
  CODE=$(confirm "$S_TOKEN" "$UNSEEN" "$SNAP/c_unseen"); UNSEENR=$(cat "$SNAP/c_unseen")
  [ "$CODE" = "409" ] && echo "$UNSEENR" | grep -q '"not_scanned"' \
    && echo "  ✓ confirming a NEVER-SCANNED pass → 409 not_scanned (a supervisor cannot admit alone)" \
    || { echo "  ✗ invalid transition issued→wristband: HTTP $CODE $UNSEENR"; fail=1; }
else
  echo "  ✗ no issued credential left to test the invalid transition"; fail=1
fi

CODE=$(confirm "$S_TOKEN" "11111111-1111-1111-1111-111111111111" "$SNAP/c_ghost")
[ "$CODE" = "404" ] && echo "  ✓ confirming a pass that does not exist → 404 (not a 500)" \
  || { echo "  ✗ ghost confirm: HTTP $CODE"; fail=1; }

# A revoked pass never gets through either half.
REVOKED_ID=$(psql_one "select id from credential where event_id='brunch-vol-09' and state='issued' order by public_ref desc limit 1")
REVOKED_QR=$(psql_one "select 'zora:'||code||':'||signature from credential where id='$REVOKED_ID'")
psql_one "update credential set state='revoked' where id='$REVOKED_ID'" >/dev/null
CODE=$(verify "$A_TOKEN" "$REVOKED_QR" "$SNAP/v_rev"); REV=$(cat "$SNAP/v_rev")
[ "$CODE" = "422" ] && echo "$REV" | grep -q '"revoked"' \
  && echo "  ✓ a REVOKED pass → 422 revoked (a cancelled ticket cannot be scanned back to life)" \
  || { echo "  ✗ revoked pass: HTTP $CODE $REV"; fail=1; }

echo ""
echo "== 11. A REVOKED SCANNER CODE CANNOT MINT A SESSION =="
curl -s -b "$SNAP/admin" -X DELETE "$BASE/api/agents/$R_ID" >/dev/null
R_STATUS=$(psql_one "select status from scanner_user where id='$R_ID'")
[ "$R_STATUS" = "revoked" ] \
  && echo "  ✓ REVOKE is a state change, not a delete — the row survives so scanned_by still resolves" \
  || { echo "  ✗ revoke left status=$R_STATUS"; fail=1; }
CODE=$(sess_code "$R_CODE" "10.0.0.9" "$SNAP/s_rev"); SREV=$(cat "$SNAP/s_rev")
[ "$CODE" = "401" ] && echo "$SREV" | grep -q '"revoked"' \
  && echo "  ✓ the revoked code → 401 revoked (the fired agent is out of the door immediately)" \
  || { echo "  ✗ revoked code minted a session: HTTP $CODE $SREV"; fail=1; }

# Rotating a code must also end the session it minted — "NEW CODE" mid-shift
# means "that phone is no longer the door".
curl -s -b "$SNAP/admin" -X POST "$BASE/api/agents/$A_ID/rotate" >/dev/null
ROT=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/scan/verify" \
  -H 'content-type: application/json' -H "authorization: Bearer $A_TOKEN" -d "{\"qr\":\"$QR_GA\"}")
[ "$ROT" = "401" ] \
  && echo "  ✓ rotating the code invalidated the live session it minted (401 on the next scan)" \
  || { echo "  ✗ a session outlived its rotated code: HTTP $ROT"; fail=1; }

echo ""
echo "══ 12. OV4 — BRUTE-FORCING THE 6-DIGIT CODE TRIGGERS A LOCKOUT ══"
echo "   6 digits = 900,000 possibilities. Without a lockout, 'type six digits'"
echo "   is a speed bump, not authentication."
# ── per-CODE lockout: someone saw a code over a shoulder and is guessing the
#    last digits. Each guess comes from a DIFFERENT source, so only the code
#    counter can catch this.
TARGET="000042"
CODE_LOCKED=""
for i in 1 2 3 4 5 6; do
  c=$(sess_code "$TARGET" "203.0.113.$i" "$SNAP/bf_code$i")
  [ "$c" = "429" ] && [ -z "$CODE_LOCKED" ] && CODE_LOCKED="$i"
done
[ -n "$CODE_LOCKED" ] && grep -q '"locked_out"' "$SNAP/bf_code$CODE_LOCKED" \
  && echo "  ✓ PER-CODE LOCKOUT: guess #$CODE_LOCKED against one code → 429 locked_out, even from a fresh source" \
  || { echo "  ✗ six guesses at one code never locked it (last: $(cat "$SNAP/bf_code6"))"; fail=1; }

# ── per-SOURCE lockout: one script sweeping many codes. Every guess is a
#    different code, so only the source counter can catch this.
IP_LOCKED=""
for i in $(seq 1 12); do
  c=$(sess_code "9000$(printf '%02d' "$i")" "198.51.100.7" "$SNAP/bf_ip$i")
  [ "$c" = "429" ] && [ -z "$IP_LOCKED" ] && IP_LOCKED="$i"
done
[ -n "$IP_LOCKED" ] && grep -q '"locked_out"' "$SNAP/bf_ip$IP_LOCKED" \
  && echo "  ✓ PER-SOURCE LOCKOUT: sweep guess #$IP_LOCKED from one source → 429 locked_out" \
  || { echo "  ✗ twelve guesses from one source never locked it (last: $(cat "$SNAP/bf_ip12"))"; fail=1; }

# THE assertion that makes it a lockout and not a counter: while locked, the
# RIGHT code is refused too. A lockout a correct guess walks through is theatre.
CODE=$(sess_code "$S_CODE" "198.51.100.7" "$SNAP/bf_good"); GOOD=$(cat "$SNAP/bf_good")
[ "$CODE" = "429" ] && echo "$GOOD" | grep -q '"locked_out"' \
  && echo "  ✓ while locked, even the CORRECT supervisor code → 429 locked_out" \
  || { echo "  ✗ the correct code walked through the lockout: HTTP $CODE $GOOD"; fail=1; }

# ...while an untouched source is unaffected: the lockout must not take the whole
# door offline because one script was pointed at it.
CODE=$(sess_code "$S_CODE" "192.0.2.55" "$SNAP/bf_clean"); CLEAN=$(cat "$SNAP/bf_clean")
[ "$CODE" = "200" ] && echo "$CLEAN" | grep -q '"supervisor"' \
  && echo "  ✓ a CLEAN source still signs in fine — the lockout is targeted, not a door-wide outage" \
  || { echo "  ✗ the lockout leaked onto an unrelated source: HTTP $CODE $CLEAN"; fail=1; }

# The ledger never stores an attempted code in the clear — it would otherwise be
# a list of near-miss door codes sitting in the database.
CLEARTEXT=$(psql_one "select count(*) from scan_auth_attempt where code_hash ~ '^[0-9]{4,10}$'")
LOGGED=$(psql_one "select count(*) from scan_auth_attempt")
[ "$CLEARTEXT" = "0" ] && [ "$LOGGED" -ge 20 ] \
  && echo "  ✓ $LOGGED attempts logged, ZERO of them storing a code in the clear" \
  || { echo "  ✗ attempt ledger: $LOGGED rows, $CLEARTEXT cleartext codes"; fail=1; }

[ "$fail" = "0" ] || { echo ""; echo "SCAN E2E: FAIL"; tail -40 "$SNAP/api.log"; exit 1; }
echo ""
echo "SCAN E2E: PASS (state on credential.state · REPLAY 409 with prior actor+time · concurrent double-scan · forged signature · wrong event + scope · ROLE GATE both ways · selective supervisor confirm · invalid transitions · revoked code + rotated session · BRUTE-FORCE LOCKOUT per code and per source)"
