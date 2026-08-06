# Plan — Cluster B: Event operations

Items: **#1 scanning (two-step + supervisor + scanner-user management) · #2 bulk email + SMS (both consoles)**

---

## #1 — Two-step scanning → wristband

**Confirmed:** web-based scanner (phone browser/PWA); v1 online-only. Super-admin creates scanner users and assigns roles.

**Roles.**
- **Agent** — scans a pass QR at the gate; verifies (HMAC + not-expired + belongs-to-event) and marks it **scanned**.
- **Supervisor** — reviews a scanned credential and **confirms** → **wristband issued** (the physical wristband is handed out; the system records issuance). A second-person gate against fraud/mis-scan.

**Credential state machine.** `issued → scanned(by agent, at, agent_id) → wristband_issued(by supervisor, at, supervisor_id)` (+ terminal `rejected`). Dedup: a credential can be scanned once; re-scan surfaces "already scanned/confirmed" with who+when.

**Schema / API.**
- `credential` gains scan lifecycle columns: `scan_state`, `scanned_at`, `scanned_by`, `confirmed_at`, `confirmed_by` (migration).
- `POST /api/scan/verify { qr }` (agent auth) — HMAC-verify the signed payload (`packages/core/credentials.ts`), check event + not-terminal, set `scanned`; returns the pass details for display. 409 if already scanned/confirmed (show prior actor).
- `POST /api/scan/confirm { credentialId }` (supervisor auth) — transition scanned → wristband_issued. Rejects if not in `scanned`.
- Idempotent + concurrency-safe (row lock; one scan wins).

**Scanner users + roles (super-admin owns this).**
- Extend the existing `agents` concept (6-digit codes today) into **scanner users** with a **role** (`agent | supervisor`) and an event/scope. Super-admin CRUD: create user, assign role, rotate code, revoke.
- Auth for the scanner app: agent/supervisor signs in with their code (or a link) → a scoped scanner session (not an admin/org session). Role gates which endpoint they can call.
- Migration: `agent` (or `scanner_user`) gains `role`, `event_scope` (optional), `active`.

**UI (responsive — this IS a phone app).**
- Scanner PWA: camera QR scan → big PASS VALID / ALREADY USED / INVALID result; agent view stops at "scanned — hand to supervisor"; supervisor view shows scanned queue + CONFIRM → WRISTBAND ISSUED.
- Super-admin (#9): scanner-users panel — add user, role dropdown, scope, rotate/revoke.

**Open decisions for eng review:** (a) auth model for scanners (6-digit code → session vs a magic link vs org sub-accounts); (b) is supervisor confirm per-credential or batch; (c) offline queue (deferred v2) — confirm; (d) reuse `agents` table vs new `scanner_user`.

---

## #2 — Bulk email + SMS (super-admin AND organizer)

**Confirmed:** available in **both** consoles.
- **Organizer** — message their own audience: buyers of one event, buyers of one tier, or all their customers.
- **Super-admin** — platform-wide: all users, by organizer, or by event.

**Model.**
- Compose (subject/body; SMS body separate from email HTML), pick channel(s) (SMS / email / both), pick audience, preview count, send.
- Recipients resolved server-side from paid orders/credentials (phone + email). Dedup per person.
- Send is **queued + batched** via the worker (not inline in the request) — SMS via `SMS_DRIVER` (Beem), email via `EMAIL_DRIVER`. Throttled to provider limits.
- **Compliance:** opt-out/unsubscribe (SMS STOP + email unsubscribe link), sender-ID, and a per-recipient suppression list. SMS costs the organizer money → show an estimated cost + count before send.
- **Delivery tracking:** a `broadcast` record + per-recipient status (queued/sent/failed) for a sent-history view.

**Schema / API.**
- Migration: `broadcast { id, sender (org handle | 'admin'), scope, channel, subject, body_sms, body_email, audience_count, status, created_at }` + `broadcast_recipient { broadcast_id, phone, email, status }` (or a compact log).
- `POST /api/org/broadcasts` (organizer, scoped to their audience) / `POST /api/admin/broadcasts` (super-admin, any scope). Validates audience, estimates count/cost, enqueues.
- `GET .../broadcasts` — history + statuses. Worker consumes the queue and fans out through the drivers.
- Suppression: `unsubscribe` table; drivers skip suppressed recipients; a public unsubscribe link/route.

**UI (responsive).** Compose screen (audience picker with live count + est. SMS cost, channel toggle, SMS/email bodies, preview, send), history with per-broadcast delivery stats. Same component in both consoles with scope differences.

**Open decisions for eng review:** (a) real per-recipient tracking vs aggregate-only for v1; (b) rate/throttle + retry policy; (c) cost display source (Beem price); (d) unsubscribe scope (per-organizer vs platform); (e) template/personalization (name, event) v1?
