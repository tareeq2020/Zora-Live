import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { db, readStorefrontAnalytics, storefrontRangeDays, SOLD_STATUSES } from '@zora/core';
import { OrganizerGuard } from '../common/organizer.guard';
import { SessionGuard } from '../common/session.guard';
import { Roles } from '../common/roles.guard';
import { OrgScopeService } from '../org/org-scope.service';

/* BS128: GET /api/org/storefront-analytics?range=7D|30D|90D&event=<id>
   BS129: GET /api/admin/storefront-analytics?range=  (platform + per-organizer)
   Counts only (traffic from first-party aggregates, purchases from orders). */

@Controller()
export class StorefrontAnalyticsController {
  constructor(private readonly scope: OrgScopeService) {}

  @UseGuards(OrganizerGuard)
  @Get('org/storefront-analytics')
  async org(@Req() req: Request, @Query('range') range?: string, @Query('event') event?: string) {
    const handle = req.actingHandle as string;
    let events = await this.scope.ownedEventIds(handle);
    if (event) events = events.filter((e) => e === event);
    const names = new Map((await this.scope.readEvents()).filter((e: any) => e && events.includes(e.id)).map((e: any) => [e.id, e.name]));
    const data = await readStorefrontAnalytics(db(), { orgs: [handle], events, days: storefrontRangeDays(range) });
    return { ...data, topEvents: data.topEvents.map((t) => ({ ...t, name: names.get(t.eventId) ?? t.eventId })) };
  }

  @Roles('super_admin')
  @UseGuards(SessionGuard)
  @Get('admin/storefront-analytics')
  async admin(@Query('range') range?: string) {
    const days = storefrontRangeDays(range);
    const all = await this.scope.readEvents();
    const orgOf = new Map<string, string>(all.filter((e: any) => e?.id).map((e: any) => [e.id, e.organizerHandle || '']));
    const nameOf = new Map<string, string>(all.filter((e: any) => e?.id).map((e: any) => [e.id, e.name]));
    const data = await readStorefrontAnalytics(db(), { orgs: null, events: null, days });
    // Per-organizer leaderboard: traffic by org_handle, purchases/GMV by event → org.
    const from = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    const traffic = await db()`
      select org_handle, coalesce(sum(views) filter (where kind='storefront'),0)::int as visits,
             coalesce(sum(views) filter (where kind='event'),0)::int as event_views, coalesce(sum(visitors),0)::int as visitors
        from analytics_daily where day >= ${from} group by org_handle`;
    const sales = await db()`
      select o.event_id, count(distinct o.id)::int as purchases, coalesce(sum(oi.quantity),0)::int as passes,
             coalesce(sum(oi.quantity * oi.unit_price),0)::bigint as gmv
        from "order" o join order_item oi on oi.order_id = o.id
       where o.status = any(${SOLD_STATUSES}) and o.created_at >= ${from}::date group by o.event_id`;
    const orgs = new Map<string, { org: string; visits: number; eventViews: number; visitors: number; purchases: number; passes: number; gmv: number }>();
    const row = (org: string) => { if (!orgs.has(org)) orgs.set(org, { org, visits: 0, eventViews: 0, visitors: 0, purchases: 0, passes: 0, gmv: 0 }); return orgs.get(org)!; };
    for (const t of traffic) Object.assign(row(t.org_handle), { visits: t.visits, eventViews: t.event_views, visitors: t.visitors });
    for (const s of sales) { const r = row(orgOf.get(s.event_id) || '(unassigned)'); r.purchases += s.purchases; r.passes += s.passes; r.gmv += Number(s.gmv); }
    const leaderboard = Array.from(orgs.values())
      .map((r) => ({ ...r, conversion: r.visitors > 0 ? Math.min(1, r.purchases / r.visitors) : 0 }))
      .sort((a, b) => b.gmv - a.gmv || b.visits - a.visits).slice(0, 50);
    return { ...data, topEvents: data.topEvents.map((t) => ({ ...t, name: nameOf.get(t.eventId) ?? t.eventId, org: orgOf.get(t.eventId) ?? '' })), organizers: leaderboard };
  }
}
