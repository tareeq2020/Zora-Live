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
import { dirname, join } from 'node:path';

// Load the API's env (single source for DATABASE_URL); shell env still wins.
config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', '.env') });

const url = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
if (!url) { console.error('backfill: set DATABASE_URL'); process.exit(1); }
const dataDir = process.env.ZORA_DATA_DIR || 'data';
const entities = process.argv.slice(2).flatMap((a) => a.split(',')).map((s) => s.trim()).filter(Boolean);
if (!entities.length) { console.error('backfill: pass entity names, e.g. node db/backfill.mjs settings tiers'); process.exit(1); }

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  for (const e of entities) {
    let text;
    try { text = readFileSync(join(dataDir, e + '.json'), 'utf8'); }
    catch { console.log(`· skip     ${e} (no ${e}.json)`); continue; }
    JSON.parse(text); // validate
    await sql`insert into collection_store (name, data, updated_at) values (${e}, ${text}, now())
      on conflict (name) do update set data = excluded.data, updated_at = now()`;
    console.log(`✓ backfill ${e}`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
