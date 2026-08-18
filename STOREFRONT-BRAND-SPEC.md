# ZORA — Storefront branding cleanup (spec)

**Goal:** make the white-label storefront (the `/@handle` index and the
`/@handle/events/:id` event page) look like one coherent, premium, branded product
— fixing the inconsistencies found on the live tenant page — and let an organizer
control their brand (logo, banner, accent) without breaking that coherence.

Reference mockup (real tokens, all three screens):
`~/.gstack/projects/tareeq2020-Zora-Live/designs/storefront-brand-20260729/storefront-brand.html`

Scope: **frontend theming only.** No schema, no money-path, no new data flow. The
per-event `cover` column + persistence already shipped (PR-BS15).

---

## What's broken today (and why)
1. **Cream background.** PR-BS15 pulled the organizer's *light* theme `bg` onto the
   event page. The Zora consumer surface should be **dark**; only the accent/assets
   are the organizer's.
2. **Redundant hero.** A store banner shows up top AND a placeholder cover block
   below it. There should be **one hero**.
3. **Checkout colour clash.** `CheckoutFlow` hardcodes electric blue (`#4C6FFF` /
   `#3D5AFE`), which fights the organizer's accent.
4. **Font inconsistency.** The event page + storefront index use **Fraunces +
   Archivo** (the old editorial theme), while every bill-split consumer screen +
   `DESIGN.md` use **Space Grotesk + Inter**. Two type systems on one product.
5. **Logo.** Upload exists in the studio but the event page never showed it, and
   its on-page position was never defined.

---

## Locked decisions
| # | Decision |
|---|----------|
| D1 | **Dark canvas is the DEFAULT consumer-facing.** The Zora consumer dark palette is the storefront background unless the organizer opts into light (see D1a). |
| D1a | **Per-org LIGHT mode (2026-08, The Weekender).** An organizer may opt the storefront + event page into a light canvas by saving BOTH `theme.bg` AND `theme.card`. When set, those drive `--paper`/`--card` and the derived text/hairline/nav tokens flip light; when unset, the fixed dark canvas (D1) holds. Reversible per-org, no effect on other organizers. Fonts stay locked (D2); the poster hero shows the full flyer (`contain` over a blurred self-fill), never cropped. |
| D2 | **Consumer type system is locked: Space Grotesk (display) + Inter (body) + IBM Plex Mono (labels).** Organizers do NOT choose fonts — that's what caused the drift. |
| D3 | **Organizer customises exactly three things: logo, banner, accent colour.** (Plus favicon.) Everything else is the Zora system. |
| D4 | **Banner = the single hero.** A per-event `cover` image, when set, *replaces* the banner as that event's hero. Never both; no placeholder. |
| D5 | **Logo has two defined positions:** a **hero brand-mark** (chip, bottom-left of the hero) + a **header identity** (top-left, next to the store name). |
| D6 | **Checkout uses the accent, not blue.** On the branded store, the entry CTA (GET TICKET / Split) also wears the accent. |
| D7 | **Split CTA = accent on the store; the aura gradient stays inside the dedicated split flow** (`/split/*`, `/join/*`). Those screens are NOT touched. |
| D8 | **Restyle the storefront INDEX too** (dark + Space Grotesk + accent) so index + event + checkout are one brand. |
| D9 | **Theme stays single/global** for now (no per-organizer theme). |

---

## Design system (as designed)

### Canvas — Zora consumer dark (fixed)
```
--c-bg        #0A0B10     page background
--c-bg2       #0D0F17
--c-surface   #11131E     cards / buy row / checkout sheet
--c-surface2  #171A28     fields
--c-text      #EDEFF7     primary text
--c-text2     #9BA3C4     secondary
--c-text3     #5C6488     mono labels / muted
--c-line      rgba(255,255,255,.12)   hairlines
--c-line2     rgba(255,255,255,.2)
```

### Accent — the organizer's brand (from `theme.accent`)
- Source: `GET /api/storefront-theme` → `accent` (Brunch City = `#C46A28`), `secondary`.
- Applied to: primary CTAs (GET TICKET, Send payment prompt), field focus ring,
  selected network chip, price value, active links, progress fills, the hero
  fallback gradient. **Replaces every `#4C6FFF`/`#3D5AFE`.**
- Robustness: if a brand ever ships a *dark* accent, keep white CTA text (accent is
  a fill, text stays white); the canvas is always the fixed dark, so contrast holds.

### Type (fixed — organizer can't change)
- **Space Grotesk** 400–700 — headings, event title, price, store name, big numbers.
- **Inter** 400–600 — body, taglines, meta values.
- **IBM Plex Mono** — labels, eyebrows, dates, "no fees", white-label badge.
- Organizer **control-room** (the studio/dashboard) keeps **Archivo + IBM Plex Mono** — a deliberately distinct seller surface (unchanged).

### Assets (organizer-uploaded, via `POST /api/upload` → CDN URL)
- `theme.logoUrl` → hero brand-mark + header identity.
- `theme.bannerUrl` → the store hero (default for every event).
- `event.cover` → per-event hero override (already persists, PR-BS15).

---

## Screen specs

