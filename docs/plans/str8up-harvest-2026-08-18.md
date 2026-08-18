# str8up-ticketing harvest — what Zora can lift

**Date:** 2026-08-18 · **Source:** `billgwakisa/str8up-ticketing` (the iMbeju Sauti
Moja / CRDB concert platform, 14 Aug 2026, ~event-scale). Studied at commit
`239e2ef`. Companion to `weekender-audit-2026-08-18.md`.

## Why this is a goldmine (and the one universal caveat)

str8up is a **sibling architecture** to Zora, almost certainly same author:
- Framework-agnostic `@str8up/core` domain (identical boundary to Zora's `@zora/core`) — "route handlers touch cookies/HTTP; core owns data+logic."
- Same Postgres model: `order` / `order_item` / `credential` / `customer` /
  `product_tier` / `price_version` / `inventory_pool`, `tx()` helper, HMAC-signed
  credentials, `public_ref` human codes.
- Same rails: **x-bridge** payments, **CRDB**, Tanzania SMS/phone, Dar events.
- It **actually ran a real large event** — the code is battle-tested, not a demo.

**The one universal adaptation cost:** str8up is a **single-event, single-brand**
platform. Every module hardcodes `const EVENT_ID = "imbeju-2026"` and often a
`GA | VIP` tier enum. Zora is **multi-event / multi-tenant** with dynamic per-event
tiers. So *no module is a literal copy-paste* — each needs (1) `EVENT_ID`
parameterized to a passed event id, and (2) tier generalized from the enum to any
`product_tier.id`. This is mechanical and pervasive, not deep. Budget it per module.

**Divergence to resolve first (eng-review decision):** Zora's table model is
**bill-split** (`table_split` / `table_share`, N payers split one table). str8up's
is **booking + seat-naming + physical assignment** (one payer owns a table, names/
invites each seat, admin maps it to a physical number). These are *complementary*
but must be reconciled: do seats + venue-mapping layer on top of a split-paid
table, or is "reserve a specific table" a parallel flow? Decide before lifting D.

---

## Harvest table (mapped to Zora's gaps)

| str8up module | LoC | Zora gap it fills | Verdict | Adapt cost |
|---|---|---|---|---|
| `comps.ts` + `0022_comps.sql` | 131 | **C — complimentary tickets** | **Adapt** | Low. Generalize tier+event; reuse Zora credential engine. |
| `credentials/ticket-pdf.ts` | — | ticket delivery (comps, tables) | **Lift** | Low. Zora renders SVG/PNG only; combined multi-page PDF is new + useful. |
| `self-entry.ts` + `entry_slot` | 340 | **C delivery + D seat naming** | **Adapt** | Med. Tokenized invite→OTP→resumable self-claim; generic (seat/runner). Powers WhatsApp/SMS comp + guest naming. |
| `booking.ts` + `0011/0013` | 753 | **D — table reservation** | **Adapt** | High. Soft-reserve window, per-table payment isolation, auto-release sweep, deadlines. Must reconcile with Zora's split model. |
| `seating.ts` + `0014_table_seats` | 570 | **D — seat management** | **Adapt** | Med. Named vs invited seats, host auto-seat, per-seat PDF. Sits on booking. |
| `venue.ts` + `0016/0026` | 637 | **D + venue library + wristband detail** | **Adapt** | Med. SVG floor-plan import+tag, physical table labels (A-G12), assign sold-table→number, **public ushers' map**, bulk xlsx import/assign. Complements Zora's zone builder. |
| `buyer-auth.ts` + `0017` | 317 | **D — "reservation needs a paid account"** | **Adapt** | Low-Med. Email+password buyer accounts extending `customer`; phone-first OTP-merge (no history loss). Zora is phone-OTP only today. |
| `offplatform-import.ts` | 295 | **Wakala cash + offline pre-load** | **Adapt** | Med. Bulk "paid by cash/agent/bank" GA/VIP upload; consumes inventory, counts in money, two-step parse→commit, dedupe. Direct fit for wakala + pre-loading offline sales before gate. |
| `corporate.ts` + `0015/0018/0019` | 1484 | **Sponsor (Wakanow) block settlement** | **Study→Adapt** | High. Off-gateway wire settlement + maker-checker approval + proof upload/scan + RBAC field shielding. The pattern for a sponsor wiring $10K for a block of tables/passes. Heavy; CRDB-specific maker-checker. |
| `waitlist-notify.ts` | 183 | sold-out urgency (per-yacht) | **Adapt** | Low. Waitlist + notify-on-availability. |
| `payments/` (classify-bill, method-gate, probe, verify-webhook, bills-notify) | ~600 | payment robustness | **Study** | Zora has its own x-bridge edge; str8up's CRDB-Bills classification + method-gate + webhook verify is more mature — mine for hardening. |
| `gate.ts` / `gate-queue.ts` / `gate-sms.ts` / `scan.ts` | ~940 | gate ops hardening | **Study** | Zora already has 2-step scan→wristband. str8up adds offline queue, gate-issued SMS, self-entry-at-gate. Mine selectively. |
| `marathon.ts` | 447 | (event-specific add-on passes) | **Study only** | Loosely informs "bundle add-on / secondary allocation." |

---

## What str8up does NOT solve (still Zora-original)

- **A — multi-day bundles / "Experiences"** (weekend pass across sub-events).
  str8up is single-event; no help. Zora must design this from scratch.
- **B — yacht-as-venue sub-inventory** (24 independently-sold sub-venues + per-unit
  sold-out). Closest analog is str8up's `venue_table` (physical units under one
  event) — it **informs the modeling** (a "yacht" ≈ a sellable venue unit with its
  own pool) but the bundle + 24-way split is Zora-original.
