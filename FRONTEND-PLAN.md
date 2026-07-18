# ZORA Frontend Plan — Information Architecture + Next.js Conversion

Outcome of a structure/IA review (demand-side, supply-side, and CEO/strategy
lenses) over the lift-shifted static site. This plan decides **how the site is
structured and where each persona enters**, then sequences the conversion of the
static HTML into a proper Next.js frontend.

## Constraints (non-negotiable)
- **No design changes.** The visual design has passed review. This is structure,
  IA, routing, and componentization only.
- **No scope reduction.** Every existing page and feature is preserved.
- **Parity-preserving conversion.** Each converted page is snapshot-diffed against
  its current rendered output (same approach as the backend golden-fixture gate),
  so "convert to React" never silently changes a page. IA changes (homepage
  reorder, new routes) are the *only* intentional deviations and are called out.

---

## 1. The IA spine — three planes

Every surface belongs to exactly one plane. This is the organizing decision the
whole plan hangs on.

| Plane | Where | Pages | Chrome |
|-------|-------|-------|--------|
| **1. Consumer marketing + marketplace** | `zora.com` apex | index, discover, about, brand, commission, help, drop-001/offshore | marketing `<nav>`+`<footer>` |
| **2. Storefront rendering** (organizer-owned, consumer-facing) | `handle.zora.com`, `/@handle`, `/events/:id` | tenant storefront + single event | branded, no marketing chrome |
| **3. Seller app** (supply-side product) | `/dashboard/*` now → `app.zora.com` later | dashboard, create-event, studio, seatbuilder, signup, **+ organizer login** | app shell, no marketing chrome |
| **(internal)** Staff console | `/admin` | admin/* | separate; NOT the organizer dashboard |

The existing `<nav>`/`<footer>` split in the static pages already matches this:
marketing pages carry chrome; app/tool/tenant pages don't. The Next.js route
groups mirror it: `(marketing)`, `(app)`, tenant rendering, admin.

---

## 2. Homepage (apex) — decided structure

**Positioning:** a **manifesto-wrapped single-DROP landing** for OFFSHORE — *not*
a marketplace homepage. There is exactly one live, dated, converting asset
(DROP 001 — OFFSHORE, countdown running, app-only passes). `discover` renders an
empty grid today, so leading with the marketplace breaks trust on the first
click. Lead with the real thing; let the marketplace graduate in later.

**Single primary CTA:** *Get on the OFFSHORE manifest* (the drop conversion path).

**Block order (existing sections resequenced — no visual redesign):**
1. Hero — keep "the ticket is the product"; **primary CTA → OFFSHORE**, "find events" secondary.
2. **DROP 001 — OFFSHORE strip** (promoted from position 5) — the live countdown + manifest.
3. **App section** — passes are app-only, so the app is a conversion dependency, not a footnote.
4. Platform pillars — the "why it works this way" proof.
5. Gallery "live on ZORA" — proof-of-life; seeds the future marketplace.
6. Organizers section — supply side, clearly below the goer path.
7. Manifesto close → footer.

**Nav reweight:** lead with `events (discover)` + `drops`; demote `about / pricing /
help / organizers`. The **organizers** link resolves to a dedicated page
(`/dashboard` login or signup), not an on-page `#organizers` anchor.

---

## 3. Entry-point matrix

### Event-goers
| Entry | Status | Action |
|-------|--------|--------|
| apex `/`, `/discover` | ✅ covered | convert |
| direct event `/events/:id` (apex 302 → owner) | ✅ covered | keep routing |
| tenant event `/@handle/events/:id`, `handle.zora.com/events/:id` | ✅ covered | keep routing |
| **tenant storefront index** `/@handle`, `handle.zora.com/` | ❌ **broken** (rewrites to single-event page → "no event") | **add storefront-index route** |
| **canonical flagship** `/events/offshore` (or `/drops/001`) | ⚠️ only bespoke `drop-001.html` | **add canonical event URL**, alias the old path |
| **shared ticket / QR / scan** `/t/:code` | ❌ missing | **add pass-resolve landing** (app-claim + web-pass fallback) |
| seat select | ⚠️ brittle `?ev=NAME` | **route by id** `/events/:id/seats` |

### Organizers
| Entry | Status | Action |
|-------|--------|--------|
| marketing CTA (`#organizers`, commission "START SELLING") → signup | ✅ covered | repoint to dedicated destination |
| signup wizard → dashboard/create-event | ✅ covered | convert, move under seller namespace |
| **organizer login / returning-user front door** | ❌ **missing** (biggest gap; `/login` today = *admin* login) | **add organizer session gate** (clone `/admin` `/api/me` pattern) |
| **"Manage this store" from own storefront** | ❌ missing | **add owner-only Manage link** on tenant page |
| direct dashboard/create-event/studio deep-links | ⚠️ **ungated static files** | **gate behind organizer session** |
| footer "ORGANIZERS → admin" | ❌ **mislinked to staff console** | repoint to organizer login |

---

## 4. Target route map

```
zora.com (Plane 1 — consumer marketing + marketplace)
├─ /                      home (OFFSHORE-led)         index
├─ /discover              marketplace hub             discover   (future lead)
├─ /events/:id            event (302 → owner tenant)  event contract
├─ /events/offshore       canonical flagship          alias of drop-001
├─ /events/:id/seats      seat picker (by id)         seatmap
├─ /t/:code               shared-ticket / QR landing  NEW
└─ /about /brand /commission /help

handle.zora.com  •  /@handle (Plane 2 — storefront rendering; middleware unchanged)
├─ /@handle              storefront INDEX (multi-event)  NEW route → thebrunchcity layout
└─ /@handle/events/:id   single event (branded)          tenant.html leaf

/dashboard/* → later app.zora.com (Plane 3 — seller app; session-gated)
├─ /dashboard                    control room            dashboard
│   ├─ /dashboard/storefront          summary + brand kit
│   └─ /dashboard/storefront/studio   full customizer     studio (a MODE, not a product)
├─ /dashboard/events/new              create event        create-event
│   └─ /dashboard/events/new/floor-plan  floor plan       seatbuilder
├─ /dashboard/onboarding              signup/KYC wizard   signup
└─ /dashboard/login                   organizer sign-in   NEW

/admin (internal staff console — relabeled, separated from organizer dashboard)
```

---

## 5. Key decisions (with the judgment calls flagged)

1. **Lead the apex with OFFSHORE, not the marketplace.** (demand + CEO agree.)
2. **One canonical event→checkout contract** rendered identically by discover,
   tenant storefronts, and the flagship — so every event routes the same and no
   buy path dead-ends.
3. **Give OFFSHORE a real event URL + flag it `mega`** so discover already leads
   with it; feed the home drop/gallery modules from `/api/events`. Then N=1 →
   N=many is a **config flip** (swap hero CTA to "find events" when discover
   fills), not a restructure. `discover` is the pre-wired future hub.
4. **One seller product, two modes.** "ZORA STUDIO" is the storefront-editing mode
   of "ZORA DASHBOARD" (dashboard Storefront = summary; Studio = full editor it
   deep-links into); floor-plan builder is a sub-tool of create-event.
5. **BUILD an organizer principal, don't "clone `/admin`."** There is no organizer
   identity today — `ZoraSession` is `{isAdmin, impersonating}` only, `/api/login`
   authenticates one hardcoded admin, KYC keys on `fullName`. Cloning the `/admin`
   gate would gate the seller app behind the *staff* credential. F-AUTH (backend)
   adds an organizer credential + `organizerHandle`/`role` in the signed session,
   an `OrganizerGuard`, and a role-aware `/api/me`. Prerequisite for F5's owner
   link and the F6 gate. *(Corrected by eng review — see §7.)*
6. **Separate `/admin` (staff) from the organizer dashboard** and fix the
   mislinked footer. `/api/me` must return `role` so the two gates authorize
   different principals; an admin mid-impersonation may enter `/dashboard/*`.
7. *[Judgment call]* **Seller namespace = `/dashboard/*` path prefix first**,
   `app.zora.com` subdomain later. The move is blocked by the **host-only cookie**
   (no `Domain`) — build the session subdomain-ready now (Option A: isolate the
   seller app on its own host + a signed impersonation handoff) rather than
   `Domain=.zora.com`, which would broadcast the privileged session to consumer
   storefront subdomains. *(See §7.)*
8. *[Judgment call]* **Do NOT put a live event grid in the apex hero** — CEO lens
   over the demand lens's grid-up-top, because the grid is empty at launch. The
   grid leads once discover is populated (decision #3's flip).
9. **The parity gate is a normalized structural-DOM snapshot of *initial* markup
   against committed goldens, with volatile nodes masked — NOT a byte-diff.** A
   byte-diff of React output false-fails immediately; countdowns / `Math.random`
   make post-hydration DOM non-deterministic. Behavior is asserted by smoke tests
   against a seeded backend with a frozen clock. *(Keystone — see §7.)*
10. **Every route is served EITHER static OR React, flipped atomically per PR
    behind an env allowlist (`ZORA_REACT_ROUTES`); static `public/*.html` stay for
    the whole phase and are decommissioned only in a final F10.** Gives per-route
    rollback with no redeploy and prevents a converted page and its `.html` twin
    both being live. *(See §7.)*

---

## 6. PR sequence (Phase F — builds on PR-1..5g; revised by eng review)

Same cadence: feature branch → verify → PR to `develop` → merge → push origin +
mirror. Distinct from the dormant payments track (PR-6..12). Convert-and-change
surfaces split into **a** (convert at parity — golden unchanged) then **b** (apply
the IA delta as a deliberately re-captured golden, so the review diff shows *only*
the intended change). Order changed: the **event contract moves before the home**
(home's `/api/events`-fed modules depend on it), and a **backend organizer-auth
PR (F-AUTH)** is inserted before the seller gate.

- **F0 — this plan.** ✅ Committed (+ this hardening revision).
- **F1 — App shell + parity harness + rollback rail.** Root layout (Server
  Component) + global `zora-tokens.css` + a no-flash inline theme boot script with
  `suppressHydrationWarning` on `<html>`; decompose `zora-theme.js` into
  `<Wordmark>` / `<ThemeToggle>` (it currently mutates DOM React will own); favicon
  → layout `metadata`. `(marketing)` / `(app)` route groups; `<SiteNav>` /
  `<SiteFooter>`. **The parity harness (§7.1)** and the **`ZORA_REACT_ROUTES`
  allowlist (§7.2)**. No page converted yet.
- **F2 — Consumer pages → React (parity):** about, brand, commission, help,
  discover — each convert-at-parity behind the allowlist; `.html` twin kept +
  `.html`→clean redirect; outbound links repointed. Discover fed by seeded
  `/api/events` + placements.
- **F3 — Canonical event contract + flagship URL** *(was F4 — moved earlier)*. One
  `<EventPage>` for `/events/:id`, `/@handle/events/:id`, subdomain. Add a **slug
  alias** (`offshore` → `offshore-001`) in `getEvent`, and **skip the apex→owner
  302 for canonical flagship slugs** so `/events/offshore` renders in place. Flag
  OFFSHORE `mega`. Add a real **`/events/:id/seats`** route + **event-scoped
  floor-plan** fetch; repoint the tenant CTA off `?ev=NAME`.
- **F4 — Home → React** *(was F3)*. **F4a** convert at parity; **F4b** apply the
  reorder + CTA swap + nav reweight, and wire drop/gallery to `/api/events`/`mega`
  (now available from F3).
- **F5 — Tenant storefront index** *(needs shape-aware middleware)*. Split `/@handle`
  root (→ storefront index) from `/@handle/events/:id` leaf via shape-aware regex;
  add a `tenant && pathname==='/'` branch **before** the `next.config` `/`→index
  rewrite. **F5a** convert at parity; **F5b** the index route + owner-only "Manage"
  link (renders unconditionally here; gated to the owner once F-AUTH lands).
- **F-AUTH — Organizer principal (backend).** Extend `ZoraSession`
  (`organizerHandle`/`role`/`kycStatus`); organizer login endpoint against the
  `organizers` collection; `OrganizerGuard`; role-aware `/api/me`
  (`{isAdmin, role, organizerId, impersonating}`); add `iat`/`exp` to the signed
  payload + verify; CSRF token on state-changing POSTs; design the cross-subdomain
  **impersonation handoff** (short-lived signed token) so the later `app.zora.com`
  move is a no-op. Extend the reserved-handle set (`dashboard, events, discover,
  drops, t`). **Prerequisite for F6; unblocks F5's owner link.**
- **F6 — Seller namespace + organizer gate.** Consolidate seller pages under
  `/dashboard/*`; middleware gate the **whole namespace incl. raw `*.html`
  filenames**, prefix-match (`=== '/dashboard' || startsWith('/dashboard/')`),
  **exempt `/dashboard/login`** (loop), fail-closed; rebrand Studio as a *mode*;
  fix the footer `ORGANIZERS→admin` mislink. Cookie stays host-only (path-prefix
  phase); built subdomain-ready per §7.3.
- **F7 — Seller pages → React (parity, authed):** dashboard, create-event, studio,
  seatbuilder, signup — behind the F6 gate; harness gains an organizer-session
  login (curl + cookie-jar, mirroring pg-parity). Breadcrumbs / "← Dashboard".
- **F8 — Shared-ticket / QR landing.** `/t/:code` resolves a pass → app-claim +
  web-pass fallback; wire discover QR + scan landing.
- **F9 — Admin console → React + separation.** Convert admin/*; `/admin` reads
  clearly as internal.
- **F10 — Decommission static.** After bake, remove `public/*.html` twins and the
  `ZORA_REACT_ROUTES` allowlist; leave only clean routes + `.html` redirects.

---

## 7. Execution guardrails (from the engineering review)

### 7.1 The parity gate (redefine before F1 ships — the keystone)
A byte-diff of served HTML (today's `apps/web/test/verify.mjs`) **cannot** survive
React (hydration attrs, `__next` data, attribute/whitespace normalization) and is
meaningless on the non-deterministic pages (`index`/`drop-001` countdowns,
`thebrunchcity` claim-code, `dashboard` live-scan feed + sparklines — `Date.now`,
`setInterval`, `Math.random`). Replace it with, committed under
`apps/web/test/golden/` (mirroring `db/test/golden/`):
1. **Structural-DOM snapshot of *initial served markup* (pre-hydration):** parse →
   strip Next hydration artifacts → canonicalize attribute order + whitespace →
   **mask volatile nodes by selector** (countdowns, claim-codes, live feeds,
   sparkline `path d`, injected placement `src`) → diff vs the committed golden.
2. **Behavior smoke** against a seeded backend (reuse pg-parity's throwaway PG) with
   a **frozen `Date.now`** and **seeded random**: countdown exists/ticks, discover
   renders N cards from a fixture, QR SVG 200s, seatmap loads the event-scoped
   floor plan, the organizer gate redirects (anon→login, authed→page, wrong-org
   blocked).
Keep the byte-diff only for still-static pages and the `/api/*` proxy. Retire it
per page as each converts.

### 7.2 Atomic route flip + rollback
Each route is served **either** static `public/*.html` **or** its React route —
never both — flipped in `next.config`/`middleware` in the same PR, gated by a
`ZORA_REACT_ROUTES` env allowlist so a regressing route drops back to static with
no redeploy or revert. Do **not** delete `public/*.html` in a conversion PR;
decommission all twins in F10 after bake. Add `.html`→clean-URL redirects and
snapshot `<head>`/canonical/OG/title in the gate (SEO parity).

### 7.3 Auth / session hardening
- **Path-prefix phase (now):** keep the cookie **host-only** (no `Domain`),
  `SameSite=Lax`, `httpOnly`, `Secure` in prod; consider the `__Host-` prefix.
  Everything (admin + `/dashboard/*` + impersonation) works on one host.
- **Subdomain phase (later, designed now in F-AUTH):** **Option A** — seller app +
  its `/api` proxy on `app.zora.com`, cookie host-only there; admin stays on
  `zora.com`; storefronts never receive the session; impersonation crosses via a
  short-lived signed-token handoff. Avoid `Domain=.zora.com` (broadcasts the
  privileged session to consumer storefront subdomains) unless storefronts are
  guaranteed ZORA-served *and* CSRF tokens are in place.
- `/api/me` returns `role`; organizer gate passes on `role==='organizer' || (isAdmin
  && impersonating)`; staff gate on `isAdmin`. Add `iat`/`exp` (legacy tokens
  without `exp` accepted until secret rotation).
- **Dev:** `COOKIE_SECURE` unset/false on `http://localhost`; HTTPS required on
  `*.zora.com` before the subdomain move.

### 7.4 Routing correctness (F3/F5/F6)
- `/events/offshore`: slug≠id — alias in `getEvent` **and** skip the apex 302 for
  canonical slugs, else it 404s then bounces to the tenant leaf.
- `/@handle`: shape-aware — `^/@([^/]+)$`→storefront index, `^/@([^/]+)/events/
  ([^/]+)$`→leaf; add `tenant && '/'`→index before the config `/` rewrite.
- `/dashboard` gate: prefix-match, exempt `/dashboard/login`, keep assets under
  `_next/`/`api/` so the per-request Edge `/api/me` fetch doesn't cover every asset.
- Seat-by-id is not cosmetic: needs the `/events/:id/seats` branch + an
  event-scoped floor-plan endpoint + the CTA repoint, together.

### 7.5 Coverage the harness must add (per the PR that needs it)
SEO/`<head>`/canonical/OG; Host-header subdomain rendering (not just the `/@handle`
path form); authed organizer snapshots (before F7); the gate redirect matrix
(anon/authed/wrong-org, in F6); and the full client-called `/api` surface
(`storefront-theme`, `floorplan`, `tenant/:handle`, `tiers`, `register`, `kyc/*`),
not just the four endpoints `verify.mjs` covers today.
