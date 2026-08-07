import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { resolveCommissionRate } from '@zora/core';
import { OrganizerGuard } from '../common/organizer.guard';
import { OrganizerRepo } from '../storage/organizer-repo';
import { OrgScopeService } from './org-scope.service';
import { KYC_REASONS } from '../common/defaults';

/* BS41 (#5): a rejection the organizer cannot read is a dead end. The stored
   value is `code` or `code · internal note`; only the code maps to user-facing
   copy, and the note is deliberately NOT returned (it is written for the audit
   log, not for the person). Reuses the existing KYC reject copy verbatim. */
function rejectionCopy(reason: string | null): string | null {
  if (!reason) return null;
  const code = reason.split('·')[0].trim();
  const match = KYC_REASONS.find((r) => r.code === code);
  return match ? match.user : 'We could not approve this account yet. Please contact support@zora.app.';
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
    return {
      actingHandle: handle,
      name: org ? org.name : null,
      role: req.session.role || (req.actingViaImpersonation ? 'admin' : 'organizer'),
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
      // Null unless a reviewer actually rejected them.
      kycReason: org && org.kycStatus === 'rejected' ? rejectionCopy(org.verificationReason) : null,
      // BS31: the platform commission netted from this org's payout (default 5%).
      // Buyer price is unaffected — this drives the "you earn net of X%" copy.
      // BS35: resolved by @zora/core, the one place the fallback chain lives.
      commissionRate: resolveCommissionRate(null, org),
    };
  }
}
