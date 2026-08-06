import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { OrganizerGuard } from '../common/organizer.guard';
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

  /** POST /api/org/payouts — request a withdrawal. */
  @Post()
  async request(
    @Req() req: Request,
    @Body() body: { amount?: unknown; currency?: unknown; note?: unknown },
  ) {
    const handle = req.actingHandle as string;
    // Parse only — do NOT decide here. Core owns every rule so the same verdict
    // is reached whether the caller is HTTP, a script or a future admin tool.
    const amount = typeof body?.amount === 'string' ? Number(body.amount.replace(/[\s,]/g, '')) : Number(body?.amount);
    const currency = String(body?.currency ?? '').trim().toUpperCase();
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 280) : null;

    const result = await this.payouts.request(handle, amount, currency, note);
    if (!result.ok) {
      // The balance rides along on a refusal so the UI can correct itself
      // immediately instead of showing a stale figure next to the error.
      throw new BadRequestException({
        error: result.code,
        message: result.message,
        ...(result.balance ? { balance: result.balance } : {}),
      });
    }

    await this.audit.record(
      'payout.request',
      `${result.payout.amount} ${result.payout.currency} (payout ${result.payout.id})`,
      req.ip,
      req.actingViaImpersonation ? `admin(as ${handle})` : handle,
    );
    return { ok: true, payout: result.payout, balance: result.balance };
  }
}
