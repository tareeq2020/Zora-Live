/* Full sync: push the site's marketplace (data/events.json) + organizers
   (data/organizers.json) into the shared Supabase tables, so the website and
   the mobile app read ONE source. Clean re-seed → safe to re-run any time.

   Run:  node scripts/migrate-to-supabase.js
   Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env, and schema-v2.sql
   already applied (adds events.props + the organizers table). */
const fs = require('fs');
const path = require('path');
const { supabase } = require('../lib/supabase');

const DATA_DIR = path.join(__dirname, '..', 'data');
const read = (n, fb) => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, n), 'utf8')); } catch { return fb; } };

// Solid cover tint per category (the app cards + site palette share the family).
const COVER = { Festivals: '#3D5AFE', Nightlife: '#C738C6', Daytime: '#E9A83B', Arts: '#17B368', Concerts: '#FF5A1F' };

async function main() {
  if (!supabase) { console.error('Supabase not configured — set env in .env first.'); process.exit(1); }

  const organizers = read('organizers.json', []);
  const events = read('events.json', []);

  // Clean slate (service role bypasses RLS). Filters match all rows.
  await supabase.from('events').delete().not('id', 'is', null);
  await supabase.from('organizers').delete().not('id', 'is', null);

  // ── organizers ──
  const orgRows = organizers.map((o) => ({
    handle: o.handle, name: o.name, email: o.email,
    status: o.status || 'active', events: o.events || 0, revenue: o.revenue || 0, joined: o.joined || null,
  }));
  const orgIns = orgRows.length ? await supabase.from('organizers').insert(orgRows).select() : { data: [], error: null };
  if (orgIns.error) throw orgIns.error;
  const orgIdByHandle = Object.fromEntries((orgIns.data || []).map((o) => [o.handle, o.id]));
  console.log(`organizers → ${orgIns.data.length}`);

  // ── events (full object in props; top-level cols for query/RLS/app) ──
  const evRows = events.map((e) => ({
    name: e.name,
    city: e.city,                                   // code: dar | nairobi | lagos …
    status: 'published',
    cover: COVER[e.category] || '#3D5AFE',
    tiers: e.priceFrom != null ? [{ name: 'From', price: e.priceFrom }] : [],
    org_id: orgIdByHandle[e.organizerHandle] || null,
    props: e,                                       // the exact events.json shape
  }));
  const evIns = evRows.length ? await supabase.from('events').insert(evRows).select() : { data: [], error: null };
  if (evIns.error) throw evIns.error;
  console.log(`events → ${evIns.data.length}`);

  console.log('Sync complete. Supabase is now the single source for both platforms.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
