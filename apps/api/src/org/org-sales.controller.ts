import { Controller, Get, Post, Param, Query, Req, UseGuards, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { OrganizerGuard } from '../common/organizer.guard';
import { Roles } from '../common/roles.guard';
import { OrgSalesService } from './org-sales.service';

/* /api/org/summary + /api/org/orders (MT3) — the organizer sales/reporting
   surface. OrganizerGuard stamps req.actingHandle (real organizer OR admin
   impersonating); every read is scoped to it via OrgSalesService (C3). */
/* BS93 (Phase 2, E4): sales/revenue reporting — owner/admin/finance. */
@Roles('owner', 'admin', 'finance')
@Controller('org')
@UseGuards(OrganizerGuard)
export class OrgSalesController {
  constructor(private readonly sales: OrgSalesService) {}

  @Get('summary')
  async summary(@Req() req: Request) {
    const handle = req.actingHandle as string;
    return this.sales.summary(handle);
  }

  // BS70 (#8): GET /api/org/analytics?range=7D|14D|30D|ALL — the KPI row + hero
  // revenue chart. Net revenue reuses the stamped-commission earnings read; the
  // range is coerced server-side (defaults to 30D on anything unrecognised).
  @Get('analytics')
  async analytics(@Req() req: Request, @Query('range') range?: string) {
    const handle = req.actingHandle as string;
    return this.sales.analytics(handle, range);
  }

  // BS58: filters + keyset paging. All optional; each only narrows within the
  // org's owned-event scope. Returns { rows, nextCursor }.
  @Get('orders')
  async orders(
    @Req() req: Request,
    @Query('eventId') eventId?: string,
    @Query('tier') tier?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const handle = req.actingHandle as string;
    const parsed = limit != null ? parseInt(limit, 10) : NaN;
    return this.sales.orders(handle, {
      eventId, tier, status, q, from, to, cursor,
      limit: Number.isFinite(parsed) ? parsed : 50,
    });
  }

  // ── GET /api/org/splits — splits forming + the refund worklist (BS12) ─────
  @Get('splits')
  async splits(@Req() req: Request) {
    const handle = req.actingHandle as string;
    return this.sales.splits(handle);
  }

  // ── POST /api/org/orders/:orderId/resend — re-send ONE order's tickets (BS59) ──
  @Post('orders/:orderId/resend')
  async resendOrder(@Req() req: Request, @Param('orderId') orderId: string) {
    const handle = req.actingHandle as string;
    const r = await this.sales.resendOrder(handle, orderId);
    if (!r.ok) {
      if (r.reason === 'not_paid') return { ok: false, reason: 'not_paid' }; // 200: a real state, not an error
      throw new NotFoundException({ error: 'not_found' });                    // foreign/absent order
    }
    return { ok: true, result: r.result };
  }

  // ── POST /api/org/events/:eventId/resend-all — re-send every paid order (BS59) ──
  @Post('events/:eventId/resend-all')
  async resendAll(@Req() req: Request, @Param('eventId') eventId: string) {
    const handle = req.actingHandle as string;
    return this.sales.resendAllForEvent(handle, eventId);
  }
}
