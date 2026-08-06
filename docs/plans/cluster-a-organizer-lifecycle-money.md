# Plan — Cluster A: Organizer lifecycle & money

Items: **#4 registration · #5 verification · #6 commission (point-in-time) · #7 payout**

Sequencing inside the cluster: **#6 → #7** (correct earnings before withdrawals); **#4 → #5** (register then verify). All organizer-facing UIs must be **responsive**.

---

## #6 — Point-in-time commission (foundation)

**Problem.** Net earnings today = `revenue × org.commissionRate` read LIVE (`org-sales.service.commissionRateFor`). Changing the rate silently rewrites all historical earnings. Payouts (#7) must not sit on shifting numbers.

**Model.**
- Commission resolves per order at checkout as: **event override → org rate → platform default (5%)**.
- Per-event override: optional `commissionRate` on the event blob (admin-set; see #9 admin). Absent → org rate.
- **Stamp the resolved rate on the `order` at checkout** (one rate per order — commission is per-org/-event, not per line). Mirrors price versioning (C6).

**Schema / API.**
- Migration `00NN_order_commission.sql`: `alter table "order" add column commission_rate numeric(6,5)` (nullable; backfilled).
- `createGaVipOrder` + the split completion path: resolve the rate (event override→org→default) and write `commission_rate` on order insert. Split shares belong to a `table_share` order → stamp on that order too.
- `org-sales.service`: net = `Σ(order.revenue × order.commission_rate)`, NOT the live org rate. Per-event + totals `netRevenue` recompute from stamped rates. `commissionRate` in the summary becomes an effective/blended display value (weighted), or per-event shows its own.
- Backfill: existing paid orders get `commission_rate = current org rate` (one-time migration using the org's rate at migration time — documented as the accepted approximation for pre-fix orders).

**Admin (per-event override).** Super-admin can set/clear a per-event commission override (lands in #9 admin, event detail). Audited.

**Open decisions for eng review:** (a) numeric precision/rounding rule for net (round per order vs per event); (b) blended `commissionRate` in the summary vs dropping the scalar; (c) does the split parent vs shares double-count revenue for commission? (must net once).

---

## #4 — Organizer registration (Google + Phone)

**LOCKED (D2:B): phone-OTP registration ships first; Google OAuth is a deferred fast-follow PR** — it's the only genuinely new dependency and must not block the pipeline.

**Flow (v1).** `/signup` (organizer) → **Phone (SMS-OTP)** → collect org name + handle → create organizer record `status:'pending', kycStatus:'unverified'` → land on a "pending verification" state. Cannot publish sellable drops or withdraw until #5 approves (reuses the existing KYC gate I6).

**Schema / API (v1).**
- Phone: reuse consumer SMS-OTP (`/api/otp/*`) to verify the phone, then mint an organizer session.
- `POST /api/org/register` — creates the pending org (handle uniqueness vs RESERVED_TOP + existing handles), mints an org session with `role:'organizer', kycStatus:'unverified'`.
- Handle collision + reserved-handle rejection.
- **Deferred (fast-follow):** Google OAuth provider (`GOOGLE_CLIENT_ID/SECRET`, callback route, `googleSub` on the org record, account-linking). Slots in behind the same register endpoint without reworking it.

**UI (responsive).** Signup screen (Google button + phone path), handle picker with live availability, "pending verification" dashboard state.

**Open decisions for eng review:** (a) OAuth lib vs hand-rolled; (b) email/phone as identity — link Google + phone to one org?; (c) can a pending org save drafts (yes) but not publish (no).

---

## #5 — Verification by super admin (unify with KYC)

**Decision (confirmed):** "verification" = the **existing KYC approval** gate, extended to cover self-registered orgs. One review queue.

**Flow.** Pending org (from #4) appears in the super-admin verification queue (the KYC review panel, in the ported admin #9). Super-admin approves → `status:'active', kycStatus:'approved'` (unlocks publishing sellable drops + withdrawals) or rejects with a reason (org notified, per existing KYC reject copy).

**Schema / API.** Reuse `/api/kyc` approve/reject + `is_verified`. Add self-registered orgs to the same queue (a `source:'self-signup'` marker so admin sees new signups distinctly). Audited.

**Open decisions for eng review:** (a) does self-signup require document upload (KYC docs) or is a lighter "verify + activate" enough for v1?; (b) verification unlocks BOTH selling and payout, or separate gates?

---

## #7 — Payout / withdraw (org requests, admin confirms)

**Model.** Out-of-band settlement: admin pays via bank/mobile-money and records it — NOT a gateway payout.

- **Available balance** = `Σ stamped net earnings (paid orders, #6)` − `Σ payouts not in {rejected}`. Per currency (I7 — payouts are single-currency).
- **State machine:** `requested → approved(=paid) | rejected`. (Optionally `approved` then `paid` as two steps; v1 = admin confirm marks paid.)

**Schema / API.**
- Migration: `payout` table `{ id, organizer_handle, amount, currency, status, requested_at, decided_at, decided_by, reference (bank/momo ref), note }`.
- `POST /api/org/payouts` (organizer) — request `amount ≤ available balance`, currency; validates balance server-side; `requested`.
- `GET /api/org/payouts` (organizer) — their payout history + current available balance.
- `GET /api/admin/payouts` + `PUT /api/admin/payouts/:id` (super-admin) — approve (with reference) / reject (reason). Guarded `isAdmin`, audited.
- Balance guard is authoritative server-side (never trust the client amount).

**UI (responsive).** Organizer: available balance card + "Request withdrawal" (amount ≤ balance) + history with statuses. Super-admin (#9): payout queue, confirm-with-reference / reject.

**Open decisions for eng review:** (a) balance is per-currency — one request per currency; (b) hold/lock requested amount so two requests can't exceed balance (concurrency); (c) minimum payout amount; (d) does a payout require the org to be verified (#5) — yes.

---

## Cross-cutting

- **Responsive:** organizer signup, pending state, sales/earnings, payout screens all mobile-first.
- **Dependencies:** #6 lands first (stamps + backfill), then #7 reads stamped net. #4→#5 pair. #5 gates #7.
- **Money safety:** every balance/commission computation is server-authoritative; client only displays.
