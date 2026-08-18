# Weekender Audit — What we have vs. what the notes require

**Date:** 2026-08-18 · **Trigger:** Zora × Weekender walkthrough + "deploy a testing
environment by Friday" commitment. **Method:** code-verified against `apps/api`,
`apps/web`, `db/migrations` (20 migrations), and the existing roadmap docs
(`docs/plans/*`, `MIGRATION-PLAN.md`). Legend: **✅ shipped** · **🟡 partial /
planned** · **🔴 net-new** (not built and not on the current backlog).

The platform is materially more built than the migration plan implies: a real
Postgres catalog (`event → product_tier → price_version → inventory_pool`),
atomic inventory holds, bill-split tables, refunds-to-inventory, KYC gating,
impersonation, audit, x-bridge payments, two-step gate scanning, per-org theme,
and org self-registration are all **shipped**. The gaps for Weekender are
concentrated in **multi-day bundles, per-yacht sub-inventory, comps, and
table-level reservation** — plus a short list of go-live cleanups.

---

## 1. Feature gap matrix (mapped to the meeting notes)

### Organizer account setup
| Requirement | State | Evidence / gap |
|---|---|---|
| Self-serve organizer signup | ✅ | `org/org-register.controller.ts` — phone-OTP register → `status:pending, kycStatus:unverified`. Google OAuth deferred (cluster-A #4). |
| Verification before selling | ✅ | KYC gate `I6` in `org-events.controller` — publishing a sellable drop requires `kycStatus==='approved'`. |
| Suspended-org lockout | ✅ | `I2` re-reads org on every write. |
| Onboarding flow | ✅ | `dashboard/onboarding/page.tsx`. |

### Event creation & ticketing
| Requirement | State | Evidence / gap |
|---|---|---|
| Create event, drafts, publish | ✅ | Draft needs only a name; publish enforces full fields + tiers (`org-events.controller`). |
| Ticket types: VIP / regular / early bird / table | ✅ | Arbitrary named tiers; `splitEnabled` = table tier. |
| Per-tier capacity, sold-out, live inventory | ✅ | `inventory_pool` + `poolSnapshots` (sold from `sold_count`, C2). |
| Table packages / bill-split | ✅ | `table_split` / `table_share`, hold window (BS10/BS30). |
| Cashless, no ticket without payment | ✅ | Credentials issue only via `convert_order_holds` on paid order. |
| Only Zora QR valid at gate (CRDB rule) | ✅ | HMAC-signed credentials; scanner verifies signature + event + state. |
| Card + mobile money | ✅ | x-bridge: `mobile` / `billpay` / `card` (`payments.module.ts`); admin method toggle (BS47). |
| **TZS *and* USD** | 🟡 | Currency is a per-tier field but **single-currency per event (I7)** and effectively TZS. No USD payment rail proven. |
| **Whole-weekend bundle / per-day pass ("Experiences")** | 🔴 | No multi-event bundle concept. Events are standalone; no parent "experience" that sells a pass across sub-events. **Biggest Weekender gap.** |
| **Complimentary tickets (organizer-issued, WhatsApp QR, tracked like paid)** | 🔴 | No comp-issuance path. Credentials only mint from paid orders. Not in dashboard nav. |
| **Wakala cash-collection (agent buys on behalf)** | 🔴 | `agents` concept exists but is scanner/provisioning codes — no cash-POS "sell on behalf" flow. |
| Offline sales / comps pre-loaded before gate | 🔴 | Depends on comps + wakala above. |

### Yacht / venue-collection requirements
| Requirement | State | Evidence / gap |
|---|---|---|
| **24 yachts each as its own "venue"** (image, name, capacity, package tiers) | 🔴 | Event has one `venue` string + one flat tier set. No sub-venue / per-yacht inventory unit. |
| **Sold-out indicator per yacht** | 🔴 | Sold-out is per tier, not per sub-venue. |
| Recurring monthly yacht events (2–3 yachts) | 🟡 | Can create separate events; no template/clone. |

### Branded pages & customization
| Requirement | State | Evidence / gap |
|---|---|---|
| Per-organizer branded storefront | ✅ | `storefront/[handle]`, subdomain middleware. |
| Theme colors / logo / typography per org | ✅ | `theme.module.ts` per-handle (accent/secondary/bg/card/typography), migration 0018. |
| **2–3 preset themes** | 🟡 | Free-form colors exist; no named presets. |
| **Dark/light toggle + live preview** | 🟡 | Consumer surfaces are fixed-dark; dashboard/checkout still light. Sitewide dark toggle is backlog Lane 3 (unbuilt). |
| Logo / banner upload | ✅ | `media` upload + per-event `cover`. |
| Marketplace / discover | ✅ | `/discover` (redesign planned, cluster-D). |
| **Custom domain per event** (zorapass.com/weekender) | 🔴 | Subdomain + `/@handle` alias exist; no custom-domain-per-event. Notes mark it "under discussion." |

### Seat maps, floor plans, reservations
| Requirement | State | Evidence / gap |
|---|---|---|
| Floor-plan / zone builder (organizer draws sections) | ✅ | `floorplan.module.ts` + `dashboard/events/new/floor-plan`. Per-event plans. |
| **Buyer reserves a *specific* table from the map** | 🔴 | Reservation is "tracked separately and intentionally out of scope" (migration 0020). `reserved_count` unused by checkout. Buyers pick a tier, not a table. |
| One reservation per (paid) account, time-limited hold | 🟡 | Generic inventory holds exist at checkout; no per-table, one-per-account rule. |
| **Venue library (pre-loaded Dar venues: Dome, Serena…)** | 🔴 | No reusable venue/layout catalog. |
| Ticket email/WhatsApp with full details (table, schedule) | 🟡 | Ticket render exists; day-by-day schedule + table detail not modeled. |

### Operations
| Requirement | State | Evidence / gap |
|---|---|---|
| Two-step gate scan → wristband | ✅ | Migration 0014 + `scan.controller`: agent `verify`→scanned, supervisor `confirm`→wristband_issued; scanner-user roles. |
| **Wristband color-code by day/experience + print run export** | 🔴 | State machine exists; no per-day color attribute or print/count export. |
| Bulk email/SMS to buyers | 🟡 | Backend + worker shipped (BS45, migration 0015); **organizer UI never built** (admin has a placeholder only). |
| Admin cart/order visibility | 🟡 | Migration 0016 + `admin-orders`; admin dashboard port pending (cluster-C). |
| Payouts / withdrawals | ✅ | `payouts` module + org withdrawals UI. |

---

## 2. Workstream 1 — Weekender go-live cleanup (target: testing env by Fri 21 Aug)

Small, mostly-shipped-adjacent items to get a *new organizer (Tareeq) set up and
their Weekender events live in a testing environment*. None require new
architecture.

1. **Seed the Weekender organizer + KYC-approve it** so publishing is unblocked
   (I6). Confirm phone-OTP signup path or admin-create.
2. **Upload the four Weekender events as separate drops** (Fri yacht / Sat Rhythm
   & Branch / Sun Paddle / Mon Coco) with tiers (VIP/regular/early-bird/table).
   Sunday is unconfirmed → keep as **draft**.
3. **City field**: ensure `dar` (fixed id) not free-text (backlog 0.1) so events
   show in discover.
4. **Per-org theme + logo/banner** for the Weekender storefront (already
   supported — just configure).
5. **Payments**: confirm x-bridge routing for the test env (mobile default
   CLICKPESA per prior setup) and the BS47 method toggles.
6. **Give Tareeq scoped access** (organizer login or impersonation) Friday.
7. Pull in the relevant **Lane-0 copy fixes** (backlog 0.2–0.6) if promoting the
   same build.

**Explicitly NOT solved by cleanup** (needs Workstream 2): the weekend **bundle
pass**, **per-yacht sub-venues**, **comps**, and **table reservation**. For the
Friday test env these are simulated with standalone per-day events + tiers.

---

## 3. Workstream 2 — Inputs for eng review / spec (net-new)

Ranked by Weekender-criticality. Each is a spec candidate; open questions are the
eng-review agenda.

### A. Experiences / bundles (multi-day pass) — 🔴 highest
Parent "experience" that sells a whole-weekend pass **or** individual days across
N sub-events, with one order → credentials for each included day.
- *Open:* model as parent-event + child-events vs a `bundle` product spanning
  tiers? How does inventory decrement across children? One credential per day vs a
  single multi-day credential? Refund/split semantics across a bundle?

### B. Yacht-as-venue / sub-inventory — 🔴 high
24 yachts as individually-inventoried sub-venues (image, capacity, packages,
per-yacht sold-out) under one event.
- *Open:* is a "yacht" a child-event, or a new `venue_unit` grouping tiers? Does it
  reuse the bundle model from (A)? Per-yacht package tiers = tier groups.

### C. Complimentary tickets — 🔴 high
Organizer issues a named comp from the dashboard → mints a real (unpaid)
credential → delivered by WhatsApp/SMS → tracked and scanned identically.
- *Open:* comp caps per org/event? Reuse the shipped broadcasts worker for
  delivery? Do comps draw down `inventory_pool` (they should, for gate counts)?

### D. Table / seat reservation at checkout — 🔴 high (seated events)
Buyer selects a specific table from the floor plan; time-limited hold; one active
reservation per paid account; credential carries the table.
- *Open:* extend `inventory_hold`/`reserved_count` to table granularity; wire the
  existing zone builder zones to sellable table units; interplay with bill-split.

### E. Organizer broadcasts UI — 🟡 (backend done)
Build the compose/audience/history UI on the shipped BS45 backend. Doubles as the
comp-delivery channel (C). Cluster-B #2 already specs it.

### F. USD alongside TZS — 🟡
A real USD rail (not just a label) for international Weekender buyers/sponsor.
- *Open:* dual-currency display, FX, x-bridge USD support, per-order currency.

### G. Wristband ops — 🔴
Per-day/experience color attribute on tiers/credentials + a print-run / count
export for production.

### H. Venue library — 🔴 (post-Weekender)
Pre-load major Dar venues with reusable layouts; organizers clone/edit.

### I. Custom domain per event — 🔴 (decision-gated)
`zorapass.com/weekender`. Notes flag SEO/infra assessment first — decision, then
spec.

**Also already on the backlog, converging here:** discover redesign (cluster-D),
admin dashboard port (cluster-C), sitewide dark mode + preset themes (backlog
Lane 3), point-in-time commission (cluster-A #6).

---

## 4. Recommended path

1. **This week:** Workstream 1 → test env + Tareeq access Friday (per-day events
   simulate the bundle).
2. **Eng review (`/plan-eng-review`)** on Workstream 2 A–D (the Weekender-critical
   net-new four) — resolve the modelling open questions before code.
3. **Spec (`/spec`)** A (bundles) and B (yacht sub-venues) together — they likely
   share one data model — then C (comps) and D (reservation).
4. E–I sequence behind them / fold into existing backlog lanes.
</content>
</invoke>
