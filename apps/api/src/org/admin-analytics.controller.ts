import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../common/session.guard';
import { Roles } from '../common/roles.guard';
import { OrgSalesService } from './org-sales.service';

/* /api/admin/analytics (BS70 / dashboard #8) — the platform-wide (all-orgs)
   variant of the org analytics, for the super-admin overview (GMV + platform
   take). Admin-only (SessionGuard) and read-only. Same response shape as
   /api/org/analytics, scoped across EVERY event instead of one organizer's:
   platform take = kpis.revenue − kpis.netRevenue. Lives in OrgModule so it can
   inject the exported OrgSalesService without duplicating the earnings read. */
/* BS93 (Phase 2, E4): /api/admin/* requires global super_admin (isAdmin maps to it). */
@Roles('super_admin')
@Controller('admin/analytics')
@UseGuards(SessionGuard)
export class AdminAnalyticsController {
  constructor(private readonly sales: OrgSalesService) {}

  @Get()
  async analytics(@Query('range') range?: string) {
    return this.sales.analyticsAll(range);
  }
}
