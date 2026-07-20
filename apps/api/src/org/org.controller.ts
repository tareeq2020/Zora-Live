import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { OrganizerGuard } from '../common/organizer.guard';
import { EntityStore } from '../storage/entity-store';
import { OrgScopeService } from './org-scope.service';
import { DEFAULT_ORGANIZERS } from '../common/defaults';

/* /api/org/* — the organizer surface (OrganizerGuard: real organizer OR admin
   impersonating). MT2/MT3 add their controllers to the org module alongside this
   one. MT1 ships only GET /api/org/me. */
@Controller('org')
export class OrgController {
  constructor(
    private readonly scope: OrgScopeService,
    private readonly entities: EntityStore,
  ) {}

  @UseGuards(OrganizerGuard)
  @Get('me')
  async me(@Req() req: Request) {
    // req.actingHandle is stamped by OrganizerGuard (guaranteed non-null here).
    const handle = req.actingHandle as string;
    const orgs = await this.entities.read<any[]>('organizers', DEFAULT_ORGANIZERS);
    const org = orgs.find((o) => o.handle === handle);
    return {
      actingHandle: handle,
      name: org ? org.name : null,
      role: req.session.role || (req.actingViaImpersonation ? 'admin' : 'organizer'),
      impersonating: req.actingViaImpersonation ? req.session.impersonating || null : null,
      // KYC status lives on the organizer record when present; the enforcement
      // gate (I6) lands in MT2. Falls back to the session claim, else null.
      kycStatus: (org && org.kycStatus) ?? req.session.kycStatus ?? null,
    };
  }
}
