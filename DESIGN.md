# ZORA — Design system

Distilled from `apps/web/public/zora-tokens.css` and the shipped surfaces during
`/plan-design-review` (2026-07-23). This is the calibration reference for all
design work: reuse it, don't redesign it.

## Two modes
Zora runs two intentional visual planes. Pick by audience, never mix on one screen.

| | **Consumer** (fan-facing) | **Organizer / creator** (seller control-room) |
|---|---|---|
| Where | discovery, storefront, event, checkout, split, tickets | `/dashboard/*`, drop editor, sales, admin |
| Base | dark-native, obsidian | light-native, warm "paper" |
| Feel | premium nightlife, aura-lit | terminal / control-room, precise |

## Consumer palette (dark, default)
- bg `#0A0B10` · bg2 `#0D0F17` · surface `#11131E` · surface2 `#171A28`
- text `#EDEFF7` · text2 `#9BA3C4` · text3 `#5C6488`
- hairlines `rgba(124,160,255,.12)` / `.22`
- **blue anchor** `#4C6FFF` (structural, focus) · ice `#7CA0FF` · cyan `#3FE0FF` (success/paid)
- **sunrise aura** `linear-gradient(130deg,#D53AD8,#FF4D7D,#FF9145)` — RESERVED for primary actions + the logo "O". Never decorative.
- glass `rgba(13,15,23,.62)` + `backdrop-filter:blur(12px)`

## Organizer palette (light "paper")
- paper `#F4F1EA` · card `#FBF9F4` · ink `#0A0A0B` · hair `#DDD8CB` · mut `#8A877E`
- blue `#3D5AFE` + bluewash `#E8EBFE` · green `#1D9E75` · red `#D85A30` · amber `#EF9F27`
- white input fields on paper; sticky blurred top bar

## Type
- **Space Grotesk** (400–700) — geometric headings, consumer wordmark, big numbers.
- **Inter** (400–600) — consumer body.
- **Archivo** (400–700) — organizer/control-room sans.
- **IBM Plex Mono** — labels, codes, money, timers, meta. Uppercase, wide tracking (`.1–.28em`).
- Display "stamp" fonts (Anton) survive where deliberately set (OFFSHORE/KULTUR).

## The wordmark
`ZORA` uppercase geometric; the **O is a gradient circle** (aura fill, soft glow), theme-aware. Consumer: white letters on dark. Organizer: the login renders `zora` with a blue "o".

## Components (reuse, don't reinvent)
- **Buttons:** `.btn.aura` (primary, gradient) · blue (secondary structural) · `.ghost` (outline). Organizer primary = ink `.publish` button, hover→blue.
- **Bottom-sheet cards** (consumer): seat-map/checkout selection sheets.
- **Toggle:** `.togglebar` + `.switch` pill (organizer) — the split-enable toggle reuses this verbatim.
- **Numbered section headers** `.block-h` with a filled circle index (organizer).
- **Fields:** dark `#171A28` with blue focus ring (consumer) · white with hair border (organizer).
- **Pills/tags:** cyan=paid, blue/ice=you, aura=host, muted=pending; organizer forming=bluewash, complete=green, refund=red.

## Rules
1. Aura gradient = primary action or the logo O. Nothing else.
2. Mono for anything numeric or system (money, codes, timers, labels).
3. Consumer is mobile-first (fans are on phones); ≥44px touch targets; no hover-only affordances.
4. Every screen ships all states: default / loading / empty / error / disabled / success. Empty and error are features, not afterthoughts.
4b. **Highest-stakes info gets the highest legibility.** Money, refund terms, countdowns, and attempt-caps must NOT sit in the smallest/lowest-contrast text (`text3`/~10px). Use `text2`+ at ≥11.5px; keep tap targets ≥44px even for "Nudge / Re-send / Change" pills.
5. Money & trust copy is plain and honest — never bury refund/timing behavior.
6. Clarity over consistency when they conflict; subtraction by default.

## Voice
Confident, plain, a little swagger; trust-forward on money. Canon lines:
"The price is the price. No fees at checkout." · "Nobody plays banker." · "Your number is your ticket." · "The table's yours."
Avoid corporate/hype. See `.context/bill-split-copy-deck.md` for the full string set.
