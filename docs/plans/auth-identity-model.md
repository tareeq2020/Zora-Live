# Auth & identity — Users, Roles, Organizers (spec)

## The problem (investigation findings, with evidence)
Today **the organizer row IS the identity**. There is no `user`.
- Login: `POST /api/org/login` = `handle + password` bcrypt-checked against the
  `organizer` table (`auth.module.ts`); session = `{ organizerHandle, role:'organizer', kycStatus }`.
- Super-admin is a **separate** magic account (`auth.module` `ADMIN_FALLBACK` /
  collection `name='admin'`), unrelated to organizers.
- Verification is a column on the organizer (`organizer.kyc_status`), and BOTH the
  payout gate (`payouts.service.ts:40`) and the publish gate (`assertKycApproved`)
  read `kyc_status === 'approved'`.

Consequences the user hit:
1. **Login identity is a handle** (`thebrunchcity.co`) — brittle, not a person; no
   way for a human to own more than one org or to be added to someone else's.
2/3. **Verification divergence.** Two approve paths write different places:
   - `POST /api/kyc/organizers/:id/approve` → `recordVerification` → sets
     `organizer.kyc_status='approved'` (the gate field). ✅
   - `POST /api/kyc/:id/approve` (identity-document queue, `kyc.module.ts:119`) →
     sets `v.status='approved'` on the **KYC record only**, never `organizer.kyc_status`. ❌
   So the admin UI shows "verified" while the payout/publish gates stay locked.
4. There is **no user / role / membership layer** — a user can't have multiple
   roles, can't own multiple orgs, and can't add teammates to an org.

## Target model
```
User (auth identity: email + phone + password_hash)
  └─ has GLOBAL roles:   super_admin | staff | scanner (platform-wide)
  └─ has MEMBERSHIPS in Organizers, each with a scoped role:
        owner | admin | finance | door | viewer
Organizer (entity: handle, name, theme, kyc_status …)   ← VERIFICATION lives here
  └─ has many members (users) via membership(user_id, organizer_id, role)
Customer = a User too (buying uses the same identity; no separate table)
```
Principles:
- **One User, many hats.** Roles are global (super_admin/staff/scanner) or
  organizer-scoped (owner/admin/finance/door). A person can be a super-admin AND
  own an org AND buy tickets — one login.
- **The Organizer is a company, not a login.** It's owned by a User and can have
  many member Users. Verification is the Organizer's, decided once.
- **One verification gate, one field, one transition.** Any approve path flips
  `organizer.kyc_status` — no second source of truth.

## Data model changes
New tables:
- `app_user` — `id, email (unique), phone, password_hash, created_at, …`.
- `user_role` — `user_id, role` (global roles: super_admin/staff/scanner).
- `organizer_member` — `user_id, organizer_id, role (owner|admin|finance|door|viewer), invited_by, created_at`; unique (user_id, organizer_id).
- `org_invite` — `organizer_id, email, role, token, expires_at, accepted_at` (add teammates).

Changes to `organizer`: it stays the entity, but **stops being the login** — drop
its role as an auth principal (keep `password_hash` only through the transition,
see Phase 1 backfill). Verification columns (`kyc_status`, `verification_reason`,
`reviewed_at/by`) stay on `organizer`.

## Auth changes
- **Login = email/phone + password** against `app_user`. During transition, accept
  the old handle as a login alias that resolves to the backfilled user.
- Session = `{ userId, globalRoles[], memberships:[{organizerId, role}] }`. The
  "acting organizer" is chosen from memberships (default = sole/owned org; a
  switcher when a user belongs to several).
- **RBAC guards** replace `OrganizerGuard` + the admin `SessionGuard`: a request to
  `/api/org/*` requires an `admin`/`owner` membership on the acting org; `/api/kyc*`,
  `/api/admin/*` require the global `super_admin` role. Scanner endpoints require
  `door`/`scanner`.
- Super-admin becomes a **User with the global `super_admin` role**, not a magic
  account.

## Verification (unify — fixes #2/#3)
- Every approve path calls the SAME organizer transition (`recordVerification`) so
  `organizer.kyc_status` is the only truth. The identity-document approve
  (`/api/kyc/:id/approve`) must resolve the record's organizer and flip its
  `kyc_status` (or be merged into the organizer queue). The admin UI reads
  `organizer.kyc_status`, never the KYC-record status, for the verified badge.
