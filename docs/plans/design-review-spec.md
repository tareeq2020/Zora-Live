# Design spec — Zora roadmap surfaces (plan-design-review, 2026-08-05)

Calibrated to `DESIGN.md` (3 planes: Consumer dark · Control-room dark [unified] · Door). Closes the state/responsive/flow gaps the plans left implicit. Design completeness: **4/10 → 9/10** after folding this in.

## Cross-cutting (every surface)

- **Six states, always** (DESIGN.md rule 4): default · loading (skeleton, not spinner-only) · empty (warm line + a primary action, never "No results.") · error (plain cause + a recover/retry) · disabled · success.
- **Responsive, designed not asserted:** mobile-first. Sidebar → hamburger drawer < 900px. Tables → stacked cards < 620px. Touch targets ≥ 44px. No hover-only affordances.
- **Money / codes / timers** in IBM Plex Mono, ≥ 11.5px, ≥ `text2` contrast (rule 4b) — never in the smallest/lowest-contrast text.
- **Aura gradient** only on the primary action, the logo O, or the scanner "escalate to supervisor" state. Nothing decorative.

## #9 Admin port + dashboard unify — the migration (highest risk)

- **AdminShell:** left **sidebar** — Overview · Organizers · Verification · Events · Orders & Carts · Payouts · Scanner users · Broadcasts · Payments routing · Media · Access. Collapsible; active section highlighted (trunk test). Impersonation banner pinned top when active. Shared `AdminTable`/`AdminCard`/`useAdminResource` so every section inherits the six states + responsive table→card for free.
- **Light→dark re-skin of a LIVE surface (flag):** the organizer dashboard + drop editor migrate `--paper`/`--card`/`--ink` (cream) → the dark control-room token set. Every shipped component re-themes: KPI cards, the net-earnings copy (BS33), the split/on-sale toggles, tier editor inputs, status pills (live/draft/archived), archive/delete/restore buttons, the "hidden — no tickets on sale" warning. **Ship the unify as its own reviewable PR** (not silently inside the port); QA each organizer surface against its current behavior before deleting the light palette. Regression-verify: dashboard KPIs, sales page, drop editor, all under real traffic.

## #7 Payout (money — rule 4b)

- **Organizer:** balance card first — big **mono** figure + currency + "net of X% Zora commission" context; then "Request withdrawal" (amount ≤ balance, currency, momo/bank reference note); then history (status pills: requested/approved/paid/rejected, mono amounts). Hierarchy: balance → action → history.
- **States:** zero balance ("Nothing to withdraw yet — earnings from paid orders show here."); below-minimum; a pending request open (disable re-request, show "1 request pending"); refund-reduced balance surfaced honestly; error.
- **Admin:** payout queue (org · mono amount · currency · requested-at) → confirm (enter reference + FX for non-settlement currency) / reject (reason). Empty queue state.

## #4 Registration + pending

- **Signup (phone-OTP, Google deferred — no button v1):** phone → OTP → org name + **handle picker with live availability** + reserved-handle error. States: OTP sent / invalid / expired / resend cooldown; handle taken/reserved.
- **Pending state (not a dead-end):** dashboard banner — "Verification pending. You can build drafts now; publishing and withdrawals unlock once a Zora admin approves you." (rule 4b legibility, primary CTA = "Set up your first drop").

## #5 Verification queue (admin)

- Queue of pending orgs (name · handle · `self-signup` marker · submitted-at) → review drawer (org details + any KYC docs) → **Approve** (unlocks sell + payout) / **Reject** (reason → org notified per existing KYC copy). Empty state ("No organizers waiting").

## #1 Scanner PWA — state completeness (aesthetic locked in DESIGN.md "Door")

Screens: sign-in (code → scoped session) · live scan (viewfinder + full-screen result takeover) · agent "scanned — hand to supervisor" · supervisor confirm queue · settings/sign-out.
States: **VALID** (solid green, ✓, name/tier, haptic) · **USED / INVALID / WRONG-EVENT** (solid red + plain reason + who/when) · **NEEDS-SUPERVISOR** (aura) · **OFFLINE** (amber dot; agent HMAC-verify still works, confirm queues) · **CAMERA-DENIED** (permission prompt + manual code-entry fallback) · **NO-MATCH**. Result auto-dismisses ~2s / tap. One-handed, ≥44px, reduced-motion respected, near-zero ambient motion.

## #2 Messaging composer (one component, both consoles)

Flow: **audience picker** (org: this event / this tier / all my customers — admin: all / by-org / by-event) with a **live recipient count** → channel toggle (SMS / email / both) → SMS body + email body (separate fields) → **cost-confirm gate** (est. SMS cost + recipient count shown before send is enabled) → send → history (per-broadcast aggregate sent/failed).
States: audience = 0 ("No recipients match this filter.") · over monthly SMS cap (blocked + why) · send-failure · suppression/opt-out note. **Verification-gated** — a pending org can compose but not send.

## #8 Discover redesign (consumer dark — apply the home ethos)

Apply DESIGN.md Consumer plane: dark `#0A0B10`, Space Grotesk, the orb mark, shimmer accents, **particles behind content** (subtle, reduced-motion aware), **aura reserved** for the primary CTA. Keep the function: search + city/category filters + event grid + "launch your storefront" organizer CTA.
- **Cards:** cover-forward — image · name · date · venue · **FROM price (mono)** · SPLITTABLE badge where relevant. Mobile-first grid (1-col → 2 → 3).
- **States:** empty search ("No events in {city} yet — try another city."), loading (skeleton cards), error. Stays a **listing**, not a teaser (locked).

## Remaining sequencing note
The **light→dark dashboard unify** is the one item that touches shipped, revenue-adjacent surfaces — do it as a discrete, QA'd PR early in #9, not folded silently into the port. Everything else is net-new and low-regression.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 21 issues folded, 3 critical money/auth gaps closed |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues → folded | score 4/10 → 9/10; state/responsive/flow specs added for 7 surfaces; the light→dark dashboard-unify flagged as a live-surface migration |

**CODEX:** not installed (outside voices not run for this design pass — the design language was pre-locked via `/design-consultation` this session).
**VERDICT:** ENG + DESIGN CLEARED — plans hardened and ready to implement. The scanner aesthetic is set in `DESIGN.md` (Door plane); all other surfaces apply the locked Consumer / Control-room systems.

**UNRESOLVED DECISIONS:**
- Ship the organizer dashboard **light→dark unify** as its own QA'd PR (not silently inside the #9 port) — sequencing to confirm at implementation time.
