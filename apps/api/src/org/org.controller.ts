import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { resolveCommissionRate } from '@zora/core';
import { OrganizerGuard } from '../common/organizer.guard';
import { OrganizerRepo } from '../storage/organizer-repo';
import { OrgScopeService } from './org-scope.service';

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
      // BS31: the platform commission netted from this org's payout (default 5%).
      // Buyer price is unaffected — this drives the "you earn net of X%" copy.
      // BS35: resolved by @zora/core, the one place the fallback chain lives.
      commissionRate: resolveCommissionRate(null, org),
    };
  }
}
