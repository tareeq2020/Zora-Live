# ZORA — Migration Plan: Express monolith → Next.js + NestJS (+ Expo)

**Goal:** reshape `Zora-Live` into three predictable apps — a Next.js web app, a
NestJS backend, and the existing Expo mobile app — **without losing a single
feature, route, or pixel of the current design.** Web + backend are the priority.

**Thesis (why this is low-resistance):** the site is already split over HTTP.
~19 static HTML pages call an Express JSON API (50 routes) via `fetch`. Front-end
and back-end are already decoupled; they just share one process. So this is a
**re-hosting, not a rewrite**: reimplement the same HTTP contract in NestJS,
re-host the same pages in Next.js, and keep the old `server.js` running as a
**living oracle** to diff against. "No lost feature" becomes a mechanical
checklist (the route parity matrix below), not a judgment call.

---

## Locked decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Front-end approach | **Lift-and-shift** HTML→Next routes first; componentize later | Guarantees identical look/feel; avoids visual regression from a premature React rewrite |
| D2 | Data layer | **JSON files behind a repo interface**; DB later | Parity first; a DB migration bundled in doubles risk and can silently change behavior |
| D3 | API contract | **Freeze current routes 1:1** as the spec | This is the anti-feature-loss mechanism; refactor to clean DTOs after cutover |
| D4 | Auth | **Preserve cookie-session semantics** | Zero front-end change; impersonation keeps working; JWT is a later taste call |
| D5 | Tooling | **pnpm + Turborepo** | Boring, minimal config, works with Next + Nest; Nx is more than 3 apps need |

---

## Target architecture

```
  TODAY                              TARGET
  ┌────────────────────────┐        ┌──────────────┐   ┌──────────────┐
  │ Express server.js      │        │ apps/web     │   │ apps/api     │
  │  ├─ static /public     │        │ (Next.js)    │──▶│ (NestJS)     │
  │  │   19 HTML pages ────┼─fetch─▶│  same pages  │   │  same routes │
  │  ├─ /api/* (50 routes) │        │  same CSS    │   │  same data/  │
  │  ├─ lib/ticket,events  │        └──────────────┘   └──────┬───────┘
  │  └─ data/*.json        │                                  │
  └────────────────────────┘        ┌──────────────┐   data/*.json (unchanged)
                                     │ apps/mobile  │   + Supabase (optional)
        Expo app (separate) ───────▶ │ (Expo, P4)   │──▶ same /api/*
                                     └──────────────┘
```

### Monorepo layout

```
zora/
├─ apps/
│  ├─ web/        Next.js (App Router) — public site + admin CMS
│  ├─ api/        NestJS — every /api/* route, ticket render, KYC crypto
│  └─ mobile/     Expo — moved as-is (phase 4)
├─ packages/
│  └─ shared/     TS types + zod schemas: Event, Ticket, Kyc, Organizer, Tier, Settings…
├─ data/          the JSON "database" (backend owns it) + kyc-private/ + .session-secret
├─ pnpm-workspace.yaml
└─ turbo.json
```

### NestJS module map (nothing invented — the current route groups, organized)

```
apps/api/src/
├─ storage/        StorageModule: FileStore (readJson/writeJson) + SupabaseService
├─ auth/           login/logout/me/password + SessionGuard (= requireAuth)
├─ settings/       /api/settings
├─ tiers/          /api/tiers CRUD
├─ registrations/  /api/register, /registrations, .csv export
├─ floorplan/      /api/floorplan
├─ media/          /api/media, /upload, image-size parser, status
├─ placements/     /api/placements
├─ organizers/     status, impersonation
├─ audit/          AuditService (shared) + GET /api/audit
├─ kyc/            upload/submit/status/reasons/review/approve/reject + CryptoService
├─ theme/          /api/storefront-theme
├─ agents/         /api/agents provisioning + rotate
├─ tickets/        /api/tickets/:code.{svg,png}  (ports lib/ticket.js verbatim)
├─ events/         /api/events CRUD             (ports lib/events.js file/Supabase seam)
└─ tenant/         /api/tenant/:handle + host-resolution middleware
```

---

## Phased plan

