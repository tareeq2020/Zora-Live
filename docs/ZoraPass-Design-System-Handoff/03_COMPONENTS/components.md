# ZoraPass component specs

Every value below is a token from `02_DESIGN_TOKENS/tokens.json`. If a number here and a token disagree, the token wins. Open `07_STYLE_GUIDE/index.html` to see all of this rendered.

## 0. Principles

1. **Flat and printed, not glassy.** Solid fills, 1–2px borders, no decorative shadows or gradients. Depth comes from colour blocks, not blur.
2. **One ground, one ink, one accent per screen.** Yellow, Black, Bone or a photo carries the screen; the other two support it.
3. **The event's artwork is never cropped into a brand shape.** It sits in a rectangle, 4:5 or 16:9, with the ZoraPass frame around it.
4. **Corners:** 16px on cards and buttons, 12px on inputs, pills for chips. Never fully rounded cards.
5. **Rhythm:** 8px base. Section padding 24 mobile / 32–48 desktop.

---

## 1. Button

The signature button is a **black block with a yellow Bungee label and an arrow**. On dark surfaces it flips to yellow with a black label.

| Variant | Light theme | Dark theme | Use |
|---|---|---|---|
| `primary` | bg `#111111`, label `#FFD21F` | bg `#FFD21F`, label `#111111` | The one action on the screen: GET PASSES, OPEN MY PASS |
| `secondary` | transparent, 2px border `#111111`, label `#111111` | transparent, 2px border `#F7F5EE`, label `#F7F5EE` | Alternatives: SEE THE LINEUP |
| `tertiary` | no border, label `#111111`, underline on hover | label `#F7F5EE` | Inline, low-stakes |
| `danger` | bg `#B42318`, label `#FFFFFF` | same | Cancel a booking, delete |
| `disabled` | bg `#BDBDBD`, label `#4A4A4A`, `cursor: not-allowed` | bg `#333333`, label `#4A4A4A` | Sold out, form incomplete |

- **Label:** Bungee, uppercase, letter-spacing 0. Two to three words, never a sentence. Body-weight (Bricolage Bold) is acceptable for small secondary buttons.
- **Sizes:** lg 56px (primary page action), md 48px (default), sm 40px (inline, filters). Horizontal padding 24/20/16. Minimum touch target 44×44.
- **Arrow:** the primary button carries a right arrow, 20px, 12px after the label, aligned to the right edge on full-width buttons.
- **Radius:** 16px. **Full width on mobile**, auto width from `md` up.
- **States:** hover = 4% darken (`#E6BD1B` for yellow); active = 2px translateY; focus-visible = 3px outline in the focus colour, 2px offset; loading = label stays, arrow replaced by a spinner, button disabled.
- **Never:** "BUY NOW", "Click here", sentence-case display labels, two primary buttons in one view.

---

## 2. Status chip

The in-UI version of a stamp state. Pill, uppercase mono, 2px border when the fill is light.

- **Type:** IBM Plex Mono Medium, 12–13px, letter-spacing .12em, uppercase.
- **Size:** height 28 (sm) / 32 (md), padding 6px 12px, radius pill.
- **Colours:** take them from `color.status` in `tokens.json` (also generated as `.zp-chip--*` classes in `zorapass.css`).
- `SOLD OUT` renders with a line through the text, by design.
- **One chip per card.** If several are true, use this priority: CANCELLED > POSTPONED > SOLD OUT > ALMOST GONE > FEW LEFT > LIVE NOW > ON SALE > JUST ANNOUNCED > ZORA PICK.
- Chips are **labels, not buttons**. If it filters, it's a filter chip: 40px, radius pill, 2px border, selected = black fill with yellow label.

---

## 3. The stamp

A circular SVG (`06_ASSETS/stamps`). It is an image, not a typeset element: never rebuild it in CSS.

- **Sizes:** 64 (compact), 96 (default), 128+ (hero and pass).
- **Rotation:** −10°. Keep it. A stamp sitting perfectly straight looks like a logo, not a stamp.
- **Inks:** black on light grounds, signal yellow on black, chalk (bone) on green or photo. Never any other colour, never a gradient, never a drop shadow.
- **Clear space:** 8% of its diameter on all sides.
- **Where it belongs:** homepage hero, purchase confirmation, pass, check-in success, empty states, the account/verified moment. **Not** on every card in a list.
- **Animation (the "stamp slam"):** from `scale(1.3) rotate(-20deg)` opacity 0 → `scale(1) rotate(-10deg)` opacity 1 over 180ms, `cubic-bezier(0.2,0.7,0.2,1)`. Use it once per screen, on entry. Respect `prefers-reduced-motion` (then just fade in 120ms).

---

## 4. Event card

The main discovery unit.

```
┌────────────────────────┐
│ [artwork 4:5]  [chip]  │  chip top-left, 12px inset
│                        │
├────────────────────────┤
│ FRI 23 OCT · 21:00     │  meta, mono 13, uppercase
│ Afro House Rooftop     │  h4, Bricolage Bold 20
│ The Terrace, Masaki    │  body-sm, secondary
│ From TSh 25,000        │  data, mono 16
└────────────────────────┘
```