- Verification is triggered/owned by the **Organizer** (an org submits KYC; the
  admin approves the org). A user being a member of a verified org inherits nothing
  personal — the gate is the org's.

## Members management (add teammates)
- `POST /api/org/members/invite { email, role }` (owner/admin only) → `org_invite`
  + email. `POST /api/org/invites/:token/accept` (creates/links the user's
  membership). `GET/DELETE /api/org/members`. New console surface under the org
  dashboard: **Team** (list members + roles + invite).

## Phased rollout
- **Phase 0 — verification-gate unification (FOLDED INTO PHASE 1 per decision):**
  route both KYC approve paths through the one `recordVerification` transition so
  `organizer.kyc_status` is the only truth; the admin badge reads it; add a
  dedup/merge check for parallel `thebrunchcity` / `thebrunchcity.co` rows. Lands
  as the verification slice of Phase 1, which fixes #2/#3 as part of the model rebuild.
- **Phase 1 — introduce Users + memberships:** new tables + a backfill that, per
  existing organizer, creates an `app_user` (from its email or `handle@…`, carrying
  its `password_hash`) and an `owner` membership; the admin account becomes a
  super_admin user. Login accepts email OR the old handle. No behavior change yet.
- **Phase 2 — RBAC + multi-role:** session carries userId + roles + memberships;
  guards switch to role checks; acting-org switcher. `organizer.password_hash`
  retired.
- **Phase 3 — teams:** invites + the Team surface + roles beyond owner.

## Acceptance criteria
- A person registers/logs in ONCE (email/phone) and can be super_admin, own org(s),
  buy tickets — no duplicate accounts.
- Approving an organizer (any queue) unlocks its payout + publish gates AND shows
  verified in the admin — the two can never diverge.
- An owner can invite a teammate by email and assign a role; the teammate logs in
  with their own identity and acts on the org per their role.
- Verification is the organizer's; a member joining a verified org gets no personal
  verification.

## Risks
- Money/security surface (payouts, verification, admin) — migrate behind the
  backfill with the old path intact until parity is proven (strangler-fig).
- Backfill must be idempotent and reversible; never lose an existing login.
- Handle-as-login has live sessions — keep it as an alias through Phase 2.

## Engineering review (2026-08-21) — architecture locked
- **E1 — Extend the existing server session, do NOT add JWT.** The app already
  signs a cookie session (`sessions.set(res, …)`). Change the payload from
  `{ organizerHandle, role }` to `{ userId, globalRoles[], memberships:[{organizerId, role}], actingOrganizerId }`. No new auth stack, no token rotation to build.
- **E2 — Idempotent, reversible backfill (`db/backfill-users.mjs`).** Per `organizer`
  row: upsert an `app_user` keyed by lower(email) (fallback `handle@handles.zorapass`
  when email is null), carry its `password_hash`, and upsert an `owner`
  `organizer_member`. The admin account → an `app_user` with global `super_admin`.
  Additive tables only; `organizer.password_hash` is NOT dropped until Phase 2 parity.
  Re-runnable (ON CONFLICT DO NOTHING on the unique keys).
- **E3 — Dual-path login into one session shape.** Login accepts email/phone OR the
  legacy handle; a handle resolves `organizer.handle → owner membership → user`.
  Both live through Phase 2, then the handle path is retired. This is what stops
  live organizers being locked out mid-migration.
- **E4 — One RBAC guard, session-derived, never body-derived.** A `@Roles()`
  decorator + guard reads the session: `/api/org/*` needs an `owner|admin` (or
  `finance` for payouts) membership on the ACTING org (from the session, matching
  the existing "acting org from session, never the body" invariant); `/api/admin/*`
  + `/api/kyc/*` need global `super_admin`; scanner endpoints need `door|scanner`.
  Replaces `OrganizerGuard` + the admin `SessionGuard`.
- **E5 — Verification: one transition, one field (folds Phase 0).** Both KYC queues
  call `recordVerification(organizerId, …)` → `organizer.kyc_status`; the identity-
  document approve resolves its record's organizer and flips it; the admin badge
  reads `organizer.kyc_status`. A dedup pass merges parallel `handle`/`handle.co`
  rows (or flags them) so one org has one owner + one status.
- **E6 — Acting-org switch:** `POST /api/me/acting-org { organizerId }` validated
  against memberships; default = sole membership; a topbar switcher when >1.
