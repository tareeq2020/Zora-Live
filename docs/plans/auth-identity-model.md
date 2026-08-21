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
- **Phase 0 — stop the bleeding (ship now, small):** make the identity-document
  approve also flip `organizer.kyc_status` (or route both queues through
  `recordVerification`); make the admin "verified" badge read `organizer.kyc_status`.
  This fixes #2/#3 without the model change. Add a dedup/merge check for parallel
  `thebrunchcity` / `thebrunchcity.co` rows.
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
