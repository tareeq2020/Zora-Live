/* Events data access. Events live in the 'events' collection (the collection_store
   blob table), exactly like every other collection the API serves via EntityStore.
   The old supabase-js `events` TABLE path is retired — there is no such table; the
   data is the JSON blob. (This finishes the "events.js split-brain" retirement:
   the marketplace + storefronts read the same store the rest of the app writes.) */
const { db } = require('@zora/core');

// Canonical slug aliases: friendly flagship URLs (/events/offshore) resolve to the
// real event id (offshore-001). Keeps the marketing URL stable if the id ever moves.
const SLUG_ALIASES = { offshore: 'offshore-001' };
function resolveSlug(id) { return SLUG_ALIASES[id] || id; }

function byDate(a, b) { return String(a.date || '').localeCompare(String(b.date || '')); }

async function readAll() {
  const rows = await db()`select data from collection_store where name = 'events'`;
  return rows.length ? JSON.parse(rows[0].data) : [];
}
async function writeAll(rows) {
  const text = JSON.stringify(rows);
  await db()`insert into collection_store (name, data, updated_at) values ('events', ${text}, now())
             on conflict (name) do update set data = excluded.data, updated_at = now()`;
}

async function listEvents(city) {
  let rows = await readAll();
  if (city) rows = rows.filter((e) => e.city === city);
  return rows.sort(byDate);
}

async function getEvent(id) {
  id = resolveSlug(id);
  const row = (await readAll()).find((e) => e.id === id);
  if (!row) throw new Error('Event not found');
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

module.exports = { listEvents, getEvent, upsertEvent, resolveSlug };
