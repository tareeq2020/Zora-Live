# Deep dive — custom tickets + WhatsApp, venue mapping, bulk issuance, QR security

**Date:** 2026-08-18 · Companion to `weekender-audit-2026-08-18.md` +
`str8up-harvest-2026-08-18.md`. Grounded in the actual code on both sides.

---

## 0. Ground truth (what's really built, verified)

- **Ticket PDF + delivery already exist.** `packages/core/src/credentials/ticket-pdf.ts`
  (`buildTicketsPdf`) renders a printable PDF; `sendCredentialEmail` attaches it +
  an inline CID QR + the human `public_ref`; SMS carries a link. Render failure
  never blocks the send. **This is a fixed-brand template, not organizer-customizable.**
- **WhatsApp is NOT a delivery channel.** `wa.me/255741099989` is only a *support
  contact*; split invites say "WhatsApp/SMS" but actually go via SMS. No WhatsApp
  Business API anywhere.
- **The buyer seat-map is a MOCK.** `apps/web/.../events/[id]/seats/seat-map.tsx`
  is a gorgeous pan/zoom SVG venue with GA/seated/table selection, an 8-min hold
  countdown, cart, and a bill-split toggle — but seats/tables are invented by a
  **seeded RNG** (`genSeats`/`genTables`), holds are a **client-side timer**, and
  "LOCK & PAY" just shows a done sheet. **No order, reservation, or credential.**
  It reads only the real *zones* (rect + type + price) from `/api/events/:id/floorplan`.
- **The floor-plan builder persists zones only** (`type: ga|seated|table`, price,
  rows×perRow or tables×perTable) — no per-seat/table inventory units.
- **Real credentials only come from checkout** (GA/VIP) or the **bill-split**
  completion (`split.ts`: one `table_split` reservation, N `split_share` payer
  orders, credentials minted once when the last share settles). Credentials carry
  `seat_index` + `table_no` but are **not bound to a specific map position**.
- **QR is a static signed token:** `zora:<code>:<sig>`, HMAC-SHA256 over
  `code.tier.tableId.eventId`, key-list rotation, offline-verifiable, no PII. Gate
  is first-scan-wins (row lock) → AMBER on re-scan; two-step scan→wristband.

---

## 1. Custom ticket designs (organizer-authored) + WhatsApp delivery

### 1a. Custom ticket designer
The credential (QR + `public_ref`) is sacrosanct — always present, always legible.
Customization *decorates around* a non-removable QR/ref zone.

**Two tiers:**
- **v1 — themed template (recommended first).** Organizer picks a preset layout +
  colors + logo + banner (reuse the per-org theme fields already on the `organizer`
  table, migration 0018). Server resolves a `TicketTemplate` per event/org and
  renders. Low risk, ships fast, covers 90% of "make it look like ours."
- **v2 — canvas designer.** Drag/drop layout stored as JSON → render engine. Higher
  effort; only if organizers demand pixel control.

**Render pipeline unification.** Zora already has both an SVG ticket renderer
(`tickets.module.ts` `ticketSVG/ticketPNG` with query overrides for live studio
preview) and a PDF renderer (`ticket-pdf.ts`). Unify: **one template → SVG →
{PNG for share/WhatsApp/live-preview, PDF for print}**. The studio already does live
field-override preview — extend it to preview the *theme* (colors/logo/layout) live,
matching the "live preview on dashboard" ask in the meeting notes.

**Design constraints to lock (eng/design review):** the QR + `public_ref` occupy a
fixed protected region a template can position but not remove or shrink below a
scannable size; A5 print + a square share image; WinAnsi/Unicode font caveat is
already handled in `ticket-pdf.ts` (drop-non-Latin today; fontkit upgrade later).

### 1b. WhatsApp delivery
Business-initiated ticket delivery = a **WhatsApp Business Platform** integration
(Meta Cloud API directly, or a BSP: 360dialog / Gupshup / Twilio / WATI). TZ
availability + pricing must be confirmed with a provider.

**Mechanics that matter:**
- Ticket send is *business-initiated* → needs a **pre-approved template** (utility
  category) plus a **media attachment** (the ticket PDF as a *document*, or the PNG
  as an *image*). Free-form only inside the 24h session after the user replies.
