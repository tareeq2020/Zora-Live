# ZORA — Bill-Split (Split-a-Table) execution plan

**Goal:** ship a robust bill-split flow on **web** so a fan can land on the discovery
page, open **Seasoned Sundays — Apricot Crush (Brunch Edition)** (thebrunchcity tenant),
start a table split, invite friends over WhatsApp, each pays their own share, the table
is held until all shares settle, everyone can track it, and each payer gets their own
seat credential. Preserve the existing (already-designed) split UI; make it actually work.

**Non-goals this cycle:** mobile app (Phase 4), Google login (Phase 2), programmatic
refunds (Phase 2, manual/ops now).

Reviewed via `/plan-eng-review` (2026-07-23) — Architecture, Code Quality, Tests,
Performance, plus an independent outside-voice challenge. All decisions locked below.

---

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Landing | apex `/` → `/discover` (discovery, not marketing) |
| D2/D3 | Split model + rounding | table capacity N; up-to-N shares; **floor invitees, host absorbs remainder** (OV1) so `sum(shares)==target` exactly |
| D4 | Hold/split window | **configurable** per tier/event (reconcile 8/10/15 copy to the configured value) |
| D5 | Payment | each payer pays their own share |
| D6 | Auth | host logs in via **SMS-OTP**; invitee pays via **signed share link + phone**, auto-verified on payment; Google = Phase 2 |
| D7 | Share channel | **WhatsApp** deep link, SMS fallback |
| D8 | Refunds | **manual/ops now**; programmatic = Phase 2. Incomplete split flags an ops refund task |
| D9 | Surface | web + backend only; mobile Phase 4 |
| A1 | Money model | **share-as-order** under a parent `table_split`; ONE reservation on the parent; each share is `order type='table_share'` (no hold) paid via the existing `initiatePayment`/`applyOutcome`; a new `table_share` branch runs an aggregation gate; on all-paid → convert + issue ONCE |
| A2 | Credentials | at completion, N per-payer credentials bound to each share's `customer_id`; `signCredential tableId=splitId` |
| A3 | Consumer identity | separate consumer session (promote `zora_buyer` to readable), `ConsumerGuard` + `/me` consumer branch, `POST /api/otp/request` + `/verify` reusing `sendSms` |
| A4 | Notifications | suppress per-share confirmation; "share received k/N" receipt; real ticket delivery only at completion |
| A5 | Expiry | split-aware: never blind-release a split with paid shares; `refund_pending` + `alertOps`; host "extend window" while forming |
| A6 | Data ownership | shares are payment-only (zero `order_item`); parent `table_split` owns reservation + price snapshot + credentials + reporting |
| CQ1 | Completion race | single atomic status flip (`update table_split set status='complete' where status='forming' and paid_count=N returning`); only the winner converts+issues |
| CQ2 | OTP | `otp_challenge` in Postgres (hash, 5-min expiry, attempt cap, per-phone throttle) |
| CQ3 | Share amounts | computed + snapshotted server-side once at creation |
| CQ4 | Invite links | HMAC-signed tokens (reuse `signSession`); `unique(split_id, share_index)`; idempotent claim |
| CQ5 | Late payment | share success re-reads parent under lock; not-forming → `alertOps` + `refund_pending`, never pocketed |
| P1 | Track view | reads Postgres only; worker + webhooks drive gateway truth |
| OV2 | Short share | a short/partial share is self-recoverable: void + re-mint a fresh payable share for that seat |
| OV3 | Stuck inventory | a stuck split keeps inventory **locked** (not returned to `available`) in `refund_pending` until ops refunds + explicitly releases; completion checks `convert_reservation()!=0` else issue nothing + alert |
| F1 | Notify | suppress `notifyOrderPaid` at the `reconcile` call site (service.ts:366) + new parent-split delivery fan-out |
| F2 | Cold invitee | claim endpoint mints the `zora_checkout` cookie bound to the share order + phone (else auto-verify never fires) |
| F3 | Read ticket | `GET /api/me/tickets` reads `credential` by `customer_id` via consumer session |
| F4 | Framing | A1 is a **parallel coordination layer**, not "just a branch" — right call, real surface area |

---

## Data model (new)

