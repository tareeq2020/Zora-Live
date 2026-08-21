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

   Mirrors the EVENT_CITIES list in apps/api/src/common/defaults.ts /
   apps/web/app/lib/cities.ts — keep the three in step when a city is added.

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

const EVENT_CITIES = [
  { id: 'dar', label: 'Dar es Salaam' },
  { id: 'zanzibar', label: 'Zanzibar' },
  { id: 'nairobi', label: 'Nairobi' },
  { id: 'accra', label: 'Accra' },
  { id: 'lagos', label: 'Lagos' },
];
const CITY_BY_KEY = EVENT_CITIES.reduce((m, c) => {
  m.set(c.id.toLowerCase(), c.id);
  m.set(c.label.toLowerCase(), c.id);
  return m;
}, new Map());
function canonCity(v) {
  if (v == null) return v;
  return CITY_BY_KEY.get(String(v).trim().toLowerCase()) || v;
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
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