- Data integrity: `unique(lower(email))` on app_user; `unique(user_id, organizer_id)`
  on membership; FK to `organizer`. All migrations additive + idempotent.

**Critical failure modes → tests**
1. Backfill run twice → no dup users/memberships (idempotent). 2. Every login that
worked pre-migration still works post-Phase-1 (no locked-out org). 3. Approving via
EITHER KYC queue unlocks payout+publish AND shows verified — the divergence cannot
recur. 4. A `viewer`/`door` member is refused owner-only endpoints (payout request,
publish, invite). 5. Duplicate `handle`/`handle.co` org rows resolve to ONE owner,
not two.

**Phasing / parallelization.** Phase 1 (tables + backfill + verification unification)
is foundational and lands first. Phase 2 (RBAC guard + dual-login + switcher) depends
on Phase 1. Phase 3 (invites + Team surface) depends on Phase 2. Within a phase,
backend and its UI can run as parallel lanes.

## Design review (2026-08-21) — UI passes
Classifier: **APP UI** (organizer + admin consoles), calibrated to DESIGN.md
Control-Room v2.
- **Login / register (IA + states):** email/phone + password; clear error states
  (wrong creds, unverified-but-can-still-log-in, suspended). No dead ends. The
  legacy handle still works during transition — the form accepts either, one field
  labelled "Email or handle".
- **Acting-org switcher (Journey):** a slim top-bar control in `CrShell`, shown only
  when the user has >1 membership; single-membership users never see it. Reuses the
  topbar-extra slot; keyboard + aria-current.
- **Team surface (new `/dashboard/team`, App-UI):** a `DataTable` of members (email ·
  role · status pill), an "Invite by email + role" action (CrDrawer), remove /
  change-role with confirm. States: **only you** (warm empty state → "invite your
  first teammate"), pending invite (amber pill), owner-can't-remove-self guard.
- **Verification (already CR, BS89):** no visual change — it just reads
  `organizer.kyc_status` now, so the badge stops lying.
- **Roles legibility:** roles render as CR status pills with plain labels (Owner ·
  Admin · Finance · Door). No jargon. Responsive: Team table → stacked cards ≤900px;
  44px targets; reduced-motion.

## Resolved decisions (autorun)
- **D1 — Login field:** one "Email or handle" field (accept both), not two — least
  friction, and it carries the transition. *(Don't-make-me-think.)*
- **D2 — Role set (v1):** global {super_admin, staff, scanner}; org-scoped {owner,
  admin, finance, door, viewer}. Start here; more later. *(Constraint worship.)*
- **D3 — Verification stays organizer-level** (not user-level) — a member of a
  verified org inherits no personal verification. *(Matches the money gate.)*
- **D4 — Backfill email fallback:** `handle@handles.zorapass` synthetic address when
  an org has no email, so every org gets a user without inventing a real inbox.
- **D5 — Duplicate orgs (thebrunchcity vs .co):** the backfill flags a same-name /
  same-owner collision for a MANUAL merge rather than auto-merging money-bearing rows.

## Implementation Tasks
- [ ] **T1 (Phase 1)** — migrations: `app_user`, `user_role`, `organizer_member`,
  `org_invite` (additive, idempotent) + `db/backfill-users.mjs` (E2, idempotent) +
  verification unification (E5) + tests (failure modes 1–3, 5).
- [ ] **T2 (Phase 2)** — session shape (E1) + dual-path login (E3) + `@Roles()` guard
  (E4) + acting-org switch (E6) + tests (failure mode 4). Retire `organizer.password_hash`.
- [ ] **T3 (Phase 2, UI ∥ T2)** — login "email or handle" + the acting-org switcher.
- [ ] **T4 (Phase 3)** — invites API + accept flow + the `/dashboard/team` surface.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | skipped | no codex/OpenAI key (informational) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | E1–E6 locked (extend session not JWT · idempotent reversible backfill · dual-path login · one RBAC guard · one verification transition · acting-org switch); 5 failure-modes → tests; 3 sequential phases |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | login/switcher/Team surfaces spec'd + states; D1–D5 resolved |

**VERDICT:** DESIGN + ENG CLEARED — ready to build. Root cause folded in (E5 fixes the verification divergence as the Phase-1 slice). Phases are sequential (1→2→3); backend/UI parallelize within a phase. Money/security surfaces migrate strangler-fig behind the backfill with the old paths intact until parity. Codex/CEO skipped (informational).

NO UNRESOLVED DECISIONS
