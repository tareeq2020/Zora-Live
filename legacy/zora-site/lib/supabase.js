/* Server-side Supabase client for zora-site.
   Uses the SERVICE ROLE key (bypasses RLS) — server only, never shipped to the
   browser. Guarded: if env is missing the module loads fine and `supabase` is
   null, so the server still boots; the /api/events routes report "not configured". */
try { require('dotenv').config(); } catch { /* dotenv optional */ }
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
if (url && serviceKey) {
  supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
} else {
  console.warn('[zora-site] Supabase not configured — /api/events disabled. Copy .env.example to .env.');
}

module.exports = { supabase };