### 1. Event page — `/@handle/events/:id`
```
┌───────────────────────────────────────────┐  dark #0A0B10
│ [logo] The Brunch City            WHITE-   │  header: logo top-left (identity)
│        thebrunchcity.zora.com     LABEL    │
│ ┌───────────────────────────────────────┐ │
│ │            BANNER  (or event cover)    │ │  ONE hero (D4)
│ │ [B]  ← logo brand-mark      badge      │ │  logo bottom-left (D5)
│ └───────────────────────────────────────┘ │
│ BRUNCH · DAR ES SALAAM            (mono)   │  eyebrow
│ Seasoned Sundays — Apricot Crush           │  Space Grotesk 600, clamp(34–58)
│ Bottomless brunch on the terrace…          │  Inter, --c-text2
│ DATE  Sun 30 Aug · 12:00   VENUE  The …    │  meta grid
│ ┌──────────────────────┐  [ GET TICKET → ] │  buy row: surface card
│ │ FROM  TZS 20,000      │   (accent fill)  │  price = Space Grotesk
│ [ Split a table … → ]  (accent outline)    │  D7
│ The price is the price. No fees at checkout.│  mono
│ runs on zora           ← back to the store  │  foot
└───────────────────────────────────────────┘
```
- Fonts loaded via `<link>` (Space Grotesk / Inter / IBM Plex Mono).
- CSS vars injected inline from theme: `--accent`, `--secondary`, plus the fixed
  dark canvas vars (the module CSS consumes them).
- Hero: `event.cover` if set, else `theme.bannerUrl`, else an accent gradient.
- `seated` events keep "CHOOSE YOUR SEATS →" (accent); non-seated → GET TICKET.

### 2. Storefront index — `/@handle` (D8: restyle to match)
- Same dark canvas + Space Grotesk/Inter + accent.
- Header: logo + store name; hero banner; event cards on `--c-surface`; accent CTAs.
- Replaces the current cream/Fraunces `storefront-client.tsx` look. Keep the same
  data + layout structure; swap the palette + fonts to the system above.

### 3. Checkout sheet — `CheckoutFlow` (+ `SharePayFlow`)
- Dark sheet (unchanged structure), but **accent-driven**: focus ring, selected
  network, total, and the pay button use the accent (was blue).
- Copy/steps unchanged.

### 4. Studio branding panel — `/dashboard/storefront/studio` (confirm, not rebuild)
- Already has **LOGO / FAVICON / DESKTOP BANNER** dropzones + accent/secondary/bg
  colour pickers, saved via `PUT /api/storefront-theme`. Confirm the **logo**
  dropzone works identically to the banner (same `/api/upload` path) and note that
  logo lands as hero brand-mark + header identity. Control-room (Archivo) style.

---

## Technical implementation

### CheckoutFlow accent plumbing (the one real decision)
- `CheckoutFlow` and `SharePayFlow` gain an **`accent?: string` prop** (default the
  current blue `#4C6FFF` for backward-compat). The component sets it as a CSS var
  (`--zco-accent`) on its card root and references that var for CTA/focus/selected/
  total — one swap, no per-rule prop drilling.
- `GetTicketButton` (event-cta) gains `accent?: string` and forwards it to
  `CheckoutFlow`.
- Each page that mounts checkout already/also fetches the theme, so it passes
  `accent={theme.accent}`:
  - storefront event page (server) → `GetTicketButton accent={theme.accent}`.
  - storefront index (client) → its own checkout mounts get `theme.accent`.
  - the split flow's `SharePayFlow` gets `accent={theme.accent}` (fetched on the
    split-configure / join pages) — but the split *chrome* keeps the aura (D7).

### Files
- `apps/web/app/(app)/storefront/[handle]/events/[id]/page.tsx` + `tenant-event.module.css` — dark, fonts, logo positions, banner-hero, accent (revise PR-BS15).
- `apps/web/app/(app)/storefront/[handle]/storefront-client.tsx` — restyle to dark + Space Grotesk + accent (D8).
- `apps/web/app/components/checkout-flow.tsx` — `accent` prop + `--zco-accent` var (D6).
- `apps/web/app/(app)/events/[id]/event-cta.tsx` (`GetTicketButton`) — forward `accent`.
- `apps/web/app/components/share-pay-flow.tsx` — optional `accent` prop (store context).
- Studio: confirm only (no change expected).

### What already exists (reuse)
- `GET /api/storefront-theme` (global theme: accent/secondary/logoUrl/bannerUrl).
- `POST /api/upload` (base64 → CDN) — logo + banner + cover all use it.
- `event.cover` persistence (PR-BS15).

---

## NOT in scope
- The bill-split split-flow screens (`/split/*`, `/join/*`) — aura gradient stays (D7).
- Money logic, data model, per-organizer theme (D9).
- Organizer font choice (removed by D2).

## Verification & rollout
- Gate: `next build` clean (no new e2e — visual change).
- **Live `/design-review`** on the real URLs after deploy (`/@thebrunchcity` +
  `/@thebrunchcity/events/brunch-vol-09`) — the review that matters for a visual change.
- Rollout: implement → build → PR `develop` → merge → promote `develop → main` →
  push `mirror` (Vercel web) → deploy → live design review → fix-forward.

## GSTACK REVIEW REPORT
| Review | Trigger | Runs | Status | Findings |
|--------|---------|------|--------|----------|
| Eng Review | `/plan-eng-review` | 0 | intentionally skipped | frontend theming — no architecture/data/money surface; the right check is a live design review |
| Design | mockup review | 1 | approved | 3-screen mockup reviewed; dark + Space Grotesk + accent + logo positions locked |

**VERDICT:** Spec approved-pending-review; implement on sign-off, then live `/design-review`.

NO UNRESOLVED DECISIONS
