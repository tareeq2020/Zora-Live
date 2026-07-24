#!/usr/bin/env node
/* Seed the first real bill-split event: "Seasoned Sundays — Apricot Crush
   (Brunch Edition)" on the thebrunchcity tenant, with a split-enabled VIP Table
   tier (the whole point) plus a GA tier. Idempotent — safe to re-run.

   Writes, all keyed off event id 'apricot-crush':
     - event Postgres row (so table_split / product_tier FKs resolve)
     - product_tier apricot-crush-ga    (GA, 20,000 TZS, pool 300)
     - product_tier apricot-crush-table (VIP Table, split_enabled, 900,000 TZS,
       16 tables, 45-min hold window)
     - price_version + inventory_pool for each
     - the event into the collection_store 'events' blob (so /api/events + the
       discovery page show it), carrying webCheckout.tiers so the storefront
       mounts the live checkout, with split:true on the table tier.

   Usage: DATABASE_URL=postgres://... node db/seed-apricot-crush.mjs */
import postgres from 'postgres';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
config({ path: join(HERE, '..', 'apps', 'api', '.env') });
const url = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
if (!url) { console.error('seed-apricot-crush: set DATABASE_URL'); process.exit(1); }
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

const EVENT = {
  id: 'apricot-crush',
  name: 'Seasoned Sundays — Apricot Crush (Brunch Edition)',
  tagline: 'Bottomless brunch on the terrace',
  category: 'Brunch',
  city: 'dar',
  venue: 'The Terrace, Hotel Slipway',
  dateLabel: 'Sun 30 Aug',
  time: '12:00',
  priceFrom: 20000,
  weekend: true,
  seated: true,
  organizerHandle: 'thebrunchcity',
};
const GA = { id: 'apricot-crush-ga', name: 'General Admission', price: 20000, capacity: 300, kind: 'shore', split: false };
const TABLE = { id: 'apricot-crush-table', name: 'VIP Table', price: 900000, capacity: 16, kind: 'table', split: true, windowSecs: 2700 };

async function seedTier(t) {
  await sql`insert into product_tier (id, event_id, name, kind, capacity, split_enabled, split_window_secs)
            values (${t.id}, ${EVENT.id}, ${t.name}, ${t.kind}, ${t.capacity}, ${t.split}, ${t.windowSecs ?? 2700})
            on conflict (id) do update set split_enabled = excluded.split_enabled,
              split_window_secs = excluded.split_window_secs, kind = excluded.kind`;
  await sql`insert into price_version (tier_id, price, currency, fee_treatment)
            select ${t.id}, ${t.price}, 'TZS', 'included'
            where not exists (select 1 from price_version where tier_id = ${t.id})`;
  await sql`insert into inventory_pool (product_tier_id, capacity, available_count)
            values (${t.id}, ${t.capacity}, ${t.capacity}) on conflict (product_tier_id) do nothing`;
  console.log(`✓ tier ${t.id} (${t.name}, ${t.price} TZS${t.split ? ', split-enabled' : ''})`);
}

try {
  // event row (FK anchor)
  await sql`insert into event (id, name, category, city, venue, date_label, event_time, status, price_from, organizer_id)
            values (${EVENT.id}, ${EVENT.name}, ${EVENT.category}, ${EVENT.city}, ${EVENT.venue}, ${EVENT.dateLabel}, ${EVENT.time}, 'published', ${EVENT.priceFrom},
                    (select id from organizer where handle = ${EVENT.organizerHandle} limit 1))
            on conflict (id) do update set name = excluded.name, venue = excluded.venue, status = 'published'`;

  await seedTier(GA);
  await seedTier(TABLE);

  // event blob with webCheckout.tiers (split:true on the table)
  const webCheckout = { tiers: [
    { tierId: GA.id, name: GA.name, unitPrice: GA.price, currency: 'TZS' },
    { tierId: TABLE.id, name: TABLE.name, unitPrice: TABLE.price, currency: 'TZS', split: true },
  ] };
  const blobEvent = { ...EVENT, webCheckout };

  const rows = await sql`select data from collection_store where name = 'events'`;
  let events;
  if (rows.length) events = JSON.parse(rows[0].data);
  else { try { events = JSON.parse(readFileSync(join(HERE, '..', 'data', 'events.json'), 'utf8')); } catch { events = []; } }
  events = events.filter((e) => e && e.id !== EVENT.id);
  events.push(blobEvent);
  await sql`insert into collection_store (name, data) values ('events', ${JSON.stringify(events)})
            on conflict (name) do update set data = excluded.data, updated_at = now()`;
  console.log(`✓ event '${EVENT.id}' in events collection (webCheckout wired, split table)`);
  console.log('seed-apricot-crush: done');
} finally {
  await sql.end({ timeout: 5 });
}
