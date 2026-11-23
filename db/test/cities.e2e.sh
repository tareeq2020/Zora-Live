#!/usr/bin/env bash
# BS168 — CITIES FROM THE DATABASE. Boots the real API on a throwaway Postgres
# and proves:
#
#   1. Migration 0039 seeds the five cities. GET /api/cities lists only cities
#      with upcoming public events, busiest first (past events, drafts and
#      archived events don't count); ?all=1 adds active cities with none.
#   2. Events carry cityName + cityCurrency; an old label ("Dar Es Salaam") or
#      spelling ("dsm") resolves to the city id, on read and in ?city=.
#   3. GET /api/cities/:id — active 200 (also with no events), unknown 404.
#   4. Organizer: GET /api/org/cities gives the list, the last city used and
#      past venues; saving an event with an unlisted city → 400 city_invalid
#      (drafts too); "DSM" is stored as dar.
#   5. Asking for a city: creates a requested city, asking again returns the
#      same one, asking for a listed city's spelling picks it, more than 3 open
#      requests → 429. An event in a requested city sells and is searchable but
#      its city isn't on Discover; Needs attention lists the request.
#   6. Admin: 401 anon; approve → the city shows on Discover; match a request
#      to a listed city → its events move and the old id redirects; decline →
#      asking again is refused; hide a city → no new events there, existing
#      ones still edit, its page 404s; a new spelling works at once; add a city.
#      Every admin write is audited.
#
# Style mirrors event-dates.e2e.sh. Self-contained. bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/apps/api"
PG_PORT="${TEST_PG_PORT:-56368}"
API_PORT="${TEST_API_PORT:-4368}"
DATA="$(mktemp -d "${TMPDIR:-/tmp}/zora-city-XXXXXX")"
SNAP="$(mktemp -d "${TMPDIR:-/tmp}/zora-citysnap-XXXXXX")"
USER_NAME="$(whoami)"
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
createdb -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" zora_city
URL="postgres://$USER_NAME@127.0.0.1:$PG_PORT/zora_city"
DATABASE_URL_MIGRATE="$URL" node "$ROOT/db/migrate.mjs" >/dev/null
DATABASE_URL="$URL" ZORA_DATA_DIR="$ROOT/data" node "$ROOT/db/backfill.mjs" settings tiers organizers audit admin events kyc >/dev/null

q() { psql -tA -h 127.0.0.1 -p "$PG_PORT" -U "$USER_NAME" -d zora_city -v ON_ERROR_STOP=1 -c "$1"; }
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1 → $2"; else echo "  ✗ $1 → $2 (want $3)"; fail=1; fi; }

FUT=$(node -e 'const d=new Date(Date.now()+30*864e5);process.stdout.write(d.toISOString().slice(0,10))')
FUT2=$(node -e 'const d=new Date(Date.now()+40*864e5);process.stdout.write(d.toISOString().slice(0,10))')
PAST=$(node -e 'const d=new Date(Date.now()-30*864e5);process.stdout.write(d.toISOString().slice(0,10))')

