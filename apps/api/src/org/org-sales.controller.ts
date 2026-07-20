import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { OrganizerGuard } from '../common/organizer.guard';
import { OrgSalesService } from './org-sales.service';

/* /api/org/summary + /api/org/orders (MT3) — the organizer sales/reporting
   surface. OrganizerGuard stamps req.actingHandle (real organizer OR admin
   impersonating); every read is scoped to it via OrgSalesService (C3). */
@Controller('org')
@UseGuards(OrganizerGuard)
export class OrgSalesController {
  constructor(private readonly sales: OrgSalesService) {}

  @Get('summary')
  async summary(@Req() req: Request) {
    const handle = req.actingHandle as string;
    return this.sales.summary(handle);
  }

  @Get('orders')
  async orders(
    @Req() req: Request,
    @Query('eventId') eventId?: string,
    @Query('limit') limit?: string,
  ) {
    const handle = req.actingHandle as string;
    const parsed = limit != null ? parseInt(limit, 10) : NaN;
    return this.sales.orders(handle, eventId, Number.isFinite(parsed) ? parsed : 50);
  }
}
