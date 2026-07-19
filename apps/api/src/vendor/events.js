/* Events data access — OUR ecosystem only.
   The marketplace fetches exclusively from our own database: the shared Supabase
   `events` table when configured (so the website and mobile app stay in sync),
   otherwise the local `data/events.json` store. Nothing generic or external ever
   enters the marketplace — every event here was created inside Zora.

   Supabase stores the full canonical event object in `events.props` (matching the
   events.json shape) plus top-level columns for querying/RLS. We read/write props
   so the site gets exactly the shape discover.html + enrichEvent expect. */
const fs = require('fs');
const path = require('path');
const { supabase } = require('./supabase');

// DATA_DIR is shared with the rest of the API (see StorageModule). Honors
// ZORA_DATA_DIR so the api reads/writes the same store as the legacy oracle.
const DATA_DIR = process.env.ZORA_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');

function readLocal() {
  try { return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8')); } catch { return []; }
}
function writeLocal(rows) {
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(rows, null, 2), 'utf8');
}
function byDate(a, b) { return String(a.date || '').localeCompare(String(b.date || '')); }

// Canonical slug aliases: friendly flagship URLs (/events/offshore) resolve to the
// real event id (offshore-001). Keeps the marketing URL stable if the id ever moves.
const SLUG_ALIASES = { offshore: 'offshore-001' };
function resolveSlug(id) { return SLUG_ALIASES[id] || id; }

// Supabase row → the site's canonical event shape. `props` holds the full object;
// fall back to top-level columns for rows written before props existed.
function fromRow(r) {
  if (!r) return r;
  if (r.props && Object.keys(r.props).length) return { ...r.props, id: r.props.id || r.id };
  return { id: r.id, name: r.name, city: r.city, status: r.status };
}
// Site event → a Supabase row (full object in props + queryable columns).
function toRow(e) {
  return {
    name: e.name,
    city: e.city,
    status: e.status || 'published',
    cover: e.cover || null,
    tiers: e.priceFrom != null ? [{ name: 'From', price: e.priceFrom }] : (e.tiers || []),
    props: e,
    updated_at: new Date().toISOString(),
  };
}

async function listEvents(city) {
  if (supabase) {
    let q = supabase.from('events').select('*');
    if (city) q = q.eq('city', city);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(fromRow);
  }
  let rows = readLocal();
  if (city) rows = rows.filter((e) => e.city === city);
  return rows.sort(byDate);
}

async function getEvent(id) {
  id = resolveSlug(id);
  if (supabase) {
    // id is the slug (events.json id). Match props->>id, or the uuid as fallback.
    const { data, error } = await supabase.from('events').select('*');
    if (error) throw error;
    const row = (data || []).find((r) => (r.props && r.props.id) === id || r.id === id);
    if (!row) throw new Error('Event not found');
    return fromRow(row);
  }
  const row = readLocal().find((e) => e.id === id);
  if (!row) throw new Error('Event not found');
  return row;
}

async function upsertEvent(event) {
  if (supabase) {
    // Update in place if this slug already exists, else insert.
    const existing = event.id
      ? (await supabase.from('events').select('id, props')).data?.find((r) => (r.props && r.props.id) === event.id || r.id === event.id)
      : null;
    const row = toRow(event);
    const q = existing
      ? supabase.from('events').update(row).eq('id', existing.id).select().single()
      : supabase.from('events').insert(row).select().single();
    const { data, error } = await q;
    if (error) throw error;
    return fromRow(data);
  }
  const row = { ...event, updated_at: new Date().toISOString() };
  const rows = readLocal();
  if (!row.id) row.id = 'ev_' + Date.now().toString(36);
  const i = rows.findIndex((e) => e.id === row.id);
  if (i >= 0) rows[i] = { ...rows[i], ...row }; else rows.push(row);
  writeLocal(rows);
  return row;
}

module.exports = { listEvents, getEvent, upsertEvent, resolveSlug };
