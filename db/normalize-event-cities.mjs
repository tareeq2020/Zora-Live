#!/usr/bin/env node
/* BS97 — normalise the stored `city` on every event in the collection_store
   'events' blob to its canonical id. Some rows landed with a freetext LABEL
   (e.g. apricot-crush stored "Dar Es Salaam" instead of "dar") via a legacy-admin
   / import path that bypassed the id-based city <select>, and discover's city
   filter — which matches on the id set — then silently hid the event from its own
   city page. The API now canonicalises city on READ (apps/api/src/vendor/events.js),
   so this is belt-and-suspenders: it cleans the PERSISTED data so the blob itself
   is correct, not just what we serve.

   Idempotent + safe: only the `city` field is touched; tiers / date / status /
   webCheckout are left exactly as-is (so it never clobbers an organizer's edits).
   An unrecognised city is left unchanged and reported, never dropped.

   BS168: reads the `city` table (migration 0039), the one city list: ids,
   names, other spellings, and merges. No copy of the list lives here.

   Usage: DATABASE_URL=postgres://... node db/normalize-event-cities.mjs
          add --dry to preview without writing. */
import postgres from 'postgres';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
config({ path: join(HERE, '..', 'apps', 'api', '.env') });
const url = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
if (!url) { console.error('normalize-event-cities: set DATABASE_URL'); process.exit(1); }
const DRY = process.argv.includes('--dry');

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const key = (v) => String(v ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
let EVENT_CITIES = [];
const CITY_BY_KEY = new Map();
const byId = new Map();
function canonCity(v) {
  if (v == null) return v;
  let id = CITY_BY_KEY.get(key(v));
  for (let i = 0; id && i < 5; i++) {
    const c = byId.get(id);
    if (!c || c.status !== 'merged' || !c.merged_into) break;
    id = c.merged_into;
  }
  return id || v;
}

try {
  EVENT_CITIES = await sql`select id, name, aliases, status, merged_into from city`;
  for (const c of EVENT_CITIES) byId.set(c.id, c);
  // Same order as the API's city cache (packages/core/src/cities.ts): live
  // cities before merged/declined ones; ids, then names, then spellings; empty keys skipped.
  const put = (k, id) => { if (k && !CITY_BY_KEY.has(k)) CITY_BY_KEY.set(k, id); };
  const closed = (c) => c.status === 'merged' || c.status === 'declined';
  for (const group of [EVENT_CITIES.filter((c) => !closed(c)), EVENT_CITIES.filter(closed)]) {
    for (const c of group) put(key(c.id), c.id);
    for (const c of group) put(key(c.name), c.id);
    for (const c of group) for (const a of c.aliases || []) put(key(a), c.id);
  }
  const rows = await sql`select data from collection_store where name = 'events'`;
  if (!rows.length) { console.log('normalize-event-cities: no events blob — nothing to do'); process.exit(0); }
  const events = JSON.parse(rows[0].data);

  let changed = 0;
  const unknown = [];
  for (const e of events) {
    if (!e || e.city == null) continue;
    const next = canonCity(e.city);
    if (next !== e.city) {
      console.log(`  ${e.id}: "${e.city}" -> "${next}"`);
      e.city = next;
      changed += 1;
    } else if (!EVENT_CITIES.some((c) => c.id === e.city)) {
      unknown.push(`${e.id} ("${e.city}")`);
    }
  }

  if (unknown.length) console.log(`  ! unrecognised city, left unchanged: ${unknown.join(', ')}`);
  if (changed === 0) { console.log('normalize-event-cities: all cities already canonical — no change'); process.exit(0); }
  if (DRY) { console.log(`normalize-event-cities: --dry, would update ${changed} event(s)`); process.exit(0); }

  await sql`update collection_store set data = ${JSON.stringify(events)}, updated_at = now() where name = 'events'`;
  console.log(`normalize-event-cities: updated ${changed} event(s)`);
} finally {
  await sql.end({ timeout: 5 });
}