```
table_split                                  split_share
──────────                                   ───────────
id               uuid pk                      id            uuid pk
event_id         text  → event               split_id      uuid → table_split
product_tier_id  text  → product_tier         share_index   int   (unique per split)
host_customer_id uuid  → customer             order_id      uuid → "order" (type='table_share')
capacity_n       int                          customer_id   uuid → customer  (payer; null until claimed)
price_version_id bigint → price_version       amount        bigint (snapshotted; floor, host absorbs rem.)
target_value     bigint (table price+fee)     is_host       bool
reservation_id   uuid  → inventory_reservation state        text: unclaimed|claimed|paid|voided
window_expires_at timestamptz                 claim_token   text (HMAC-signed; nullable)
status           text: forming | complete | refund_pending | expired
created_at       timestamptz
   invariant: paid_count = count(split_share where state='paid'); complete when = capacity_n

otp_challenge: phone, code_hash, expires_at, attempts, consumed_at, created_at
consumer session: promote zora_buyer cookie → { phone, customerId, verified } readable via ConsumerGuard
```

## Flow (happy path + the guarded transitions)

```
DISCOVER (apex → /discover) ─▶ EVENT (thebrunchcity/Apricot Crush)
     │ "Split this table" (tier is split_enabled)
     ▼
HOST OTP LOGIN (POST /otp/request → /otp/verify → consumer session)
     ▼
CREATE SPLIT  POST /api/splits { tier, N }
     ├─ tier not split_enabled → 400
     ├─ reserve_inventory('split', splitId, N, window) → null (sold out) → 400
     ├─ N ∉ [2..capacity] → 400
     └─ compute+snapshot N share amounts (floor invitees, host remainder) → table_split + N split_share
     ▼
SHARE  WhatsApp deep link per share (HMAC claim_token)          TRACK (GET /api/splits/:id, Postgres-only poll)
     ▼                                                              ▲ k/N paid, live
CLAIM (cold invitee)  GET/POST /api/splits/:id/shares/:i/claim ─────┘
     └─ mints zora_checkout cookie bound to share order + phone (F2); idempotent (CQ4)
     ▼
PAY SHARE  POST .../pay → existing initiatePayment(share order)  → x-bridge collection
     ▼
webhook/worker → applyOutcome(share txn):  [NEW table_share branch]
     ├─ short → void share + re-mint payable share (OV2)
     ├─ success:
     │    ├─ re-read parent UNDER LOCK
     │    │    └─ not 'forming' → mark paid, alertOps + refund_pending (CQ5/OV3), STOP
     │    ├─ mark share 'paid'; SUPPRESS notifyOrderPaid (F1); send "k/N received" receipt (A4)
     │    └─ AGGREGATION GATE (CQ1):
     │         update table_split set status='complete'
     │           where id=$1 and status='forming' and paid_count=N returning   ← single winner
     │         winner ONLY:
     │            converted = convert_reservation('split', splitId)
     │            if converted==0 → issue NOTHING + alertOps (OV3, mirrors paid_unseatable)
     │            else issueTableCredentials(splitId)  ← N creds, per-payer customer_id, tableId=splitId (A2)
     │                 + parent-split delivery fan-out to N customers (F1)
     ▼
EACH PAYER: GET /api/me/tickets (credential by customer_id, F3) → seat QR

EXPIRY (split-aware sweep, A5/OV3):
   window lapses & paid_count==0 → clean release (no refund flag)
   window lapses & paid_count>0  → refund_pending, inventory LOCKED, alertOps; host could 'extend' earlier
```

---

## What already exists (reuse — do not rebuild)

| Need | Existing | Reuse? |
|------|----------|--------|
| Hold a table's inventory | `reserve_inventory`/`convert_reservation`/`release_reservation`/`sweep_expired_reservations` (0003) | Yes, as-is (ref_type='split') |
| Per-payer collection | `initiatePayment`/`applyOutcome` exactly-once machine (service.ts) | Yes — each share is a normal full collection |
| Webhook dedup | `webhook_event unique(provider,dedup_key)` + `resolveTransactionId` | Yes, unchanged |
| Ops-alert / refund worklist | `alertOps` → `webhook_event provider='ops-alert'` (service.ts:427) | Yes — refund_pending alerts route here |
| SMS | `sendSms` (live) | Yes — OTP + receipts + delivery |
| Signed-cookie primitive | `signSession`/`verifySession` (session-cookie.ts) | Yes — consumer session + claim tokens |
| Post-pay buyer promote | `zora_buyer` mint (payments.module.ts:129) | Promote to readable session (was write-only) |
| Credential signing w/ table | `signCredential({...tableId})` (credentials.ts) | Yes — set tableId (today null, service.ts:130) |
| Discovery / event / CheckoutFlow / split UI | `/discover`, tenant event route, `seat-map.tsx` | Yes — wire the designed UI to the new backend |
| Worker reconcile/sweep | `reconcilePending`/`sweepExpiredHolds` (singleton) | Extend with split-aware sweep |

