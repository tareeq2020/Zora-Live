import {
  BadRequestException, Body, ConflictException, Controller, NotFoundException, Param, Post, Put, Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import * as crypto from 'crypto';
import { resolveCommissionRate, sendEmail, publicWebOrigin, escapeHtml } from '@zora/core';
import { SessionGuard } from '../common/session.guard';
import { Roles } from '../common/roles.guard';
import { OrganizerRepo, publicOrganizer } from '../storage/organizer-repo';
import { AuthUsersRepo } from '../storage/auth-users.repo';
import { OrgMembersRepo } from '../storage/org-members.repo';
import { AuditService } from '../audit/audit.module';
import { HANDLE_MAX, handleIssue, handleIssueMessage, normalizeHandle } from '../common/handles';

/* /api/admin/organizers (BS95 / auth Phase 3.5, B) — SUPER-ADMIN organizer
   provisioning. Closes the "org row with no owner user" gap from the other side:
   an admin can create an organizer AND ensure it has a real app_user owner, or
   assign/transfer ownership of an existing one.

   super_admin-only: @Roles('super_admin') + SessionGuard (isAdmin maps to
   super_admin in the RBAC guard). A plain org session has no isAdmin → SessionGuard
   401s; an authenticated non-admin → 401 'Not logged in' (the platform-route shape).

   Owner provisioning is EXACTLY the invite-accept pattern (AuthUsersRepo +
   OrgMembersRepo):
     · owner email already has an app_user → add an `owner` membership DIRECTLY.
     · no app_user yet → mint an owner org_invite + email the join-team link; the
       existing accept flow sets their password and makes them owner. Admin
       authority BYPASSES the "no owner via public invite" rule (that guard lives in
       the org-scoped OrgMembersController, not here).
   Every write is idempotent (addMember/createInvite), so a retried call is safe. */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // ~7 days

function isEmail(v: string): boolean {
  return v.includes('@') && v.indexOf('@') > 0 && v.indexOf('@') < v.length - 1;
}

@Roles('super_admin')
@Controller('admin/organizers')
@UseGuards(SessionGuard)
export class AdminOrganizersController {
  constructor(
    private readonly organizers: OrganizerRepo,
    private readonly authUsers: AuthUsersRepo,
    private readonly members: OrgMembersRepo,
    private readonly audit: AuditService,
  ) {}

  // ── POST /api/admin/organizers { name, handle, ownerEmail } ──────────────────
  // Create a draft/unverified organizer AND ensure its owner.
  @Post()
  async create(@Body() body: any, @Req() req: Request) {
    const name = String(body?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (name.length < 2) {
      throw new BadRequestException({ error: 'name_required', message: 'Enter the organizer’s name.' });
    }

    // Handle: same structural + reserved checks as signup (the ONE handle authority).
    const handle = normalizeHandle(body?.handle);
    const issue = handleIssue(handle);
    if (issue) {
      throw new BadRequestException({
        error: issue === 'reserved' ? 'handle_reserved' : 'handle_invalid',
        message: handleIssueMessage(issue),
      });
    }
    if (await this.organizers.handleTaken(handle)) {
      throw new ConflictException({ error: 'handle_taken', message: handleIssueMessage('taken') });
    }

    const ownerEmail = String(body?.ownerEmail ?? '').trim().toLowerCase();
    if (!isEmail(ownerEmail)) {
      throw new BadRequestException({ error: 'invalid_email', message: 'Enter a valid owner email.' });
    }

    // Same slug-id derivation as self-signup (unique for free off the unique handle).
    const id = ('o-' + handle).slice(0, 2 + HANDLE_MAX);
    let org;
    try {
      org = await this.organizers.createByAdmin({ id, name, handle, email: ownerEmail });
    } catch (e: any) {
      // picker→insert race: the DB UNIQUE(handle) is the referee.
      if (String(e?.code) === '23505') {
        throw new ConflictException({ error: 'handle_taken', message: handleIssueMessage('taken') });
      }
      throw e;
    }

    const ownerStatus = await this.ensureOwner(org.id, org.name, ownerEmail, req);
    await this.audit.record(
      'admin_create_organizer',
      `${org.name} (${org.handle}) · owner ${ownerEmail} · ${ownerStatus}`,
      req.ip,
    );

    return {
      ok: true,
      organizer: publicOrganizer(org, resolveCommissionRate(null, org)),
      handle: org.handle,
      owner: ownerStatus, // 'member' (existing user) | 'invited' (invite sent)
    };
  }

  // ── PUT /api/admin/organizers/:id/owner { email } ────────────────────────────
  // Assign/transfer ownership. The target becomes `owner`; any PREVIOUS owner is
  // demoted to `admin` (never orphaned/deleted). Idempotent if already the owner.
  @Put(':id/owner')
  async setOwner(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const org = await this.organizers.byId(id);
    if (!org) throw new NotFoundException({ error: 'not_found', message: 'Organizer not found.' });

    const email = String(body?.email ?? '').trim().toLowerCase();
    if (!isEmail(email)) {
      throw new BadRequestException({ error: 'invalid_email', message: 'Enter a valid owner email.' });
    }

    const target = await this.authUsers.byEmail(email);
    if (!target) {
      // New person → owner invite (accepting makes them owner via the existing flow).
      // The previous owner stays owner until the invitee accepts, so the org is
      // never left ownerless in the interim (never orphan).
      await this.sendOwnerInvite(org.id, org.name, email, req);
      await this.audit.record('admin_transfer_owner_invite', `${org.name} (${org.handle}) · invited ${email}`, req.ip);
      return { ok: true, owner: 'invited' };
    }

    const priorOwners = await this.members.ownerUserIds(org.id);
    const targetAlreadySoleOwner = priorOwners.length === 1 && priorOwners[0] === target.id;
    if (targetAlreadySoleOwner) {
      return { ok: true, owner: 'unchanged', ownerUserId: target.id };
    }

    // Make the target the owner (promote an existing membership, or add one).
    const existingMembership = await this.members.memberByUserId(org.id, target.id);
    if (existingMembership) {
      await this.members.setMemberRole(org.id, target.id, 'owner');
    } else {
      await this.members.addMember({ userId: target.id, organizerId: org.id, role: 'owner' });
    }

    // Demote every OTHER prior owner to admin (never orphan — keep them as admins).
    const demoted: string[] = [];
    for (const uid of priorOwners) {
      if (uid === target.id) continue;
      await this.members.setMemberRole(org.id, uid, 'admin');
      demoted.push(uid);
    }

    await this.audit.record(
      'admin_transfer_owner',
      `${org.name} (${org.handle}) · owner → ${email}${demoted.length ? ` · demoted ${demoted.length}` : ''}`,
      req.ip,
    );
    return { ok: true, owner: 'assigned', ownerUserId: target.id, demoted };
  }

  // ── PUT /api/admin/organizers/:id/verification { decision, reason? } ─────────
  // BS96 (Phase 4, A) — VERIFY ANY organizer, not just self-signups. The #5
  // verification queue only lists source='self-signup' rows, so a seeded or
  // admin-created org (thebrunchcity, kyc_status NULL) could never be approved and
  // its payout/publish gates stayed locked forever. This routes through the SAME
  // OrganizerRepo.recordVerification the self-signup queue uses — one transition,
  // one field (organizer.kyc_status), so the two paths can never diverge.
  // Idempotent: re-approving an approved org just re-writes the same state.
  @Put(':id/verification')
  async verify(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const org = await this.organizers.byId(id);
    if (!org) throw new NotFoundException({ error: 'not_found', message: 'Organizer not found.' });

    const decision = String(body?.decision ?? '').trim();
    if (decision !== 'approve' && decision !== 'reject') {
      throw new BadRequestException({ error: 'invalid_decision', message: "Decision must be 'approve' or 'reject'." });
    }
    // Reject carries an optional reason (approve clears it — recordVerification does).
    const reason = decision === 'reject' ? (String(body?.reason ?? '').trim() || null) : null;

    const updated = await this.organizers.recordVerification(id, decision as 'approve' | 'reject', 'admin', reason);
    if (!updated) throw new NotFoundException({ error: 'not_found', message: 'Organizer not found.' });

    await this.audit.record(
      'admin_verify_organizer',
      `${updated.name} (${updated.handle}) → ${updated.kycStatus}${reason ? ` · ${reason}` : ''}`,
      req.ip,
    );
    return { ok: true, kycStatus: updated.kycStatus, status: updated.status };
  }

  /* ── helpers ─────────────────────────────────────────────────────────────── */

  /** Ensure an org has its owner: existing user → direct owner membership;
      otherwise → owner invite + email. Returns 'member' | 'invited'. */
  private async ensureOwner(
    organizerId: string,
    orgName: string,
    email: string,
    req: Request,
  ): Promise<'member' | 'invited'> {
    const existing = await this.authUsers.byEmail(email);
    if (existing) {
      await this.members.addMember({
        userId: existing.id,
        organizerId,
        role: 'owner',
        invitedBy: req.session?.userId ?? null,
      });
      return 'member';
    }
    await this.sendOwnerInvite(organizerId, orgName, email, req);
    return 'invited';
  }

  /** Mint (refresh) an OWNER org_invite and email the join-team link. */
  private async sendOwnerInvite(organizerId: string, orgName: string, email: string, req: Request): Promise<void> {
    await this.members.deletePendingInvitesFor(organizerId, email);
    const token = crypto.randomBytes(24).toString('hex');
    await this.members.createInvite({
      organizerId,
      email,
      role: 'owner',
      token,
      invitedBy: req.session?.userId ?? null,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });
    const link = `${publicWebOrigin()}/join-team/${token}`;
    // Never let a delivery hiccup roll back a created invite (admin can re-send).
    try {
      await sendEmail(email, `You've been made owner of ${orgName} on Zora`, ownerInviteEmailHtml(orgName, link));
    } catch (err) {
      console.warn(`[admin/organizers] owner-invite email failed for ${email}: ${(err as Error)?.message ?? err}`);
    }
  }
}

function ownerInviteEmailHtml(orgName: string, link: string): string {
  const name = escapeHtml(orgName);
  const href = escapeHtml(link);
  return `<!doctype html>
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f0f14;">
  <div style="font-size:22px;font-weight:800;letter-spacing:.1em;">ZORA</div>
  <p style="font-size:15px;line-height:1.5;">You've been made the <strong>owner</strong> of <strong>${name}</strong> on Zora.</p>
  <p style="font-size:15px;line-height:1.5;">Accept to take ownership — if you're new to Zora you'll set a password on the way in.</p>
  <p style="margin:24px 0;"><a href="${href}" style="display:inline-block;background:#0f0f14;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">Accept &amp; take ownership</a></p>
  <p style="font-size:12px;color:#6a6a72;">Or paste this link into your browser:<br>${href}</p>
  <p style="font-size:12px;color:#6a6a72;">This invitation expires in 7 days.</p>
</div>`;
}
