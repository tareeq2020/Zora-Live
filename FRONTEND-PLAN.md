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
5. **Ship an organizer session gate + login** (clone the `/admin` middleware
   pattern) and gate all seller pages. This is the single biggest missing entry.
6. **Separate `/admin` (staff) from the organizer dashboard** and fix the
   mislinked footer.
7. *[Judgment call]* **Seller namespace = `/dashboard/*` path prefix first**,
   `app.zora.com` subdomain later. `app` is already reserved in the signup handle
   blocklist, so the subdomain is safe to adopt when we want it; the path prefix
   is lighter for the migration. Overridable.
8. *[Judgment call]* **Do NOT put a live event grid in the apex hero** — CEO lens
   over the demand lens's grid-up-top, because the grid is empty at launch. The
   grid leads once discover is populated (decision #3's flip).

---

## 6. PR sequence (Phase F — builds on PR-1..5g)

Same cadence as the backend: feature branch → verify → PR to `develop` → merge →
push origin + mirror. Distinct from the dormant payments track (PR-6..12).

- **F0 — this plan.** Commit `FRONTEND-PLAN.md`.
- **F1 — App shell + route groups + parity harness.** Root layout lifts
  `zora-theme.js` + `zora-tokens.css` as global primitives; extract `<SiteNav>` /
  `<SiteFooter>`; create `(marketing)` and `(app)` route groups; snapshot-parity
  harness (render route → diff vs captured golden of the current static page).
  Nothing user-visible changes.
- **F2 — Consumer pages → React (parity):** about, brand, commission, help,
  discover. Discover fed by `/api/events` + placements. Byte/visual parity.
- **F3 — Home → React + apply the decided reorder & CTA swap.** Blocks become
  components; resequence per §2; nav reweighted; drop/gallery modules fed by
  `/api/events`. (Intentional IA change, documented.)
- **F4 — Canonical event contract + flagship URL.** One `<EventPage>` for
  `/events/:id`, `/@handle/events/:id`, tenant subdomain; canonical
  `/events/offshore` (alias `drop-001`); OFFSHORE flagged `mega`; seat route by
  id. drop-001 renders through the contract (app-only fulfillment = a variant).
- **F5 — Tenant storefront index route.** `/@handle` + subdomain root → storefront
  index (thebrunchcity layout), distinct from the single-event leaf. Owner-only
  "Manage" link → dashboard.
- **F6 — Seller namespace + organizer session gate + login.** Consolidate seller
  pages under `/dashboard/*`; add organizer login (clone `/admin` `/api/me`
  gate); gate all seller pages; regularize paths; rebrand Studio as a mode; fix
  footer mislink.
- **F7 — Seller pages → React (parity)** under the new namespace: dashboard,
  create-event, studio, seatbuilder, signup — with breadcrumbs / "← Dashboard"
  affordances and Studio nested under Storefront.
- **F8 — Shared-ticket / QR landing.** `/t/:code` resolves a pass → app-claim +
  web-pass fallback; wire discover QR + scan landing.
- **F9 — Admin console → React + separation.** Convert admin/*; ensure `/admin`
  reads clearly as internal.

Each PR ships the converted surface behind the parity gate; IA-changing PRs
(F3–F6, F8) add a functional smoke check for the new/changed routes.
