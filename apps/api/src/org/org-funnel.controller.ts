import { Controller, Get, NotFoundException, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { OrganizerGuard } from '../common/organizer.guard';
import { Roles } from '../common/roles.guard';
import { OrgFunnelService } from './org-funnel.service';

/* BS160: GET /api/org/funnel and GET /api/org/orders/:id — the organizer's
   lighter funnel and per-order timeline. Same gate and roles as the Sales
   reads (OrgSalesController); everything is scoped to req.actingHandle. */
@Roles('owner', 'admin', 'finance')
@Controller('org')
@UseGuards(OrganizerGuard)
export class OrgFunnelController {
  constructor(private readonly funnel: OrgFunnelService) {}

  /** ?days=7|30|90 (default 7) &event= one of their events (else 404). */
  @Get('funnel')
  async get(@Req() req: Request, @Query('days') days?: string, @Query('event') event?: string) {
    return this.funnel.funnel(req.actingHandle as string, days ? parseInt(days, 10) : null, event && event !== 'all' ? event : null);
  }

  /** One order with its outcome and a short timeline. Another org's order is a 404. */
  @Get('orders/:id')
  async detail(@Req() req: Request, @Param('id') id: string) {
    const order = await this.funnel.detail(req.actingHandle as string, id);
    if (!order) throw new NotFoundException({ error: 'not_found' });
    return order;
  }
}
