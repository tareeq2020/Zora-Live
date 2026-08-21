import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../common/session.guard';
import { Roles } from '../common/roles.guard';
import { AdminOrdersService } from './admin-orders.service';

/* /api/admin/orders (BS43 / plan #3) — support's window into EVERY order.

   Read-only and admin-only (SessionGuard). Nothing here mutates an order: this
   is the screen someone opens with a customer on the phone, and the whole value
   is that it shows the attempt as it happened — including the pending, failed
   and expired carts every other read hides.

   Two guards on the read itself, both in the service:
     · a recent WINDOW is applied unless the caller opts out (PERF-1), because
       abandoned carts outnumber paid ones and grow fastest;
     · buyer contact on a never-paid cart is masked past the PII window (OV8). */
/* BS93 (Phase 2, E4): /api/admin/* requires global super_admin (isAdmin maps to it). */
@Roles('super_admin')
@Controller('admin/orders')
@UseGuards(SessionGuard)
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  /** GET /api/admin/orders/filters — the dropdown vocabulary (events, orgs,
      statuses) so the UI never hard-codes a status list that drifts. */
  @Get('filters')
  async filters() {
    return this.orders.filters();
  }

  /**
   * GET /api/admin/orders?status=&event=&organizer=&q=&limit=&cursor=&days=
   *
   * `days=0` explicitly disables the recent window — allowed, but it has to be
   * asked for; the default never scans the whole table.
   */
  @Get()
  async list(
    @Query('status') status?: string,
    @Query('event') event?: string,
    @Query('organizer') organizer?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('days') days?: string,
  ) {
    const parsedLimit = limit != null ? parseInt(limit, 10) : NaN;
    const parsedDays = days != null && days !== '' ? parseInt(days, 10) : NaN;
    return this.orders.list({
      status: status && status !== 'all' ? status : null,
      eventId: event && event !== 'all' ? event : null,
      organizerHandle: organizer && organizer !== 'all' ? organizer : null,
      q: q || null,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : null,
      cursor: cursor || null,
      days: Number.isFinite(parsedDays) ? parsedDays : null,
    });
  }
}
