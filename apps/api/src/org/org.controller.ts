import { Controller, Get, Put, Body, Req, UseGuards, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { resolveCommissionRate } from '@zora/core';
import { OrganizerGuard } from '../common/organizer.guard';
import { OrganizerRepo } from '../storage/organizer-repo';
import { OrgScopeService } from './org-scope.service';
import { KYC_REASONS } from '../common/defaults';
import { normalizeTzPhone, isValidTzMsisdn } from '../common/phone';

/* BS41 (#5): a rejection the organizer cannot read is a dead end. The stored
   value is `code` or `code · internal note`; only the code maps to user-facing
   copy, and the note is deliberately NOT returned (it is written for the audit
   log, not for the person). Reuses the existing KYC reject copy verbatim. */
function rejectionCopy(reason: string | null): string | null {
  if (!reason) return null;
  const code = reason.split('·')[0].trim();
  const match = KYC_REASONS.find((r) => r.code === code);
  return match ? match.user : 'We could not approve this account yet. Please contact support@zorapass.com.';
}

/* /api/org/* — the organizer surface (OrganizerGuard: real organizer OR admin
   impersonating). MT2/MT3 add their controllers to the org module alongside this
   one. MT1 ships only GET /api/org/me. */
@Controller('org')
export class OrgController {
  constructor(
    private readonly scope: OrgScopeService,
    private readonly organizers: OrganizerRepo,
  ) {}

  @UseGuards(OrganizerGuard)
  @Get('me')
  async me(@Req() req: Request) {
    // req.actingHandle is stamped by OrganizerGuard (guaranteed non-null here).
    const handle = req.actingHandle as string;
    const org = await this.organizers.byHandle(handle); // BS35: relational row
    // BS94 (Phase 3): the caller's org-scoped MEMBERSHIP role for the acting org
    // (owner|admin|finance|door|viewer), derived from the session — the Team
    // surface reads it to hide invite/remove from non-owner/admin members. A
    // legacy session (no memberships) OR an admin impersonating is an implicit
    // owner, matching the RBAC guard's rule (no lockout).
    const memberships = Array.isArray(req.session.memberships) ? req.session.memberships : [];
    const acting = req.session.actingOrganizerId;
    const membership = memberships.find((m) => m.organizerId === acting) || null;
    const memberRole = membership ? membership.role : (memberships.length ? null : 'owner');
    return {
      actingHandle: handle,
      name: org ? org.name : null,
      role: req.session.role || (req.actingViaImpersonation ? 'admin' : 'organizer'),
      memberRole,
      userId: req.session.userId ?? null,
      impersonating: req.actingViaImpersonation ? req.session.impersonating || null : null,
      // KYC status lives on the organizer record when present; the enforcement
      // gate (I6) lands in MT2. Falls back to the session claim, else null.
      kycStatus: (org && org.kycStatus) ?? req.session.kycStatus ?? null,
      // BS41 (#4): the two facts the dashboard needs to tell a SELF-REGISTERED
      // org waiting on approval apart from a long-standing org whose identity
      // documents happen to be in review. They get different banners: one says
      // "you're new, drafts work, an admin is coming", the other says "verify
      // your ID". Read from the row, never the session — an admin's approval
      // must take effect on the organizer's next page load, not on their next
      // login. (`status` is also what tells the UI a rejection is not a ban.)
      status: org ? org.status : null,
      source: org ? org.source : null,
      // BS57: the org's own alert number (null until they set it) — the dashboard
      // prefills the "SMS order alerts" field from this.
      phone: org ? org.phone : null,
      // Null unless a reviewer actually rejected them.
      kycReason: org && org.kycStatus === 'rejected' ? rejectionCopy(org.verificationReason) : null,
      // BS31: the platform commission netted from this org's payout (default 5%).
      // Buyer price is unaffected — this drives the "you earn net of X%" copy.
      // BS35: resolved by @zora/core, the one place the fallback chain lives.
      commissionRate: resolveCommissionRate(null, org),
    };
  }

  // ── PUT /api/org/phone — set/clear the org's new-order SMS alert number ──────
  // BS57: existing orgs (created before self-signup captured a phone, or seeded)
  // had no way to add a number. An empty string clears it (opt out). Stored
  // normalized to +255…; validated the same way self-registration validates.
  @UseGuards(OrganizerGuard)
  @Put('phone')
  async setPhone(@Req() req: Request, @Body() body: { phone?: string }) {
    const handle = req.actingHandle as string;
    const org = await this.organizers.byHandle(handle);
    if (!org) throw new BadRequestException({ error: 'not_found' });

    const raw = String(body?.phone ?? '').trim();
    let value = '';
    if (raw !== '') {
      value = normalizeTzPhone(raw);
      if (!isValidTzMsisdn(value)) {
        throw new BadRequestException({ error: 'invalid_phone', message: 'Enter a valid mobile number — 9 digits after +255.' });
      }
    }
    const updated = await this.organizers.setPhone(org.id, value);
    return { ok: true, phone: updated ? updated.phone : null };
  }
}
