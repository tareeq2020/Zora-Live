# Backend on Render — setup and cutover (BS142)

The API and worker move from the PM2 box (`zora-api.thebrunchcity.com`) to Render, at **https://api.zorapass.com**. Web stays on Vercel. Postgres stays on Supabase.

```
Buyer / organizer ──► www.zorapass.com (Vercel, apps/web)
                         │  /api/*  (rewrite, baked at build from API_URL)
                         ▼
                      api.zorapass.com  ── Render web service  zora-api   (apps/api)
x-bridge webhooks ──►    │                 Render worker       zora-worker (apps/worker)
                         ▼
                      Supabase Postgres (session pooler :5432) + Storage
```

## 1. Create the Blueprint

1. Render → **New → Blueprint** → connect the GitHub repo **`Reli-Tech/zora`** (production code lands there on every release). Branch **`main`**.
2. Render reads `render.yaml` and proposes: env group `zora-backend`, web service `zora-api`, worker `zora-worker`.
3. Fill every `sync: false` value in the env group (table below). **Copy secrets from the current production `apps/api/.env`** — do not generate new ones (see notes).
4. Apply. First deploy runs: install → build → `node db/migrate.mjs` (pre-deploy) → start. The health check is `GET /api/health`.

| Variable | Required | Value / where from | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | Supabase → Project → Database → **Session pooler** URI (:5432) | Not the :6543 transaction pooler |
| `SESSION_SECRET` | yes | current prod value | New value = everyone logged out |
| `KYC_SECRET` | yes | current prod value | Must match, or existing KYC docs can't be decrypted |
| `TICKET_SIGNING_KEY` | yes | current prod value (comma list) | Must include the current key, or issued QR passes stop scanning |
| `OTP_SECRET` | yes | current prod value | |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MEDIA_BUCKET`, `KYC_BUCKET` | yes | current prod values | Media + KYC storage |
| `XBRIDGE_BASE_URL`, `XBRIDGE_KEY_ID`, `XBRIDGE_SECRET` | yes for live payments | current prod values | Unset key ⇒ mock payments |
| `XBRIDGE_WEBHOOK_SECRET` | for installments /v1 | from x-bridge | Leave blank until x-bridge /v1 |
| `SMS_DRIVER` + `BEEM_*` or `AT_*` | yes | current prod values | |
| `RESEND_API_KEY`, `EMAIL_FROM` | yes | current prod values | |
| `POSTHOG_KEY` | optional | PostHog project key | Server events (payment_completed, checkout_abandoned) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_GOOGLE_EMAILS` / `ADMIN_GOOGLE_DOMAIN` | optional | Google Cloud OAuth client | Admin Google sign-in; callback `https://www.zorapass.com/api/auth/google/callback` |

Preset in `render.yaml` (no action): `PUBLIC_ORIGIN=https://api.zorapass.com`, `PUBLIC_WEB_ORIGIN=https://www.zorapass.com`, `ZORA_ROOT_DOMAIN=zorapass.com`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `XBRIDGE_V1=0`, `NODE_VERSION=22`, `PG_POOL_MAX=10`.

## 2. Domain

1. Render → `zora-api` → Settings → Custom Domains: `api.zorapass.com` is already listed from the blueprint.
2. DNS for zorapass.com: **CNAME `api` → `zora-api.onrender.com`**. Wait for Render to verify and issue TLS.
3. Check: `curl https://api.zorapass.com/api/health` → `{"ok":true,"db":true,…}`.

## 3. Cutover (order matters)

1. **Smoke the new API directly** (Vercel still points at the old box):
   `curl https://api.zorapass.com/api/settings`, `/api/flags`, `/api/payment-methods`, `/api/auth/google/config` all return JSON.
2. **Stop the old worker first**: on the PM2 box run `pm2 stop zora-worker`. The worker is also a Postgres advisory-lock singleton, so two would not double-run, but only one should own the jobs.
3. **Point web at Render**: Vercel → zora-web → Settings → Environment Variables → Production `API_URL=https://api.zorapass.com` → **Redeploy** (the `/api/*` proxy is baked at build time).
4. **Point x-bridge at Render**: payment callbacks use `PUBLIC_ORIGIN`, so new payments call `https://api.zorapass.com` automatically. Ask x-bridge to update any URL registered on their side (webhook allow-lists, `/v1` receivable webhook URL `https://api.zorapass.com/api/webhooks/xbridge/receivables`).
5. **Verify on production**: open www.zorapass.com, a storefront, an event; buy a test pass on a pilot event; scan it at `/scan`; admin login; organizer login.
6. **Keep the PM2 box running (API stopped from new traffic) for 24h** as rollback, then `pm2 delete zora-api zora-worker`.

**Rollback:** Vercel `API_URL` back to `https://zora-api.thebrunchcity.com` + redeploy; `pm2 start zora-worker` on the old box; stop `zora-worker` on Render (scale to 0).

## 4. Day-to-day

- Every release promoted to `main` and pushed to `Reli-Tech/zora` auto-deploys the API and worker (build filters skip unrelated changes). Migrations run in the pre-deploy step; a failed migration fails the deploy and leaves the previous version serving.
- Logs: Render → service → Logs. Worker jobs log `[worker] …` per tick.
- Manual redeploy: Render → service → Manual Deploy → latest commit.
- Releases still go: PR → develop → main (origin) → push to `Reli-Tech/zora` (mirror). That push now deploys **both** web (Vercel) and backend (Render).
