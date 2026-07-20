/* pm2 process definition for the ZORA NestJS API.
 *
 * The API is disk-free: all state lives in Postgres + Supabase Storage, so this
 * process is safe to restart, and can run anywhere with the env below.
 *
 * ── First deploy ────────────────────────────────────────────────────────────
 *   pnpm install
 *   pnpm --filter "@zora/api..." build      # @zora/core → api (dist/main.js)
 *   pnpm --filter "@zora/worker..." build   # the reconciliation worker
 *   node db/migrate.mjs                     # create tables incl. payments (idempotent)
 *   node db/backfill.mjs settings tiers placements theme agents floorplan \
 *        tickets organizers audit admin kyc media media_manifest registrations events
 *   node db/seed-tiers.mjs                  # GA tiers + inventory + web-sellable flag
 *   pm2 start ecosystem.config.js           # starts zora-api AND zora-worker
 *   pm2 save && pm2 startup                 # persist across reboots
 *
 * ── Update ──────────────────────────────────────────────────────────────────
 *   git pull && pnpm install
 *   pnpm --filter "@zora/api..." build && pnpm --filter "@zora/worker..." build
 *   node db/migrate.mjs                     # apply any new migrations
 *   pm2 reload zora-api && pm2 reload zora-worker
 *
 * ── Secrets / env ───────────────────────────────────────────────────────────
 * All loaded from apps/api/.env by each app's own dotenv (NEVER in this file):
 *   DATABASE_URL, SESSION_SECRET, KYC_SECRET, TICKET_SIGNING_KEY, SUPABASE_URL,
 *   SUPABASE_SERVICE_ROLE_KEY, and — for live payments — XBRIDGE_BASE_URL/KEY_ID/
 *   SECRET, PUBLIC_ORIGIN (the API's own public https URL — the gateway webhook
 *   must hit the API host DIRECTLY, not via the Next /api rewrite), and the
 *   SMS/EMAIL driver creds. Without XBRIDGE_KEY_ID the gateway runs in MOCK mode.
 *   See apps/api/.env.example for the full list.
 */
module.exports = {
  apps: [
    {
      name: 'zora-api',
      cwd: './apps/api',
      script: 'dist/main.js',
      // Single instance: the free Supabase session pooler has a small connection
      // budget, and the app is stateless so one process is plenty for MVP. Scale
      // by raising `instances` (cluster mode) only after moving to a bigger pool.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '512M',
      // Non-secret defaults. COOKIE_SECURE=true requires the API to be served
      // over HTTPS (behind a TLS-terminating proxy). PORT must match the proxy
      // upstream and Vercel's API_URL.
      env: {
        NODE_ENV: 'production',
        PORT: 4101,
        COOKIE_SECURE: 'true',
        ZORA_ROOT_DOMAIN: 'zora.com',
      },
      // Logs (pm2 default dir ~/.pm2/logs unless overridden).
      merge_logs: true,
      time: true,
    },
    {
      // Payments reconciliation worker (PR-9). Sweeps expired inventory holds/
      // reservations and reconciles pending payments (re-fetches gateway status).
      // MUST be a singleton — it also self-guards with pg_try_advisory_lock, so a
      // stray second instance simply exits, but keep instances:1 regardless.
      name: 'zora-worker',
      cwd: './apps/worker',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        // Reads DATABASE_URL + XBRIDGE_* from apps/api/.env via its own dotenv.
      },
      merge_logs: true,
      time: true,
    },
  ],
};
