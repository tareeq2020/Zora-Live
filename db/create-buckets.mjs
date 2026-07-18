#!/usr/bin/env node
/* Create the Supabase Storage buckets (idempotent). Uses SUPABASE_URL +
   SUPABASE_SERVICE_ROLE_KEY from apps/api/.env.
     kyc-private  private  — KYC .enc documents (admin-streamed)
     media        public   — uploaded assets (CDN)
   Usage: node db/create-buckets.mjs */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', '.env') });
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('create-buckets: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const sb = createClient(url, key, { auth: { persistSession: false } });
const buckets = [
  { name: process.env.KYC_BUCKET || 'kyc-private', public: false },
  { name: process.env.MEDIA_BUCKET || 'media', public: true },
];

for (const b of buckets) {
  const { error } = await sb.storage.createBucket(b.name, { public: b.public });
  if (!error) console.log(`✓ created ${b.name} (${b.public ? 'public' : 'private'})`);
  else if (/already exists/i.test(error.message)) console.log(`· exists  ${b.name}`);
  else { console.error(`✗ ${b.name}: ${error.message}`); process.exit(1); }
}
