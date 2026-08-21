import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import * as crypto from 'crypto';
import { sendEmail, publicWebOrigin, escapeHtml } from '@zora/core';
import { OrganizerGuard } from '../common/organizer.guard';
import { Roles } from '../common/roles.guard';
import { OrganizerRepo } from '../storage/organizer-repo';
import { OrgMembersRepo } from '../storage/org-members.repo';

/* /api/org/members (BS94 / auth Phase 3) — TEAM management. owner/admin only
   (RolesGuard on the class @Roles). The acting org is resolved from the SESSION
   via OrganizerGuard's stamped actingHandle — NEVER from the request body — so a
   member can only ever manage the org their session is acting as.

   Roles a teammate can hold: admin | finance | door | viewer. `owner` is NEVER
   assignable here (no invite-to-owner, no promote-to-owner) — ownership is the
   backfilled login-holder's, transferred by a separate deliberate action, not a
   role edit. The sole-owner guard refuses removing/demoting the last owner so an
   org can never be left with nobody who can administer it. */

const INVITABLE_ROLES = new Set(['admin', 'finance', 'door', 'viewer']);
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // ~7 days

@Roles('owner', 'admin')
@Controller('org/members')
@UseGuards(OrganizerGuard)
export class OrgMembersController {
  constructor(
    private readonly organizers: OrganizerRepo,
    private readonly members: OrgMembersRepo,
  ) {}

  /** The acting organizer's id, resolved from the session-stamped handle. */
  private async actingOrgId(req: Request): Promise<string> {
    const handle = req.actingHandle as string;
    const org = await this.organizers.byHandle(handle);
    if (!org) throw new NotFoundException({ error: 'not_found' });
    return org.id;
  }

  // ── GET /api/org/members — members + pending invites for the acting org ──────
  @Get()
  async list(@Req() req: Request) {
    const organizerId = await this.actingOrgId(req);
    const [members, invites] = await Promise.all([
      this.members.listMembers(organizerId),
      this.members.listPendingInvites(organizerId),
    ]);
    return {
      members: members.map((m) => ({ userId: m.userId, email: m.email, role: m.role, joinedAt: m.joinedAt })),
      invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt, createdAt: i.createdAt })),
    };
  }

  // ── POST /api/org/members/invite { email, role } ────────────────────────────
  @Post('invite')
  async invite(@Req() req: Request, @Body() body: { email?: string; role?: string }) {
    const organizerId = await this.actingOrgId(req);
    const email = String(body?.email ?? '').trim().toLowerCase();
    const role = String(body?.role ?? '').trim();

    if (!email || !email.includes('@')) {
      throw new BadRequestException({ error: 'invalid_email', message: 'Enter a valid email address.' });
    }
    if (!INVITABLE_ROLES.has(role)) {
      throw new BadRequestException({ error: 'invalid_role', message: 'Pick a role: admin, finance, door or viewer.' });
    }
    if (await this.members.memberEmailExists(organizerId, email)) {
      throw new ConflictException({ error: 'already_member', message: 'That person is already a member of this organizer.' });
    }

    // Refresh: drop any earlier pending invite for this email so only the newest
    // link is live, then mint a fresh single-use token.
    await this.members.deletePendingInvitesFor(organizerId, email);
    const token = crypto.randomBytes(24).toString('hex');
    const invite = await this.members.createInvite({
      organizerId,
      email,
      role,
      token,
      invitedBy: req.session?.userId ?? null,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });

    const org = await this.organizers.byHandle(req.actingHandle as string);
    const orgName = org?.name ?? 'a Zora organizer';
    const link = `${publicWebOrigin()}/join-team/${token}`;
    // sendEmail's mock never throws; a real driver can — never let a delivery
    // hiccup roll back a created invite (the owner can resend). Log and move on.
    try {
      await sendEmail(
        email,
        `You've been invited to join ${orgName} on Zora`,
        inviteEmailHtml(orgName, role, link),
      );
    } catch (err) {
      console.warn(`[org/invite] email send failed for ${email}: ${(err as Error)?.message ?? err}`);
    }

    return { ok: true, invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt } };
  }

  // ── PUT /api/org/members/:userId { role } — change a member's role ───────────
  @Put(':userId')
  async setRole(@Req() req: Request, @Param('userId') userId: string, @Body() body: { role?: string }) {
    const organizerId = await this.actingOrgId(req);
    const role = String(body?.role ?? '').trim();
    if (!INVITABLE_ROLES.has(role)) {
      throw new BadRequestException({ error: 'invalid_role', message: 'Pick a role: admin, finance, door or viewer.' });
    }
    const member = await this.members.memberByUserId(organizerId, userId);
    if (!member) throw new NotFoundException({ error: 'not_a_member', message: 'That person is not a member of this organizer.' });

    // Demoting the sole owner would strip the org of anyone who can administer it.
    if (member.role === 'owner' && (await this.members.ownerCount(organizerId)) <= 1) {
      throw new BadRequestException({ error: 'sole_owner', message: 'This is the only owner — add another owner before changing this role.' });
    }
    await this.members.setMemberRole(organizerId, userId, role);
    return { ok: true, userId, role };
  }

  // ── DELETE /api/org/members/:userId — remove a member ────────────────────────
  @Delete(':userId')
  async remove(@Req() req: Request, @Param('userId') userId: string) {
    const organizerId = await this.actingOrgId(req);
    const member = await this.members.memberByUserId(organizerId, userId);
    if (!member) throw new NotFoundException({ error: 'not_a_member', message: 'That person is not a member of this organizer.' });

    // Refuse removing the last owner (covers an owner removing themselves when
    // they're the only one) — the org must always keep an administrator.
    if (member.role === 'owner' && (await this.members.ownerCount(organizerId)) <= 1) {
      throw new BadRequestException({ error: 'sole_owner', message: 'You are the only owner — you can\'t remove yourself. Add another owner first.' });
    }
    await this.members.removeMember(organizerId, userId);
    return { ok: true, userId };
  }
}

function inviteEmailHtml(orgName: string, role: string, link: string): string {
  const name = escapeHtml(orgName);
  const r = escapeHtml(role);
  const href = escapeHtml(link);
  return `<!doctype html>
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f0f14;">
  <div style="font-size:22px;font-weight:800;letter-spacing:.1em;">ZORA</div>
  <p style="font-size:15px;line-height:1.5;">You've been invited to join <strong>${name}</strong> on Zora as <strong>${r}</strong>.</p>
  <p style="font-size:15px;line-height:1.5;">Accept the invite to get access — if you're new to Zora you'll set a password on the way in.</p>
  <p style="margin:24px 0;"><a href="${href}" style="display:inline-block;background:#0f0f14;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">Accept invitation</a></p>
  <p style="font-size:12px;color:#6a6a72;">Or paste this link into your browser:<br>${href}</p>
  <p style="font-size:12px;color:#6a6a72;">This invitation expires in 7 days.</p>
</div>`;
}
