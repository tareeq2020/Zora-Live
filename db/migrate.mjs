#!/usr/bin/env node
/* ZORA migration runner (hand-written SQL, no ORM).
   - Applies db/migrations/*.sql in filename order, once each.
   - Tracks applied files in `schema_migrations`.
   - Holds a SESSION advisory lock on a reserved connection so concurrent runners
     serialize. IMPORTANT: run this against the SESSION/direct connection
     (DATABASE_URL_MIGRATE), not the transaction pooler — session advisory locks
     and multi-statement DDL need a pinned connection.
   - Each file runs in its own transaction; a failure rolls that file back.

   Usage: DATABASE_URL_MIGRATE=postgres://... node db/migrate.mjs
*/
import postgres from 'postgres';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, 'migrations');
const LOCK_KEY = 727274; // arbitrary, shared by all runners

const url = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
if (!url) { console.error('migrate: set DATABASE_URL_MIGRATE (or DATABASE_URL)'); process.exit(1); }

// max:1 => the session advisory lock and every migration run on the SAME
// physical connection, so the lock is held for the whole run.
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

async function run() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  let applied = 0;
  try {
    await sql`select pg_advisory_lock(${LOCK_KEY})`;
    await sql`create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )`;
    const done = new Set((await sql`select filename from schema_migrations`).map((r) => r.filename));
    for (const file of files) {
      if (done.has(file)) { console.log(`· skip   ${file}`); continue; }
      const body = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(body);              // whole file (multi-statement) in one tx
        await tx`insert into schema_migrations (filename) values (${file})`;
      });
      applied++;
      console.log(`✓ apply  ${file}`);
    }
    await sql`select pg_advisory_unlock(${LOCK_KEY})`;
  } finally {
    await sql.end({ timeout: 5 });
  }
  console.log(`migrate: ${applied} applied, ${files.length} total`);
}

run().catch((e) => { console.error('migrate failed:', e.message); process.exit(1); });