## NOT in scope (explicit)
- Programmatic refunds (Phase 2 — manual/ops via the alert worklist now).
- Google/OAuth login (Phase 2 — SMS-OTP only now).
- Mobile app split wiring (Phase 4 — `CheckoutScreen.tsx` TODO stays a TODO).
- Ticket-scan verification (deferred §S — scanner still talks to the legacy LAN gate).
- Multi-table / cross-event splits, split of GA/VIP (only `table` tiers split).
- Org-sales split reporting breakdown is **sequenced as a fast-follow** (OV4), not a launch blocker.

## Failure modes (each: test? error-handled? user-visible?)
| Codepath | Realistic failure | Test | Handled | User sees |
|----------|-------------------|------|---------|-----------|
| create split | tier sold out at reserve | e2e | reserve→null → 400 | "table no longer available" |
| aggregation gate | two shares settle same instant | e2e | atomic flip, single winner (CQ1) | one completion, no dup |
| completion | reservation lapsed (convert==0) | e2e | issue nothing + alertOps (OV3) | host sees "held up, we're on it" — NOT a silent oversell |
| window expiry | lapses with k>0 paid | e2e | refund_pending, inventory locked, alertOps (A5/OV3) | "split didn't fill; refunds being processed" |
| late payment | share settles after release | e2e | re-read under lock → refund_pending (CQ5) | receipt + refund notice, never pocketed silently |
| short share | partial mobile-money collection | e2e | void + re-mint payable share (OV2) | "payment came up short, re-pay this share" |
| duplicate webhook | gateway re-delivers | e2e | `webhook_event` dedup (reused) | no-op |
| cold invitee | no zora_checkout cookie | e2e | claim mints cookie (F2) | pays + auto-verifies |
| paid invitee ticket | share order has no credential | e2e | `/api/me/tickets` by customer_id (F3) | sees their seat QR |
| OTP | SMS-bomb / brute force | unit+e2e | throttle + attempt cap + expiry (CQ2) | "too many attempts, wait" |
**Critical gaps (no test AND no handling AND silent): none** — every row above has both a test and a handled, user-visible path.

## Test plan (T3:A — full failure-matrix, no shortcut)
- `db/test/split.e2e.sh` + `split.harness.cjs` (mirror `payments.e2e.sh`/`payments.harness.cjs`): all failure-matrix rows above.
- `packages/core/test/split.test.mjs` (`node --test`): rounding (floor+remainder sums to target), claim-token sign/verify, OTP hash/expiry/attempt-cap, aggregation single-winner.
- **Regression (IRON RULE, mandatory):** (1) existing GA/VIP `applyOutcome`+checkout stays byte-identical after the `table_share` branch (extend `payments.e2e.sh`); (2) apex→`/discover` uses the existing broad middleware matcher (`apps/web/test/verify.mjs`, learning `nextjs-middleware-matcher-multisegment`).

## Implementation phases (build order)
1. **Migration 0006_bill_split.sql** — `table_split`, `split_share`, `otp_challenge`; `split_enabled` on `product_tier`; indexes (`phone`, `split_id`, `share_index`).
2. **@zora/core/split.ts** — `createTableSplit`, share-amount computation, `claimShare`, the `table_share` branch + aggregation gate + `completeSplit` (atomic flip), `issueTableCredentials`, `splitAwareExpirySweep`, short-share void+re-mint. **@zora/core/otp.ts** — request/verify.
3. **apps/api** — `/api/otp/{request,verify}`, `ConsumerGuard` + `/me` consumer branch + `/api/me/tickets`, `/api/splits` (create), `GET /api/splits/:id` (track), claim, `.../pay`; suppress `notifyOrderPaid` for `table_share` at the reconcile call site + parent delivery; org tier `split_enabled` PUT.
4. **apps/web** — apex→`/discover`; wire `seat-map.tsx` split UI to the backend; WhatsApp invite; **track view** (new); **consumer OTP login screens** (new); organizer split-enable toggle (new).
5. **worker** — register `splitAwareExpirySweep` in the singleton loop.
6. **tests** — as above, alongside each unit.
7. **fast-follow** — org-sales `table_split` reporting branch (OV4).

