import {
  BadRequestException, Body, Controller, Get, Param, Post, Req, Res, UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { OrganizerRepo } from '../storage/organizer-repo';
import { AuthUsersRepo } from '../storage/auth-users.repo';
import { OrgMembersRepo } from '../storage/org-members.repo';
import { SessionService } from '../common/session.module';
import type { SessionMembership } from '../common/session-cookie';

/* /api/org/invites/:token (BS94 / auth Phase 3) — the ACCEPT flow. Deliberately
   NOT @Roles-guarded and NOT behind OrganizerGuard: the invitee may be a
   brand-new user with no session at all. The token IS the authorization — it is
   single-use (accepted_at), time-boxed (expires_at) and unguessable.

   Two paths on accept:
     · an app_user already exists for the invite email → just add the membership
       (no password needed).
     · no app_user → create one from the email + the password they set (min 8),
       then add the membership.
   Either way the invite is marked accepted and the invitee is LOGGED IN (a session
   is minted acting as the org they joined) so they land straight on the dashboard.
   The suspended-org guard applies on both paths. */

function isExpired(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t < Date.now();
}

@Controller('org/invites')
export class OrgInvitesController {
  constructor(
    private readonly organizers: OrganizerRepo,
    private readonly authUsers: AuthUsersRepo,
    private readonly members: OrgMembersRepo,
    private readonly sessions: SessionService,
  ) {}

  // ── GET /api/org/invites/:token — what the accept page renders ───────────────
  // Public: shows the org + role you're invited to, and whether a password is
  // needed (a brand-new user sets one; an existing user just accepts).
  @Get(':token')
  async show(@Param('token') token: string) {
    const invite = await this.members.inviteByToken(token);
    if (!invite) return { valid: false, reason: 'not_found' };
    if (invite.acceptedAt) return { valid: false, reason: 'accepted' };
    if (isExpired(invite.expiresAt)) return { valid: false, reason: 'expired' };

    const org = await this.organizers.byId(invite.organizerId);
    const existing = await this.authUsers.byEmail(invite.email);
    return {
      valid: true,
      email: invite.email,
      role: invite.role,
      orgName: org?.name ?? null,
      orgHandle: org?.handle ?? null,
      // A brand-new invitee must set a password; an existing user needs none.
      needsPassword: !(existing && existing.passwordHash),
    };
  }

  // ── POST /api/org/invites/:token/accept { password? } ────────────────────────
  @Post(':token/accept')
  async accept(
    @Param('token') token: string,
    @Body() body: { password?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const invite = await this.members.inviteByToken(token);
    if (!invite) throw new BadRequestException({ error: 'not_found', message: 'This invitation link is not valid.' });
    if (invite.acceptedAt) throw new BadRequestException({ error: 'accepted', message: 'This invitation has already been used.' });
    if (isExpired(invite.expiresAt)) throw new BadRequestException({ error: 'expired', message: 'This invitation has expired — ask for a new one.' });

    const org = await this.organizers.byId(invite.organizerId);
    if (!org) throw new BadRequestException({ error: 'not_found', message: 'This invitation link is not valid.' });
    if (org.status === 'suspended') throw new UnauthorizedException({ error: 'Account suspended' });

    // Resolve (or create) the identity for the invite email.
    let user = await this.authUsers.byEmail(invite.email);
    if (user && user.passwordHash) {
      // Existing user → just link the membership (no password taken).
    } else if (user && !user.passwordHash) {
      // An identity exists but has no password (e.g. a synthetic backfill row) —
      // set the one they provide so they can log in afterwards.
      const password = String(body?.password ?? '');
      if (password.length < 8) throw new BadRequestException({ error: 'weak_password', message: 'Choose a password of at least 8 characters.' });
      await this.authUsers.setPasswordForUser(user.id, bcrypt.hashSync(password, 10));
    } else {
      const password = String(body?.password ?? '');
      if (password.length < 8) throw new BadRequestException({ error: 'weak_password', message: 'Choose a password of at least 8 characters.' });
      user = await this.authUsers.createUser({ email: invite.email, passwordHash: bcrypt.hashSync(password, 10) });
    }

    await this.members.addMember({
      userId: user!.id,
      organizerId: invite.organizerId,
      role: invite.role,
      invitedBy: null,
    });
    await this.members.markInviteAccepted(invite.id);

    // Log them in acting as the org they just joined (mirrors org/login's session
    // shape) so they land on the dashboard with a usable membership.
    const [rows, globalRoles] = await Promise.all([
      this.authUsers.membershipsOf(user!.id),
      this.authUsers.globalRolesOf(user!.id),
    ]);
    const memberships: SessionMembership[] = rows.map((m) => ({
      organizerId: m.organizerId,
      organizerHandle: m.organizerHandle,
      role: m.role,
    }));
    const acting = rows.find((m) => m.organizerId === invite.organizerId) ?? rows[0] ?? null;
    this.sessions.set(res, {
      userId: user!.id,
      globalRoles,
      memberships,
      actingOrganizerId: acting ? acting.organizerId : undefined,
      organizerHandle: acting ? acting.organizerHandle : undefined,
      role: 'organizer',
      kycStatus: acting ? acting.kycStatus ?? undefined : undefined,
    });
    return { ok: true, organizerHandle: acting ? acting.organizerHandle : null, role: invite.role };
  }
}