- **Per-org theming / branded storefronts / marketplace** — Zora is *ahead* (str8up
  is single-brand CRDB).
- **Multi-currency TZS/USD** — neither platform has it.

So the harvest is strongest on **gaps C & D** and the **operational/wakala/sponsor**
items; the two hardest Zora-original items (A, B) get *modeling inspiration* but no
drop-in code.

---

## Schema deltas (all additive — str8up's own migration discipline)

Lifting these needs additive migrations onto Zora's existing tables (str8up ships
them nullable/new, migrate-before-deploy, backfill scripts — same discipline Zora
already follows):
- `credential`: `is_comp`, `comp_type`, `holder_name`, `public_ref`, `table_ref`, `entry_slot_id`.
- `product_tier`: `seat_count`, `kind='table'` (Zora has `kind` already), `drinks_package`, `sort_order`.
- `customer`: `password_hash` (+ partial unique index on `lower(email)`).
- New tables: `booking`, `entry_slot`, `venue_floorplan`, `venue_table`,
  `venue_map`, `corporate_order` + settlement/proof, comp order type.

---

## Recommended approach

1. **Feed this into the eng review** alongside the audit. For gaps C & D the
   question changes from "how do we build it" to "how do we *adapt* proven code" —
   much lower risk.
2. **Sequence the easy wins first:** `comps.ts` + `ticket-pdf.ts` + `self-entry.ts`
   give Zora complimentary tickets (gap C) with WhatsApp/SMS delivery — small, high
   value for Weekender, low reconciliation risk.
3. **Then the table stack** (`buyer-auth` → `booking` → `seating` → `venue`) as one
   workstream — but **first resolve the split-vs-booking model divergence** (the
   decision above). This is gap D end-to-end plus the venue library.
4. **`offplatform-import.ts`** for wakala/offline is a self-contained mid-size lift
   — schedule independently.
5. **`corporate.ts`** only if Wakanow (or future sponsors) actually settle by wire
   for a block — study it now, adapt when the sponsor money path is confirmed.
6. Keep A (bundles) and B (yacht sub-venues) as **Zora-original design work**;
   borrow the `venue_table` sub-unit pattern for B.
</content>