## Worktree parallelization
| Step | Modules | Depends on |
|------|---------|-----------|
| Migration 0006 | `db/` | — |
| core split+otp | `packages/core/` | migration |
| api endpoints | `apps/api/` | core |
| web surfaces | `apps/web/` | api (contract) |
| tests | `db/test`,`packages/core/test`,`apps/web/test` | its target |

- Lane A: migration → core split/otp → api (sequential, shared contract).
- Lane B: web OTP-login screens + organizer toggle can start against a mocked contract in parallel once the API shapes are frozen.
- Lane C: web routing (apex→/discover) is independent of the split backend — start immediately.
Execution: launch **C** now (routing + regression). Run **A** as the spine. Start **B** once API request/response shapes are frozen (after api step begins). Conflict flag: A and B both touch `apps/web/` split UI — keep B on new files (login screens, toggle, track view), leave `seat-map.tsx` wiring in Lane A's tail to avoid a merge conflict.

## Implementation Tasks
Synthesized from this review. P1 blocks ship; P2 same branch; P3 follow-up.

- [ ] **T1 (P1, human ~1d / CC ~20min)** — db — migration `0006_bill_split.sql` (`table_split`, `split_share`, `otp_challenge`, `product_tier.split_enabled`, indexes)
  - Files: `db/migrations/0006_bill_split.sql`; Verify: `pnpm db:test`
- [ ] **T2 (P1, human ~3d / CC ~45min)** — @zora/core — `split.ts` (create, share math, claim, table_share branch + aggregation gate + completeSplit atomic flip, issueTableCredentials, split-aware sweep, short-share void+re-mint)
  - Surfaced by: A1/A2/CQ1/CQ3/OV2/OV3; Files: `packages/core/src/split.ts`, `credentials.ts`, `inventory.ts`; Verify: `node --test packages/core/test/split.test.mjs`
- [ ] **T3 (P1, human ~1d / CC ~20min)** — @zora/core — `otp.ts` request/verify (hash, expiry, attempt cap, throttle)
  - Surfaced by: CQ2; Files: `packages/core/src/otp.ts`; Verify: core unit
- [ ] **T4 (P1, human ~1d / CC ~20min)** — apps/api — consumer session: promote `zora_buyer` readable, `ConsumerGuard`, `/me` consumer branch, `GET /api/me/tickets`
  - Surfaced by: A3/F3; Files: `apps/api/src/common/*`, `apps/api/src/payments/payments.module.ts`; Verify: api e2e
- [ ] **T5 (P1, human ~2d / CC ~30min)** — apps/api — split endpoints (`/api/splits`, `/:id`, claim mints checkout cookie F2, `.../pay`), OTP endpoints; suppress `notifyOrderPaid` for `table_share` at reconcile call site + parent delivery
  - Surfaced by: A1/A4/F1/F2/P1; Files: `apps/api/src/splits/*`, `apps/api/src/auth/*`; Verify: `db/test/split.e2e.sh`
- [ ] **T6 (P1, human ~1d / CC ~20min)** — apps/web — apex `/` → `/discover` via existing broad matcher + regression test
  - Surfaced by: D1 + learning; Files: `apps/web/middleware.ts`, `apps/web/test/verify.mjs`; Verify: `node apps/web/test/verify.mjs`
- [ ] **T7 (P1, human ~3d / CC ~40min)** — apps/web — wire `seat-map.tsx` split UI to backend; WhatsApp invite; new track view; new consumer OTP login screens
  - Surfaced by: A1/A3/D7; Files: `apps/web/app/(app)/events/[id]/seats/*`, new `splits/*`, login screens; Verify: web behavior test
- [ ] **T8 (P1, human ~1d / CC ~20min)** — apps/web + api — organizer per-tier `split_enabled` toggle (PUT + drop-editor UI)
  - Surfaced by: A6; Files: `apps/api/src/org/*`, `apps/web/app/(app)/dashboard/events/*`; Verify: org e2e
