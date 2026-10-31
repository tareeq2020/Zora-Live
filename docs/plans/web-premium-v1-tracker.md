# Web Premium v1 — PR tracker (single source of truth)

> **Rule:** every PR in this programme updates this file in the same PR (status, PR link, notes). When Linear is back, this table moves there.
> Plan: [`web-premium-v1.md`](web-premium-v1.md) · Screens: https://claude.ai/artifact/YcSVYDXTZBLdTw8d5t9Fvf · Amendments A1–A22 are binding.

**Status key:** `todo` · `wip` · `review` · `merged` (on develop) · `released` (on main + mirror) · `blocked`
**Flags:** each feature ships dark and is turned on per release. Flag names are in the Flag column.

Last updated: 2026-10-31

## Releases

| Release | Contents | Flag(s) | State |
|---|---|---|---|
| R0 Safety + sync | BS114–BS118, BS121, BS124–BS125, BS139 | — | released 2026-10-31 · PR #203 |
| R1 New look | BS119–BS120 | `zp_look_v2` | wip |
| R2 Checkout v2 + tracking | BS121–BS123 | `zp_checkout_v2` | todo |
| R3 Seat maps | BS124–BS127 | `zp_seatmap` (per event) | todo |
| R4 Analytics + branded passes | BS128–BS131 | `zp_analytics`, `zp_pass_design` (per org) | todo |
| R5 Installments | BS132–BS136 | `zp_installments` (per org, OFF until x-bridge /v1 R3 ≈ 21 Nov) | todo |
| R6 Hardening + x-bridge /v1 | BS137–BS138 | — | todo |

## PRs

