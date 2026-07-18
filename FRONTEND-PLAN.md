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
9. **The gate proves the React build matches the *approved design*, not byte-parity
   with the old HTML** — visual-regression screenshots (React route vs the static
   page as design reference, frozen clock / seeded data) + behavior smoke on a
   seeded backend + design review. A byte/DOM diff of React output is the wrong
   surface (hydration attrs; countdowns / `Math.random` are non-deterministic).
   *(See §7.1.)*
10. **Clean cutover — no `.html` maintenance.** *(Revised: 0 live users, get it
    right the first time.)* Each page's static `public/*.html` twin is deleted (and
    its `next.config`/static mapping removed) in the **same PR** that ships its
    React route. No `ZORA_REACT_ROUTES` allowlist, no keep-both coexistence, no
    `.html`→clean redirects, no F10 — that machinery existed to protect live users
    during an incremental cutover, and there are none. Regressions are caught in
    review/QA and fixed forward. Build each page's intended end-state directly
    (converted + any IA change together) — no convert-at-parity/apply-delta split.
    *(See §7.2.)*

---

## 6. PR sequence (Phase F — builds on PR-1..5g; revised by eng review)

Same cadence: feature branch → verify → PR to `develop` → merge → push origin +
mirror. Distinct from the dormant payments track (PR-6..12). **With 0 live users,
each conversion PR deletes its `public/*.html` twin and builds the intended
end-state directly** — no parity-preserving a/b split, no rollback allowlist, no
redirect shim. The **event contract precedes the home** (home's `/api/events`-fed
modules depend on it), and a **backend organizer-auth PR (F-AUTH)** precedes the
seller gate.

- **F0 — this plan.** ✅ Committed (+ hardening + 0-users revision).
- **F1 — App shell + verification harness.** Root layout (Server Component) +
  global `zora-tokens.css` + a no-flash inline theme boot script with
  `suppressHydrationWarning` on `<html>`; decompose `zora-theme.js` into
  `<Wordmark>` / `<ThemeToggle>` (it currently mutates DOM React will own); favicon
  → layout `metadata`. `(marketing)` / `(app)` route groups; `<SiteNav>` /
  `<SiteFooter>`. **The verification harness (§7.1).** No page converted yet.
- **F2 — Consumer pages → React:** about, brand, commission, help, discover — each
  PR deletes its `.html` twin and repoints internal links to clean routes.
  Discover fed by seeded `/api/events` + placements.
- **F3 — Canonical event contract + flagship URL** *(was F4 — moved earlier)*. One
  `<EventPage>` for `/events/:id`, `/@handle/events/:id`, subdomain. Add a **slug
  alias** (`offshore` → `offshore-001`) in `getEvent`, and **skip the apex→owner
  302 for canonical flagship slugs** so `/events/offshore` renders in place. Flag
  OFFSHORE `mega`. Add a real **`/events/:id/seats`** route + **event-scoped
  floor-plan** fetch; repoint the tenant CTA off `?ev=NAME`.
- **F4 — Home → React (converted + IA in one)** *(was F3)*. Blocks → components;
  apply the reorder + CTA swap + nav reweight; wire drop/gallery to
  `/api/events`/`mega` (from F3). Verified against the approved design, not the old
  byte output.
- **F5 — Tenant storefront index** *(needs shape-aware middleware)*. Split `/@handle`
  root (→ storefront index) from `/@handle/events/:id` leaf via shape-aware regex;
  add a `tenant && pathname==='/'` branch **before** the `next.config` `/`→index
  rewrite. Convert + add the index route in one PR; owner-only "Manage" link
  (owner-gated once F-AUTH lands).
- **F-AUTH — Organizer principal (backend).** Extend `ZoraSession`
  (`organizerHandle`/`role`/`kycStatus`); organizer login endpoint against the
  `organizers` collection; `OrganizerGuard`; role-aware `/api/me`
  (`{isAdmin, role, organizerId, impersonating}`); add `iat`/`exp` to the signed
  payload + verify; CSRF token on state-changing POSTs; design the cross-subdomain
  **impersonation handoff** (short-lived signed token) so the later `app.zora.com`
  move is a no-op. Extend the reserved-handle set (`dashboard, events, discover,
  drops, t`). **Prerequisite for F6; unblocks F5's owner link.**
- **F6/F7 — Seller pages → React under `/dashboard/*`, gated.** Convert the seller
  pages (dashboard, create-event, studio, seatbuilder, signup) to React under the
  new namespace **and** stand up the gate together, deleting each `.html` twin in
  its PR (so there is no ungated filename backdoor). Middleware gate: prefix-match
  (`=== '/dashboard' || startsWith('/dashboard/')`), **exempt `/dashboard/login`**
  (loop), fail-closed on `/api/me`. Rebrand Studio as a *mode*; fix the footer
  `ORGANIZERS→admin` mislink; breadcrumbs / "← Dashboard". Cookie host-only
  (path-prefix phase), built subdomain-ready per §7.3. Harness gains an
  organizer-session login (curl + cookie-jar, mirroring pg-parity).
- **F8 — Shared-ticket / QR landing.** `/t/:code` resolves a pass → app-claim +
  web-pass fallback; wire discover QR + scan landing.
- **F9 — Admin console → React + separation.** Convert admin/*; `/admin` reads
  clearly as internal. *(Last static twins removed as their pages convert — no
  separate decommission phase.)*

---

## 7. Execution guardrails (from the engineering review)

### 7.1 The verification gate (goal: matches the approved design)
With 0 users we are **not** preserving byte-parity with the old HTML for a live
site — the static page is the **design reference to port from**, and the goal is
"the React build faithfully reproduces the approved design + behaves correctly."
The right surface is therefore visual + behavioral, not a byte/DOM diff (which
false-fails on hydration attrs and is meaningless on the non-deterministic pages —
`index`/`drop-001` countdowns, `thebrunchcity` claim-code, `dashboard` live-scan +
sparklines). The gate (extend `apps/web/test/verify.mjs`; commit references under
`apps/web/test/golden/`):
1. **Visual regression** — screenshot the React route with a **frozen `Date.now`**
   and **seeded random** and compare to the static page rendered under the same
   frozen conditions (for converted-at-parity pages) or to a committed approved
   screenshot (for IA-changed pages like the home). Design review signs off the
   intentional-change screenshots.
2. **Behavior smoke** against a seeded backend (reuse pg-parity's throwaway PG):
   countdown exists/ticks, discover renders N cards from a fixture, QR SVG 200s,
   seatmap loads the event-scoped floor plan, the organizer gate redirects
   (anon→login, authed→page, wrong-org blocked).
3. **Structural snapshot** (optional, forward-looking) — once a page is React, a
   normalized-DOM snapshot with volatile nodes masked guards against *future*
   unintended regressions between React PRs. It is a regression guard, not the
   conversion oracle.
Retire the byte-diff-vs-legacy oracle per page as each converts; keep it only for
the `/api/*` proxy (still a valid contract). Include `<head>`/canonical/OG/title
in the visual/behavior checks (SEO).

### 7.2 Clean cutover (0 live users)
No rollback rail is needed. Each conversion PR: add the React route, remove the
page's `next.config`/static mapping, and **delete its `public/*.html`** — in one
PR. No `ZORA_REACT_ROUTES` allowlist, no static/React coexistence, no `.html`
redirects (nothing external links to them pre-launch; internal links are repointed
in the same PR). The one care: gate any seller `.html` that would outlive its
conversion (see F6/F7 — they convert + gate + delete together, so it doesn't).
Build each page's intended end-state directly; a regression is a fix-forward in
review/QA, not a production rollback.

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
