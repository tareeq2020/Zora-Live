#!/usr/bin/env node
/* Seed THE WEEKENDAR — a new organizer (The Weekender) + its first two live drops
   for the Sept 12–14 weekend in Dar es Salaam. Idempotent — safe to re-run.

   Prices: quoted in USD by the organizer, loaded in TZS at 1 USD = 2,700 (Phase 1
   on sale now; Phase 2 is a later one-click re-price — see the tier editor's C6
   re-price). Capacity is a PLACEHOLDER (organizer said "no cap for now") — set the
   real per-yacht / per-day numbers before go-live.

   Writes:
     - organizer  'weekendar'  (status active, kyc approved → can publish + be
       impersonated; a dashboard password is set later via admin ACCESS).
     - theme row  (per-org LIGHT canvas: bg + card set → the storefront + event
       pages render light; accent = Weekendar blue, secondary = electric lime,
       banner = the WEEKENDAR overview flyer).
     - two events (the-14th, rhythm-and-brunch): the Postgres event row (FK anchor)
       + product_tier + price_version (TZS) + inventory_pool per tier, and the event
       blob into collection_store 'events' (webCheckout.tiers + per-event cover) so
       /api/events, discover, the storefront and live checkout all light up.

   Usage: DATABASE_URL=postgres://... node db/seed-weekendar.mjs */
import postgres from 'postgres';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
config({ path: join(HERE, '..', 'apps', 'api', '.env') });
const url = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
if (!url) { console.error('seed-weekendar: set DATABASE_URL'); process.exit(1); }
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

const RATE = 2700;               // 1 USD -> TZS (Phase 1 prices)
const CAP = 500;                 // PLACEHOLDER capacity per tier — set real caps before go-live

const ORG = {
  id: 'weekendar',
  name: 'The Weekendar',
  handle: 'weekendar',
  email: 'hello@theweekendar.com',
};

// The org was first seeded under the misspelt handle 'weekender'. Remove that
// footprint before (re)seeding 'weekendar' so no orphan org/theme/events linger.
// Safe: nothing was ever sold under it (no order_item/credential references the
// deleted tiers). No-op on a fresh DB.
const LEGACY_HANDLE = 'weekender';

const THEME = {
  brandName: 'The Weekendar',
  accent: '#1668E3',             // Weekendar blue (CTAs)
  secondary: '#C9F03C',          // electric lime (eyebrows / accents)
  bg: '#F5F6F8',                 // LIGHT canvas — opts this org into light mode
  card: '#FFFFFF',
  typography: 'grotesk',
  logoUrl: '',                   // TODO: drop in a transparent WEEKENDAR wordmark PNG
  faviconUrl: '',
  bannerUrl: '/weekendar/weekendar-hero.jpg',
};

// kind 'shore' = a normal per-person GA-style tier (no table/split). USD is loaded × RATE.
const EVENTS = [
  {
    id: 'the-14th',
    name: 'The 14th — Yacht Party',
    tagline: 'Six catamarans, one horizon — the Weekendar opener.',
    category: 'Daytime',
    city: 'dar',
    venue: 'Departs Slipway, Dar es Salaam',   // tentative
    dateLabel: 'Sat 12 Sep',
    time: '12:00',                              // tentative
    weekend: true,
    seated: false,
    cover: '/weekendar/the-14th.jpg',
    tiers: [
      { id: 'the-14th-regular', name: 'Regular · Food & Soft Drinks', usd: 85 },
      { id: 'the-14th-alcohol', name: 'With Alcohol',                 usd: 135 },
    ],
  },
  {
    id: 'rhythm-and-brunch',
    name: 'Rhythm & Brunch',
    tagline: 'Live-band brunch, all afternoon.',
    category: 'Daytime',
    city: 'dar',
    venue: 'Dar es Salaam · venue TBA',         // tentative
    dateLabel: 'Sun 13 Sep',
    time: '13:00',                              // tentative
    weekend: true,
    seated: false,
    cover: '/weekendar/rhythm-brunch.jpg',
    tiers: [
      { id: 'rhythm-and-brunch-ga', name: 'General Admission', usd: 25 },
    ],
  },
];

async function seedTier(eventId, t) {
  const price = t.usd * RATE;
  await sql`insert into product_tier (id, event_id, name, kind, capacity, split_enabled, split_window_secs)
            values (${t.id}, ${eventId}, ${t.name}, 'shore', ${CAP}, false, 2700)
            on conflict (id) do update set name = excluded.name, kind = 'shore'`;
  await sql`insert into price_version (tier_id, price, currency, fee_treatment)
            select ${t.id}, ${price}, 'TZS', 'included'
            where not exists (select 1 from price_version where tier_id = ${t.id})`;
  await sql`insert into inventory_pool (product_tier_id, capacity, available_count)
            values (${t.id}, ${CAP}, ${CAP}) on conflict (product_tier_id) do nothing`;
  console.log(`  ✓ tier ${t.id} — ${t.name} · ${price.toLocaleString('en-US')} TZS ($${t.usd})`);
  return { tierId: t.id, name: t.name, unitPrice: price, currency: 'TZS' };
}

