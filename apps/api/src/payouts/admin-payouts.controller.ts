import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../common/session.guard';
import { Roles } from '../common/roles.guard';
import { AuditService } from '../audit/audit.module';
import { OrganizerRepo } from '../storage/organizer-repo';
import { PayoutsService } from './payouts.service';

/* /api/admin/payouts (BS38 / #7) — the STAFF side: the withdrawal queue and the
   confirm/reject decision.

   Settlement is out-of-band. Zora does not push money anywhere: an admin makes
   the bank or mobile-money transfer by hand and records the reference here, which
   is why `reference` is REQUIRED on approve — an approved payout with no
   reference is money that left with no proof. When the organizer's balance
   currency is not the currency actually settled in, the admin types the rate they
   used into `fxNote` (OV7); Zora never invents an FX rate.

   Guarded by SessionGuard (admin session) and written to the audit trail, like
   every other money-moving admin action. */
/* BS93 (Phase 2, E4): /api/admin/* requires global super_admin (isAdmin maps to it). */
@Roles('super_admin')
@Controller('admin/payouts')
@UseGuards(SessionGuard)
export class AdminPayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly organizers: OrganizerRepo,
    private readonly audit: AuditService,
  ) {}

  /** GET /api/admin/payouts?status=requested — the queue, newest first. */
  @Get()
  async list(@Query('status') status?: string, @Query('limit') limit?: string) {
    const parsed = limit != null ? parseInt(limit, 10) : NaN;
    const rows = await this.payouts.adminList(status, Number.isFinite(parsed) ? parsed : undefined);
    // Attach the display name so the queue reads "The Brunch City", not a slug.
    const orgs = await this.organizers.list();
    const nameByHandle = new Map(orgs.map((o) => [o.handle, o.name]));
    return rows.map((p) => ({ ...p, organizerName: nameByHandle.get(p.organizerHandle) ?? p.organizerHandle }));
  }

  /** PUT /api/admin/payouts/:id — { decision:'approve', reference, fxNote }
                                 | { decision:'reject', reason } */
  @Put(':id')
  async decide(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { decision?: unknown; reference?: unknown; fxNote?: unknown; reason?: unknown },
  ) {
    // The id column is a uuid; a malformed one would blow up in Postgres, so it
    // is a 404 here (and never leaks whether some other id exists).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''))) {
      throw new NotFoundException({ error: 'not_found' });
    }
    const decision = String(body?.decision ?? '').toLowerCase();
    if (decision !== 'approve' && decision !== 'reject') {
      throw new BadRequestException({ error: 'invalid_decision', message: 'A payout can only be approved or rejected.' });
    }

    const result = await this.payouts.decide(id, decision, 'admin', {
      reference: typeof body?.reference === 'string' ? body.reference.slice(0, 200) : null,
      fxNote: typeof body?.fxNote === 'string' ? body.fxNote.slice(0, 200) : null,
      reason: typeof body?.reason === 'string' ? body.reason.slice(0, 280) : null,
    });

    if (!result.ok) {
      if (result.code === 'not_found') throw new NotFoundException({ error: result.code, message: result.message });
      throw new BadRequestException({ error: result.code, message: result.message });
    }

    const p = result.payout;
    await this.audit.record(
      decision === 'approve' ? 'payout.approve' : 'payout.reject',
      decision === 'approve'
        ? `${p.organizerHandle} ${p.amount} ${p.currency} ref=${p.reference}${p.fxNote ? ` fx=${p.fxNote}` : ''} (payout ${p.id})`
        : `${p.organizerHandle} ${p.amount} ${p.currency} reason=${p.reason} (payout ${p.id})`,
      req.ip,
    );
    return { ok: true, payout: p };
  }
}
