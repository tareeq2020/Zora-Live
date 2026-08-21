import { Injectable } from '@nestjs/common';
import { db } from '@zora/core';

/* OrgMembersRepo (BS94 / auth Phase 3) — the write+read side of TEAMS:
   organizer_member (a user's membership in an org) and org_invite (a pending
   teammate invite). Phase 1 (0022) shipped the tables; this is the first code to
   populate org_invite and to mutate organizer_member beyond the backfill's owner
   rows.

   Every method is scoped by organizer_id — the controller passes the ACTING org
   resolved from the session (never the body), so nothing here trusts a client id. */

export interface MemberView {
  userId: string;
  email: string | null;
  role: string;
  joinedAt: string | null;
}

export interface InviteView {
  id: string;
  email: string;
  role: string;
  token: string;
  invitedBy: string | null;
  expiresAt: string | null;
  acceptedAt: string | null;
  createdAt: string | null;
}

function iso(v: Date | string | null): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

@Injectable()
export class OrgMembersRepo {
  /* ── members ──────────────────────────────────────────────────────────── */

  /** Every member of an org (owner-first, then oldest) with the user's email. */
  async listMembers(organizerId: string): Promise<MemberView[]> {
    const rows = await db()<
      { user_id: string; email: string | null; role: string; created_at: Date | string | null }[]
    >`
      select m.user_id, u.email, m.role, m.created_at
        from organizer_member m
        join app_user u on u.id = m.user_id
       where m.organizer_id = ${organizerId}
       order by (m.role = 'owner') desc, m.created_at asc`;
    return rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      role: r.role,
      joinedAt: iso(r.created_at),
    }));
  }

  /** A single membership row (or null) — used by change-role / remove. */
  async memberByUserId(
    organizerId: string,
    userId: string,
  ): Promise<{ userId: string; role: string } | null> {
    const rows = await db()<{ user_id: string; role: string }[]>`
      select user_id, role from organizer_member
       where organizer_id = ${organizerId} and user_id = ${userId} limit 1`;
    return rows.length ? { userId: rows[0].user_id, role: rows[0].role } : null;
  }

  /** Does an org already have a member whose user email matches (case-insensitive)? */
  async memberEmailExists(organizerId: string, email: string): Promise<boolean> {
    const e = String(email ?? '').trim().toLowerCase();
    if (!e) return false;
    const rows = await db()<{ n: number }[]>`
      select count(*)::int as n
        from organizer_member m
        join app_user u on u.id = m.user_id
       where m.organizer_id = ${organizerId} and lower(u.email) = ${e}`;
    return Number(rows[0]?.n ?? 0) > 0;
  }

  /** BS96 (Phase 4, B): one aggregate pass over organizer_member for the admin
      Organizers list — per org, its OWNER's email (the identity behind the org) and
      a member count. Returns a map keyed by organizer_id; orgs with no members at
      all are simply absent (the caller reads owner=null, memberCount=0). One query
      for the whole list, so the list endpoint stays a single extra round-trip. */
  async summariesByOrg(): Promise<Record<string, { ownerEmail: string | null; memberCount: number }>> {
    const rows = await db()<
      { organizer_id: string; member_count: number; owner_email: string | null }[]
    >`
      select m.organizer_id,
             count(*)::int                                  as member_count,
             max(u.email) filter (where m.role = 'owner')   as owner_email
        from organizer_member m
        join app_user u on u.id = m.user_id
       group by m.organizer_id`;
    const out: Record<string, { ownerEmail: string | null; memberCount: number }> = {};
    for (const r of rows) {
      out[r.organizer_id] = { ownerEmail: r.owner_email ?? null, memberCount: Number(r.member_count ?? 0) };
    }
    return out;
  }

  /** BS95 (Phase 3.5): the user ids of every OWNER of an org — the ownership-transfer
      flow demotes each of these (except the incoming owner) to `admin`. */
  async ownerUserIds(organizerId: string): Promise<string[]> {
    const rows = await db()<{ user_id: string }[]>`
      select user_id from organizer_member
       where organizer_id = ${organizerId} and role = 'owner'`;
    return rows.map((r) => r.user_id);
  }

  /** How many owners the org has — the sole-owner guard reads this. */
  async ownerCount(organizerId: string): Promise<number> {
    const rows = await db()<{ n: number }[]>`
      select count(*)::int as n from organizer_member
       where organizer_id = ${organizerId} and role = 'owner'`;
    return Number(rows[0]?.n ?? 0);
  }

  /** Add (or leave in place) a membership. Idempotent on (user_id, organizer_id). */
  async addMember(input: {
    userId: string;
    organizerId: string;
    role: string;
    invitedBy?: string | null;
  }): Promise<void> {
    await db()`
      insert into organizer_member (user_id, organizer_id, role, invited_by)
      values (${input.userId}, ${input.organizerId}, ${input.role}, ${input.invitedBy ?? null})
      on conflict (user_id, organizer_id) do nothing`;
  }

  async setMemberRole(organizerId: string, userId: string, role: string): Promise<void> {
    await db()`
      update organizer_member set role = ${role}
       where organizer_id = ${organizerId} and user_id = ${userId}`;
  }

  async removeMember(organizerId: string, userId: string): Promise<void> {
    await db()`
      delete from organizer_member
       where organizer_id = ${organizerId} and user_id = ${userId}`;
  }

  /* ── invites ──────────────────────────────────────────────────────────── */

  /** Pending (not-yet-accepted) invites for an org, newest first. */
  async listPendingInvites(organizerId: string): Promise<InviteView[]> {
    const rows = await db()<any[]>`
      select id, email, role, token, invited_by, expires_at, accepted_at, created_at
        from org_invite
       where organizer_id = ${organizerId} and accepted_at is null
       order by created_at desc`;
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      token: r.token,
      invitedBy: r.invited_by ?? null,
      expiresAt: iso(r.expires_at),
      acceptedAt: iso(r.accepted_at),
      createdAt: iso(r.created_at),
    }));
  }

  /** Drop any prior pending invite for the same org+email so re-inviting refreshes
      rather than piling up rows (the newest link is the only live one). */
  async deletePendingInvitesFor(organizerId: string, email: string): Promise<void> {
    const e = String(email ?? '').trim().toLowerCase();
    await db()`
      delete from org_invite
       where organizer_id = ${organizerId} and lower(email) = ${e} and accepted_at is null`;
  }

  async createInvite(input: {
    organizerId: string;
    email: string;
    role: string;
    token: string;
    invitedBy?: string | null;
    expiresAt: Date;
  }): Promise<InviteView> {
    const rows = await db()<any[]>`
      insert into org_invite (organizer_id, email, role, token, invited_by, expires_at)
      values (${input.organizerId}, ${input.email.trim().toLowerCase()}, ${input.role},
              ${input.token}, ${input.invitedBy ?? null}, ${input.expiresAt})
      returning id, email, role, token, invited_by, expires_at, accepted_at, created_at`;
    const r = rows[0];
    return {
      id: r.id,
      email: r.email,
      role: r.role,
      token: r.token,
      invitedBy: r.invited_by ?? null,
      expiresAt: iso(r.expires_at),
      acceptedAt: iso(r.accepted_at),
      createdAt: iso(r.created_at),
    };
  }

  /** Resolve an invite by its opaque token (the accept flow's entry point). */
  async inviteByToken(token: string): Promise<{
    id: string;
    organizerId: string;
    email: string;
    role: string;
    expiresAt: string | null;
    acceptedAt: string | null;
  } | null> {
    const t = String(token ?? '').trim();
    if (!t) return null;
    const rows = await db()<any[]>`
      select id, organizer_id, email, role, expires_at, accepted_at
        from org_invite where token = ${t} limit 1`;
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.id,
      organizerId: r.organizer_id,
      email: r.email,
      role: r.role,
      expiresAt: iso(r.expires_at),
      acceptedAt: iso(r.accepted_at),
    };
  }

  async markInviteAccepted(id: string): Promise<void> {
    await db()`update org_invite set accepted_at = now() where id = ${id}`;
  }
}
