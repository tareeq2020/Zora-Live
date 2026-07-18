# ZORA — Backend + Ticketing + Payments plan (single execution plan)

Turns the file-based admin API into a **Supabase-Postgres ticketing backend** with
**atomic inventory, signed ticket credentials, x-bridge/ClickPesa payments, object
storage, and stateless sessions**, running under **pm2** (frontend stays on Vercel).

The domain **logic and infra are lifted from a reference ticketing backend** and
re-implemented **generically** — no external brand/event/org identity is carried
over (no third-party project names, bank names, event names, or their cookie/
prefix/scope strings). We keep only the **x-bridge gateway contract** (FSP ids like
`CLICKPESA`), since we integrate the same gateway, and we drive it from config.

## Sanitization rule (applies to everything lifted)
- Package/domain: `@zora/core`. Cookies: `zora_admin`, `zora_checkout`, `zora_buyer`, `zora_slot`.
- Idempotency tx id: `ZORA-<orderId>-<attempt>`. Ticket ref: `ZORA-XXXX-XXXX`. QR payload: `zora:<code>:<sig>` (HMAC-signed). **Scanner verification is a separate later workstream** — the current mobile scanner talks to a legacy LAN gate that does NOT check signatures (see Execution hardening §S).
- Keep, but config-driven (not hardcoded): FSP ids (`CLICKPESA`/`SELCOM`), `currency:"TZS"`, MSISDN `255` rules, MNO codes. These are gateway/market facts, not identity.
- Lift the **patterns, SQL, function shapes, state machines**; re-type them in our stack. Nothing copied verbatim that carries a foreign identifier.

---

## Architecture (adopted from the reference, sanitized)

```
packages/core/            @zora/core — framework-agnostic domain (NO http/nest imports)
  db.ts                   postgres.js pool + tx() helper + int8 parser
  config.ts               setting-table reader w/ ~10s cache (fees, routes, kill-switches)
  catalog / inventory     tiers, price_version, inventory pools + atomic holds
  credentials             signed ticket issuance (HMAC), offline-verifiable
  payments/{xbridge,service}   gateway adapter + order/payment state machine
  self-entry / booking    tables, entry_slot (OTP), seat claim
  sms / email             pluggable drivers
  worker.ts               reconciliation + sweeps (singleton)
apps/api/                 NestJS — thin HTTP layer over @zora/core (controllers/guards only)
apps/worker/              runs @zora/core worker loops as a singleton pm2 process
apps/web/                 Next.js (unchanged shell) — checkout flow follows the contract
db/migrations/*.sql       hand-written SQL; runner = schema_migrations + advisory lock
```
Rule: **core owns data + logic; the api layer only does HTTP/cookies; the worker is one process.**

## Decisions (recommended defaults — veto any)
| # | Decision | Default |
|---|----------|---------|
| D1 | DB layer | **postgres.js** tagged SQL + hand-written migrations + tiny runner. No ORM, no supabase-js for data. |
| D2 | Money | **whole-TZS `bigint` + `currency` text** (no minor unit). |
| D3 | Sessions | **Stateless HMAC-signed cookie** (admin now; phone-first `customer` when checkout ships). Split `SESSION_SECRET` / `KYC_SECRET` / `TICKET_SIGNING_KEY`. |
| D4 | Tenancy | **Organizer = first-class tenant**; scope events/tiers/orders/kyc by `organizer_id`. |
| D5 | Domain placement | **`packages/core`** framework-agnostic; api + worker both import it. |
| D6 | Enums | `text` + commented value sets (migration-free). |
| D7 | Gateway | **x-bridge**, FSP routing in the `setting` table; primary `CLICKPESA` (mobile USSD-push + BillPay control number). |
| D8 | Config | **In-DB `setting` table** (fees, routes, TTLs, kill-switches) w/ short-TTL cache — editable without deploy. |
| D9 | Build order | Migrate existing data first (Phase A); build ticketing+payments net-new (Phase B); frontend checkout follows (Phase C). |

---

## Schema (full target; build in phases)

### Identity & tenancy
- **`app_user`** (staff/admin): id, email unique, password_hash (scrypt), role text (`super_admin|admin|read_only`), status.
- **`organizer`** (tenant): id, handle unique, name, email, status, revenue bigint, auth_user_id null (Supabase bridge later).
- **`customer`** (buyer, phone-first): id, phone unique, email, name, password_hash null; partial-unique `lower(email) where password_hash is not null`.

