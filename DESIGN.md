# ZoraPass — Design system

**Source of truth: [`docs/ZoraPass-Design-System-Handoff/`](docs/ZoraPass-Design-System-Handoff/00_START_HERE.md)**
(Stamp & Signal, v1.0, 23 Sep 2026). Start with `00_START_HERE.md`, then
`03_COMPONENTS/components.md`, `04_UI_COPY/ui-copy.md`, `05_SCREENS/screens.md`.
If this file and the handoff disagree, the handoff wins. This page is the short
version for engineers working in this repo (rewritten in BS119; replaces the
2026-07 obsidian / sunrise-aura system, which is retired).

## In the code
- Tokens: `apps/web/public/brand/design-tokens/zorapass.css` (`--zp-*`, generated —
  don't edit by hand) + `fonts.css`, loaded globally in `apps/web/app/layout.tsx`.
- `apps/web/public/zora-tokens.css` is a legacy alias layer only (`--c-*`, `--sans`,
  `.wordmark`) mapped onto `--zp-*`. New UI uses `--zp-*` directly.
- Logo + stamps: `apps/web/public/brand/logo/svg/`, `apps/web/public/brand/stamps/svg/`.
- No Tailwind. Each page is a self-contained scoped `<style>` block or CSS module.
- `<html data-theme>` defaults to `dark`, which flips the *semantic* `--zp-surface*`
  tokens. Fixed-light buyer pages therefore use the *primitive* tokens
  (`--zp-color-bone`, `--zp-color-board-black`, `--zp-color-signal-yellow`, …).

## Non-negotiables
- **Fonts — three, no others.** Bungee = display only, ALL CAPS, 1–4 words, **never
  below 20px**. Bricolage Grotesque = headlines, body, UI, the logo. IBM Plex Mono =
  dates, times, prices, counts, codes, pass IDs, micro-labels.
- **Colour.** Signal Yellow `#FFD21F` · Board Black `#111111` · Bone `#F7F5EE`.
  Neutrals from the tokens. Alert Red `#B42318` only for problems. No new colours.
- **Flat and printed.** No gradients, no decorative shadows, no blur/glass, no glow.
  Corners: 16px cards and buttons, 12px inputs, pills for chips.
- **Logo:** "ZoraPass", one word, Bricolage Bold, −0.035em. Never "Zora Pass", never "Zora" alone.
- **Stamp:** an SVG image at −10°, default state ZORAPASS. A status stamp only when true.
  Hero, confirmation, pass, check-in, empty states — not on every card.

## Surfaces
| | **Consumer** (buyer) | **Organizer console** | **Admin** | **Door** (scanner) |
|---|---|---|---|---|
| Where | Discover, storefront, event, checkout, confirmation, pass, split/join | `/dashboard/*` | `/admin/*` | gate-scanner PWA |
| Ground | Bone, black ink, yellow accent. Pass + confirmation are black. | Bone ground, **black sidebar** | Black ground | Black utility |
| Rule | One ground, one ink, one accent per screen | Data in mono; **one yellow accent per chart**; numbers are the design | Same components, dark | Glanceable result |

## Components (from `03_COMPONENTS`)
- **Primary button:** black block, yellow Bungee label (≥20px), right arrow 12px after
  the label (right-aligned when full width). On dark it flips: yellow block, black label.
  lg 56 / md 48 / sm 40px; full width on mobile. Hover darken, active 2px down,
  focus-visible 3px outline at 2px offset. One primary per view.
- **Secondary:** transparent, 2px black border (bone on dark), Bricolage Bold.
- **Status chip:** pill, IBM Plex Mono 12–13px, .12em, uppercase, 2px border on light
  fills (`.zp-chip--*`). One per card. Labels, not buttons.
- **Filter chip:** 40px pill, 2px border, selected = black fill + yellow label.
- **Event card:** whole card is one link; artwork 4:5 or 16:9 (never cropped into a
  shape); mono meta → Bricolage Bold 20 name → venue 14 secondary → mono price;
  "GET PASSES →" strip as the last row. Sold out stays visible, dimmed, SOLD OUT chip.
- **Pass:** black, bone ink, kind label mono → event name → mono rows → tear line → QR
  on white (≥200px) with a readable mono pass ID → brightness hint → stamp.
- **Inputs:** 48/56px, radius 12, 2px border, white, 16px text, mono label above,
  errors in words (never colour only). Phone defaults to +255.
- **Organizer statuses:** mono text with a square marker, not chips.

## Copy (from `04_UI_COPY`)
- Buy CTA is **GET PASSES**. Never BUY NOW, PURCHASE, BOOK NOW, Get tickets.
- Status words only from the handoff list (ON SALE, FEW LEFT, SOLD OUT, …), and only
  when true (FEW LEFT < 20% left, ALMOST GONE < 10%, SOLD OUT = 0).
- Money: `TSh 25,000`, `From TSh 25,000`, in mono, thousands separators always.
- Bungee lines are caps and short; everything else sentence case. Second person.
  No exclamation marks, no emoji, no campaign lines (ADMIT US., TUKO WANGAPI?) in product.
- Errors: say what happened, then what to do; never blame.

## Door / scanner
Brand chrome, utility core. Black canvas; Bricolage Grotesque for the giant result
word, IBM Plex Mono for pass details. Result = full-screen solid-colour takeover,
auto-dismiss ~2s: VALID solid green (Mtaa Green) · ALREADY USED / INVALID / WRONG
EVENT solid red with a plain reason + who/when · NEEDS SUPERVISOR yellow with black
text. Thin top strip (event · agent · offline dot). Near-zero motion; reduced-motion respected.

## Accessibility (ship gate — `03_COMPONENTS` §11)
Body ≥16px, nothing <12px · 44×44 targets · visible focus ring on everything
interactive · status never by colour alone · artwork alt text names the event,
decorative stamps `aria-hidden` · pass ID readable as text · test at 200% zoom.

## Rules
1. Mono for anything numeric or system.
2. Mobile-first; no hover-only affordances.
3. Every screen ships default / loading (skeletons) / empty / error / disabled / success.
4. Money, refund terms and countdowns get the highest legibility, never the smallest text.
5. Money and trust copy is plain and honest; never promise what the system can't do.