### Phase 0 — Scaffold, break nothing
- [ ] Init pnpm workspace + Turborepo at a new repo root.
- [ ] Move `zora-site` in as-is (still runs on `npm start`); move `mobile` → `apps/mobile`.
- [ ] Move `data/` to the shared root; point the legacy server at it.
- [ ] Verify: old server still boots and serves every page. One commit, zero behavior change.

### Phase 1 — Backend parity (NestJS) — **the critical phase**
- [ ] Scaffold `apps/api` (NestJS), listening on a new port; legacy Express stays up as the **oracle**.
- [ ] `StorageModule`: port `readJson`/`writeJson` into a `FileStore` service; port `lib/supabase.js` into `SupabaseService`.
- [ ] Port `lib/ticket.js` → `TicketsService` (framework-agnostic already; QRCode + resvg unchanged).
- [ ] Port `lib/events.js` → `EventsService` (file/Supabase seam + `props` jsonb shape intact).
- [ ] Port KYC AES-256-GCM crypto → `CryptoService`; **carry `data/.session-secret` across unchanged** (see Trap #2).
- [ ] Reimplement all 50 routes 1:1 (matrix below). Preserve status codes, validation messages, headers, response shapes.
- [ ] `SessionGuard` replicating `requireAuth`; `express-session` cookie config identical (httpOnly, sameSite lax, 8h).
- [ ] First-run seeding: admin/settings/tiers/organizers defaults.
- [ ] **Contract tests**: hit legacy + Nest for every route, diff JSON/headers/status. Green = parity.

### Phase 2 — Frontend re-host (Next.js)
- [ ] Scaffold `apps/web` (App Router). Add `next.config` rewrite/proxy to the API in dev.
- [ ] Bring `zora-tokens.css`, `zora-theme.js`, `placements.js`, `zbot.js` across; keep behavior identical (theme = client component setting `data-theme` at head to avoid FOUC).
- [ ] Port pages **lift-and-shift**, one per route (matrix below): keep exact HTML+CSS, move inline `<script>` into client components, point `fetch` at the API.
- [ ] Port `admin/login.html` + `admin/dashboard.html` into an `/admin` route group.
- [ ] **Middleware** for `<handle>.zora.com` → tenant rewrite (replaces `server.js:670`); keep the `/@handle` path-alias fallback for local/no-wildcard-DNS.
- [ ] Serve uploaded assets via the API (Trap #3), committed assets from `public/`.

### Phase 3 — Cutover
- [ ] Flip DNS/proxy: web → api → data. Retire `server.js`.
- [ ] Smoke-test every page + admin flow against the parity checklist.

### Phase 4 — Later (non-blocking)
- [ ] Point Expo app at the NestJS API instead of Supabase-direct.
- [ ] Migrate JSON files → Postgres/Supabase behind the `FileStore` interface.
- [ ] Componentize pages where reuse pays; move KYC key to env/KMS.

---

## Complete route parity matrix (the spec — freeze 1:1)

Legend: **Auth** = requires admin session · **Pub** = public · **Open\*** = intentionally
unauthed in the demo (decide whether to gate — see Trap #4).

| # | Method + Route | Owner | Auth | Parity notes (must preserve) |
|---|---|---|---|---|
| 1 | POST `/api/login` | api/auth | Pub | bcrypt compare; sets `session.isAdmin` |
| 2 | POST `/api/logout` | api/auth | Pub | destroys session |
| 3 | GET `/api/me` | api/auth | Pub | `{ isAdmin }` |
| 4 | POST `/api/password` | api/auth | Auth | current check; min 8 chars |
| 5 | GET `/api/settings` | api/settings | Pub | DEFAULT_SETTINGS fallback |
| 6 | PUT `/api/settings` | api/settings | Auth | shallow merge |
| 7 | GET `/api/tiers` | api/tiers | Pub | sorted by `order` |
| 8 | POST `/api/tiers` | api/tiers | Auth | id = base36 timestamp |
| 9 | PUT `/api/tiers/:id` | api/tiers | Auth | preserves id |
| 10 | DELETE `/api/tiers/:id` | api/tiers | Auth | filter-out |
| 11 | POST `/api/register` | api/registrations | Pub | crewName/leadName/phone required; size 2–6; phone dedupe; code `Z001-####` |
| 12 | GET `/api/registrations` | api/registrations | Auth | full list |
| 13 | DELETE `/api/registrations/:id` | api/registrations | Auth | filter-out |
| 14 | GET `/api/registrations.csv` | api/registrations | Auth | **BOM prefix + Content-Disposition filename** |
| 15 | GET `/api/floorplan` | api/floorplan | Pub | default `{space,stage,zones}` |
| 16 | PUT `/api/floorplan` | api/floorplan | Open\* | zones cap 300 |
| 17 | GET `/api/media` | api/media | Auth | **image-size parser (PNG/JPEG), cdnUrl hash, categorize, lowres flag** |
| 18 | PUT `/api/media/:name/status` | api/media | Auth | status ∈ approved/flagged/pending |
| 19 | POST `/api/upload` | api/media | Open\* | base64 data URL; 8MB cap; safe filename |
| 20 | GET `/api/placements` | api/placements | Pub | SLOTS + defaults |
| 21 | PUT `/api/placements` | api/placements | Auth | slot allowlist |
| 22 | GET `/api/organizers` | api/organizers | Auth | DEFAULT_ORGANIZERS seed |
| 23 | PUT `/api/organizers/:id/status` | api/organizers | Auth | active/suspended; **audit** |
| 24 | POST `/api/organizers/:id/impersonate` | api/organizers | Auth | blocks suspended; `session.impersonating`; **audit** |
| 25 | POST `/api/impersonate/exit` | api/organizers | Auth | clears; **audit** |
| 26 | GET `/api/impersonation` | api/organizers | Pub | reads session |
| 27 | GET `/api/audit` | api/audit | Auth | last 120, reversed |
| 28 | POST `/api/kyc/upload` | api/kyc | Open\* | **AES-256-GCM encrypt**; opaque docId; 8MB; jpg/png/webp/pdf |
| 29 | POST `/api/kyc/submit` | api/kyc | Open\* | validate; **masked doc# + sha256 hash only**; attempt count |
| 30 | GET `/api/kyc/status/:ref` | api/kyc | Pub | no PII; mapped rejection reason |
| 31 | GET `/api/kyc/reasons` | api/kyc | Pub | code+label list |
| 32 | GET `/api/kyc` | api/kyc | Auth | `kycPublic` shape; reversed |
| 33 | GET `/api/kyc/:id/documents/:docId` | api/kyc | Auth | **decrypt stream; no-store; logs view** |
| 34 | POST `/api/kyc/:id/approve` | api/kyc | Auth | flips is_verified; **audit** |
| 35 | POST `/api/kyc/:id/reject` | api/kyc | Auth | standardized reason; **audit** |
| 36 | GET `/api/storefront-theme` | api/theme | Pub | DEFAULT_THEME |
| 37 | PUT `/api/storefront-theme` | api/theme | Open\* | merge |
| 38 | GET `/api/agents` | api/agents | Auth | list |
| 39 | POST `/api/agents` | api/agents | Auth | **6-digit code; 3-day expiry** |
| 40 | POST `/api/agents/:id/rotate` | api/agents | Auth | new code + expiry |
| 41 | DELETE `/api/agents/:id` | api/agents | Auth | filter-out |
| 42 | GET `/api/tickets/:code.svg` | api/tickets | Pub | resolveTicket + **query-string field overrides** |
| 43 | GET `/api/tickets/:code.png` | api/tickets | Pub | scale param (≤3); async resvg |
| 44 | GET `/api/events` | api/events | Pub | `enrichEvent` (organizer+subdomain+url); city filter |
| 45 | GET `/api/events/:id` | api/events | Pub | enrichEvent |
| 46 | POST `/api/events` | api/events | Auth | upsert (file or Supabase) |
| 47 | PUT `/api/events/:id` | api/events | Auth | upsert by id |
| 48 | GET `/api/tenant/:handle` | api/tenant | Pub | 404 unknown handle |
| 49 | GET `/admin`, `/login` | **web** | — | session-gated page (login vs dashboard) |
| 50 | GET `/events/:id` | **web** + mw | — | tenant → branded page; apex → 302 to subdomain |
| 51 | GET `/@:handle`, `/@:handle/events/:id` | **web** | — | tenant.html path alias |
| 52 | host middleware `*.zora.com` | **web** mw + api mw | — | resolve `req.tenant` |
| 53 | static `/public` + `/assets` | **web** + api | — | committed = public/; uploads = API-served |

### Page port list (Next.js routes, lift-and-shift)
`/` (index) · `/about` · `/brand` · `/commission` · `/create-event` · `/discover` ·
`/drop-001` · `/help` · `/studio` · `/seatmap` · `/dashboard-seatbuilder` · `/signup` ·
`/ticket-preview` · `/tenant` → `[handle]` · `/thebrunchcity` (tenant demo) ·
`/dashboard` (organizer) · `/admin` group (login + dashboard).

---

## Feature-loss traps (each is a checklist line, not a hope)

1. **Subdomain tenant routing** (`server.js:670`) — replicate host→tenant in Next middleware *and* Nest; keep `/@handle` fallback for no-wildcard-DNS local dev.
2. **KYC at-rest key** — derived from `data/.session-secret`; **carry the file across unchanged** or the 3 existing `.enc` docs become permanently undecryptable. Flag: move to env/KMS in P4.
3. **Uploaded-asset serving** — `/assets` mixes committed images and runtime uploads; Next `public/` is build-time only, so uploads must be API-served (or written to a shared volume both read).
4. **Open\* demo endpoints** (16, 19, 28, 29, 37) — decide keep-open vs gate now; record the choice.
5. **CSV export** — BOM + `Content-Disposition` (`server.js:186`).
6. **Ticket query-string overrides** — live studio preview (`server.js:596`).
7. **First-run seeding** — admin/settings/tiers/organizers defaults on empty data.
8. **Impersonation session state** — must survive the auth port.
9. **Media image-size parser** — hand-rolled PNG/JPEG dimension reader (`server.js:216`); port exactly, it drives the lowres flag.
10. **express.json 12mb limit** — base64 uploads need the raised body limit on the Nest side.

---

## Testing strategy

- **Oracle diff (primary):** Phase 1 keeps legacy Express live. A test harness replays
  a fixture of requests against both servers and asserts identical status + headers + body.
  This is the parity guarantee.
- **Unit:** ticket render (SVG snapshot), KYC encrypt/decrypt round-trip, media size parser,
  register validation, CSV shape.
- **E2E (Playwright):** each ported page loads, key flows work (register, KYC submit/approve,
  ticket preview, tenant routing, admin login + impersonation).
- **Visual:** screenshot diff legacy vs Next per page to prove look/feel parity.

## Out of scope (explicit — so it doesn't silently creep)
- DB migration off JSON files (P4, behind the interface).
- Expo app repointing (P4).
- API redesign / clean DTOs (post-cutover).
- Auth model change to JWT (post-cutover).
- New features of any kind — this migration adds zero behavior.

## Risks
- **resvg/QR native deps** in Nest runtime image — pin versions, verify in the deploy target.
- **Session store** — in-memory sessions don't survive multi-instance; if scaling, add a shared
  session store (Redis) at cutover. Single-instance keeps current behavior.
- **Supabase `props` shape drift** — events read/write the full object in `props`; keep `fromRow`/`toRow` byte-identical.

---

## GSTACK REVIEW REPORT

| Field | Value |
|-------|-------|
| Runs | 1 (interactive eng review) |
| Status | Plan drafted, decisions locked |
| Scope | Re-host zora-site → Next.js (web) + NestJS (api); Expo aligned in P4 |
| Findings | 10 feature-loss traps identified and checklisted; 53-row route parity matrix is the spec |
| Model | claude |

**Decisions:** D1 lift-and-shift · D2 files-behind-interface · D3 freeze API 1:1 ·
D4 cookie sessions · D5 pnpm+Turborepo — all accepted by user.

**Method:** strangler-fig re-host with the legacy Express server as a live oracle;
parity proven by request-diff contract tests, not judgment.

**VERDICT:** APPROVED TO EXECUTE — start Phase 0 (scaffold, break nothing), then
Phase 1 backend parity (the critical phase). Feature parity is mechanically
enforced by the route matrix + oracle diff.

NO UNRESOLVED DECISIONS
