#!/usr/bin/env node
/* Seed a GA sellable tier (+ price + inventory pool) per catalog event.
   Idempotent: safe to re-run — product_tier & inventory_pool use ON CONFLICT
   DO NOTHING, and a price_version is only inserted when the tier has none.

   For each event that has a priceFrom, creates:
     product_tier   id = `${eventId}-ga`, name 'General Admission',
                    capacity = env DEFAULT_TIER_CAPACITY || 500
     price_version  price = priceFrom, currency TZS
     inventory_pool capacity + available_count = capacity

   Events are read from the collection_store 'events' blob if present, else from
   data/events.json. Loads apps/api/.env for DATABASE_URL (shell env still wins).

   Usage: DATABASE_URL=postgres://... node db/seed-tiers.mjs
*/
import postgres from 'postgres';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));       // db/
const API_DIR = join(HERE, '..', 'apps', 'api');
config({ path: join(API_DIR, '.env') });

const url = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
if (!url) { console.error('seed-tiers: set DATABASE_URL'); process.exit(1); }
const CAPACITY = Number(process.env.DEFAULT_TIER_CAPACITY || 500);

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

async function loadEvents() {
  // Prefer the live collection_store; fall back to the seed file.
  try {
    const rows = await sql`select data from collection_store where name = 'events'`;
    if (rows.length) return JSON.parse(rows[0].data);
  } catch { /* table may not exist yet — fall through to file */ }
  return JSON.parse(readFileSync(join(HERE, '..', 'data', 'events.json'), 'utf8'));
}

try {
  const events = await loadEvents();
  let seeded = 0;
  let wiredWeb = false;
  for (const ev of events) {
    if (!ev || !ev.id || ev.priceFrom == null) continue;
    const tierId = `${ev.id}-ga`;
    // Ensure the event row exists so the FKs resolve (idempotent).
    await sql`insert into event (id, name) values (${ev.id}, ${ev.name || ev.id})
              on conflict (id) do nothing`;
    await sql`insert into product_tier (id, event_id, name, capacity)
              values (${tierId}, ${ev.id}, 'General Admission', ${CAPACITY})
              on conflict (id) do nothing`;
    // Only add a price_version if this tier has none (no natural conflict key).
    await sql`insert into price_version (tier_id, price, currency)
              select ${tierId}, ${ev.priceFrom}, 'TZS'
              where not exists (select 1 from price_version where tier_id = ${tierId})`;
    await sql`insert into inventory_pool (product_tier_id, capacity, available_count)
              values (${tierId}, ${CAPACITY}, ${CAPACITY})
              on conflict (product_tier_id) do nothing`;
    // Flag the event web-sellable so the storefront mounts the live checkout
    // flow (CheckoutFlow reads webCheckout.tiers → {tierId,name,unitPrice,currency}).
    const tiers = [{ tierId, name: 'General Admission', unitPrice: ev.priceFrom, currency: 'TZS' }];
    if (JSON.stringify(ev.webCheckout?.tiers || null) !== JSON.stringify(tiers)) {
      ev.webCheckout = { tiers };
      wiredWeb = true;
    }
    seeded++;
    console.log(`✓ seed ${tierId} (cap ${CAPACITY}, ${ev.priceFrom} TZS)`);
  }
  // Persist webCheckout.tiers back onto the events collection (live only; the
  // storefront reads /api/events). Additive + idempotent; /api/events is not
  // golden-tested, so byte format is not load-bearing.
  if (wiredWeb) {
    await sql`update collection_store set data = ${JSON.stringify(events)}, updated_at = now()
              where name = 'events'`;
    console.log('✓ wired webCheckout.tiers onto the events collection');
  }
  console.log(`seed-tiers: ${seeded} event(s) seeded`);
} finally {
  await sql.end({ timeout: 5 });
}