try {
  // 0) cleanup the misspelt 'weekender' footprint (delete children before the org
  //    to respect FKs; theme cascades on org delete but we drop it explicitly).
  //    No-op on a fresh DB. Safe: nothing sold under it.
  const legacy = await sql`select id from organizer where handle = ${LEGACY_HANDLE}`;
  if (legacy.length) {
    await sql`delete from product_tier where event_id in (select id from event where organizer_id = ${legacy[0].id})`;
    await sql`delete from event where organizer_id = ${legacy[0].id}`;
    await sql`delete from theme where organizer_id = ${legacy[0].id}`;
    await sql`delete from organizer where id = ${legacy[0].id}`;
    console.log(`✓ removed legacy '${LEGACY_HANDLE}' org + its events/theme`);
  }

  // 1) organizer — active + KYC approved so it can publish sellable drops (I6) and
  //    be reached via admin impersonation. Idempotent.
  await sql`insert into organizer (id, name, handle, email, status, kyc_status, joined, events, revenue)
            values (${ORG.id}, ${ORG.name}, ${ORG.handle}, ${ORG.email}, 'active', 'approved',
                    ${new Date().toISOString().slice(0, 10)}, ${EVENTS.length}, 0)
            on conflict (id) do update set name = excluded.name, email = excluded.email,
              status = 'active', kyc_status = 'approved'`;
  console.log(`✓ organizer '${ORG.handle}' (active, kyc approved)`);

  // 2) theme — per-org LIGHT canvas (bg + card) + Weekendar accent/secondary/banner.
  await sql`insert into theme (organizer_id, brand_name, accent, secondary, bg, card, typography, logo_url, favicon_url, banner_url, updated_at)
            values (${ORG.id}, ${THEME.brandName}, ${THEME.accent}, ${THEME.secondary}, ${THEME.bg},
                    ${THEME.card}, ${THEME.typography}, ${THEME.logoUrl}, ${THEME.faviconUrl}, ${THEME.bannerUrl}, now())
            on conflict (organizer_id) do update set
              brand_name = excluded.brand_name, accent = excluded.accent, secondary = excluded.secondary,
              bg = excluded.bg, card = excluded.card, typography = excluded.typography,
              logo_url = excluded.logo_url, favicon_url = excluded.favicon_url, banner_url = excluded.banner_url,
              updated_at = now()`;
  console.log(`✓ theme (light canvas ${THEME.bg}, accent ${THEME.accent}, banner ${THEME.bannerUrl})`);

  // 3) events — FK row + tiers + the storefront blob.
  const blobRows = await sql`select data from collection_store where name = 'events'`;
  let events;
  if (blobRows.length) events = JSON.parse(blobRows[0].data);
  else { try { events = JSON.parse(readFileSync(join(HERE, '..', 'data', 'events.json'), 'utf8')); } catch { events = []; } }

  for (const ev of EVENTS) {
    console.log(`\n▸ ${ev.name}  (${ev.dateLabel} · ${ev.time})`);
    const priceFrom = Math.min(...ev.tiers.map((t) => t.usd)) * RATE;
    await sql`insert into event (id, name, category, city, venue, date_label, event_time, status, price_from, organizer_id)
              values (${ev.id}, ${ev.name}, ${ev.category}, ${ev.city}, ${ev.venue}, ${ev.dateLabel}, ${ev.time}, 'published', ${priceFrom},
                      (select id from organizer where handle = ${ORG.handle} limit 1))
              on conflict (id) do update set name = excluded.name, venue = excluded.venue,
                date_label = excluded.date_label, event_time = excluded.event_time, status = 'published'`;

    const webTiers = [];
    for (const t of ev.tiers) webTiers.push(await seedTier(ev.id, t));

    const blobEvent = {
      id: ev.id, name: ev.name, tagline: ev.tagline, category: ev.category, city: ev.city,
      venue: ev.venue, dateLabel: ev.dateLabel, time: ev.time, priceFrom, weekend: ev.weekend,
      seated: ev.seated, cover: ev.cover, organizerHandle: ORG.handle,
      webCheckout: { tiers: webTiers },
    };
    events = events.filter((e) => e && e.id !== ev.id);
    events.push(blobEvent);
    console.log(`  ✓ blob wired (cover ${ev.cover}, FROM ${priceFrom.toLocaleString('en-US')} TZS)`);
  }

  await sql`insert into collection_store (name, data) values ('events', ${JSON.stringify(events)})
            on conflict (name) do update set data = excluded.data, updated_at = now()`;
  console.log(`\n✓ ${EVENTS.length} events in the 'events' collection`);
  console.log('seed-weekendar: done — visit /@weekendar (or the weekendar subdomain).');
} finally {
  await sql.end({ timeout: 5 });
}
