#!/usr/bin/env node
/* BS92 — backfill the auth/identity USER layer (spec E2, D4, D5).

   For every `organizer` row this upserts an `app_user` (the login identity) and an
   `owner` `organizer_member`, so the existing organizers become Users that own
   their org. The collection_store `admin` account becomes an `app_user` with the
   GLOBAL `super_admin` role. Additive only — organizer.password_hash is NOT dropped
   (Phase 2 retires it once the new login path has parity).

   E2 — idempotent + reversible:
     · Forward run is re-runnable. app_user is keyed on lower(email) (unique index),
       organizer_member on (user_id, organizer_id), user_role on (user_id, role):
       every insert is ON CONFLICT DO NOTHING, so a second run creates nothing.
     · `--revert` removes exactly what this backfill creates (memberships, roles,
       then users) — the Phase-1 tables are populated by this script alone.

   D4 — an org with no email gets a synthetic `handle@handles.zorapass` address, so
        every org yields a User without inventing a real inbox.

   D5 — when two organizers collide on the same owner (same lower(email)) or the
        same normalized name (e.g. `thebrunchcity` and `thebrunchcity.co`), the
        colliding rows carry MONEY (revenue/payouts). We do NOT auto-merge them into
        one owner's control: the shared email still resolves to ONE app_user (so it
        is one owner, not two), but only the primary org gets an owner membership —
        the rest are logged as "MANUAL MERGE NEEDED" and skipped (backed off).

   Usage:
     DATABASE_URL=postgres://... node db/backfill-users.mjs
     DATABASE_URL=postgres://... node db/backfill-users.mjs --revert
*/
import postgres from 'postgres';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url)); // db/
const API_DIR = join(HERE, '..', 'apps', 'api');
// Load the API's env (single source for DATABASE_URL); shell env still wins.
config({ path: join(API_DIR, '.env') });

const url = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
if (!url) { console.error('backfill-users: set DATABASE_URL'); process.exit(1); }

const REVERT = process.argv.slice(2).includes('--revert');
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

const EMAIL_FALLBACK_DOMAIN = 'handles.zorapass';
const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

async function revert() {
  // FK order: memberships + roles reference app_user; drop them, then the users
  // this backfill created. These three tables are owned entirely by Phase 1, so a
  // full clear is the exact inverse of the forward run.
  const m = await sql`delete from organizer_member`;
  const r = await sql`delete from user_role`;
  const u = await sql`delete from app_user`;
  console.log(`↺ revert: removed ${m.count} membership(s), ${r.count} role(s), ${u.count} user(s)`);
}

async function backfill() {
  // ── organizers → users + owner memberships ────────────────────────────────
  const orgs = await sql`
    select id, name, handle, email, phone, password_hash
      from organizer
     order by created_at asc, id asc`;

  // D5 — find collisions BEFORE writing memberships. Group by owner email and by
  // normalized name; any group with >1 org is a collision. The primary (first by
  // the stable created_at/id order above) keeps its owner membership; the rest are
  // flagged for a human merge and skipped.
  const byEmail = new Map();
  const byName = new Map();
  for (const o of orgs) {
    const e = o.email ? o.email.toLowerCase() : null;
    if (e) (byEmail.get(e) ?? byEmail.set(e, []).get(e)).push(o.id);
    const n = normName(o.name || o.handle);
    if (n) (byName.get(n) ?? byName.set(n, []).get(n)).push(o.id);
  }
  const primaryOf = new Map();   // collision-group key -> primary org id
  const collides = new Map();    // org id -> { key, primaryId }
  const flagGroup = (groups) => {
    for (const [key, ids] of groups) {
      if (ids.length < 2) continue;
      const primaryId = ids[0]; // first in stable order
      for (const id of ids) {
        if (!collides.has(id)) collides.set(id, { key, primaryId });
      }
      if (!primaryOf.has(key)) primaryOf.set(key, primaryId);
    }
  };
  flagGroup(byEmail);
  flagGroup(byName);

  let users = 0, members = 0, flagged = 0;
  for (const o of orgs) {
    const email = (o.email && o.email.trim())
      ? o.email.trim().toLowerCase()
      : `${o.handle}@${EMAIL_FALLBACK_DOMAIN}`;

    // Upsert the identity, keyed on lower(email). ON CONFLICT DO NOTHING makes a
    // re-run a no-op; two orgs sharing an email resolve to the SAME user (D5: one
    // owner, not two).
    const ins = await sql`
      insert into app_user (email, phone, password_hash, username, updated_at)
      values (${email}, ${o.phone ?? null}, ${o.password_hash ?? null}, ${o.handle}, now())
      on conflict (lower(email)) where email is not null do nothing
      returning id`;
    if (ins.count) users++;

    const [{ id: userId } = {}] = ins.length
      ? ins
      : await sql`select id from app_user where lower(email) = lower(${email})`;
    if (!userId) { console.warn(`  ! could not resolve a user for ${o.handle} (${email})`); continue; }

    // D5 — a colliding, non-primary org carries money we must not silently fold
    // into one owner. Flag it and back off (no membership row).
    const c = collides.get(o.id);
    if (c && c.primaryId !== o.id) {
      flagged++;
      console.warn(
        `  ⚠ MANUAL MERGE NEEDED: organizer '${o.handle}' (${o.id}) collides with primary '${
          orgs.find((x) => x.id === c.primaryId)?.handle ?? c.primaryId
        }' on ${c.key.includes('@') ? 'owner email' : 'name'} — skipping owner membership (money-bearing rows are not auto-merged).`,
      );
      continue;
    }

    const mem = await sql`
      insert into organizer_member (user_id, organizer_id, role)
      values (${userId}, ${o.id}, 'owner')
      on conflict (user_id, organizer_id) do nothing
      returning id`;
    if (mem.count) members++;
  }

  // ── admin → super_admin user ──────────────────────────────────────────────
  // The magic admin lives in the collection_store `admin` blob ({username,
  // passwordHash}); make it a real User with the GLOBAL super_admin role. Keyed on
  // a synthetic email so it is idempotent and never collides with an organizer.
  const adminRows = await sql`select data from collection_store where name = 'admin'`;
  if (adminRows.length) {
    let admin = {};
    try { admin = JSON.parse(adminRows[0].data); } catch { admin = {}; }
    const username = admin.username || 'admin';
    const adminEmail = `${username}@${EMAIL_FALLBACK_DOMAIN}`;
    const ains = await sql`
      insert into app_user (email, password_hash, username, updated_at)
      values (${adminEmail}, ${admin.passwordHash ?? null}, ${username}, now())
      on conflict (lower(email)) where email is not null do nothing
      returning id`;
    if (ains.count) users++;
    const [{ id: adminId } = {}] = ains.length
      ? ains
      : await sql`select id from app_user where lower(email) = lower(${adminEmail})`;
    if (adminId) {
      const rr = await sql`
        insert into user_role (user_id, role)
        values (${adminId}, 'super_admin')
        on conflict (user_id, role) do nothing`;
      if (rr.count) console.log(`✓ admin '${username}' → super_admin user`);
    }
  }

  console.log(
    `✓ backfill-users: ${users} user(s), ${members} owner membership(s)` +
    (flagged ? `, ${flagged} flagged for manual merge (NOT auto-merged)` : ''),
  );
}

try {
  if (REVERT) await revert();
  else await backfill();
} finally {
  await sql.end({ timeout: 5 });
}
