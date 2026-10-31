# Web Premium v1 — PR tracker (single source of truth)

> **Rule:** every PR in this programme updates this file in the same PR (status, PR link, notes). When Linear is back, this table moves there.
> Plan: [`web-premium-v1.md`](web-premium-v1.md) · Screens: https://claude.ai/artifact/YcSVYDXTZBLdTw8d5t9Fvf · Amendments A1–A22 are binding.

**Status key:** `todo` · `wip` · `review` · `merged` (on develop) · `released` (on main + mirror) · `blocked`
**Flags:** each feature ships dark and is turned on per release. Flag names are in the Flag column.

Last updated: 2026-10-31 (final train)

## Releases

| Release | Contents | Flag(s) | State |
|---|---|---|---|
| R0 Safety + sync | BS114–BS118, BS121, BS124–BS125, BS139 | — | released 2026-10-31 · PR #203 |
| R1 New look | BS119–BS120 | `zp_look_v2` | released (PR #214) |
| R2 Checkout v2 + tracking | BS121–BS123 | `zp_checkout_v2` | released (PR #214) — flag off until backend deploy |
| R3 Seat maps | BS124–BS127, BS143 | `zp_seatmap` (per event) | released (PR #218 + final train) |
| R4 Analytics + branded passes | BS128–BS131 | `zp_analytics`, `zp_pass_design` (per org) | released (PR #213) |
| R5 Installments | BS132–BS136, BS144 | `zp_installments` (per org) | released DARK (final train) — keep OFF until x-bridge /v1 (BS138) |
| R6 Hardening + x-bridge /v1 | BS137 ✅, BS138 ⛔, BS145–BS146 todo | — | partial |
| R8 Backend on Render (api.zorapass.com) | BS142 | — | released (PR #223) — owner cutover pending |
| R7 Admin Google sign-in | BS141 | — (on when GOOGLE_CLIENT_ID/SECRET set) | released (PR #213) — needs OAuth keys |

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
| BS120 | Shared event card (storefront + discover), city, status chip rules, installment hint | R1 | A | BS119 | F2, DD2 | merged | https://github.com/tareeq2020/Zora-Live/pull/207 | chips from real inventory; card links ?buy=1 |
| BS121 | Checkout API: subtotal/fee/currency in response; payment-method groups endpoint | R2 | A | BS116 | A8 | merged | https://github.com/tareeq2020/Zora-Live/pull/196 | checkout-http e2e PASS |
| BS122 | Checkout v2 UI: 2 steps, summary column, artwork, fee line, methods Mobile/Card/QR | R2 | A | BS120, BS121 | F3, DD6 | merged | https://github.com/tareeq2020/Zora-Live/pull/212 | behind zp_checkout_v2 (v1 kept as fallback); not yet tested against real payments |
| BS123 | Analytics capture: beacon + `analytics_daily` / `analytics_visitor_day`, server events (payment_completed, checkout_abandoned), purge job | R2 | C | BS115, BS118 | F4, A10, A11, A22 | merged | https://github.com/tareeq2020/Zora-Live/pull/205 | migration 0029; analytics e2e PASS; set POSTHOG_KEY on API for server events |
| BS124 | Seat inventory: migration, generation from published plan, versioned diff + 409 guard | R3 | B | BS116, BS118 | F5, A6, A7, A21 | merged | https://github.com/tareeq2020/Zora-Live/pull/199 | seat-inventory e2e 18/18 |
| BS125 | Seat holds in checkout: hold tx with tier hold, seatIds through order, seat on credential, sweep, late-settlement rule | R3 | B | BS124 | A6, A12, A13, A17 | merged | https://github.com/tareeq2020/Zora-Live/pull/201 | migration 0032; seat e2e + checkout/payments regression PASS |
| BS126 | Buyer seat map live (desktop + phone), poll + ETag, conflict UX | R3 | B | BS125 | F5, DD3 | merged | https://github.com/tareeq2020/Zora-Live/pull/210 | wired into checkout v1+v2; re-entry releases own hold; seat e2e PASS |
| BS127 | Organizer builder: block / reserve / comps / release, venue image upload, price mode | R3 | B | BS124 | F5, DD8 | merged | https://github.com/tareeq2020/Zora-Live/pull/216 | comps-for-seats shipped; builder prod-build bug fixed; seat + comps e2e PASS |
| BS128 | Organizer storefront analytics page + API | R4 | C | BS123 | F4, DD7 | merged | https://github.com/tareeq2020/Zora-Live/pull/208 | with BS129 in one PR; analytics e2e PASS |
| BS129 | Admin platform analytics page + API | R4 | C | BS123 | F4 | merged | https://github.com/tareeq2020/Zora-Live/pull/208 | shared view component |
| BS130 | Theme resolver (core) + `ticket_design` + renderer branding + seat on pass | R4 | C | BS116 | F6, A14, DD4 | merged | https://github.com/tareeq2020/Zora-Live/pull/204 | migration 0030; flag off = byte-identical pass; ticket-qr e2e PASS |
| BS131 | Pass design tab (draft → publish) + branded web pass + email | R4 | C | BS130 | F6 | merged | https://github.com/tareeq2020/Zora-Live/pull/206 | ticket-design e2e PASS; EMAIL/WALLET preview toggles not built; logo PNG/JPEG only |
| BS132 | Installments core: plan/schedule tables, schedule maths, statuses, held→reserved, earnings by collected money | R5 | A | BS116, BS118 | F7, A2, A3, A16, A19 | merged | https://github.com/tareeq2020/Zora-Live/pull/215 | migration 0031; installments + payouts + money regression e2e PASS; refunds after default are manual (ops) |
| BS133 | Installment provider adapter (x-bridge /v1 receivables; mock until R3 sandbox) + webhook handler | R5 | A | BS132 | A4, A20 | merged | https://github.com/tareeq2020/Zora-Live/pull/217 | migration 0033; mock-only until x-bridge sandbox (TODO(xbridge-v1) markers); webhook HMAC |
| BS134 | Installment checkout + confirmation + "booked" pass state (no QR until paid) | R5 | A | BS122, BS132 | A5, DD5 | merged | https://github.com/tareeq2020/Zora-Live/pull/224 | quote = stored schedule; /pay needs cookie or OTP; buyer e2e 27/27 |
| BS135 | Worker: reminders, due nudges, locked default close + refund minus fee | R5 | A | BS132 | A18 | merged | https://github.com/tareeq2020/Zora-Live/pull/219 | locked default close; refund recorded as pending for ops; jobs e2e PASS |
| BS136 | Organizer installment settings + orders view; admin enable switch + fee | R5 | A | BS132 | F7 | merged | https://github.com/tareeq2020/Zora-Live/pull/221 | org tab + page, reminders 1/day, admin refund queue; org e2e PASS |
| BS137 | Hardening: full e2e sweep, a11y checklist, QA fixes, flags on per release | R6 | all | all | — | merged | https://github.com/tareeq2020/Zora-Live/pull/225 | QA R1–R4: 9 bugs fixed (fonts never loaded!) + installments double-sidebar; open: buyer map reads draft plan → BS143 |
| BS138 | Payments: move from x-bridge /collection/* to /v1 before x-bridge release 4 (≈ 28 Nov) | R6 | A | x-bridge /v1 live | new | blocked | | x-bridge switches /collection/* off at its R4 |
| BS139 | R0 review follow-ups: flags lists out of public GET /settings, generic PUT can't write flags, seat-plan NaN/size guards | R0 | 0 | BS118 | review | merged | https://github.com/tareeq2020/Zora-Live/pull/202 | homepage→/discover kept (intentional Reli-Tech change) |

| BS140 | Admin feature-flags page (`/admin/console/flags`) + `GET /api/settings/flags` (admin) | R1 | 0 | BS118 | A15 | merged | https://github.com/tareeq2020/Zora-Live/pull/209 | needed to switch each release on |
| BS141 | Admin Google sign-in as the default (password kept as break-glass); allowlist via settings.adminGoogleEmails / ADMIN_GOOGLE_EMAILS / ADMIN_GOOGLE_DOMAIN | R7 | 0 | — | owner request 2026-10-31 | merged | https://github.com/tareeq2020/Zora-Live/pull/211 | needs Google OAuth client + callback <web>/api/auth/google/callback |
| BS142 | Render Blueprint (`render.yaml`: zora-api web + zora-worker + env group), `/api/health`, api.zorapass.com, cutover runbook `docs/deploy/render.md` | R8 | 0 | — | owner request 2026-10-31 | merged | https://github.com/tareeq2020/Zora-Live/pull/222 | owner: create Blueprint from Reli-Tech/zora, DNS CNAME api → zora-api.onrender.com, Vercel API_URL |
| BS143 | Buyer seat map reads the PUBLISHED plan (`GET /api/events/:id/seatmap`, written on publish), never the builder draft | R3 | B | BS127 | QA finding (BS137) | merged | https://github.com/tareeq2020/Zora-Live/pull/226 | seat e2e extended |
| BS144 | Final review fixes: seat map falls back for events published before BS143; pay page seat labels from order_seat | R5 | 0 | BS143 | final review | merged | https://github.com/tareeq2020/Zora-Live/pull/227 | follow-ups below |
| BS145 | FOLLOW-UP (security): /api/orders/:id/status returns QR codes to anyone with the order id (pre-existing; order ids now in installment SMS). Gate qr/code on canReadBuyerOrder after checking mobile app + split-share flows | R6 | 0 | — | final review | todo | | must test mobile checkout + Tuchange shares first |
| BS146 | FOLLOW-UP: quiet hours for organizer "Send reminder"; cancel stale pending installment_plan when releaseOwnSeatHold expires its order; batch the public installments/offers read | R6 | A | — | final review | todo | | minor |
## Decisions log
- 2026-10-31 · Owner: backend moves to Render at api.zorapass.com (BS142 / R8). Web stays on Vercel; Postgres stays on Supabase.
- 2026-10-31 · Owner: add Google login as the default for admins (R7 / BS141).
- 2026-10-31 · Seat maps in v1 · x-bridge runs installments (receivables /v1, R3 ≈ 21 Nov; schedules/deposit stay Zora-side) · missed payment = release + refund minus service fee · methods from x-bridge grouped Mobile money / Card / QR · follow design handoff strictly.

## Deploy log
| Date | Release | origin/main | mirror/main | API + worker redeployed (PM2 until R8 cutover, then Render auto-deploy) |
|---|---|---|---|---|
| 2026-10-31 | R0 | 23f2cb0 | 23f2cb0 | PENDING manual: migrations 0028 + 0032, pm2 reload zora-api zora-worker |
| 2026-10-31 | train 2 (R1 partial, R4, R7) | 92c713b | 92c713b | pending |
| 2026-10-31 | train 3 (R1, R2) | 6825c10 | 6825c10 | pending |
| 2026-10-31 | train 4 (R3) | 3c266b9 | 3c266b9 | pending |
| 2026-10-31 | train 5 (R5 backend) | 3c101a8 | 3c101a8 | pending (migrations 0028–0033) |
| 2026-10-31 | R8 Render blueprint | 52eaceb | 52eaceb | n/a |