- [ ] **T9 (P1, human ~2d / CC ~30min)** — tests — full `split.e2e.sh` + `split.harness.cjs` failure matrix + 2 regression guards
  - Surfaced by: T3:A; Files: `db/test/split.e2e.sh`, `db/test/split.harness.cjs`; Verify: bash script green
- [ ] **T10 (P1, human ~1d / CC ~15min)** — data — seed the Apricot Crush event + split-enabled table tier on thebrunchcity
  - Files: `db/seed-*`, `data/events.json`/pg; Verify: event renders at `/discover` + tenant route
- [ ] **T11 (P2, human ~1d / CC ~20min)** — worker — register `splitAwareExpirySweep` in the singleton loop
  - Files: `apps/worker/main.ts`, `packages/core/src/split.ts`; Verify: sweep e2e row
- [ ] **T12 (P2, fast-follow) — apps/api** — org-sales `table_split` reporting branch (OV4)
  - Files: `apps/api/src/org/org-sales.service.ts`; Verify: org-sales e2e

## Design (locked via /plan-design-review, 2026-07-23)

Three persona journeys designed as HTML storyboards on the **real** `zora-tokens.css`
(reuse the look, fix the copy/UX/journeys). Artifacts:
`~/.gstack/projects/tareeq2020-Zora-Live/designs/billsplit-host-20260723/{host,invitee,organizer}-journey.html`,
copy deck `.context/bill-split-copy-deck.md`, system reference `DESIGN.md` (new).

- **Host (consumer, dark):** OTP login → configure split (**fixed** the mock free-stepper → table-bound N with presets + stepper for any N, server-authoritative share) → WhatsApp invite → track "who's paid" ★ → completion (own seat QR).
- **Invitee (cold WhatsApp, no session):** trust-first landing → pay share (money "goes to the table, not to {host}") → "you're in, k/N" receipt → own ticket → honest refund/didn't-fill screen.
- **Organizer (control-room, paper):** per-tier split toggle (reuses `.togglebar/.switch`) + configurable hold window; sales view with the **refund worklist** (the manual-refund seam made visible + safe).

Design decisions: **DV1** disclose the manual/delay refund reality up front on the cold landing · **DV2** ship lightweight inviter trust now (name + social proof + support/legal + "money goes to the table" line up front), verified identity as a fast-follow · **DV3** the system reminds the "pay later" host (their share blocks completion).

Folded from the design outside-voice (build these — not just states): cold-link double-charge guard, USSD payment-pending screen + timeout/recovery, table-full-on-arrival and expired-on-arrival(unpaid) dead-ends, refund-sent confirmation, empty/zero states, a real extend-window lever, host-as-payer flow, reassign-unclaimed-share. Accessibility rule added to `DESIGN.md`: highest-stakes copy (money/refund/countdown) gets highest legibility, not `text3`/10px.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run (optional) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean (folded) | 6 arch + 5 code-quality + 1 perf + full test matrix, all resolved |
| Outside Voice (eng) | Claude subagent | Independent 2nd opinion | 1 | issues_found → folded | 8 findings; 4 decisions (OV1–OV4) + 4 fold-ins (F1–F4) |
| Design Review | `/plan-design-review` | UI/UX + journeys + copy | 1 | 3/10 → 9/10 | 3 personas designed; 6 decisions; 1 unresolved |
| Design Outside Voice | Claude subagent | Independent design 2nd opinion | 1 | issues_found → folded | 8 findings; DV1–DV3 decided, rest folded as build reqs |

**CROSS-MODEL:** both outside voices materially hardened this plan. Eng voice caught the rounding contradiction (OV1), bricked-split-on-short-pay (OV2), stuck-inventory ambiguity (OV3). Design voice caught the cold-link double-charge risk, the missing USSD-pending screen, refund overpromise, and the a11y inversion (highest-stakes copy in lowest-legibility text). No unresolved cross-model tension — every point was user-decided or folded.

**VERDICT:** ENG + DESIGN CLEARED to implement. Money model is a parallel coordination layer over the untouched exactly-once core; every failure-matrix row has a test + a handled, user-visible path; all three persona journeys are designed on the real tokens with final copy and full state coverage. Next: build (T1→T12), then verify live with `/qa` + `/design-review` (the "every button works, responsively, on device" pass this plan review cannot itself guarantee).

Refund SLA locked: **24 hours** — cold-invitee refund copy + receipts promise refund within 24h; ops must action any `refund_pending` split within that window.

NO UNRESOLVED DECISIONS
