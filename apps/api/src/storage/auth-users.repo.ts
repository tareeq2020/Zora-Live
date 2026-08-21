import { Injectable } from '@nestjs/common';
import { db } from '@zora/core';

/* AuthUsersRepo (BS93 / auth Phase 2, E3) — the read side of the new USER layer
   (app_user + user_role + organizer_member) that Phase 1 (0022) shipped and
   db/backfill-users.mjs populates.

   These reads back the DUAL-PATH login: an email resolves an app_user directly; a
   legacy handle resolves organizer.handle → owner membership → app_user. If none
   of the Phase-1 rows exist yet (prod backfill not run), the caller falls back to
   the legacy organizer.password_hash path — so nothing is keyed on these tables
   being populated. Every method returns null/[] rather than throwing when the row
   is absent, which is exactly what lets the legacy fallback take over. */

export interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  passwordHash: string | null;
}

export interface MembershipRow {
  organizerId: string;
  organizerHandle: string;
  role: string;
  status: string | null;
  kycStatus: string | null;
  name: string | null;
}

type UserRow = { id: string; email: string | null; phone: string | null; password_hash: string | null };

function toUser(r: UserRow): AuthUser {
  return { id: r.id, email: r.email, phone: r.phone, passwordHash: r.password_hash };
}

@Injectable()
export class AuthUsersRepo {
  /** The identity for an email, case-insensitively (app_user_email_lower_uq). */
  async byEmail(email: string): Promise<AuthUser | null> {
    const e = String(email ?? '').trim().toLowerCase();
    if (!e) return null;
    const rows = await db()<UserRow[]>`
      select id, email, phone, password_hash from app_user
       where lower(email) = ${e} limit 1`;
    return rows.length ? toUser(rows[0]) : null;
  }

  /** handle-path: the OWNER user of an organizer (organizer.id → owner membership
      → app_user). Oldest owner wins if somehow there are two. */
  async ownerUserByOrganizerId(organizerId: string): Promise<AuthUser | null> {
    const id = String(organizerId ?? '');
    if (!id) return null;
    const rows = await db()<UserRow[]>`
      select u.id, u.email, u.phone, u.password_hash
        from organizer_member m
        join app_user u on u.id = m.user_id
       where m.organizer_id = ${id} and m.role = 'owner'
       order by m.created_at asc
       limit 1`;
    return rows.length ? toUser(rows[0]) : null;
  }

  /** Every membership a user holds, owner-first then oldest — the session's
      memberships[] and the default acting org (memberships[0]). */
  async membershipsOf(userId: string): Promise<MembershipRow[]> {
    const id = String(userId ?? '');
    if (!id) return [];
    return db()<MembershipRow[]>`
      select m.organizer_id             as "organizerId",
             o.handle                    as "organizerHandle",
             m.role                      as role,
             o.status                    as status,
             o.kyc_status                as "kycStatus",
             o.name                      as name
        from organizer_member m
        join organizer o on o.id = m.organizer_id
       where m.user_id = ${id}
       order by (m.role = 'owner') desc, m.created_at asc`;
  }

  /** BS94 (Phase 3): create a brand-new identity for an invitee who has no
      app_user yet (email + the password they set on the accept page). Email is
      stored lower-cased to line up with app_user_email_lower_uq. Returns the new
      user; the caller then adds the organizer_member. */
  async createUser(input: { email: string; passwordHash: string }): Promise<AuthUser> {
    const e = String(input.email ?? '').trim().toLowerCase();
    const rows = await db()<UserRow[]>`
      insert into app_user (email, password_hash, updated_at)
      values (${e}, ${input.passwordHash}, now())
      returning id, email, phone, password_hash`;
    return toUser(rows[0]);
  }

  /** BS95 (Phase 3.5): idempotently create-or-get the identity for an email. Keyed
      on lower(email) via app_user_email_lower_uq, carrying phone + username to
      MATCH db/backfill-users.mjs's convention (so a signup provisions the same row
      shape the backfill would). ON CONFLICT DO NOTHING makes a re-run a no-op — a
      second signup/provision for the same email resolves to the SAME user rather
      than throwing. The password_hash/phone/username are only used when the row is
      first created; an existing identity keeps whatever it already had. */
  async ensureUser(input: {
    email: string;
    passwordHash?: string | null;
    phone?: string | null;
    username?: string | null;
  }): Promise<AuthUser> {
    const e = String(input.email ?? '').trim().toLowerCase();
    await db()`
      insert into app_user (email, phone, password_hash, username, updated_at)
      values (${e}, ${input.phone ?? null}, ${input.passwordHash ?? null}, ${input.username ?? null}, now())
      on conflict (lower(email)) where email is not null do nothing`;
    const rows = await db()<UserRow[]>`
      select id, email, phone, password_hash from app_user where lower(email) = ${e} limit 1`;
    return toUser(rows[0]);
  }

  /** BS94 (Phase 3): set a password on an EXISTING identity that had none (e.g. an
      org backfilled with a real email but no password). Lets that invitee log in
      after accepting. */
  async setPasswordForUser(userId: string, passwordHash: string): Promise<void> {
    await db()`update app_user set password_hash = ${passwordHash}, updated_at = now() where id = ${userId}`;
  }

  /** The user's GLOBAL platform roles (super_admin | staff | scanner). */
  async globalRolesOf(userId: string): Promise<string[]> {
    const id = String(userId ?? '');
    if (!id) return [];
    const rows = await db()<{ role: string }[]>`
      select role from user_role where user_id = ${id}`;
    return rows.map((r) => r.role);
  }
}