### Catalog + pricing
- **`event`**: id text slug PK, organizer_id FK, name, tagline, category, city, venue, date_label, status text(`draft|published|past`), props jsonb.
- **`product_tier`**: id text PK, event_id FK, name, kind text(`shore|vessel|table`), capacity int, sort_order, status text(`open|locked|soldout`).
- **`price_version`**: id bigint identity, tier_id FK, price bigint, currency, fee_treatment text(`passed|absorbed`), effective_from, effective_to null, updated_by.

### Inventory (atomic anti-oversell — the crown-jewel lift)
- **`inventory_pool`**: tier_id unique, capacity, available_count, sold_count, blocked_count, reserved_count; **CHECK `available+sold+blocked+reserved <= capacity`**.
- **`inventory_hold`** / **`inventory_reservation`**: TTL ledgers (`held|converted|released`), partial index `where state='held'`.
- **PL/pgSQL fns:** `place_inventory_hold(tier,order,qty,ttl)` (conditional decrement `where available>=qty`, returns hold id or NULL), `convert_order_holds`, `try_reacquire_order`, `release_order_holds`, `reserve/convert/release/sweep_reservation`.

### Orders / payments / credentials (lift)
- **`order`**: id uuid, customer_id FK, event_id FK, type text(`ga|table`), status text(`pending|paid|failed|expired|cancelled|paid_unseatable|payment_short`), target_value bigint, notified_at, booking_id null.
- **`order_item`**: id, order_id FK cascade, tier_id FK, price_version_id FK, quantity, unit_price bigint.
- **`payment_transaction`**: id, order_id FK, **transaction_id text unique** (`ZORA-<order>-<n>`), method text(`mobile|billpay|card`), fsp_id text, amount bigint, currency, status text(`created|pending|processing|successful|failed|partial|expired`), order_reference, bill_pay_number, collected_amount.
- **`webhook_event`**: provider, dedup_key text (sha256 raw body), transaction_id, applied bool, **unique(provider,dedup_key)** (also reused as ops-alert ledger).
- **`credential`** (ticket): id, order_item_id FK null, event_id FK, tier_id FK, **code text unique**, signature text (HMAC over `code.tier.event`), state text(`issued|used|revoked`), holder_name, table_ref, seat_index; **unique(order_item_id, seat_index)**.

### Tables / self-entry (lift)
- **`booking`** (parent of N table orders), **`entry_slot`** (tokenized self-entry: token_hash unique, OTP state, field_schema jsonb, data jsonb, status), **`venue_table`** (physical table ↔ sold order), **`venue_floorplan`**.