echo "== seed: 3 upcoming in Dar (one stored as a label), 1 in Zanzibar, 1 past in Nairobi, a draft in Accra, 1 in Lagos =="
q "update organizer set kyc_status='approved' where handle='thebrunchcity'" >/dev/null
q "update collection_store set data = '[
  {\"id\":\"e-d1\",\"name\":\"Dar One\",\"city\":\"dar\",\"venue\":\"Coco Beach\",\"status\":\"published\",\"date\":\"$FUT\",\"organizerHandle\":\"thebrunchcity\",\"updated_at\":\"2026-01-01T00:00:00Z\"},
  {\"id\":\"e-d2\",\"name\":\"Dar Two\",\"city\":\"Dar Es Salaam\",\"venue\":\"Coco Beach\",\"status\":\"published\",\"date\":\"$FUT\",\"organizerHandle\":\"thebrunchcity\",\"updated_at\":\"2026-01-02T00:00:00Z\"},
  {\"id\":\"e-d3\",\"name\":\"Dar Three\",\"city\":\"dar\",\"venue\":\"Slipway\",\"status\":\"published\",\"organizerHandle\":\"thebrunchcity\",\"updated_at\":\"2026-01-03T00:00:00Z\"},
  {\"id\":\"e-z1\",\"name\":\"Zanzibar One\",\"city\":\"zanzibar\",\"venue\":\"Forodhani\",\"status\":\"published\",\"date\":\"$FUT2\",\"organizerHandle\":\"thebrunchcity\",\"updated_at\":\"2026-02-01T00:00:00Z\"},
  {\"id\":\"e-n1\",\"name\":\"Nairobi Past\",\"city\":\"nairobi\",\"venue\":\"K1\",\"status\":\"published\",\"date\":\"$PAST\",\"organizerHandle\":\"o-other\"},
  {\"id\":\"e-a1\",\"name\":\"Accra Draft\",\"city\":\"accra\",\"venue\":\"X\",\"status\":\"draft\",\"date\":\"$FUT\",\"organizerHandle\":\"o-other\"},
  {\"id\":\"e-l1\",\"name\":\"Lagos One\",\"city\":\"lagos\",\"venue\":\"Eko\",\"status\":\"draft\",\"date\":\"$FUT\",\"organizerHandle\":\"thebrunchcity\",\"updated_at\":\"2025-12-01T00:00:00Z\"},
  {\"id\":\"e-old\",\"name\":\"Old Freetext\",\"city\":\"Arusha Old Town\",\"venue\":\"Y\",\"status\":\"draft\",\"organizerHandle\":\"thebrunchcity\",\"updated_at\":\"2025-11-01T00:00:00Z\"},
  {\"id\":\"e-mw\",\"name\":\"Mwanza Label\",\"city\":\"Mwanza\",\"venue\":\"Z\",\"status\":\"draft\",\"organizerHandle\":\"thebrunchcity\",\"updated_at\":\"2025-11-02T00:00:00Z\"}
]' where name='events'" >/dev/null

echo "== boot API =="
lsof -ti tcp:$API_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 0.3
( cd "$API_DIR" && env PORT="$API_PORT" DATABASE_URL="$URL" XBRIDGE_MOCK=true COOKIE_SECURE=false \
    SESSION_SECRET=e2e KYC_SECRET=e2e TICKET_SIGNING_KEY=e2e-ticket-key \
    PUBLIC_ORIGIN="http://localhost:$API_PORT" node dist/main.js ) >"$SNAP/api.log" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$API_PORT/api/settings" 2>/dev/null && break; sleep 1; done
BASE="http://localhost:$API_PORT"
jx() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let o;try{o=JSON.parse(s)}catch{process.stdout.write("ERR:"+s.slice(0,160));return}try{process.stdout.write(String(eval(process.argv[1])))}catch(e){process.stdout.write("ERR:"+e.message)}})' "$1"; }
code() { curl -s -o "$SNAP/body" -w "%{http_code}" "$@"; }

echo ""
echo "== 1. migration + public list =="
check "seeded cities" "$(q "select string_agg(id, ',' order by sort) from city")" "dar,zanzibar,nairobi,accra,lagos"
check "GET /api/cities (only cities with upcoming events, busiest first)" "$(curl -s "$BASE/api/cities" | jx 'o.cities.map(c=>c.id+":"+c.upcoming).join(",")')" "dar:3,zanzibar:1"
check "?all=1 adds the active cities with none" "$(curl -s "$BASE/api/cities?all=1" | jx 'o.cities.map(c=>c.id).join(",")')" "dar,zanzibar,nairobi,accra,lagos"
check "city carries name/country/currency" "$(curl -s "$BASE/api/cities" | jx 'const c=o.cities[0];[c.name,c.country,c.currency].join("|")')" "Dar es Salaam|Tanzania|TZS"

echo ""
echo "== 2. events carry the city; old spellings resolve =="
check "stored label 'Dar Es Salaam' served as dar + name + currency" "$(curl -s "$BASE/api/events" | jx 'const e=o.find(x=>x.id==="e-d2");[e.city,e.cityName,e.cityCurrency].join("|")')" "dar|Dar es Salaam|TZS"
check "?city=dsm (a spelling) lists Dar's events" "$(curl -s "$BASE/api/events?city=dsm" | jx 'o.map(e=>e.id).sort().join(",")')" "e-d1,e-d2,e-d3"
check "?city=Dar%20es%20Salaam (a name) too" "$(curl -s "$BASE/api/events?city=Dar%20es%20Salaam" | jx 'o.length')" "3"

echo ""
echo "== 3. one city =="
check "GET /api/cities/dar" "$(curl -s "$BASE/api/cities/dar" | jx 'o.city.id+":"+o.city.upcoming')" "dar:3"
check "GET /api/cities/lagos (active, no events) → 200" "$(code "$BASE/api/cities/lagos")" "200"
check "GET /api/cities/atlantis → 404" "$(code "$BASE/api/cities/atlantis")" "404"

echo ""
echo "== 4. organizer picker + city checks on save =="
curl -s -c "$SNAP/admin" -X POST "$BASE/api/login" -H 'content-type: application/json' -d '{"username":"admin","password":"zora2026"}' >/dev/null
curl -s -b "$SNAP/admin" -X PUT "$BASE/api/organizers/o1/password" -H 'content-type: application/json' -d '{"password":"orgpass123"}' >/dev/null
curl -s -c "$SNAP/org" -X POST "$BASE/api/org/login" -H 'content-type: application/json' -d '{"handle":"thebrunchcity","password":"orgpass123"}' >/dev/null
check "anon GET /api/org/cities → 401" "$(code "$BASE/api/org/cities")" "401"
curl -s -b "$SNAP/org" "$BASE/api/org/cities" > "$SNAP/oc.json"
check "picker lists the 5 active cities" "$(jx 'o.cities.map(c=>c.id).sort().join(",")' < "$SNAP/oc.json")" "accra,dar,lagos,nairobi,zanzibar"
check "last city = the most recently touched event's" "$(jx 'o.lastCity' < "$SNAP/oc.json")" "zanzibar"
check "past venues, most used first, with their city" "$(jx 'o.venues.slice(0,2).map(v=>v.venue+"@"+v.city+"x"+v.uses).join(",")' < "$SNAP/oc.json")" "Coco Beach@darx2,Forodhani@zanzibarx1"
check "the Dar spelling 'dsm' is on the city for search" "$(jx 'o.cities.find(c=>c.id==="dar").aliases.includes("dsm")' < "$SNAP/oc.json")" "true"

EV='"dateLabel":"Sat","date":"'"$FUT"'","venue":"V","category":"Party","priceFrom":1000,"seated":false,"tiers":[{"name":"GA","price":1000,"capacity":10}]'
check "publish with city 'atlantis' → 400" "$(code -b "$SNAP/org" -X POST "$BASE/api/org/events" -H 'content-type: application/json' -d '{"name":"Bad","city":"atlantis","sellable":true,"idempotencyKey":"c-bad",'"$EV"'}')" "400"
check "  … error city_invalid" "$(jx 'o.error' < "$SNAP/body")" "city_invalid"
check "a DRAFT with 'atlantis' → 400 too" "$(code -b "$SNAP/org" -X POST "$BASE/api/org/events" -H 'content-type: application/json' -d '{"name":"Bad draft","city":"atlantis"}')" "400"
check "publish with 'DSM' → 201/200" "$(code -b "$SNAP/org" -X POST "$BASE/api/org/events" -H 'content-type: application/json' -d '{"name":"Spelled","city":"DSM","sellable":true,"idempotencyKey":"c-dsm",'"$EV"'}' | sed 's/201/200/')" "200"
check "  … stored as dar" "$(q "select e->>'city' from collection_store, jsonb_array_elements(data::jsonb) e where name='events' and e->>'name'='Spelled'")" "dar"
check "an event with an old unlisted city still edits (city unchanged) → 200" "$(code -b "$SNAP/org" -X PUT "$BASE/api/org/events/e-old" -H 'content-type: application/json' -d '{"name":"Old Freetext (renamed)","city":"Arusha Old Town"}')" "200"
check "  … its city is kept as stored" "$(q "select e->>'city' from collection_store, jsonb_array_elements(data::jsonb) e where name='events' and e->>'id'='e-old'")" "Arusha Old Town"
check "  … but moving it to another unlisted city → 400" "$(code -b "$SNAP/org" -X PUT "$BASE/api/org/events/e-old" -H 'content-type: application/json' -d '{"city":"Atlantis"}')" "400"
SPELLED=$(q "select e->>'id' from collection_store, jsonb_array_elements(data::jsonb) e where name='events' and e->>'name'='Spelled'")
check "clearing the city of a published event → 400" "$(code -b "$SNAP/org" -X PUT "$BASE/api/org/events/$SPELLED" -H 'content-type: application/json' -d '{"city":"   "}')" "400"
check "  … error city_required" "$(jx 'o.error' < "$SNAP/body")" "city_required"
NOCITY=$(curl -s -b "$SNAP/org" -X POST "$BASE/api/org/events" -H 'content-type: application/json' -d '{"name":"No City Draft"}' | jx 'o.id')
check "publishing a draft that has no city → 400" "$(code -b "$SNAP/org" -X PUT "$BASE/api/org/events/$NOCITY" -H 'content-type: application/json' -d '{"sellable":true,"dateLabel":"Sat","date":"'"$FUT"'","venue":"V","category":"Party","priceFrom":1000,"seated":false,"tiers":[{"name":"GA","price":1000,"capacity":10}]}')" "400"
check "  … error city_required" "$(jx 'o.error' < "$SNAP/body")" "city_required"
check "clearing the city of a draft → 200" "$(code -b "$SNAP/org" -X PUT "$BASE/api/org/events/e-old" -H 'content-type: application/json' -d '{"city":""}')" "200"
q "update collection_store set data = (select jsonb_agg(case when e->>'id'='e-old' then e || '{\"city\":\"Arusha Old Town\"}'::jsonb else e end) from jsonb_array_elements(data::jsonb) e)::text where name='events'" >/dev/null

echo ""
echo "== 5. asking for a city =="
check "ask for 'Arusha' → requested" "$(curl -s -b "$SNAP/org" -X POST "$BASE/api/org/cities/request" -H 'content-type: application/json' -d '{"name":"Arusha"}' | jx 'o.city.id+":"+o.city.status+":"+o.matched')" "arusha:requested:false"
check "ask again → the same city" "$(curl -s -b "$SNAP/org" -X POST "$BASE/api/org/cities/request" -H 'content-type: application/json' -d '{"name":" arusha "}' | jx 'o.city.id+":"+o.matched')" "arusha:true"
check "ask for 'Dar-es-Salaam' → picks dar" "$(curl -s -b "$SNAP/org" -X POST "$BASE/api/org/cities/request" -H 'content-type: application/json' -d '{"name":"Dar-es-Salaam"}' | jx 'o.city.id+":"+o.city.status+":"+o.matched')" "dar:active:true"
check "ask for '<b>' → 400" "$(code -b "$SNAP/org" -X POST "$BASE/api/org/cities/request" -H 'content-type: application/json' -d '{"name":"<b>x</b>"}')" "400"
curl -s -b "$SNAP/org" -X POST "$BASE/api/org/cities/request" -H 'content-type: application/json' -d '{"name":"Mwanza","country":"Tanzania"}' >/dev/null
curl -s -b "$SNAP/org" -X POST "$BASE/api/org/cities/request" -H 'content-type: application/json' -d '{"name":"Moshi"}' >/dev/null
check "a 4th open request → 429" "$(code -b "$SNAP/org" -X POST "$BASE/api/org/cities/request" -H 'content-type: application/json' -d '{"name":"Dodoma"}')" "429"
check "the picker shows the org's requests" "$(curl -s -b "$SNAP/org" "$BASE/api/org/cities" | jx 'o.requested.map(c=>c.id).sort().join(",")')" "arusha,moshi,mwanza"

check "publish an event in Arusha (requested) → 200" "$(code -b "$SNAP/org" -X POST "$BASE/api/org/events" -H 'content-type: application/json' -d '{"name":"Arusha Night","city":"arusha","sellable":true,"idempotencyKey":"c-aru",'"$EV"'}' | sed 's/201/200/')" "200"
curl -s -b "$SNAP/org" -X POST "$BASE/api/org/events" -H 'content-type: application/json' -d '{"name":"Mwanza Night","city":"mwanza","sellable":true,"idempotencyKey":"c-mwz",'"$EV"'}' >/dev/null
check "  … it's on /api/events with its city name" "$(curl -s "$BASE/api/events" | jx 'const e=o.find(x=>x.name==="Arusha Night");e.city+"|"+e.cityName')" "arusha|Arusha"
check "  … but Arusha is not a Discover city yet" "$(curl -s "$BASE/api/cities" | jx 'o.cities.some(c=>c.id==="arusha")')" "false"
check "  … and /api/cities/arusha → 404" "$(code "$BASE/api/cities/arusha")" "404"
check "Needs attention lists 3 city requests" "$(curl -s -b "$SNAP/admin" "$BASE/api/admin/attention" | jx 'o.counts.city_request+":"+o.items.filter(i=>i.kind==="city_request").map(i=>i.href).filter((v,i,a)=>a.indexOf(v)===i).join()')" "3:/admin/console/cities"

echo ""
echo "== 6. admin =="
check "anon GET /api/admin/cities → 401" "$(code "$BASE/api/admin/cities")" "401"
check "org session on /api/admin/cities → 401/403" "$(code -b "$SNAP/org" "$BASE/api/admin/cities" | sed 's/403/401/')" "401"
curl -s -b "$SNAP/admin" "$BASE/api/admin/cities" > "$SNAP/ac.json"
check "admin list: requests first, with event counts" "$(jx 'o.cities.slice(0,3).map(c=>c.id+":"+c.status+":"+c.events).join(",")' < "$SNAP/ac.json")" "arusha:requested:1,moshi:requested:0,mwanza:requested:2"
check "  … old freetext cities listed for fixing" "$(jx 'o.unknown.map(u=>u.value).join(",")' < "$SNAP/ac.json")" "Arusha Old Town"

check "approve Arusha (set country) → active" "$(curl -s -b "$SNAP/admin" -X POST "$BASE/api/admin/cities/arusha/approve" -H 'content-type: application/json' -d '{"country":"Tanzania","currency":"TZS","timezone":"Africa/Dar_es_Salaam"}' | jx 'o.city.status+":"+o.city.country')" "active:Tanzania"
check "  … Arusha is on Discover now (ties: admin order)" "$(curl -s "$BASE/api/cities" | jx 'o.cities.map(c=>c.id).join(",")')" "dar,zanzibar,arusha"
check "approve Arusha again → 409" "$(code -b "$SNAP/admin" -X POST "$BASE/api/admin/cities/arusha/approve" -H 'content-type: application/json' -d '{}')" "409"
check "decline Mwanza while events use it → 409 city_in_use" "$(code -b "$SNAP/admin" -X POST "$BASE/api/admin/cities/mwanza/decline")" "409"
check "match a city to itself → 400" "$(code -b "$SNAP/admin" -X POST "$BASE/api/admin/cities/mwanza/merge" -H 'content-type: application/json' -d '{"into":"mwanza"}')" "400"

check "match Mwanza to Dar → 2 events moved (by id and by spelling)" "$(curl -s -b "$SNAP/admin" -X POST "$BASE/api/admin/cities/mwanza/merge" -H 'content-type: application/json' -d '{"into":"dar"}' | jx 'o.moved+":"+o.into')" "2:dar"
check "  … the one stored as 'Mwanza' moved too" "$(q "select e->>'city' from collection_store, jsonb_array_elements(data::jsonb) e where name='events' and e->>'id'='e-mw'")" "dar"
check "  … editing the matched city → 409" "$(code -b "$SNAP/admin" -X PUT "$BASE/api/admin/cities/mwanza" -H 'content-type: application/json' -d '{"country":"x"}')" "409"
check "  … the event is in dar" "$(curl -s "$BASE/api/events" | jx 'o.find(x=>x.name==="Mwanza Night").city')" "dar"
check "  … /api/cities/mwanza redirects to dar" "$(curl -s "$BASE/api/cities/mwanza" | jx 'o.redirect')" "dar"
check "  … 'Mwanza' is now a Dar spelling" "$(q "select 'mwanza' = any(aliases) from city where id='dar'")" "t"

check "decline Moshi" "$(curl -s -b "$SNAP/admin" -X POST "$BASE/api/admin/cities/moshi/decline" | jx 'o.ok')" "true"
check "  … asking for Moshi again → 409" "$(code -b "$SNAP/org" -X POST "$BASE/api/org/cities/request" -H 'content-type: application/json' -d '{"name":"Moshi"}')" "409"

check "hide Lagos" "$(curl -s -b "$SNAP/admin" -X PUT "$BASE/api/admin/cities/lagos" -H 'content-type: application/json' -d '{"status":"hidden"}' | jx 'o.city.status')" "hidden"
check "  … new event in Lagos → 400" "$(code -b "$SNAP/org" -X POST "$BASE/api/org/events" -H 'content-type: application/json' -d '{"name":"New Lagos","city":"lagos"}')" "400"
check "  … the existing Lagos draft still saves with lagos" "$(code -b "$SNAP/org" -X PUT "$BASE/api/org/events/e-l1" -H 'content-type: application/json' -d '{"name":"Lagos One (edited)","city":"lagos"}')" "200"
check "  … /api/cities/lagos → 404" "$(code "$BASE/api/cities/lagos")" "404"
check "  … not offered in the picker" "$(curl -s -b "$SNAP/org" "$BASE/api/org/cities" | jx 'o.cities.some(c=>c.id==="lagos")')" "false"

check "add the spelling 'bongo' to Dar" "$(curl -s -b "$SNAP/admin" -X PUT "$BASE/api/admin/cities/dar" -H 'content-type: application/json' -d '{"aliases":"dsm, dar es salaam, Bongo, mwanza"}' | jx 'o.city.aliases.includes("bongo")')" "true"
check "  … ?city=bongo finds Dar's events at once" "$(curl -s "$BASE/api/events?city=bongo" | jx 'o.length>=3')" "true"
check "a spelling that already means another city → 409" "$(code -b "$SNAP/admin" -X PUT "$BASE/api/admin/cities/dar" -H 'content-type: application/json' -d '{"aliases":"dsm, zanzibar"}')" "409"
check "match into a hidden city → 409" "$(code -b "$SNAP/admin" -X POST "$BASE/api/admin/cities/arusha/merge" -H 'content-type: application/json' -d '{"into":"lagos"}')" "409"
check "bad currency → 400" "$(code -b "$SNAP/admin" -X PUT "$BASE/api/admin/cities/dar" -H 'content-type: application/json' -d '{"currency":"shillings"}')" "400"
check "bad time zone → 400" "$(code -b "$SNAP/admin" -X PUT "$BASE/api/admin/cities/dar" -H 'content-type: application/json' -d '{"timezone":"Mars/Base"}')" "400"

check "add Kigali" "$(curl -s -b "$SNAP/admin" -X POST "$BASE/api/admin/cities" -H 'content-type: application/json' -d '{"name":"Kigali","country":"Rwanda","currency":"RWF","timezone":"Africa/Kigali"}' | jx 'o.city.id+":"+o.city.status')" "kigali:active"
check "  … adding it twice → 409" "$(code -b "$SNAP/admin" -X POST "$BASE/api/admin/cities" -H 'content-type: application/json' -d '{"name":"kigali"}')" "409"
check "  … offered to organizers at once" "$(curl -s -b "$SNAP/org" "$BASE/api/org/cities" | jx 'o.cities.some(c=>c.id==="kigali")')" "true"

check "admin writes audited (approve, merge, decline, update x2, create)" \
  "$(q "select count(*) from collection_store, jsonb_array_elements(data::jsonb) a where name='audit' and a->>'action' like 'admin.city.%'")" "6"
check "the organizer's requests are audited" \
  "$(q "select count(*) from collection_store, jsonb_array_elements(data::jsonb) a where name='audit' and a->>'action' = 'org.city.request'")" "3"
# (audited before section 7: the audit store is one JSON row rewritten per entry,
#  so concurrent audit writes can drop entries; a known pre-existing limit.)

echo ""
echo "== 7. concurrent requests can't pass the cap =="
PIDS=""
for n in Tabora Dodoma Morogoro Tanga Iringa Songea Kigoma Musoma Bukoba Lindi Mtwara Singida; do
  curl -s -o /dev/null -b "$SNAP/org" -X POST "$BASE/api/org/cities/request" -H 'content-type: application/json' -d "{\"name\":\"$n\"}" &
  PIDS="$PIDS $!"
done
wait $PIDS # only these requests (a bare wait would also wait for the API server)
check "12 at once (more than the DB pool of 10) → exactly 3 requested" "$(q "select count(*) from city where status='requested' and requested_by='thebrunchcity'")" "3"
check "  … and the API still answers" "$(code --max-time 10 "$BASE/api/cities")" "200"

echo ""
if [ "$fail" = 0 ]; then echo "ALL CITIES CHECKS PASSED"; else echo "CITIES CHECKS FAILED (api log: $SNAP/api.log)"; tail -30 "$SNAP/api.log"; exit 1; fi
