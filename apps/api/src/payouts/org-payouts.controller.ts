import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { OrganizerGuard } from '../common/organizer.guard';
import { Roles } from '../common/roles.guard';
import { AuditService } from '../audit/audit.module';
import { PayoutsService } from './payouts.service';

/* /api/org/payouts (BS38 / #7) — the ORGANIZER side of withdrawals.

   OrganizerGuard stamps req.actingHandle (a real organizer, or an admin actively
   impersonating one). Every read and write below is keyed on THAT handle and
   nothing else — there is no id or handle in the request body that could point
   at another org, so cross-org access is impossible by construction rather than
   by a check someone can forget.

   The client sends an amount and a currency. It never sends a balance: the
   balance is recomputed server-side inside the same locked transaction that
   writes the row (@zora/core/payouts, eng review ARCH-2). A refusal comes back
   as HTTP 400 with a typed `error` code plus a human `message` (CQ3), so the UI
   maps codes and never string-matches. */
/* BS93 (Phase 2, E4): payouts are money — owner/admin/finance only. A viewer/door
   member is refused (403); a legacy session (no memberships) is an implicit owner. */
@Roles('owner', 'admin', 'finance')
@Controller('org/payouts')
@UseGuards(OrganizerGuard)
export class OrgPayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly audit: AuditService,
  ) {}

  /** GET /api/org/payouts — history + the current available balance per currency. */
  @Get()
  async list(@Req() req: Request) {
    return this.payouts.organizerView(req.actingHandle as string);
  }

  /** GET /api/org/payouts/methods — the destination catalog the request form
      renders (payment methods · banks · mobile-money operators). Static registry
      data; scoped under the org guard only so it rides the same session. */
  @Get('methods')
  methods() {
    return this.payouts.destinationCatalog();
  }

  /** POST /api/org/payouts — request a withdrawal. */
  @Post()
  async request(
    @Req() req: Request,
    @Body() body: { amount?: unknown; currency?: unknown; note?: unknown; destination?: unknown },
  ) {
    const handle = req.actingHandle as string;
    // Parse only — do NOT decide here. Core owns every rule so the same verdict
    // is reached whether the caller is HTTP, a script or a future admin tool.
    const amount = typeof body?.amount === 'string' ? Number(body.amount.replace(/[\s,]/g, '')) : Number(body?.amount);
    const currency = String(body?.currency ?? '').trim().toUpperCase();
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 280) : null;
    // Destination is passed through as-is; core validates it against the canonical
    // registry (the ONE place the rules live) and returns `destination_invalid`.
    const destination = body?.destination ?? null;

    const result = await this.payouts.request(handle, amount, currency, note, destination);
    if (!result.ok) {
      // The balance rides along on a refusal so the UI can correct itself
      // immediately instead of showing a stale figure next to the error.
      throw new BadRequestException({
        error: result.code,
        message: result.message,
        ...(result.balance ? { balance: result.balance } : {}),
      });
    }

    const d = result.payout.destination;
    await this.audit.record(
      'payout.request',
      `${result.payout.amount} ${result.payout.currency}` +
        (d ? ` → ${d.providerName} ${d.account}${d.accountName ? ` (${d.accountName})` : ''}` : '') +
        ` (payout ${result.payout.id})`,
      req.ip,
      req.actingViaImpersonation ? `admin(as ${handle})` : handle,
    );
    return { ok: true, payout: result.payout, balance: result.balance };
  }
}