### Existing collections → tables
- **`registration`** (crews): event_id FK, crew/lead/phone/email/size/code; unique(event_id, phone). ← registrations.json
- **`kyc_verification`** (organizer_id FK, ref unique, status, id_type, country, full_name, masked, hash, attempt, review, vendor jsonb) + **`kyc_document`** (verification_id FK, **storage_path**, side, content_type, sha256). ← kyc.json + kyc-private/*.enc
- **`setting`** (key PK, value jsonb), **`theme`** (organizer_id FK), **`placement`** (slot PK), **`floorplan`** (event_id FK, zones jsonb), **`media_asset`** (path PK, status, storage_path), **`agent`** (staff scanner cred), **`audit_log`** (actor/action/detail jsonb/at/ip). ← the rest

---

## Ticketing domain to lift (sanitized) — Phase B1

1. **Atomic inventory.** Oversell made structurally impossible: single conditional-decrement fn + the CHECK ceiling. Holds/reservations are TTL ledgers swept by the worker. Reserved bucket (separate `reserved_count`) for soft table/corporate holds distinct from `sold`.
2. **Order creation = all-or-nothing tx:** upsert customer → insert order(pending) → per line place atomic hold (rollback releases prior holds on sold-out) → insert items at the exact `price_version` → compute fee → set `target_value`. Read config **before** opening the tx (avoid a 2nd pooled connection while holding one).
3. **Credentials (tickets):** one per seat, `on conflict (order_item_id, seat_index) do nothing` = idempotent issuance. `code` opaque (no PII); `signature = HMAC(code.tier.event, TICKET_SIGNING_KEY)`; QR = `zora:<code>:<sig>`. Design the verifier to accept a **list** of signing keys (future key rotation / venue minting). **NOT wired to the mobile scanner in this plan** — see §S: the current scanner hits a legacy gate with no signature check; connecting it to a real API scan-verify endpoint is a deferred workstream.
4. **Never issue a ticket without confirmed inventory:** on payment success, convert holds; if lapsed → `try_reacquire`; if gone → mark `paid_unseatable`, alert ops for refund, **issue nothing** (anti-oversell escape hatch). Amount check: `collected < target` → `payment_short`, no ticket.
5. **Tables + self-entry:** parent `booking` → child table orders; tokenized `entry_slot` with OTP challenge + data-driven `field_schema` for guest self-check-in.

## Payments to lift (sanitized) — Phase B2

**x-bridge adapter (`@zora/core/payments/xbridge`)** — plain `fetch`, no SDK:
- Auth = key-id/secret → short-lived JWT: `POST /generate-token {keyId,secret} → {token,expiresAt}`; **in-process token cache + single-flight + 60s early-refresh** (relies on the long-lived pm2 host).
- `collectMobile({transactionId,amount,payerPhone,fspId,callbackUrl})` → USSD push. `collectBillPay({...,payerName,paymentMode})` → control number (ClickPesa `paymentMode:"EXACT"` locks amount; never send EXACT to Selcom). `collectCard(...)` → hosted-checkout redirect url. All carry a caller-supplied `transactionId` and `currency:"TZS"`.
- **`collectionStatus(txId, fspId)` is the authority** (`PENDING|COMPLETED|PARTIAL|FAILED` + `collectedAmount`). `fspId` required.
- Helpers: `normalizeMsisdn → +255…`, `cardCheckoutUrl` normalizes provider url field.
- No timeout/retry in the adapter — reliability delegated to the worker poll loop.

**FSP routing** = `setting.fsp_route_map` (data, not code): `(method,MNO) → method default → CLICKPESA`; capability-failover guard; buyer UI resolves the same map so displayed fee == charged. Kill-switches in settings: `method_enabled`, `sales_paused` (→ 503+Retry-After), `mm_max_amount`.

**Order/payment state machine (`@zora/core/payments/service`):**
- Per-attempt `transaction_id = ZORA-<order>-<count+1>` (a timed-out PIN is retryable with a fresh key). Retry of a `failed` order re-acquires inventory first.
- **Webhook is a trigger, not truth:** dedup on `sha256(rawBody)` in `webhook_event`; ClickPesa carries no tx id → reverse-map via stored `order_reference`; then **re-fetch `collectionStatus`** and apply.
- **`applyOutcome` = apply-exactly-once:** `SELECT … FOR UPDATE` + terminal-status guard; order-level already-`paid` guard (duplicate collection → alert+refund, no reissue); success → convert inventory → issue credential; short/failed/unseatable handled explicitly. Confirmations (SMS/email) fire **outside** the tx, once-guarded by `notified_at`.

**Reconciliation worker (`apps/worker`, singleton):** sweeps holds/reservations (60s) + reconciles pendings (30s). **Per-method expiry windows** (mobile ~1h, card ~2h, BillPay ~72h) — a control number stays payable for days; expiry only drops it from the poll budget, a late `COMPLETED` still settles + issues. Bounded concurrency (~8). **Must be exactly one instance** (pm2 `instances:1`).

**Idempotency inventory:** tx id (unique) · webhook dedup (sha256) · applyOutcome row-lock+terminal · credential per-seat · `notified_at` · bulk-resend ledger · inventory fns.

## How the frontend follows (Phase C — Zora's own Next.js, contract only)
Our checkout journey mirrors the lifted contract (we build our UI; we do not copy theirs):
1. `POST /api/checkout` `{phone,email,cart:[{tier,qty}],method?,network?}` → `{orderId,total}` (or `409 sold_out`, `503 sales_paused`). Sets signed `zora_checkout` cookie binding browser↔order.
2. `POST /api/checkout/:orderId/pay` `{method,payerPhone,payerName?,mno?}` → **mobile:** `{transactionId,status:"pending"}` (PIN pushed) · **billpay:** `{billPayNumber}` (show control number) · **card:** `{redirectUrl}`.
3. `GET /api/orders/:orderId/status` (poll) — route self-reconciles so a closed browser still resolves. Returns terminal `status` + `credentials:[{tier,state,qr:"zora:<code>:<sig>",code,seatLabel}]`. On `paid`, render QR; also delivered by SMS + email (QR PNG). Paying (PIN) auto-issues `zora_buyer{verified}` without OTP; other devices need OTP.

Zora already renders premium tickets (`lib/ticket.ts`) — the credential `code`+`sig` feeds that renderer. (Scanner verification is deferred, §S.) Note: the current QR default is `zora://t/<id>`; adopting `zora:<code>:<sig>` is a format change to reconcile when checkout ships, not at the as-is launch.

## Sessions / storage / deploy
- **Sessions:** stateless HMAC-signed cookie (`sign/verify` in core), scrypt passwords. Split secrets: `SESSION_SECRET` (cookie), `KYC_SECRET` (doc encryption, seeded to the current value), `TICKET_SIGNING_KEY` (QR).
- **Storage:** Supabase Storage — `kyc-private` (private bucket; keep app-layer AES as defense-in-depth) + `media` (public/CDN).
- **Deploy:** one image, pm2 `ecosystem.config.js` = `zora-api` (web/HTTP) + `zora-worker` (**instances:1, singleton**). `render.yaml`/`fly.toml`/`railway.json` mirrors. Frankfurt co-located w/ Supabase EU.
- **Env:** `DATABASE_URL`,`PG_POOL_MAX`,`PG_PREPARE`; `XBRIDGE_BASE_URL`,`XBRIDGE_KEY_ID`,`XBRIDGE_SECRET`,`PUBLIC_ORIGIN`; `SESSION_SECRET`,`KYC_SECRET`,`TICKET_SIGNING_KEY`; `SUPABASE_URL`,`SUPABASE_SERVICE_ROLE_KEY`; `SMS_DRIVER`+creds; `EMAIL_DRIVER`+creds. (No ClickPesa creds in env — they live in the gateway, keyed by the JWT.)

---

## Execution sequence (PR → develop)

**Phase A — foundation & migrate existing (no new features).** Cutover is **backfill-first + per-entity feature flag + rollback** (eng-review decision):
- **PR-1** `@zora/core` + postgres.js `db` + migrations runner + DDL for the current domain. Two DB URLs: **session/direct (5432) for migrations** (advisory lock + no prepared-stmt limit), transaction pooler for runtime. Reviewed before merge.
- **PR-2** Per-entity Repository interface + a `DATA_BACKEND[entity]` flag (`json`|`pg`), default `json`. This is a **service-layer change** (the 15 modules call whole-collection `readJson`/`writeJson`; that becomes per-entity repo calls) — NOT just swapping `FileStore`'s implementation.
- **PR-3** Per-entity: **backfill** JSON→Postgres, then **golden-dataset diff** (every read endpoint byte-matches the pre-migration API, reproducing quirks: `/tiers` sort, `/kyc` reverse, `/audit` last-120-reverse, media-from-fs), then **flip the flag to `pg`**. Flag = instant rollback. Repeat entity by entity. Retire the events.js supabase-js path here (reconcile into the new `event` table).
- **PR-4** Sessions → stateless signed cookie; **bcrypt-compat verify** (keep verifying the existing `$2a$` admin hash); secret split with `KYC_SECRET` = the **exact untrimmed** `.session-secret` bytes.
- **PR-5** Supabase Storage (kyc-private + media); media list becomes a **filesystem/bucket walk**, not a `media.json` read.

**Phase B — ticketing + payments (net-new, lifted)**
- **PR-6** Inventory pools + atomic hold/reservation fns + `price_version` + credential signing.
- **PR-7** Orders + order_items + checkout endpoints (create/hold).
- **PR-8** x-bridge adapter + FSP routing + `setting` config.
- **PR-9** Payment state machine + webhook + `apps/worker` reconciliation (singleton).
- **PR-10** SMS/email drivers + ticket delivery + credential issuance.

**Phase C — frontend + deploy**
- **PR-11** Web checkout flow (initiate → pay → poll → QR) against the contract.
- **PR-12** pm2 `ecosystem.config.js` + Docker + `render.yaml` + env docs.

## What I need to start
- Confirm/veto **D1–D9**.
- **Supabase Postgres connection string** (pooler URL) + confirm which project.
- **x-bridge sandbox creds** (`XBRIDGE_BASE_URL`, `XBRIDGE_KEY_ID`, `XBRIDGE_SECRET`) when we reach Phase B, and confirm the ClickPesa business is provisioned inside the gateway.
- OK on bucket names `kyc-private` / `media`. (QR/scanner contract is deferred — §S.)

---

## Execution hardening (from eng review — 2026-07-18)

Decisions locked: **(1)** ticket-scan verification **descoped** from launch; **(2)** cutover = **per-entity flag + backfill-first + rollback**; **(3)** DB inventory/pricing is **dormant at launch** (frozen HTML shows current prices; goes live with checkout). Corrections folded in:

- **§S — Scanner is NOT wired.** The mobile scanner (`ScannerScreen.tsx:42` → `gate.ts:6` LAN IP → legacy `gate/agent.js`) does in-memory dedup, no HMAC, own secrets, archived. Build credentials/inventory in Phase B, but the plan makes **no claim** of scanner integration. Deferred workstream: add an API `POST /api/tickets/verify` (DB-backed dedup) + agent token (exchange the 6-digit code) + repoint the scanner.
- **KYC secret (P0):** `KYC_SECRET` must be the **untrimmed** `.session-secret` bytes (file read is untrimmed at `secret.ts:15`; env is trimmed) or existing `.enc` become undecryptable. A round-trip decrypt test of the 3 committed `.enc` gates PR-4.
- **Webhook raw body (P0):** mount `express.raw({type:'*/*'})` on `/api/webhooks/xbridge` **before** the global `express.json()` (`main.ts:36`) so `sha256(rawBody)` dedup matches the gateway's exact bytes. Endpoint is public → security = re-fetch status from the gateway (never trust payload) + verify source.
- **`PUBLIC_ORIGIN` → the pm2 API host directly**, not the Vercel domain — the ClickPesa callback must not traverse the Next `/api/*` rewrite (buffering/limits break rawBody).
- **events.js split-brain:** retire the existing supabase-js events path (`vendor/events.js:47-95`) during PR-3's events flip; one `event` table, one shape.
- **bcrypt not scrypt:** `app_user` verify must accept the existing `$2a$` bcrypt admin hash (`auth.module.ts:17`), or the sole admin login breaks at cutover.
- **media source-of-truth:** `media_asset` is seeded from a filesystem/bucket walk (dims/size computed), not `media.json` (a `{status,flagReason}` sidecar).
- **Explicit `ORDER BY`:** every list endpoint needs one — local JSON ordering was insertion order (`byDate` sorts a nonexistent `date` field); Postgres has no implicit order. jsonb `props` won't round-trip byte-identical (key reorder/number normalize) — the golden-dataset diff must normalize before comparing, or store `props` as text where byte-fidelity matters.
- **Pooler:** migrations on the **session/direct** connection (advisory lock is session-scoped; no prepared-stmt ban); runtime on the transaction pooler with `PG_PREPARE=false`.
- **Multi-instance guard:** the worker/token-cache/sweeps assume one process — add an advisory-lock guard, not just pm2 `instances:1`.
- **Session cutover:** flipping express-session → HMAC cookie 401s live admin sessions at deploy (acceptable; deliberate timed cutover).

**Test additions (gates):** golden-dataset migration diff per entity (PR-3); KYC `.enc` decrypt round-trip (PR-4); Phase-B payment failure matrix (sold-out rollback, per-attempt tx-id retry, webhook dedup+re-fetch, `paid_unseatable`, `payment_short`, duplicate-collection, late-settlement).

**NOT in scope (launch):** ticket sales/checkout, inventory enforcement, scanner integration, dynamic prices on the frozen pages — all Phase B/C, dormant at the as-is launch.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_found → folded | 13 execution risks (4 P0), all folded into the plan |
| Outside Voice | Claude subagent | Independent 2nd opinion | 1 | issues_found | Confirmed all P0s; added bcrypt/scrypt, events.js split-brain, tiers-in-HTML |

**CROSS-MODEL:** full agreement on every P0 (scanner fiction, KYC-seed trim, webhook raw-body, PR-2 contradiction) — high-confidence real.

**VERDICT:** ENG CLEARED to execute — plan corrected. Launch = Phase A (backfill-first, per-entity flag, golden-dataset diff). Phase B/C (payments/checkout/scanner) is net-new, dormant at launch.

NO UNRESOLVED DECISIONS
