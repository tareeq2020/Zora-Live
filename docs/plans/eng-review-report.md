# Eng review — Zora roadmap (clusters A/B/C)

Reviewed 2026-08-05. Covers `cluster-a/b/c-*.md`. Cluster D (discover) is design-only → `/plan-design-review`.

## Locked decisions

**Step 0 (scope):** D1 commission stamps on the `table_share` order (splits) · D2 phone-OTP registration first, Google OAuth deferred · D3 build the React AdminShell first, strangler-fig port · D4 messaging v1 = queued send + opt-out + aggregate status (defer per-recipient tracking + templates).

**Architecture:** 1 `#6` also **unions split revenue** (`split_share.amount`) into the sales query — split money is invisible today · 2 `#7` payout balance computed+inserted **under a per-org lock**, pending requests **reserve** balance · 3 scanner auth = **scoped session minted from a rotatable 6-digit code** + role · 4 `#2` fan-out = **bounded batches on the worker** · 5 `#6` backfill = each order gets its **org's current rate**.

**Code quality:** 1 one `resolveCommissionRate` + `netOf` in `@zora/core` (no duplication) · 2 one `BroadcastComposer` + send service, two scoped mount points · 3 typed payout rejection codes + `messageForError` · 4 shared `AdminShell`/`AdminTable`/`AdminCard`/`useAdminResource` before porting panels.

**Performance:** 1 `#3` admin orders paginated + recent-window default + index `order(status,created_at)`/`event_id` · 2 `#2` audience count cheap (aggregate) + recipients materialized/queued in batches.

**Outside voice (all accepted):** OV1 **add a refund/debit path** — order `refunded` state + event-cancellation clawback; balance = `Σ paid net − Σ refunded net − Σ payouts`, floored at 0 · OV2 **migrate `organizers` from the JSON blob to a real table** (prerequisite for A — enables row locks, kills last-write-wins) · OV3 **#9 AdminShell is the critical path**, sequence it first · OV4 extend the existing `credential.state` (don't add a parallel scan column) + **rate-limit the code→session exchange** · OV5 gate messaging on #5 verification + per-org monthly SMS cap + sender-ID/opt-out (defer prepaid billing) · OV6 **agent HMAC-scan is the gate (offline-capable); supervisor-confirm only for flagged/comp/table credentials, not every GA** · OV7 payouts settle per-currency, admin enters FX/reference at confirm · OV8 `#3` view includes `split_share` rows + time-boxed PII for never-paid carts.

## What already exists (reuse, don't rebuild)

