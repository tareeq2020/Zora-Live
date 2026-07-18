#!/usr/bin/env node
/* One-time: upload the existing on-disk KYC .enc blobs into the private
   Supabase Storage bucket, verbatim. The files are already AES-256-GCM
   encrypted (iv|tag|ciphertext) so they are uploaded byte-for-byte — no
   re-encryption. Idempotent (upsert). Reads SUPABASE_URL + service-role key
   from apps/api/.env. Usage: node db/migrate-kyc-enc.mjs */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(HERE, '..', 'apps', 'api');
config({ path: resolve(API_DIR, '.env') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in apps/api/.env'); process.exit(1); }
const bucket = process.env.KYC_BUCKET || 'kyc-private';

// .enc live at repo-root data/kyc-private (the pre-migration ZORA_DATA_DIR).
const encDir = resolve(HERE, '..', 'data', 'kyc-private');
const files = readdirSync(encDir).filter((f) => f.endsWith('.enc'));
if (!files.length) { console.log('No .enc files to migrate.'); process.exit(0); }

const supa = createClient(url, key, { auth: { persistSession: false } });
let ok = 0;
for (const name of files) {
  const buf = readFileSync(resolve(encDir, name));
  const { error } = await supa.storage.from(bucket).upload(name, buf, {
    contentType: 'application/octet-stream', upsert: true,
  });
  if (error) { console.error(`✗ ${name}: ${error.message}`); process.exit(1); }
  console.log(`✓ ${name} → ${bucket} (${buf.length} bytes)`);
  ok++;
}
console.log(`Done: ${ok}/${files.length} uploaded.`);
