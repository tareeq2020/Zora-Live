# ZoraPass Web Premium v1 — plan

Status: DRAFT (pre eng-review / design-review) · Owner: Bill · Date: 2026-10-31
Scope: **web first** (apps/web + apps/api + packages/core). Mobile follows in a later plan.

Inputs: client brief "Zora — Product & UX Improvement Requirements", engineering
"Zora 3-Week Implementation Timeline" (Sep 24 – Oct 14), the ZoraPass design-system
handoff (`docs/ZoraPass-Design-System-Handoff`, v1.0, 23 Sep 2026), the
`/review` audit of develop @ 485af35 (2026-10-29), and the new requirement:
**installment payments through x-bridge**.

## Goal

Make ZoraPass feel like a premium event-discovery and ticketing marketplace.

- Buyer: DISCOVER → EXPLORE → SELECT → PAY (in full or in installments) → RECEIVE BRANDED PASS → ATTEND
- Organizer: CREATE → BRAND → SELL → ANALYSE → MANAGE

## Where we are (audit, 2026-10-29)

| Area | State |
|---|---|
| Storefront grid | Done (`storefront/[handle]/storefront-client.tsx`); city missing |
| Design system | Tokens/fonts loaded globally; used in 4 files; legacy fonts elsewhere; `cr-tokens.css` references non-existent `--zp-*` names |
| Checkout | Re-skinned; no artwork, no fee line, location only via free text, 3–4 screens |
| Product analytics | Hand-rolled PostHog capture; page/checkout/payment-start only; leaks route tokens; sanitiser strips `eventName`/`tierName` |
| Organizer/admin analytics | None (only order-based "conversion") |
| Branded tickets | None — renderer uses fixed Zora themes |
| Seat maps | Builder persists zones as a JSON blob (no auth on PUT); buyer map uses **random** availability; no seat-level hold; tickets not linked to seat; GA `cap`/`capacity` bug; tables priced as qty 1 |
| Installments | None |
| Branches | October work (Reli-Tech PRs #1–#16) only on mirror/develop, not origin |

## Features

### F0 — Stabilise (blockers before any new work)
1. Analytics: send the route *pattern* (`/join/[token]`), never raw path/query.
2. Sanitiser: allow `eventName`/`tierName` explicitly (allowlist before blocklist); send `eventId` everywhere.
3. Floor-plan `PUT` (both endpoints): require the owning organizer session.
4. Seat map: fix GA `cap` → `capacity` read; gate the buyer seat-map behind a feature flag until F5 lands (no fake availability in front of buyers).
5. `cr-tokens.css`: map to real `--zp-color-*` names; Bricolage not Archivo.
6. Sync origin/develop with mirror/develop; merge `codex/week3-mobile-nest-attendee-entry`.

### F1 — Design system everywhere
- Every buyer-facing page on handoff tokens: Discover, event page, tenant event page, checkout, confirmation, pass, my passes, split/join.
- Remove Space Grotesk / Inter / Archivo; `zora-tokens.css` retired or aliased to `--zp-*`.
- Copy pass per `04_UI_COPY` (GET PASSES, never BUY NOW / "Zora Pass" / "Get tickets").
- Accessibility checklist (`03_COMPONENTS` §11) is the ship gate.

### F2 — Storefront marketplace
- Grid is done; add city, status stamp (SOLD OUT / FEW LEFT only when true), "from" price incl. installment hint ("or 3 × TZS 20,000") when enabled.
- Discover page adopts the same event card component (one shared card).

### F3 — Checkout v2 (ecommerce feel)
- One page summary column (artwork, name, date, venue+city, tier, qty, price, **fees**, total) + action column.
- Steps: **Choose passes → Your details + pay** (method + network on one screen) → Confirmation. Max 2 input screens.
- API: `POST /checkout` returns `{ orderId, subtotal, fees, total, currency, expiresAt }`; client shows hold countdown from `expiresAt`.
- Pay-in-full vs **Pay in installments** toggle (F7) on the pay step when the tier allows it.
- Payment-method names: pending decision (M-Pesa / Airtel Money / Mixx by Yas / card) — default "Mobile money" until confirmed.
- Existing payment APIs/x-bridge flow unchanged for pay-in-full.

### F4 — Storefront analytics
- **Capture**: storefront view, event view, tier selected, checkout started, payment started, payment completed (**server-side** on `applyOutcome` paid), checkout abandoned (hold expiry with no payment), installment plan started/completed/defaulted. Referrer + UTM on first touch.
- **First-party aggregates** (source for in-product dashboards): `POST /api/v/track` beacon → `analytics_daily(org_id, event_id, day, source, views, unique_visitors)` with a daily-salted visitor hash (no PII, no raw IDs). Joined with orders for conversion.
- **Organizer dashboard** (`/dashboard/analytics`): visits, unique visitors, page views, top events, traffic over time, event page views, purchases, visit→purchase rate, top referrers. Date range + per-event filter.
- **Admin console** (`/admin/console/analytics`): platform totals, top events, organizer leaderboard (views, conversion, GMV), trends.
- PostHog remains for internal funnels/replay; DB stays source of truth for money/tickets/check-ins.
- Privacy: aggregate only; documented in `docs/PRODUCT-ANALYTICS.md`.

### F5 — Seat maps (real inventory)
- **Model**: `seat_inventory(event_id, seat_id, zone_id, kind[seat|table|ga_slot], label, tier_id, price, state[available|held|sold|reserved|blocked], hold_order_id, hold_expires_at)`; generated from the published floor plan (`packages/core/src/seatmap.ts`), re-generated safely on edit (never touches sold/held).
- **Holds**: `POST /events/:id/seats/hold {seatIds}` → atomic conditional update (`where state='available'`), TTL = checkout hold TTL; released by the existing hold-expiry sweep; GA zones keep tier-level holds.
- **Checkout**: cart carries `seatIds`; `createGaVipOrder` converts seat holds with the order; on paid → `sold`; credential gets `seat_id`, `zone_id`, `table_no`, `seat_label`.
- **Buyer map**: availability from `GET /events/:id/seats` (poll 5 s while open; ETag); states available / selected (client) / held / sold / reserved; tables priced per table or per seat (zone setting).
- **Organizer**: zone/seat/table builder (existing), venue image upload via media module, block/reserve/release seats, assign to comps, live sold/held/available view.
- **Installments + seats**: a seat on an installment plan is `sold` (reserved for buyer) once the deposit clears; released back to `available` on default.

### F6 — Branded passes (MVP)
- Inheritance: Zora defaults → storefront theme (accent, bg, logo, typography) → event design (artwork, colours) → ticket design overrides.
- `ticket_design(event_id, template, bg_image, bg_color, accent, logo_url, organizer_logo_url, sponsor_logos[], show_fields[], status[draft|published])`.
- Renderer (`apps/api/src/vendor/ticket.js`) takes resolved theme; reuse share-card `themeFor`. Seat/zone/table on the pass. QR + ref stay fixed zone (never covered).
- Organizer: "Pass design" tab in event editor — pick template (3), customise, upload logos/sponsors, live preview (web pass + SVG), save draft, publish.
- Same branding on web pass, email, and SMS link landing.

### F7 — Installment payments (x-bridge)
- **Organizer config** per event (optionally per tier): enable, deposit % or amount, number of installments (2–6), frequency (weekly / bi-weekly / monthly), final due date (must be ≥ N days before event), late grace days, default policy (forfeit deposit / refund minus fee — pending decision).
- **Buyer**: choose "Pay in installments" at checkout → see schedule → pay deposit through x-bridge → order `installment_active`; pass shown as "Reserved — X of N paid" (QR not scannable) until fully paid, then pass issued.
- **Payments**: each installment is a normal `payment_transaction` against the order (existing `initiatePayment`/`applyOutcome`), driven by an `installment_plan` + `installment_schedule` table. Either x-bridge schedules pulls or Zora initiates each due collection — **adapter boundary** `InstallmentProvider` in `packages/core/src/payments/` until the x-bridge installment contract is published.
- **Reminders**: SMS + email 3 days before, on due date, and on miss; "Pay now" link → hosted pay page for that installment.
- **Default**: after grace, plan → `defaulted`, inventory released (tier qty or seat), buyer notified; organizer sees it.
- **Inventory**: deposit converts the hold to sold-for-plan; capacity counts plan seats as sold.
- **Organizer view**: installment orders list (on track / due / overdue / defaulted / complete), collected vs outstanding; payouts only release collected money.
- **Admin**: global enable switch, fee for installment orders, per-organizer allow.
- Analytics events: plan started / installment paid / completed / defaulted (no PII).

## Out of scope (v1)
- Drag-and-drop freeform ticket designer (templates + overrides only).
- Websocket live seat updates (poll is enough for MVP).
- Mobile app changes (separate plan).

## Open decisions
1. Seat maps ship in v1? (handoff: "ask Mr T").
2. x-bridge installment contract: who schedules collections, callback shape, card vs mobile support.
3. Installment default policy & refund wording.
4. Payment method display names.
5. CTA: GET PASSES (handoff) vs Get Tickets (client) — recommend GET PASSES.

---

# Engineering review — 2026-10-31 (`/plan-eng-review`, autopilot)

Target: `docs/plans/web-premium-v1.md` (this file). Mode: **autopilot, no scope reduction** (user instruction 2026-10-31). Every choice below was auto-decided to the recommended option; no feature was cut. Scope Challenge result: **scope accepted as-is** (structure: original feature split, with the amendments below).

## Binding amendments (supersede the feature text above where they conflict)

**A1. One owner for "what an order status means".** Add `packages/core/src/order-status.ts` exporting the status list and predicates `countsAsSold`, `countsAsRevenue`, `isScannable`, `isPayable`. Replace the hand-synced lists `PAID_STATES` (`apps/api/src/org/org-events.controller.ts:59`), `PAID` (`apps/api/src/org/org-sales.service.ts:42`), `EARNING_STATUSES` (`packages/core/src/earnings.ts:28`) and the `'paid'` literals that gate money/scan (≈50 sites across 13 files). New statuses: `installment_active`, `installment_defaulted`. Lands in F0, before F7.

**A2. Installment money = money collected, never order total.** Earnings/payout balance (`packages/core/src/earnings.ts`, `packages/core/src/payouts.ts`) count, for installment orders, the sum of `payment_transaction` rows in `successful` state, net of the commission snapshotted on the order (`service.ts:50`). Defaulted plans: earnings follow the default policy decision (open decision 3). Payout e2e (`db/test/payouts.e2e.sh`) extended.

**A3. Installment inventory reuses the reservation ledger.** Deposit paid → new SQL fn `convert_order_holds_to_reservation(order_id, ref_type:='installment', expires_at)` moves held → reserved (`inventory_reservation`, `0003_inventory_credentials.sql:41`). Final installment → `convert_reservation` (reserved → sold). Default → `release_reservation`. Reservation `expires_at` = final due + grace + 1 day as a safety net; the installment worker job marks default and releases first. No new inventory bucket.

**A4. Mobile money cannot be silently debited.** `collectMobile` is an STK push the buyer must approve (`packages/core/src/payments/xbridge.ts:149`). Each installment therefore needs buyer action: on the due date the worker sends SMS/email with a pay link and (opt-in at plan start) triggers one STK push; bill-pay control number offered as fallback (`collectBillPay`, `xbridge.ts:184`). The x-bridge installment feature plugs in behind one function `collectInstallment(plan, n)` in `packages/core/src/payments/installments.ts`; no wider adapter layer.

**A5. No pass until paid in full.** Credentials are issued by `issueCredentials` (`service.ts:141`) only when the final installment clears. Before that the buyer's pass page shows "Reserved — X of N paid" from the order + plan. Scanner code is untouched (nothing to scan).

**A6. Seat identity rides on tier capacity.** `inventory_pool` stays the single capacity truth. A seat hold runs in one transaction: `place_inventory_hold(tier, order, n)` + conditional `update seat_inventory set state='held' … where state='available'` for all `seatIds`; any miss rolls back both. Seat sold/reserved/released moves with the order's hold conversion. `seat_inventory` carries identity and state; it never decides capacity.

**A7. Stable seat IDs and safe edits.** Seat IDs are deterministic (`<zoneId>-<row><col>`, `<zoneId>-T<n>`). Republishing a plan diffs against `seat_inventory`; removing or re-tiering a seat that is held/sold/reserved returns 409 with the affected labels.

**A8. Checkout response correction.** `createGaVipOrder` already returns `subtotal` and `fee` (`service.ts:63`); the controller drops them (`apps/api/src/checkout/checkout.module.ts:113-117`). F3 change = add `subtotal`, `fee`, `currency` to that response; keep the existing `holdExpiresAt` name (plan text said `expiresAt`).

**A9. Floor-plan endpoints behind `OrganizerGuard`** (pattern: `apps/api/src/theme/theme.module.ts:66`) plus an event-ownership check on both `PUT floorplan` and `PUT events/:id/floorplan` (`apps/api/src/floorplan/floorplan.module.ts:30,59`).

**A10. First-party analytics storage.** `analytics_daily(org_id, event_id, day, source, views)` upserted per beacon; unique visitors from `analytics_visitor_day(day, event_id, visitor_hash)` primary-keyed for dedupe, hash = sha256(daily salt + anon id), purged after 35 days by a worker job. Beacon: rate-limited per IP, bot UA filter, 204 always, never blocks render.

**A11. Abandonment and payment-completed are server events.** `payment_completed` fires in `applyOutcome` on the paid transition; `checkout_abandoned` fires from the hold sweep, which must return released order IDs (today `sweepExpiredHolds` returns a count, `apps/worker/src/main.ts:94`). Server PostHog calls are fire-and-forget with a 2 s timeout.

**A12. Seat availability read is coalesced.** `GET /events/:id/seats` uses a 2 s coalescing cache + ETag (pattern: `poolSnapshotsCached`, `packages/core/src/inventory.ts:92`) so 5 s polling scales with events, not viewers.

**A13. Tables have a price mode.** Zone setting `priceMode: per_table | per_seat`; checkout quantity math follows it (fixes `seat-map.tsx:538`).

**A14. Shared theme resolver.** Move share-card `themeFor` (`apps/api/src/share-card/share-card.module.ts:44`) to `packages/core/src/theme-resolve.ts`; share-card and the ticket renderer both call it, then apply event + ticket-design overrides. [ADVISORY accepted: two verified callers.]

**A15. Every phase ships an API + worker redeploy.** API and worker run under PM2 and do not auto-deploy; migrations run on the session pooler. Each milestone's done-definition includes migrate → `pm2 reload zora-api zora-worker` → smoke.

## Scope Challenge

- Existing solutions reused: tier holds + oversell choke point (`place_inventory_hold`), reservation ledger, payment attempts/reconcile (`payment_transaction`, worker reconcile every 30 s), bill-split windowed multi-payment state machine (`0006_bill_split.sql:28`, split-sweep) as prior art for installments, theme table + share-card theming, media upload module (`SessionGuard`), singleton worker (`apps/worker/src/main.ts`).
- Complexity: ~45 files touched, 6 new core modules/services (order-status, installments, seat-inventory, analytics-aggregate, theme-resolve, ticket-design). Gate tripped; structure auto-decided to **original arrangement** (feature-per-module), no feature cuts per user instruction.
- Search: in-distribution knowledge used for conditional-update seat locking and daily-salted-hash visitor counting [Layer 1].

## Section 1 — Architecture

Design-twice (installments): **Shape A** one order + many `payment_transaction` rows + `installment_schedule`; **Shape B** each installment is a child order. Pick **A**: matches the existing "one row per attempt" design (`0005_payments.sql:13`), keeps one inventory owner and one pass issuance point; B would duplicate holds and split revenue across orders (red flag: split ownership).

Red flags found and fixed: hand-synced paid lists (#8 → A1); seat vs pool capacity (#5 → A6); theme logic in share-card only (#2 → A14).

Findings:
- [CRITICAL] (9/10) `packages/core/src/earnings.ts:28` — `EARNING_STATUSES = ['paid','refunded']` keys payouts off order status; installment orders would pay out uncollected money or none. → A2. Accepted.
- [CRITICAL] (9/10) `apps/api/src/org/org-events.controller.ts:59` — `PAID_STATES` hand-copied in several modules; new statuses would be missed. → A1. Accepted.
- [CRITICAL] (8/10) `db/migrations/0003_inventory_credentials.sql:70` — capacity lives in `inventory_pool`; a separate seat table that also decides availability would double-own capacity. → A6. Accepted.
- [CRITICAL] (8/10) `packages/core/src/inventory.ts:16` — only held→sold exists; installments need held→reserved. → A3. Accepted.
- [HIGH] (9/10) `apps/api/src/floorplan/floorplan.module.ts:59` — "OPEN in the demo". → A9. Accepted.
- [HIGH] (9/10) `packages/core/src/payments/xbridge.ts:149` — STK push needs buyer PIN; auto-debit assumption false. → A4. Accepted.
- [HIGH] (8/10) `packages/core/src/payments/service.ts:141` — issuing passes before full payment forces scanner changes. → A5. Accepted.

Production failure per new path: seat hold race (two buyers, last seat) → conditional update loses → 409 "seat just taken", map refreshes; x-bridge callback lost → existing 30 s reconcile; installment reminder SMS fails → broadcast drain already surfaces undelivered (BS79); analytics beacon down → 204 swallowed, sales unaffected.

## Section 2 — Code quality

- [HIGH] (8/10) floor-plan builder emits only counts (`floor-plan/page.tsx`), no seat IDs → A7. Accepted.
- [MEDIUM] (9/10) `checkout.module.ts:113` drops `subtotal`/`fee` → A8. Accepted.
- [MEDIUM] (7/10) `seat-map.tsx:538` table priced as qty 1 → A13. Accepted.
- [MEDIUM] (9/10) `seat-map.tsx:331` reads `cap`, core writes `capacity` (`seatmap.ts:148`) → F0 fix, make the buyer read `capacity` via the core normaliser (one reader). Accepted.
- [ADVISORY] share-card `themeFor` → `core/theme-resolve.ts` (A14). Est. impl −40/+55 lines, total incl. tests +90. Accepted.

## Section 3 — Tests

Framework: shell e2e against throwaway Postgres (`db/test/*.e2e.sh` + `.harness.cjs`) and node `.test.mjs` in `packages/core/test`; root `pnpm test` via turbo.

```
CODE PATHS                                         USER FLOWS
[+] core/order-status.ts                           [+] Buy GA pass, pay in full
  └── predicates × every status  [GAP] unit          └── [★★★ TESTED] checkout.e2e.sh / payments.e2e.sh
[+] core/installments.ts                           [+] Buy in installments
  ├── create plan from tier rules [GAP] unit         ├── [GAP][→E2E] deposit → 2nd → final → pass issued
  ├── deposit → held→reserved     [GAP][→E2E]        ├── [GAP][→E2E] miss + grace → defaulted → stock back
  ├── installment paid / short    [GAP][→E2E]        └── [GAP] double-tap "pay now" on same installment
  ├── final → reserved→sold + issueCredentials [GAP][→E2E]
  └── default sweep → release + notify [GAP][→E2E]
[+] payouts with installments                      [+] Organizer withdraws
  └── balance = collected only    [GAP][→E2E] CRITICAL regression   └── [★★★ TESTED] payouts.e2e.sh (extend)
[+] seat hold                                      [+] Pick seats
  ├── all seats available → held  [GAP][→E2E]        ├── [GAP][→E2E] two buyers, same seat → one wins
  ├── one taken → rollback both   [GAP][→E2E]        └── [GAP] hold expires mid-checkout → seats freed
  └── sweep releases seat + tier  [GAP][→E2E]
[+] floor-plan republish diff                      [+] Organizer edits sold zone → 409 [GAP][→E2E]
[+] analytics beacon + aggregates [GAP] unit + e2e  [+] Organizer analytics page shows counts [GAP]
[+] ticket theme resolve chain    [GAP] unit golden [+] Branded pass renders [GAP] golden SVG (db/test/golden)
[+] checkout response subtotal/fee [★★ checkout-http.e2e.sh — extend]

COVERAGE (planned paths): 2/24 tested today | GAPS: 22 (13 E2E)
```

Required regression (CRITICAL, IRON RULE): pay-in-full checkout, payment, pass issuance, scan and payout totals must be unchanged after A1/A2 — extend `checkout.e2e.sh`, `payments.e2e.sh`, `payouts.e2e.sh`, `scan.e2e.sh` to assert identical results for non-installment orders. Auto-approved.

New test files: `db/test/installments.e2e.sh` (+harness), `db/test/seat-inventory.e2e.sh`, `db/test/analytics.e2e.sh`, `packages/core/test/order-status.test.mjs`, `packages/core/test/theme-resolve.test.mjs`, ticket SVG goldens under `db/test/golden/`.

## Section 4 — Performance

- [MEDIUM] (7/10) seat polling: N viewers × 5 s on a hot event → A12 (one query / 2 s / instance).
- [MEDIUM] (7/10) beacon writes: one upsert per view; at drop surge use the same 2 s coalescing write buffer or accept upsert contention on `(event_id, day, source)` — index both analytics tables on PK. Scale unknown; measure at first drop.
- [INFO] organizer analytics queries read daily aggregates only (bounded by days × events).

## Failure modes

| Path | Failure | Handled | User sees |
|---|---|---|---|
| Seat hold | concurrent last seat | conditional update + tx rollback | "Seat just taken" + refreshed map |
| Installment due | buyer ignores STK push | reminders, grace, default job | SMS/email; organizer sees overdue |
| Installment default | reservation sweep fires before default job | expires_at = due + grace + 1 day; default job owns release | buyer notified once |
| Payout | installment order counted as paid | A2 + regression test | correct balance |
| Floor-plan edit | sold seat removed | A7 409 | organizer sees blocked labels |
| Analytics | beacon 5xx | swallowed | nothing (critical gap: none) |

## Worktree parallelization

| Step | Modules | Depends on |
|---|---|---|
| F0 stabilise + A1 order-status | packages/core, apps/api, apps/web | — |
| F1/F2 design system + storefront | apps/web | F0 |
| F3 checkout v2 | apps/web, apps/api/checkout | F0 |
| F4 analytics | packages/core, apps/api, apps/web, apps/worker, db | F0 |
| F5 seat inventory | packages/core, apps/api, apps/web, apps/worker, db | F0 |
| F6 branded passes | apps/api/vendor+tickets+theme, packages/core, apps/web dashboard | F0 |
| F7 installments | packages/core/payments, apps/api, apps/worker, db, apps/web checkout | F0 (A1), F3 |

Lanes: **A** F1/F2 → F3 → F7 (checkout surface) · **B** F5 · **C** F4 → F6. Launch A+B+C after F0 merges. Conflict flags: `db/migrations` numbering (assign numbers up front: 0028 order-status, 0029 seat-inventory, 0030 analytics, 0031 ticket-design, 0032 installments); `apps/worker/src/main.ts` (B and A each add a job; sequence merges); `checkout-flow.tsx` (A owns; B adds seat payload via props only).

## Implementation tasks

1. core/order-status.ts + migrate all paid-literal callers + regression e2e (A1)
2. F0 fixes: route-pattern analytics, sanitiser allowlist, floor-plan guard (A9), GA capacity read, cr-tokens, seat-map flag
3. Branch sync: origin/develop ← mirror/develop; merge attendee-entry branch
4. F1 token migration per page + copy pass + a11y checklist
5. F2 shared event card + city + stamp + installment hint
6. F3 checkout summary/action layout, 2-step flow, subtotal/fee response (A8)
7. F4 beacon + aggregates (A10), server events (A11), organizer + admin analytics pages
8. F5 seat_inventory migration + generation/diff (A7) + hold tx (A6) + read cache (A12) + price mode (A13) + organizer block/reserve + map upload + credential seat columns
9. F6 theme-resolve (A14) + ticket_design table + renderer + pass-design tab + email
10. F7 installment tables, plan rules, deposit flow, collectInstallment (A4), worker due/reminder/default job, reservation conversion (A3), earnings (A2), pass gating (A5), organizer/admin views
11. Per-phase migrate + API/worker redeploy + smoke (A15)

## NOT in scope
- Drag-and-drop freeform ticket designer — templates + overrides meet the MVP.
- Websocket seat updates — 5 s polling with coalesced reads is enough at current scale.
- Card tokenised auto-debit for installments — not offered by the FSP flow today.
- Mobile app (separate plan).

## Outside voice (Codex, read-only, 2026-10-31) — 15 findings

Overlap with this review: installment ledger/earnings (A2), inventory state (A3), no pass before full payment (A5), floor-plan auth (A9), seat-aware checkout (A6/A7), gate the fake map (F0). New findings, all accepted on autopilot as amendments:

**A16. Per-installment amount on payment attempts.** `initiatePayment` charges the order's full `target_value` (`service.ts:214-236`). Add an `amount` argument bound to one `installment_schedule` row; `applyOutcome` allocates to that row and checks the cumulative collected against the order total (idempotent per transaction id). Pay-in-full path unchanged.

**A17. Late settlement vs expiry has one winner.** A deposit or seat payment can clear after the hold sweep released stock (`service.ts:809-827` late-settlement path). Rule: under a lock on the order row, re-hold the same seats/tier quantity; if gone, order → `paid_unseatable` (existing status) and auto-refund path — never silently resell.

**A18. Default is a locked close.** Default job: lock plan → mark `closing` (no new collections) → reconcile any pending attempts → if paid in full meanwhile, complete; else release inventory + apply default policy exactly once.

**A19. Schedule maths.** Integer minor units; deposit first, remainder split evenly with the rounding remainder on the last installment; schedule must fit between purchase and final due date (reject otherwise, with message); schedule is snapshotted on the order at purchase so later organizer config edits don't change it.

**A20. F7 starts with an x-bridge contract gate.** Before F7 build: confirm provider capability (does x-bridge schedule pulls or does Zora initiate?), callback identity/idempotency and retry semantics. v1 supports **one** scheduler: Zora-initiated (A4) unless x-bridge confirms native scheduling before F7 starts.

**A21. Layout versions.** Published floor plans get a version number; `seat_inventory` rows carry the version that created them; price is snapshotted onto the order item at hold time.

**A22. Analytics semantics written down before dashboards.** Event schemas, dedupe key (anon id + event + 30 min window), attribution = last non-direct referrer within 7 days of purchase, purchase credited to purchase day; no cookie banner needed because no PII/third-party cookie, documented in `docs/PRODUCT-ANALYTICS.md`.

Disagreed (partly): Codex #15 asks to hold all visual work until backend contracts settle. F1/F2 (design system, storefront) don't depend on those contracts and ship independently; F3 checkout waits for A8/A16 interfaces only. Kept the lane plan.

## Completion summary

- Scope Challenge: scope accepted as-is (autopilot, no reduction)
- Architecture: 7 findings · Code quality: 5 · Tests: 22 gaps, regression contract required · Performance: 3
- Outside voice: Codex completed, 15 findings, 6 new (A16–A21) + A22
- Critical gaps: 0 left unaddressed (all mapped to amendments A1–A22)
- Unresolved decisions: product decisions only (listed below)
- Test plan artifact: written to gstack project dir

# Design review — 2026-10-31 (`/plan-design-review`, autopilot)

Target: this plan. Calibrated against the ZoraPass handoff (`docs/ZoraPass-Design-System-Handoff`, v1.0), which replaces earlier direction. Screens for approval: **https://claude.ai/artifact/YcSVYDXTZBLdTw8d5t9Fvf** (15 artboards, three pages: Buyer journey · Organizer console · Zora admin). Mockups were built as HTML on the real tokens rather than AI image variants, so copy, colours and type are exact.

Initial design completeness: **3/10** — the plan said what the backend does, not what people see. After this review: **8/10** (open items below keep it from 10).

## Screens (all drawn)

| # | Screen | Feature |
|---|---|---|
| 01–02 | Storefront desktop + phone | F2 |
| 03 | Event page + purchase panel (installment hint, pick-a-table link) | F2/F3/F5/F7 |
| 04 | Checkout 1 · Passes (summary column with artwork, fees, total, hold timer) | F3 |
| 05 | Checkout 2 · Details + pay (pay in full vs installments schedule, network chips) | F3/F7 |
| 06 | Seat map — buyer (5 states, live, conflict message) | F5 |
| 07 | Confirmation — paid in full (YOU'RE IN.) and installment (YOU'RE BOOKED.) | F3/F7 |
| 08 | Pass — organizer branded (accent is a tweak on the canvas) | F6 |
| 09 | Pass — installments in progress (no QR until paid) | F7/A5 |
| 10 | Organizer storefront analytics | F4 |
| 11 | Pass design tab (template, inherit storefront, colours, logos, sponsors, fields, live preview, draft → publish) | F6 |
| 12 | Seat map builder — block / reserve / comps / release, sold-seat edit guard | F5/A7 |
| 13 | Installment settings | F7 |
| 14 | Installment orders | F7 |
| 15 | Platform analytics (admin) | F4 |

## Decisions (auto-decided to the recommendation; user approves via the canvas)

- **DD1 DESIGN.md is stale.** It still describes the dark-obsidian consumer palette with the "sunrise aura" gradient and a paper/blue control room; the handoff forbids gradients and sets Yellow/Black/Bone. → Rewrite `DESIGN.md` from the handoff in F1. Organizer console = bone ground, black sidebar, one yellow accent per chart; admin = black ground.
- **DD2 Event card = one link with a visible CTA strip.** Client asked for a Get Tickets button; handoff says the whole card is one link. The card stays one link and renders "GET PASSES →" as its last row (no nested button).
- **DD3 Seat states never by colour alone.** Available = outline · Your pick = yellow + ✓ · Held = grey dashed · Sold = solid black · Reserved = dark grey + "R" · Blocked (organizer only) = red outline + "×". Every seat has an aria-label with row, number and state. Legend always visible.
- **DD4 Branded pass has a fixed frame.** Organizer colour/artwork only in the header band, event name and seat line; QR block, pass ID, tear line, brightness hint and the ZoraPass mark are fixed. Text colour on the accent is picked automatically for contrast.
- **DD5 Installment states are explicit everywhere.** Buyer: "BOOKED · 2 OF 3 PAID", progress bar, schedule rows, "PASS ON THE WAY" placeholder where the QR will be, one PAY button. Organizer: ON TRACK / DUE SOON / OVERDUE / PAID IN FULL / RELEASED with words, never colour only.
- **DD6 Checkout keeps the handoff's three steps on two screens.** Passes → Who's going + Pay. Hold countdown is a mono chip in the header on every step. Fees are a separate line before the button.
- **DD7 Analytics reads like a story, not a chart wall.** KPI row → visits over time (one yellow bar marks the peak) → visit-to-pass funnel → sources → top events. Privacy line on the page: counts only.
- **DD8 Floor-plan edits that hit sold seats are blocked in the UI** with the seat labels named (matches A7).

## Open design items (need a human)

1. New strings outside the handoff's fixed list: `YOU'RE BOOKED.`, `BOOKED · X OF N PAID`, `PASS ON THE WAY`, `ON TRACK`, `DUE SOON`, `OVERDUE`, `PAID IN FULL`, `RELEASED`. Handoff says "ask before you invent" → Mr T approval.
2. Bungee size on buttons: the a11y checklist says Bungee never below 20px, but 48px buttons with Bungee labels need 16–18px. Need a ruling (mockups use 16–18px).
3. Phone layouts still to draw: checkout (both steps), seat map on a phone (pinch-zoom map + "best available" list), event page sticky GET PASSES bar.
4. Payment method names on the network chips (shown: M-Pesa, Mixx by Yas, Airtel Money, Halopesa) — pending decision 4.
5. Seat maps in v1 at all — pending decision 1.

Outside design voices: skipped on autopilot (the engineering pass already ran Codex; design was calibrated against the client's own handoff).

# Milestones (web) — proposed, 2 engineers, start Mon 2 Nov 2026

| Milestone | Dates | Lane | Exit criteria |
|---|---|---|---|
| M0 Stabilise + sync | 2–6 Nov | all | F0 fixes live; order-status module + regression e2e green; origin = mirror; decisions 1–5 answered |
| M1 Look + storefront | 9–13 Nov | A | handoff tokens on every buyer page; DESIGN.md rewritten; shared event card; a11y checklist pass |
| M2 Checkout v2 | 16–20 Nov | A | 2-step checkout with fee line + artwork; checkout-http e2e extended |
| M3 Analytics | 9–20 Nov | C | beacon + daily aggregates; server events; organizer + admin analytics pages |
| M4 Seat maps | 9–27 Nov | B | seat inventory + holds + seat-aware checkout + passes with seats; builder block/reserve; flag off → on |
| M5 Branded passes | 23 Nov–4 Dec | C | theme resolver; pass design tab; branded web pass + email |
| M6 Installments | 23 Nov–11 Dec | A | x-bridge contract gate passed; plans, reminders, default job, earnings by collected money, organizer/admin views |
| M7 Harden + launch | 14–18 Dec | all | full e2e + QA pass, API/worker redeploy, canary on one Brunch City event |

# Owner decisions — 2026-10-31

1. **Seat maps ship in v1** (M4 stays on the critical path).
2. **x-bridge runs installments end to end** where it can (schedule, collection, reminders on their side). Full guide pending. A20 changes: the F7 adapter `collectInstallment` targets the x-bridge installment API first; the Zora-initiated schedule (A4) stays only as the fallback if the guide arrives without native scheduling. M6 can start its UI, ledger, earnings and pass-gating work before the guide; the provider integration waits for it.
3. **Missed-payment rule: release + refund what was paid, minus the service fee** (the recommended option; confirm if you meant the other).
4. **Payment methods come from x-bridge**; checkout groups them as Mobile money · Card · Scan to pay (QR). Network names are rendered from the x-bridge list, never hard-coded.
5. **Follow the handoff strictly.** Bungee never below 20px (all button labels updated). No new Bungee lines or status chips: installment states are sentence-case text ("Booked — 1 of 3 paid.", "Your pass is on the way") and mono labels; organizer statuses are mono text with a square marker, not chips. CTA stays **GET PASSES**.

# Release plan

Milestones are build blocks, not releases. Code merges to `develop` continuously behind per-feature flags (per event / per organizer), and a **release train goes to `main` + mirror every Friday** (web auto-deploys from the mirror; API + worker redeployed by hand with migrations). Each feature then **turns on** in its own customer-facing release:

| Release | Train | What customers see | Flag |
|---|---|---|---|
| R0 Safety fixes | Fri 6 Nov | nothing visible; leaks + open endpoint closed | none |
| R1 New look | Fri 13 Nov | ZoraPass design on storefront, event, discover | global |
| R2 Checkout v2 | Fri 20 Nov | new checkout; tracking starts collecting | global (old checkout kept one train as fallback) |
| R3 Seat maps (pilot) | Fri 27 Nov | seat picking on one pilot event | per event |
| R4 Analytics + branded passes | Fri 4 Dec | organizer + admin analytics; pass design tab | per organizer → global |
| R5 Installments (pilot) | Fri 11 Dec | pay in installments for one pilot organizer | per organizer |
| R6 General availability | Fri 18 Dec | seat maps + installments open to all organizers | global |

# Parallel development

Works well in **three lanes after M0** (≈70% of the work is in disjoint modules):

```
Lane A  checkout surface   M1 look → M2 checkout → M6 installments   (web checkout, core/payments, worker job)
Lane B  inventory          M4 seat maps                              (core/seat-inventory, floorplan API, seat UI)
Lane C  insight + brand    M3 analytics → M5 branded passes          (beacon/aggregates, admin+org pages, renderer)
```

What has to be serial or coordinated:
- **M0 first, alone.** The order-status refactor touches ~50 money/scan sites; every lane builds on it.
- **Migration numbers assigned up front** (0028–0032) so lanes never collide.
- **Two shared files:** `apps/worker/src/main.ts` (B adds seat-hold sweep, A adds installment job, C adds analytics purge) and `checkout-flow.tsx` (A owns; B passes seat IDs in through props). Merge these in a fixed order: C → B → A.
- **Seat + installment together** (a seat on an installment plan) is only testable once M4 and M6 meet — scheduled as the last week of M6.
- **x-bridge guide** gates M6's provider wiring, not its UI or ledger.

Real bottlenecks are not code: PR review (≈20 PRs over 7 weeks), QA per train, the manual API/worker redeploy, and the x-bridge guide date. With agents in separate worktrees each lane can move at full speed; keep one human reviewer per lane and the Friday train as the only path to `main`.

# x-bridge contract notes (from the x-bridge build session, 2026-10-31)

- **No installments API today.** `/v1` receivables land in x-bridge release 3 (≈ 21 Nov). `/collection/*` switches off at x-bridge release 4 (≈ 28 Nov) → BS138 moves all Zora payments to `/v1`.
- **Shape:** one receivable per installment order. amount = order total, amount type `flexible`, expiry = last due date + grace, `notifications: "none"` (Zora sends reminders).
- **Paying:** Zora keeps the schedule and calls `POST /v1/payments/receivables/:id/pay {method, amount}` with an `Idempotency-Key`. Same key + body returns the first result. A pay is refused if it would exceed balance minus in-flight pushes.
- **Webhooks** (signed `X-Bridge-Signature v1`): `receivable.partially_paid`, `receivable.paid`, `receivable.overpaid` (a bank control number can overpay; Zora refunds or credits the excess), `receivable.expired`.
- **Limits:** mobile-money pushes are capped at 3 per receivable per 10 min and per phone per hour. Retries and "pay now" taps must respect this.
- **Not in x-bridge R3:** fixed schedules, deposits, public payment-methods endpoint. Zora keeps schedule + deposit; the method list stays Zora-configured until x-bridge publishes it.
- Stable docs today: `…/bridge-fsp-adapter/docs/scaling/collections-quickstart.md`, `card-collection-integration-guide.md`, `docs/collection-callback-verification.md`, `docs/api-reference.md`, `xbridge-test-affordances.md`. Contract source: x-bridge `docs/platform/build-plan.md` §4.

# Hosting deliverable — backend on Render (owner, 2026-10-31)

- **BS142 / R8:** API + worker move from the PM2 box to Render via `render.yaml` (Blueprint: env group `zora-backend`, web service `zora-api` with `preDeployCommand: node db/migrate.mjs` and health check `/api/health`, background worker `zora-worker` ×1). Custom domain **api.zorapass.com**.
- Web stays on Vercel (`API_URL=https://api.zorapass.com`, rebuild). Postgres stays on Supabase (session pooler).
- Build process change: a release pushed to `Reli-Tech/zora` `main` now deploys web (Vercel) **and** backend (Render) automatically; migrations run in Render's pre-deploy step (amends A15: no more manual PM2 redeploys after cutover).
- Runbook + env table + cutover/rollback: `docs/deploy/render.md`.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (`codex exec`, read-only) | Independent 2nd opinion | 1 | issues_found | 15 findings, 7 new amendments |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | issues_open | 37 issues, 0 critical gaps (all mapped to A1–A22) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues_open | score: 3/10 → 8/10, 8 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review, completed, 15 findings. Design outside voices: skipped (autopilot).
- **CROSS-MODEL:** eng only — Claude and Codex agree on installment ledger, earnings, inventory state, pass gating, floor-plan auth, seat-aware checkout.
- **VERDICT:** ENG + DESIGN reviewed; owner decisions 1, 3, 4, 5 recorded 2026-10-31 — ready to start M0.

**UNRESOLVED DECISIONS:**
- x-bridge installment guide (who schedules, callbacks, card support) — awaited; gates M6 provider wiring only
