# Share your store / Share your drop — the organizer virality banner

## Why
Every organizer already has an audience — that's why they're an organizer. Today
Zora does nothing to turn that audience into Zora's growth. The store address
(`zorapass.com/{handle}`) and each drop are shareable, but nothing on the dashboard
*prompts* the share, composes it, or makes it look designed. In Dar es Salaam the
channel that actually moves tickets is **WhatsApp Status**, then Instagram Stories —
not a copied link. The gap: no prompt, no ready-made asset, no one-tap to the
channel that works.

Classifier for this review: **APP UI** (the banner lives in the organizer console,
Control-Room v2) with **one MARKETING-flavored artifact** (the share card, which is
consumer-plane, brand-forward). App-UI rules govern the banner; the card is a
brand-first composition.

## THE VIRALITY MOMENT — "It's live. Now flex it."
The emotional peak we design around. The instant a drop goes live (or the first time
an organizer opens Home with a live drop), the console greets them — not with a
generic "share" widget, but with the feeling of *"I made a thing and it looks
real."* One tap puts a designed card on their WhatsApp Status. Every share carries
`zorapass.com/{handle}`, so **the audience they bring compounds into an audience
they share** (the home-page promise, made literal).

The loop that makes it viral (k-factor path):
```
Organizer publishes ──▶ "It's live — flex it" (dopamine → share)
        │ one tap: WhatsApp Status (a designed card, not a screenshot)
        ▼
Their audience sees it ──▶ taps zorapass.com/{handle} or the event
        │ GET PASSES (+ buyers get "bring your crew" table-split share)
        ▼
Buyer buys ──▶ buyer shares to their crew ──▶ loop
```
The organizer share is the *seed*; the buyer "bring your crew" share is the
*multiplier*. This plan builds the seed and wires the existing multiplier.

## The feature
A slim, always-present **"Share your drop" prompt bar** at the very top of the
organizer Home (`/dashboard/overview`), that expands into a share sheet with an
**auto-rendered, server-side share card** so the post looks intentional.

---

