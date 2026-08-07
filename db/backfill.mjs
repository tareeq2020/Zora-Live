#!/usr/bin/env node
/* Backfill JSON collections into the collection_store blob table.
   Stores the EXACT file text (parsed only to validate), so the pg backend's
   JSON.parse -> res.json reproduces byte-identical API output.

   Usage: DATABASE_URL=postgres://... ZORA_DATA_DIR=./data \
          node db/backfill.mjs settings tiers placements theme
*/
import postgres from 'postgres';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, isAbsolute } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));       // db/
const API_DIR = join(HERE, '..', 'apps', 'api');
// Load the API's env (single source for DATABASE_URL); shell env still wins.
config({ path: join(API_DIR, '.env') });

const url = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
if (!url) { console.error('backfill: set DATABASE_URL'); process.exit(1); }
// ZORA_DATA_DIR is written relative to apps/api (where the API runs), so anchor a
// relative value there — NOT to backfill's cwd (usually the repo root).
const rawData = process.env.ZORA_DATA_DIR || join(HERE, '..', 'data');
const dataDir = isAbsolute(rawData) ? rawData : resolve(API_DIR, rawData);
const entities = process.argv.slice(2).flatMap((a) => a.split(',')).map((s) => s.trim()).filter(Boolean);
if (!entities.length) { console.error('backfill: pass entity names, e.g. node db/backfill.mjs settings tiers'); process.exit(1); }

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

/* BS35: organizers are a real table now (migration 0009), not a blob. The
   migration backfills from collection_store, but on a FRESH database it runs
   BEFORE this script, so the blob it wanted to read did not exist yet. Re-run the
   same idempotent copy here so `node db/migrate.mjs && node db/backfill.mjs`
   lands the seed organizers as ROWS in either order. ON CONFLICT DO NOTHING keeps
   it safe: an existing organizer (with its password_hash, kycStatus and
   commission) is never overwritten by the seed file. */
async function syncOrganizerTable() {
  const [{ present }] = await sql`select to_regclass('public.organizer') is not null as present`;
  if (!present) return; // migrations not applied yet — 0009 will do the copy
  const res = await sql`
    insert into organizer (id, name, handle, email, status, kyc_status, commission_rate, password_hash, joined, events, revenue)
    select o->>'id',
           coalesce(o->>'name', o->>'handle'),
           lower(o->>'handle'),
           o->>'email',
           coalesce(o->>'status', 'active'),
           o->>'kycStatus',
           case when jsonb_typeof(o->'commissionRate') = 'number' then (o->>'commissionRate')::numeric else null end,
           o->>'passwordHash',
           o->>'joined',
           coalesce((case when jsonb_typeof(o->'events')  = 'number' then (o->>'events')::int    else 0 end), 0),
           coalesce((case when jsonb_typeof(o->'revenue') = 'number' then (o->>'revenue')::bigint else 0 end), 0)
      from collection_store cs,
           lateral jsonb_array_elements(cs.data::jsonb) as o
     where cs.name = 'organizers'
       and jsonb_typeof(cs.data::jsonb) = 'array'
       and coalesce(o->>'handle', '') <> ''
       and not exists (select 1 from organizer x where x.handle = lower(o->>'handle'))
    on conflict (id) do nothing`;
  console.log(`✓ organizer table synced (${res.count} new row${res.count === 1 ? '' : 's'})`);
}

/* BS42: same story for scanner users — the `agents` blob became the
   `scanner_user` table in migration 0014, which backfills from the blob. On a
   FRESH database 0013 runs BEFORE this script, so the blob it wanted did not
   exist yet; repeat the idempotent copy here so either order lands the seed door
   staff as rows. ON CONFLICT DO NOTHING never overwrites a rotated code. */
async function syncScannerUserTable() {
  const [{ present }] = await sql`select to_regclass('public.scanner_user') is not null as present`;
  if (!present) return; // migrations not applied yet — 0013 will do the copy
  const res = await sql`
    insert into scanner_user (id, name, contact, via, role, event_scope, code, status, created_at, expires_at)
    select a->>'id',
           coalesce(a->>'name', 'Scanner'),
           a->>'contact',
           a->>'via',
           case when a->>'role' = 'supervisor' then 'supervisor' else 'agent' end,
           (select e.id from event e where e.id = a->>'event'),
           a->>'code',
           case when a->>'status' = 'revoked' then 'revoked' else 'active' end,
           coalesce((a->>'createdAt')::timestamptz, now()),
           (a->>'expiresAt')::timestamptz
      from collection_store cs,
           lateral jsonb_array_elements(cs.data::jsonb) as a
     where cs.name = 'agents'
       and jsonb_typeof(cs.data::jsonb) = 'array'
       and coalesce(a->>'id', '') <> ''
       and coalesce(a->>'code', '') <> ''
       and not exists (select 1 from scanner_user x where x.id = a->>'id')
       and not exists (select 1 from scanner_user x where x.code = a->>'code' and x.status = 'active')
    on conflict (id) do nothing`;
  console.log(`✓ scanner_user table synced (${res.count} new row${res.count === 1 ? '' : 's'})`);
}

try {
  for (const e of entities) {
    let text;
    try { text = readFileSync(join(dataDir, e + '.json'), 'utf8'); }
    catch { console.log(`· skip     ${e} (no ${e}.json)`); continue; }
    JSON.parse(text); // validate
    await sql`insert into collection_store (name, data, updated_at) values (${e}, ${text}, now())
      on conflict (name) do update set data = excluded.data, updated_at = now()`;
    console.log(`✓ backfill ${e}`);
    if (e === 'organizers') await syncOrganizerTable();
    if (e === 'agents') await syncScannerUserTable();
  }
} finally {
  await sql.end({ timeout: 5 });
}