- Surface: `surface-raised`; 1px border in light, none in dark; radius 16; artwork radius 12 with 8px inset, or flush to the top edge — pick one and keep it.
- The whole card is one link. Hover: border goes to `border-strong`, artwork scales 1.02 over 180ms.
- Skeleton: artwork block + two grey bars, no spinner.
- **Sold-out cards** dim the artwork to 60% and show the SOLD OUT chip. Do not hide them: sold-out events are proof the platform works.

## 5. Board row (the listings table)

The departure-board layout: this is ZoraPass's signature list.

- Columns: day (mono, 48px wide) · event name (Bricolage Bold 16–18) · area (body-sm secondary) · time (mono, right) · chip (right, optional).
- Row height 56 mobile / 64 desktop, 1px separator, no vertical lines.
- Hover: row fills `surface-sunken`; active row can carry a 4px yellow left bar.
- On mobile below 480px, drop the area column, not the time.

## 6. Pass / ticket

The one screen people show at a door. It has to work at arm's length in the dark.

- Black surface, bone ink, radius 16, full-bleed on mobile.
- Order top to bottom: kind label (`GENERAL · ADMIT 1`, mono) → event name (Bricolage Bold 24–28) → date, time, venue rows → **tear line** (2px dashed, with a 16px notch cut into both edges) → QR block.
- **QR:** minimum 200×200 on a white card with 16px padding, and a mono pass ID below it (`ZP-1023-0918`).
- Show a **brightness hint** ("Turn your brightness up") and raise screen brightness programmatically when the pass opens.
- The stamp sits bottom-right at −10°, ZORAPASS by default, CHECKED IN after a successful scan (animate the slam on that change).
- Group bookings: the header carries `ME +3 · ADMIT 4` and the four initials; each guest still gets their own QR.
- Wallet: ship Apple Wallet and Google Wallet passes — black background, yellow logo, the same fields.

## 7. Inputs and forms

- Height 48 (md) / 56 (lg), radius 12, 2px border `border`, background `surface-raised`, text 16px (never smaller: iOS zooms below 16).
- Label above the field in mono label style. Helper text 14px secondary below.
- Focus: border goes to `focus`, plus a 3px outline at 2px offset.
- Error: border and message in `danger`, message 14px, icon optional. Never colour-only signalling — always words.
- Phone number is the primary identifier in Tanzania: country picker defaulting to +255, numeric keypad, format as the user types.
- Money: `TSh 25,000` in mono, never `25000.00`. Thousands separators always.
- Quantity stepper (passes): 48×48 buttons with a mono count between them, min 1, max from the tier. Above 1, reveal the group options inline — never as a separate flow.

## 8. Navigation

**Web header:** 64px, `surface` with a 1px bottom border. Logo left (height 24–28, links home) · city selector (mono, chevron) · What's on · Organizers · Search icon · My passes / Sign in. On mobile, collapse to logo + search + menu.

**App tab bar:** 64px + safe area, four tabs — What's on · Search · My passes · Profile. Active tab: yellow icon and label, plus a 3px yellow indicator above the icon. Mono 11px labels, uppercase.

**Back:** a real back arrow at 44×44 on every pushed screen. Titles are Bricolage Bold 18, truncated to one line.

## 9. Feedback, empty and error states

- **Toast:** dark surface, bone text, 48px tall, bottom of the screen (above the tab bar), 3s. Success takes a green left bar, failure a red one.
- **Empty state:** stamp (96px) + a short Bungee line + one sentence + one button. Examples: "NOTHING HERE YET." / "No passes yet. Find something to go to." → FIND EVENTS.
- **Error state:** never blame the user. "That didn't go through. Try again, or use another payment method." Always offer the next action.
- **Loading:** skeletons shaped like the content. A spinner only inside buttons. Never a full-screen spinner over a list.
- **Offline:** the pass and the QR must render from cache with no network. Show a mono `OFFLINE` chip rather than an error.

## 10. Motion

| Moment | Motion |
|---|---|
| Stamp appears | Stamp slam, 180ms |
| Page or screen transition | 240ms fade + 8px rise |
| Chip status change | 120ms cross-fade |
| Tear line / split | The ticket separates 12px over 240ms |
| Board rows on load | Stagger 40ms per row, max 8 rows |
| Pull to refresh | Yellow progress bar, not a spinner |

Everything respects `prefers-reduced-motion: reduce` by falling back to a plain fade.

## 11. Accessibility checklist (ship gate)

- [ ] Body text is at least 16px; nothing below 12px anywhere.
- [ ] Contrast: black on yellow 13.0:1 ✓ · black on bone 17.3:1 ✓ · bone on black 17.3:1 ✓ · white on green 5.4:1 ✓ · white on alert red 6.6:1 ✓ · black on blue 5.8:1 ✓.
- [ ] **Bahari Blue on white is only 3.3:1** — use it as a background with black text, or for large text only. Never as small blue text on white.
- [ ] Bungee is a display face: never below 20px, never more than ~6 words, never for body copy or error messages.
- [ ] Every interactive element has a 44×44 minimum target and a visible focus ring.
- [ ] Status is never carried by colour alone; the chip always has a word.
- [ ] Images: event artwork has alt text with the event name; decorative stamps get `aria-hidden="true"`.
- [ ] The QR screen works with a screen reader: the pass ID is readable as text.
- [ ] Test at 200% browser zoom and with the phone's largest font setting.