## Pass 1 — Information Architecture (6 → 9)
The banner must not bury the KPIs (the current #1 on Home). It's a **slim prompt
bar**, not a full hero. Home hierarchy:
```
/dashboard/overview
┌───────────────────────────────────────────────────────────┐
│ ① SHARE PROMPT BAR  (slim, full-width, first thing)        │  ← new
│    default:  "🟢 The 14th is live — share it"  [Share ▸]   │
│    expanded: card preview + WhatsApp • IG • Copy • Download │
├───────────────────────────────────────────────────────────┤
│ ② KPI stat-tile row (Revenue · Sold · Avg · Conv · In)     │
│ ③ Hero chart (revenue over time)                           │
│ ④ Recent orders · Your events tables                       │
└───────────────────────────────────────────────────────────┘
```
Constraint worship — if the bar can show only 3 things: (1) *which* drop is live,
(2) that it's live now, (3) the one Share action. Everything else lives in the
expanded sheet. The bar is one row tall collapsed; expanding pushes content down,
never covers it.

## Pass 2 — Interaction states (4 → 9)
What the user SEES (not backend):
```
STATE          | WHAT THE USER SEES
---------------|--------------------------------------------------------------
loading        | The bar renders instantly with a skeleton drop-name chip;
               |   Share button disabled with a soft pulse until data lands.
no drops yet   | "Your store is live at zorapass.com/{handle} — publish a drop
               |   to share it." Primary: [Create your first drop]. Still lets
               |   them share the STORE (secondary, quieter).
drafts only    | "{Draft name} is a draft. Publish it to share it live."
               |   Primary: [Finish & publish] → editor.
one live drop  | "🟢 {Drop} is live — share it" [Share ▸]. Default target = drop.
multiple live  | Same, newest live drop named; expanded sheet has a small
               |   switcher (● this drop / ○ another / ○ my store).
expanded/share | Card preview (brand-matched) + WhatsApp (dominant) · IG Stories
               |   · Copy link · Download. Live "{N} going" only when strong (D4).
card rendering | Preview shows a shimmer placeholder ~300ms; if the card route
               |   fails, the sheet still offers Copy link + the store link (never
               |   a dead end).
success (copy) | Toast "Link copied" (aria-live polite), 2s.
success (share)| After returning from WhatsApp, a quiet "Shared 🎉 — nudge again
               |   after your first sales" (sets up the repeat).
error          | "Couldn't build the share image — copy your link instead"
               |   [Copy zorapass.com/{handle}].
```

## Pass 3 — User journey & emotional arc (5 → 9)
```
STEP | USER DOES                | USER FEELS         | PLAN SUPPORTS IT WITH
-----|--------------------------|--------------------|----------------------------
1    | Hits Publish on a drop   | pride, momentum    | Post-publish, Home opens with
     |                          |                    | the bar EXPANDED on that drop.
2    | Sees the share card      | "this looks real"  | Brand-matched card (their cover,
     |                          |                    | colors, logo) — designed, not a
     |                          |                    | screenshot.
3    | Taps "Share to WhatsApp" | low-effort, sure   | One dominant button; prefilled
     |                          |                    | text + link; opens Status.
4    | Returns to the dashboard | accomplished       | "Shared 🎉" + a soft nudge to
     |                          |                    | share again after first sales.
5    | First sales land         | validation         | KPI count-up + (later) a "first
     |                          |                    | sale — share the momentum" nudge.
```
Time-horizons: **5s** the bar reads in one glance (green dot + drop name + one
button). **5min** sharing feels like one obvious tap, not a social-icon maze.
**5-year** every share teaches the org that Zora makes them look good and grows
their crowd — the reflective reason they stay.

## Pass 4 — AI-slop avoidance (7 → 9)
Hard-rejection risks and how we avoid them:
- NOT a symmetric row of social icons-in-circles (AI-slop #2/#3). ONE dominant
  **WhatsApp** action (branded green, full-width on mobile); IG/Copy/Download are
  secondary text-buttons, not equal-weight circles.
- The share **card is a real composition** matched to the org's storefront theme
  (their cover, accent, logo), NOT a Zora template with the name dropped in — so no
  two orgs' cards look the same.
- No decorative blobs/grad* behind text; the aura gradient appears ONLY on the
  primary Share action + the logo O (DESIGN.md rule 1).
- Copy is product language, not hype: "The 14th is live — share it", never "Unlock
  your audience".

## Pass 5 — Design-system alignment (6 → 9) — calibrated to DESIGN.md
- **Banner = a new CR component, `CrPromptBar`** (control-room plane): `--cr-card`
  surface, `--cr-hair` bottom border, `--cr-ink`/`--cr-ink2` text, the drop-state
  dot uses `--cr-green` (live). Primary Share button is the ONE place the banner
  spends the aura gradient (rule 1). Reuses `CrDrawer` for the mobile expanded sheet.
- **Share card = consumer-plane, brand-forward.** It READS the org theme
  (bg/card/accent/logo already stored) so it matches the storefront the buyer lands
  on. It does NOT change storefront rendering or theme mechanics — it's a separate
  render target. Type: Space Grotesk display + IBM Plex Mono for the URL/`{N} going`,
  per DESIGN.md.
- Money/count in mono ≥11.5px (rule 2/4b). One accent = the org's own.

## Pass 6 — Responsive & accessibility (3 → 9)
```
VIEWPORT        | LAYOUT
----------------|---------------------------------------------------------------
desktop ≥900px  | Slim bar; "Share ▸" opens an inline expanded panel below the bar
                |   with the card preview left, channel buttons right.
tablet          | Same bar; expanded panel stacks card over buttons.
mobile <900px   | One-line bar (dot + drop name + Share); tap opens a bottom-sheet
                |   (CrDrawer) with the card preview and a full-width WhatsApp button
                |   first, IG/Copy/Download below.
```
A11y: the bar is a `<section aria-label="Share your drop">` landmark with a real
heading; all actions are `<button>`/`<a>` ≥44px; tab order = drop switcher →
WhatsApp → IG → Copy → Download → close; the share-card preview `<img>` has alt
("Share card for {drop} — {N} going"); the copy-link toast and the "{N} going" count
update via `aria-live="polite"`; drawer is focus-trapped (CrDrawer already is);
contrast ≥4.5:1 on all text; respects `prefers-reduced-motion` (no card shimmer).

## Pass 7 — Resolved decisions (autorun)
- **D1 — Persistent, not dismissable, but adaptive.** The bar is always present
  (it's the growth engine; a dismissable one gets dismissed once and never seen),
  but it's *slim and context-changing* (expands post-publish, collapses to one line
  otherwise) so it never becomes banner-blind wallpaper. *(Principle: subtraction +
  trust — respect attention without hiding the lever.)*
- **D2 — Server-rendered og:image**, a `GET /api/share-card/{handle}[/{eventId}].png`
  route, so the SAME image is the WhatsApp/link **unfurl preview** AND the download.
  Client canvas can't produce an og:image; the unfurl *is* the viral surface, so it
  must be server-rendered. *(Principle: the moment lives where the link is pasted.)*
- **D3 — Default to the newest LIVE drop** (a specific event converts better than a
  store), one-tap toggle to "share store"; no live drop → share store. *(Hierarchy
  as service — push the freshest live thing.)*
- **D4 — Show "{N} going" only at a threshold (≥10); below it show a neutral hype
  line, not a weak number.** "2 going" hurts conversion. *(Trust — social proof is
  strong or absent, never weak.)*

---

## What already exists (reuse, don't reinvent)
- CR shell + tokens + `CrDrawer` (BS73) — the bar and mobile sheet build on these.
- The org **theme** (bg/card/accent/logo/banner) already stored per org — the card
  reads it; no storefront change.
- `zorapass.com/{handle}` path convention (BS83) + event pages already have GET
  PASSES and the buyer **table-split "bring your crew"** share — the multiplier is
  already built; this plan wires the seed to it.
- `DESIGN.md` Control-Room v2 (banner) + Consumer plane (card).

## NOT in scope (deferred, with rationale)
- **Buyer post-purchase "bring your crew" prompt** as a dedicated screen — the
  split-share exists; a dedicated buyer viral prompt is its own pass.
- **Referral attribution / rewards** (measure shares → sales → payouts) — phase 2;
  needs an attribution model, not just a share button.
- **Scheduled "your event is in 3 days — remind your list" nudges** — depends on the
  broadcasts backend; separate.

## Implementation Tasks
Synthesized from the findings above.

- [ ] **T1 (P1, human: ~1d / CC: ~30min)** — `CrPromptBar` — the slim adaptive share
  bar on `/dashboard/overview`, states from Pass 2, IA order from Pass 1.
  - Surfaced by: Pass 1 + Pass 2. Files: `apps/web/app/(app)/dashboard/overview/*`,
    `apps/web/app/components/cr/*`. Verify: renders in every state; KPIs not buried.
- [ ] **T2 (P1, human: ~1d / CC: ~30min)** — share-card route —
  `GET /api/share-card/{handle}[/{eventId}].png` (+ og:image on the event/store
  pages), brand-matched, 9:16 and 1.91:1. Surfaced by: D2. Files: `apps/api/src/*`.
  Verify: WhatsApp/link unfurl shows the card.
- [ ] **T3 (P2, human: ~3h / CC: ~15min)** — channel actions — WhatsApp `wa.me` deep
  link (dominant), IG Stories (download + open), Copy (aria-live toast), Download.
  Surfaced by: Pass 4 + Pass 6. Verify: mobile bottom-sheet, 44px targets.
- [ ] **T4 (P2, human: ~2h / CC: ~10min)** — post-publish expand + "{N} going"
  threshold (D4) + "Shared 🎉" return nudge. Surfaced by: Pass 3 + D4.
- [ ] **T5 (P3, human: ~2h / CC: ~10min)** — a11y + responsive polish (landmark,
  focus order, reduced-motion, contrast). Surfaced by: Pass 6.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | skipped | no OPENAI/codex key (informational) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | not yet run — recommended next (share-card route) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score 5/10 → 9/10, 4 decisions resolved (D1–D4) |

Passes: IA 6→9 · States 4→9 · Journey 5→9 · AI-slop 7→9 · Design-sys 6→9 · Responsive/a11y 3→9. Overall 5→9.
Mockups: AI generator unavailable (no OpenAI key) — text review; ASCII IA + state/journey tables stand in.

**VERDICT:** DESIGN CLEARED — the share/virality banner is design-complete (9/10). The virality moment ("It's live. Now flex it.") is specified end-to-end: seed (organizer share card) → existing multiplier (buyer bring-your-crew). Eng review recommended next for the server share-card/og:image route (T2).

NO UNRESOLVED DECISIONS
