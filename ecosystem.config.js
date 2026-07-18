/* pm2 process definition for the ZORA NestJS API.
 *
 * The API is disk-free: all state lives in Postgres + Supabase Storage, so this
 * process is safe to restart, and can run anywhere with the env below.
 *
 * ── First deploy ────────────────────────────────────────────────────────────
 *   pnpm install
 *   pnpm --filter @zora/api build          # produces apps/api/dist/main.js
 *   node db/migrate.mjs                     # create tables (idempotent)
 *   node db/backfill.mjs settings tiers placements theme agents floorplan \
 *        tickets organizers audit admin kyc media media_manifest registrations
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup                 # persist across reboots
 *
 * ── Update ──────────────────────────────────────────────────────────────────
 *   git pull && pnpm install && pnpm --filter @zora/api build
 *   node db/migrate.mjs                     # apply any new migrations
 *   pm2 reload zora-api
 *
 * ── Secrets ─────────────────────────────────────────────────────────────────
 * DATABASE_URL, SESSION_SECRET, KYC_SECRET, SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are loaded from apps/api/.env by the app's own
 * dotenv at boot (cwd is apps/api). Keep them there — NEVER in this committed
 * file. See apps/api/.env.example for the full list.
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
  ],
};