- `price_version` versioning (the precedent for #6 point-in-time stamping).
- consumer SMS-OTP (`/api/otp/*`) → reuse for #4 phone registration.
- KYC review + `is_verified` gate → IS #5 (just add a `source:'self-signup'` marker).
- `credential` HMAC sign/verify (`packages/core/credentials.ts`) + `credential.state` (`issued|used|revoked`, `0001_init.sql:210`) → extend for #1 scan lifecycle.
- `agents` (6-digit codes, rotate/revoke) → extend with `role` for scanner users.
- `SMS_DRIVER`/`EMAIL_DRIVER` + the singleton worker → reuse for #2 (bounded batches).
- `order`/`order_item`/`split_share` → #3 reads them (no schema change); #6 stamps on `order`.

## NOT in scope (deferred, with rationale)

- **Google OAuth registration** — phone-OTP first; OAuth is a clean fast-follow (D2).
- **Per-recipient delivery tracking, message templates/personalization** — v1 aggregate status (D4).
- **Prepaid/funded SMS billing** — v1 uses a per-org cap; netting SMS cost from payout is a later ledger feature (OV5).
- **Offline scanner queue** — agent HMAC-verify already works offline; the two-step confirm is online (OV6 keeps confirm selective so a blip doesn't stop the GA gate).
- **Automated gateway payouts / FX conversion** — payouts are admin-confirmed out-of-band, per-currency, FX entered by hand (OV7).
- **Cluster D discover redesign** — design track.

## Failure modes → coverage

| New path | Realistic failure | Test | Handling | Silent? |
|---|---|---|---|---|
| #7 balance | two concurrent withdrawals over-withdraw | CRITICAL e2e (concurrency) | per-org lock + reserve | no |
| #7 balance | withdraw refunded money | e2e (refund → balance drops) | OV1 debit term | **was silent — now handled** |
| #6 splits | split revenue omitted or double-counted | e2e (split union + stamp) | ARCH-1 union, D1 stamp-once | no |
| #1 scan | replay / double-scan | e2e (already-scanned) | dedup + state guard | no |
| #1 auth | 6-digit code brute-forced | e2e (lockout) | OV4 rate-limit | **was silent — now handled** |
| #2 send | opt-out ignored | e2e (suppression) | suppression list | no |
| org write | concurrent signup/edit lost | e2e (OCC) | OV2 org table | **was silent — now handled** |

No remaining critical gap (all of the above now have a test + handling in the plan).

## Parallelization (worktree lanes)

| Lane | Work | Depends on |
|---|---|---|
| **C** | #9 AdminShell + shared admin primitives (sidebar, table/card, fetch hook) | — (start first — critical path) |
| **0** | OV2 org→table migration → #6 commission core (resolve/net in core, stamp, split-union, refund/debit OV1, backfill) | — (start first) |
| **1** | #7 payout ledger (request/confirm/reject, balance under lock) | Lane 0 (#6 net + OV1) |
| **Areg** | #4 phone registration → #5 verify queue | Lane 0 (org table) + Lane C (admin queue) |
| **Bscan** | #1 scan state (extend credential.state), scanner session + role gate, PWA | Lane C (scanner-user admin) |
| **Bmsg** | #2 broadcast tables + worker bounded-batch + composer | Lane C (admin scope) |
| **D** | #8 discover redesign | — (fully independent) |

**Execution:** launch **C + 0 + D** in parallel worktrees. Then **1** after 0; **Areg** after 0+C; **Bscan/Bmsg** after C. Conflict flag: Lanes 0, 1, Areg all touch `org` + `@zora/core` money paths → keep them one lane (sequential), not parallel.

## Implementation Tasks
Synthesized from the findings. P1 blocks ship; P2 same branch; P3 follow-up.

- [ ] **T1 (P1)** — org model — migrate `organizers` JSON blob → relational table (OV2); update all `entities.read('organizers')` callers. Foundation for A. Verify: org-events/org-sales e2e still green.
- [ ] **T2 (P1)** — core — `resolveCommissionRate(event,org)` + `netOf(gross,rate)` in `@zora/core` (CQ1). Verify: core unit tests (branches + rounding).
- [ ] **T3 (P1)** — checkout/core — stamp `order.commission_rate` at pay time for GA/VIP + `table_share` (D1, ARCH-1); migration + backfill with org current rate (ARCH-5). Verify: e2e stamp + backfill.
- [ ] **T4 (P1)** — org-sales — net from stamped rate; **union `split_share` revenue** (ARCH-1). Verify: e2e split-union + net-from-stamped.
- [ ] **T5 (P1)** — orders/refunds — order `refunded` state + event-cancellation clawback; earnings subtract refunds (OV1). Verify: e2e refund → balance drops.
- [ ] **T6 (P1)** — payouts — `payout` table + request (balance under per-org lock, reserve pending, typed errors CQ3) + admin confirm/reject + per-currency FX at confirm (ARCH-2, OV7). Verify: CRITICAL concurrency e2e + verified-gate.
- [ ] **T7 (P1)** — admin — `AdminShell` + sidebar + responsive primitives; strangler-fig port scaffold (D3, OV3, CQ4). Verify: QA per section.
- [ ] **T8 (P1)** — scan — extend `credential.state` lifecycle + `/scan/verify` (agent, offline-capable) + `/scan/confirm` (supervisor, selective per OV6) with transition guards. Verify: e2e valid/replay/invalid-transition/role-gate.
- [ ] **T9 (P1)** — scanner auth — scoped session from rotatable code + role + **rate-limit/lockout** (ARCH-3, OV4). Verify: e2e brute-force lockout.
- [ ] **T10 (P2)** — registration — `POST /api/org/register` (phone-OTP), pending state, handle/reserved guards (D2). Verify: e2e collision/reserved/OTP.
- [ ] **T11 (P2)** — verification — self-signup marker into the KYC queue; approve unlocks sell + payout (#5). Verify: e2e pending→approved gate.
- [ ] **T12 (P2)** — messaging — `broadcast`/recipient tables + worker bounded-batch fan-out + suppression/opt-out + sender-ID + per-org cap + verification gate (D4, ARCH-4, OV5, PERF-2). Verify: e2e scope-isolation + opt-out + batch drain.
- [ ] **T13 (P2)** — messaging UI — one `BroadcastComposer` mounted in both consoles with scope diff (CQ2). Verify: QA.
- [ ] **T14 (P2)** — admin orders — `GET /api/admin/orders` all-states incl `split_share`, paginated + recent-window + index; time-boxed PII (PERF-1, OV8, #3). Verify: e2e pending/failed/split visible.
- [ ] **T15 (P3)** — Google OAuth registration fast-follow (deferred D2).

## Completion summary
- Step 0: **scope reduced** per recommendation (D2 Google-defer, D4 messaging-trim).
- Architecture: 5 issues found, all folded.
- Code Quality: 4 issues found, all folded.
- Test review: coverage diagram produced, 17 new paths → all mapped to e2e/unit gaps; 0 regressions (all-new code).
- Performance: 2 issues found, all folded.
- NOT in scope: written. · What already exists: written.
- Failure modes: 3 previously-silent gaps (refund leak, org-blob race, code brute-force) now handled — **0 remaining critical gaps**.
- Outside voice: ran (Claude subagent) — 10 findings, all accepted; 2 P0 money holes caught.
- Parallelization: 7 lanes (C+0+D parallel, then 1/Areg/Bscan/Bmsg).
- Lake score: 15/15 decisions chose the complete option.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_found → all folded | 11 issues + 10 outside-voice, 3 critical gaps closed |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | pending | clusters A/B/C UIs + D |

**CODEX:** not installed — outside voice ran via Claude subagent (2 P0 money holes: refund debit, org-blob concurrency — both accepted).
**VERDICT:** ENG CLEARED — plan hardened and ready to implement. Design review recommended next (scanner UI, payout/registration screens, admin look, discover #8).

NO UNRESOLVED DECISIONS