| PR | Title | Release | Lane | Depends on | Plan refs | Status | Link | Notes |
|---|---|---|---|---|---|---|---|---|
| — | Sync origin/develop with mirror (Reli-Tech #1–#16) | R0 | — | — | F0.6 | released | — | pushed 485af35 to origin/develop 2026-10-31 |
| BS114 | Plan, tracker, design handoff into repo | R0 | — | — | — | merged | https://github.com/tareeq2020/Zora-Live/pull/193 | docs only |
| BS115 | Safety fixes: analytics route pattern + sanitiser allowlist + eventId; floor-plan auth; GA capacity read; seat-map buyer flag; cr-tokens names/font | R0 | 0 | — | F0.1–F0.5, A9 | merged | https://github.com/tareeq2020/Zora-Live/pull/198 | floorplan-auth e2e 15/15; web build OK; seat map behind NEXT_PUBLIC_ZP_SEATMAP |
| BS116 | Order-status single owner (`core/order-status.ts`) + migrate paid-literal callers + regression e2e | R0 | 0 | — | A1, IRON RULE | merged | https://github.com/tareeq2020/Zora-Live/pull/197 | 10 statuses, 9 predicates; 6 money e2e PASS before+after. F7 must land A16 before producing installment_active |
| BS117 | Mobile: Nest attendee entry (drop Supabase) — merge `codex/week3-mobile-nest-attendee-entry` | R0 | 0 | — | F0.6 | merged | https://github.com/tareeq2020/Zora-Live/pull/194 | mobile typecheck not run (deps) |
| BS118 | Seat-map + installments migrations numbers reserved; feature-flag helper (`core/flags.ts`, settings-backed) | R0 | 0 | BS116 | A15 | merged | https://github.com/tareeq2020/Zora-Live/pull/195 | migrations reserved: 0028 seats · 0029 analytics · 0030 ticket design · 0031 installments |
| BS119 | Design system everywhere: handoff tokens on every buyer page, retire legacy fonts, rewrite DESIGN.md, copy pass | R1 | A | BS115 | F1, DD1 | merged | https://github.com/tareeq2020/Zora-Live/pull/200 | web build OK; rebased over BS115 seat flag |
| BS120 | Shared event card (storefront + discover), city, status chip rules, installment hint | R1 | A | BS119 | F2, DD2 | todo | | |
| BS121 | Checkout API: subtotal/fee/currency in response; payment-method groups endpoint | R2 | A | BS116 | A8 | merged | https://github.com/tareeq2020/Zora-Live/pull/196 | checkout-http e2e PASS |
| BS122 | Checkout v2 UI: 2 steps, summary column, artwork, fee line, methods Mobile/Card/QR | R2 | A | BS120, BS121 | F3, DD6 | todo | | |
| BS123 | Analytics capture: beacon + `analytics_daily` / `analytics_visitor_day`, server events (payment_completed, checkout_abandoned), purge job | R2 | C | BS115, BS118 | F4, A10, A11, A22 | merged | https://github.com/tareeq2020/Zora-Live/pull/205 | migration 0029; analytics e2e PASS; set POSTHOG_KEY on API for server events |
| BS124 | Seat inventory: migration, generation from published plan, versioned diff + 409 guard | R3 | B | BS116, BS118 | F5, A6, A7, A21 | merged | https://github.com/tareeq2020/Zora-Live/pull/199 | seat-inventory e2e 18/18 |
| BS125 | Seat holds in checkout: hold tx with tier hold, seatIds through order, seat on credential, sweep, late-settlement rule | R3 | B | BS124 | A6, A12, A13, A17 | merged | https://github.com/tareeq2020/Zora-Live/pull/201 | migration 0032; seat e2e + checkout/payments regression PASS |
| BS126 | Buyer seat map live (desktop + phone), poll + ETag, conflict UX | R3 | B | BS125 | F5, DD3 | todo | | |
| BS127 | Organizer builder: block / reserve / comps / release, venue image upload, price mode | R3 | B | BS124 | F5, DD8 | todo | | |
| BS128 | Organizer storefront analytics page + API | R4 | C | BS123 | F4, DD7 | todo | | |
| BS129 | Admin platform analytics page + API | R4 | C | BS123 | F4 | todo | | |
| BS130 | Theme resolver (core) + `ticket_design` + renderer branding + seat on pass | R4 | C | BS116 | F6, A14, DD4 | merged | https://github.com/tareeq2020/Zora-Live/pull/204 | migration 0030; flag off = byte-identical pass; ticket-qr e2e PASS |
| BS131 | Pass design tab (draft → publish) + branded web pass + email | R4 | C | BS130 | F6 | merged | https://github.com/tareeq2020/Zora-Live/pull/206 | ticket-design e2e PASS; EMAIL/WALLET preview toggles not built; logo PNG/JPEG only |
| BS132 | Installments core: plan/schedule tables, schedule maths, statuses, held→reserved, earnings by collected money | R5 | A | BS116, BS118 | F7, A2, A3, A16, A19 | todo | | |
| BS133 | Installment provider adapter (x-bridge /v1 receivables; mock until R3 sandbox) + webhook handler | R5 | A | BS132 | A4, A20 | todo | | real wiring blocked on x-bridge /v1 |
| BS134 | Installment checkout + confirmation + "booked" pass state (no QR until paid) | R5 | A | BS122, BS132 | A5, DD5 | todo | | |
| BS135 | Worker: reminders, due nudges, locked default close + refund minus fee | R5 | A | BS132 | A18 | todo | | |
| BS136 | Organizer installment settings + orders view; admin enable switch + fee | R5 | A | BS132 | F7 | todo | | |
| BS137 | Hardening: full e2e sweep, a11y checklist, QA fixes, flags on per release | R6 | all | all | — | todo | | |
| BS138 | Payments: move from x-bridge /collection/* to /v1 before x-bridge release 4 (≈ 28 Nov) | R6 | A | x-bridge /v1 live | new | blocked | | x-bridge switches /collection/* off at its R4 |
| BS139 | R0 review follow-ups: flags lists out of public GET /settings, generic PUT can't write flags, seat-plan NaN/size guards | R0 | 0 | BS118 | review | merged | https://github.com/tareeq2020/Zora-Live/pull/202 | homepage→/discover kept (intentional Reli-Tech change) |

## Decisions log
- 2026-10-31 · Seat maps in v1 · x-bridge runs installments (receivables /v1, R3 ≈ 21 Nov; schedules/deposit stay Zora-side) · missed payment = release + refund minus service fee · methods from x-bridge grouped Mobile money / Card / QR · follow design handoff strictly.

## Deploy log
| Date | Release | origin/main | mirror/main | API + worker redeployed |
|---|---|---|---|---|
| 2026-10-31 | R0 | 23f2cb0 | 23f2cb0 | PENDING manual: migrations 0028 + 0032, pm2 reload zora-api zora-worker |