- **Deliver a link, not just an image** (str8up's proven pattern): message = ticket
  media + a hosted ticket page (`/t/<ref>` or a tokenized `/claim/<token>`) so it's
  re-openable and, critically, can host the **live/rotating QR** (see §4).
- **Fallback chain:** WhatsApp → SMS link → email. The `public_ref` + hosted page is
  the universal fallback (never let a channel failure lose the ticket).
- **Architecture:** add a `whatsapp` driver beside `EMAIL_DRIVER`/`SMS_DRIVER`; a
  `sendCredentialWhatsApp(to, tickets)`; fan-out through the **existing BS45
  broadcasts worker** + suppression list. Opt-in: phone is already collected at
  checkout; capture a WA-consent flag.

**Open decisions:** (a) direct Cloud API vs BSP (cost, TZ number provisioning,
template approval lead time); (b) send the PDF document vs a branded image + link;
(c) consent + opt-out capture; (d) per-message cost ownership (organizer vs platform).

---

## 2. Venue mapping — make the mock real (the "superior" ambition)

**Reframe:** Zora's venue mapping isn't "improve str8up's" — the buyer selection UX
is *already better* than str8up (str8up sells fungible tables + admin assigns the
physical number **after** sale; Zora's map lets the buyer pick **the specific
table/seat**). The problem is Zora's version has **no backend**. So this is
*greenfield inventory + reservation behind an excellent existing UI*, borrowing
str8up's engine parts.

**What str8up contributes:** `venue_table` (a physical unit with label/zone/coords),
atomic unique assignment (`SELECT … FOR UPDATE` + `unique(assigned_order_id)`),
floor-plan import + bulk xlsx define/assign, `seating.ts` per-seat credentials +
name/invite (self-entry), `booking.ts` soft-reservation TTL + auto-release sweep,
buyer-account gate. But str8up assigns physical tables **post-sale**; Zora binds them
**at selection**.

### The synthesis — three layers (this is the answer to the eng-review question)

The reconciliation isn't "split **or** booking" — they answer *different* questions
and stack cleanly:

1. **Selection / inventory layer (NEW — the missing backend).** Each drawn seat/table
   becomes a real **unit** (`venue_unit`: state `available|held|reserved|sold`,
   bound to a zone + tier + map coords). Tapping table T7 does a **server hold on
   that specific unit** (`SELECT … FOR UPDATE`, exactly one tap wins — mirror
   `scanCredential`'s race handling). Replaces the RNG `genSeats/genTables` and the
   client-only timer with `/api/events/:id/seatmap/state` + a real TTL hold.
2. **Payment layer (KEEP Zora's split).** Once a specific unit is held, the buyer
   either **pays in full** (one order) or **splits** (`table_split`/`table_share`,
   each seat its own payer). The only change: the split reservation points at a
   **specific `venue_unit`** instead of decrementing a fungible tier pool.
3. **Seat-management layer (ADOPT str8up's `seating.ts`).** After payment, name/invite
   each seat via self-entry; the credential carries the **specific table label +
   seat index** the buyer already chose — so **no admin post-assignment step** (Zora
   leapfrogs str8up here).

Net: **buyer-chosen physical placement AND bill-split, both real** — neither
platform has that today.

### Eng-review decision agenda (resolve before building)
- **a. Granularity first cut:** table-level units first (simpler; fits Weekender
  VVIP tables + yacht packages) with seat-level selection as v2? Or seats from day 1?
- **b. Hold mechanism:** extend `inventory_hold` to unit-level (one hold row per
  unit) vs a new `seat_hold`; TTL + sweep reusing `splitAwareExpirySweep`'s pattern.
- **c. Re-point split:** `table_split` currently reserves from a tier pool → change
  to lock a specific `venue_unit`. (Splitting the cost of a *chosen* table is exactly
  the point — this strengthens the split story.)
- **d. Mixed cart:** the map cart mixes GA (pooled qty) + specific seated/table units.
  Checkout must place a pooled hold AND unit holds **atomically** (one tx).
- **e. Oversell/concurrency:** two buyers on T7 → exactly one hold wins; the map must
  render **server-truth** unit states (poll or subscribe), never RNG.
- **f. One-reservation-per-account + paid-account gate:** adopt str8up `buyer-auth.ts`
  (the notes require "table reservations require a paid account; one per account").
- **g. Venue library:** once units are real, str8up's SVG import + xlsx bulk-define
  feeds a **reusable venue template** (pre-load Dome/Serena) an event clones — the
  notes' "pre-load major Dar venues" ask.

**Recommendation:** v1 = **table-level real units** (pick a specific table → hold →
pay or split → name seats), composing Zora's split (money) + str8up's seating
(post-pay) + the one new per-unit inventory concept. Seat-level selection = v2.

---

## 3. Bulk ticket creation (separate from comps)

**The distinction is the whole point:**
- **Comps** (str8up `comps.ts`): 0-value, **bypass inventory** (over-cap allowed),
  **never** in money aggregates. For guests/artists/crew/sponsors-as-courtesy.
- **Bulk** (str8up `offplatform-import.ts`): **real sales paid off-platform**
  (cash/agent/bank/sponsor wire) → **consume inventory** (never oversell), **count in
  money/reporting**, marked `channel='offplatform'`. For wakala cash reconciliation,
  corporate/sponsor blocks (Wakanow), and **pre-loading offline sales before gate**
  (the CRDB lesson from the notes).

**Shape:** organizer uploads xlsx/csv (name, phone, email, tier, qty) → **parse +
preview** (validate, dedupe on name+phone+tier, writes nothing) → **commit** → mint
`issued` credentials consuming the pool, one order per recipient → deliver combined
PDF/link over email/SMS/WhatsApp. Two-step so the organizer reviews every row.

**Key policy decision (eng review):** do off-platform bulk sales count toward
organizer **revenue/commission** and the **payout balance**? They're real sales
(count for reporting) but the cash never flowed through Zora's gateway → they should
be **reconciliation-only**, flagged `channel='offplatform'`, and **excluded from the
withdrawable balance** (Zora never held that money). This mirrors str8up's remittance
handling and must be explicit or it corrupts payouts.

**Reuse:** lift `offplatform-import.ts`, generalize event+tier (drop the GA/VIP enum),
wire to the org dashboard + the delivery channels. Inventory via Zora's existing
`placeHold`/`convertHolds`. Heavier sponsor/wire settlement = `corporate.ts` later.

---

## 4. QR security — rotating, screenshot-resistant, still offline

**Today's exposure:** the QR is *static*. First-scan-wins + AMBER-on-rescan limits
resale, but a leaked screenshot used **before** the real owner arrives still admits
the thief and burns the owner. The ask: a dynamic/rotating QR (WhatsApp-web style).

**The core tension:** true WhatsApp-web rotation needs the **display device online**
(it long-polls a fresh token every ~20s) — but event gates are exactly where
connectivity dies, and Zora/str8up deliberately built **offline-verifiable** gates.
A naive "always-online rotating QR" fights that requirement.

### The resolution: TOTP-style rotating QR (rotating **and** offline)
Embed a **time window** in the signed claims. The ticket **app/PWA** computes, and
animates every ~30s, a QR of `code : window : sig`, where
`sig = HMAC(key, code.tier.tableId.eventId.window)` and `window = floor(now/30s)`.
The scanner recomputes the expected `sig` for the **current window ±1** — **fully
offline, no network**, exactly like Google Authenticator/TOTP. A captured screenshot
is **stale within ≤30–60s** and can't be regenerated without the signing key.

**What this changes:**
- The **live ticket is a page in the Zora app/PWA** (or the hosted `/t/<ref>` page)
  that renders the ticking QR. A flat PDF/image/screenshot becomes a **lower-trust
  fallback** (static QR still verifies, but staff are trained "if it's not ticking,
  it's a screenshot" — the WhatsApp-web tell).
- **No new secret to distribute:** scanners already hold the signing key; the window
  is just time. Requires rough clock sync (±1 window tolerance) — fine offline.
- **Interacts cleanly with the existing gate:** rotation only matters at the *agent
  scan*; after scan→wristband the physical band is the credential and the QR is moot.
  So the resale window rotation closes is precisely the pre-entry window.

### Options table
| Approach | Screenshot-resistant | Works offline at gate | Cost |
|---|---|---|---|
| Static signed QR (today) | ✗ | ✓ | — |
| **TOTP-style rotating QR (recommended)** | ✓ (≤60s stale) | ✓ | app/PWA live-render + window term |
| Server-rotating (true WhatsApp-web) | ✓✓ | ✗ (needs wifi both sides) | option for wifi'd VVIP only |
| First-scan-wins + wristband (today) | partial | ✓ | already shipped |

### Recommendation + honest limit
- Keep the **static signed QR as the offline base + fallback** (never break the gate).
- Add a **rotating TOTP-style live QR** in the app/PWA for the primary path; window
  in the claims, scanner accepts current ±1, offline. Add a **countdown ring / live
  clock / holder name** so a static screenshot visibly lacks the motion.
- **Honest limit:** rotation defeats *static screenshot resale*, not *lending your
  unlocked phone*. The wristband handoff + first-scan-wins + optional name/photo on
  the pass close the remainder. No QR scheme alone solves physical phone-lending.

**Open decisions:** (a) mandate app/PWA for the live QR while keeping PDF as
supervisor-fallback? (b) window size vs offline clock-skew tolerance; (c) do we also
offer server-rotation for wifi'd indoor VVIP; (d) does the hosted `/t/<ref>` page
(also the WhatsApp/SMS fallback link, §1b) render the live QR — yes, that unifies
delivery + security.
</content>
