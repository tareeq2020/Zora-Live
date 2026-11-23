/* Events data access. Events live in the 'events' collection (the collection_store
   blob table), exactly like every other collection the API serves via EntityStore.
   The old supabase-js `events` TABLE path is retired — there is no such table; the
   data is the JSON blob. (This finishes the "events.js split-brain" retirement:
   the marketplace + storefronts read the same store the rest of the app writes.) */
const { db, suspendedHandles, cities, withCityFields } = require('@zora/core');

// Canonical slug aliases: friendly flagship URLs (/events/offshore) resolve to the
// real event id (offshore-001). Keeps the marketing URL stable if the id ever moves.
const SLUG_ALIASES = { offshore: 'offshore-001' };
function resolveSlug(id) { return SLUG_ALIASES[id] || id; }

// BS97 → BS168: canonicalise the city on READ so every consumer (marketplace,
// storefront, middleware) sees a current city id however the row was written
// (an old label like "Dar Es Salaam", or a city an admin since merged). The list
// now comes from the `city` table via the core cache (no copy here), and each
// event also carries cityName + cityCurrency so no surface keeps its own list.
function canonCity(v) {
  return cities().canon(v);
}
function canonEvent(e) {
  return withCityFields(e, cities());
}

// BS99 (#2): the marketplace "FROM {price}" must be the lowest price a buyer can
// ACTUALLY pay — i.e. the cheapest ON-SALE tier. `priceFrom` is a stored field
// that is not recomputed when a tier is disabled, so an event whose cheapest tier
// was taken off sale kept advertising that dead price (Apricot Crush showed
// "from 1,000" for a disabled GA tier while the cheapest live tier was 20,000).
// Derive it on read from the non-disabled webCheckout tiers; fall back to the
// stored value only when there are no active tiers to speak for it.
function deriveFrom(e) {
  const tiers = e && e.webCheckout && Array.isArray(e.webCheckout.tiers) ? e.webCheckout.tiers : null;
  if (!tiers || !tiers.length) return e;
  const live = tiers
    .filter((t) => t && !t.disabled && Number.isFinite(Number(t.unitPrice)))
    .map((t) => Number(t.unitPrice));
  if (!live.length) return e; // every tier disabled — leave the stored priceFrom
  const from = Math.min(...live);
  return from === e.priceFrom ? e : { ...e, priceFrom: from };
}

function byDate(a, b) { return String(a.date || '').localeCompare(String(b.date || '')); }

// C5: public-read status filter. Events gain status ∈ {draft,published,archived}
// (added by the org CRUD in MT2). Public reads expose ONLY published events — a
// MISSING/null status means a legacy event (the 7 seed events predate the field)
// and is treated as published for backward-compat. Drafts/archived vanish from
// /api/events, /api/events/:id, the storefront, and the middleware event lookup.
function isPubliclyVisible(e) {
  return !!e && (e.status == null || e.status === 'published');
}

// BS70 (#6/T7): a published event is ALSO hidden when its organizer is suspended
// — the cascade. Consulted against the in-memory suspended-handle set (never a
// per-event DB join, C3): the org table's handle column is the key and the set
// is refreshed synchronously the moment an admin flips status. `ensureFresh`
// lazily reloads it on a short TTL so a first read after boot is never stale.
async function isPublicEvent(e) {
  if (!isPubliclyVisible(e)) return false;
  const suspended = suspendedHandles();
  await suspended.ensureFresh();
  return suspended.isVisible(e);
}

async function readAll() {
  await cities().ensureFresh();
  const rows = await db()`select data from collection_store where name = 'events'`;
  // Canonicalise city on the way out (BS97) — the single choke point every public
  // read (list/get) and the upsert read-modify-write all flow through.
  return rows.length ? JSON.parse(rows[0].data).map(canonEvent).map(deriveFrom) : [];
}
async function writeAll(rows) {
  // cityName / cityCurrency are added on read; never persist them.
  const text = JSON.stringify(rows.map(({ cityName, cityCurrency, ...e }) => e)); // eslint-disable-line no-unused-vars
  await db()`insert into collection_store (name, data, updated_at) values ('events', ${text}, now())
             on conflict (name) do update set data = excluded.data, updated_at = now()`;
}

async function listEvents(city) {
  const suspended = suspendedHandles();
  await suspended.ensureFresh(); // one refresh for the whole list, then sync checks
  let rows = (await readAll()).filter((e) => isPubliclyVisible(e) && suspended.isVisible(e));
  if (city) {
    const want = canonCity(city);
    rows = rows.filter((e) => e.city === want);
  }
  return rows.sort(byDate);
}

async function getEvent(id) {
  id = resolveSlug(id);
  const row = (await readAll()).find((e) => e.id === id);
  // A non-published event — or one whose organizer is suspended — is treated as
  // non-existent on the public read path (404), same as an unknown id: no draft/
  // archived leak, and a suspended org's events vanish entirely (BS70 #6).
  if (!row || !(await isPublicEvent(row))) throw new Error('Event not found');
  return row;
}

async function upsertEvent(event) {
  const rows = await readAll();
  const row = { ...event, updated_at: new Date().toISOString() };
  if (!row.id) row.id = 'ev_' + Date.now().toString(36);
  const i = rows.findIndex((e) => e.id === row.id);
  if (i >= 0) rows[i] = { ...rows[i], ...row };
  else rows.push(row);
  await writeAll(rows);
  return row;
}

module.exports = { listEvents, getEvent, upsertEvent, resolveSlug, isPublicEvent, isPubliclyVisible, canonCity };
