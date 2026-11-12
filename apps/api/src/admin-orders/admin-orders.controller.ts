import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  db, adminPush, adminPushPreview, AdminPushRefused, maskPhone, reconcile, checkOrderWithGateway, GatewayCheckRefused,
} from '@zora/core';
import { SessionGuard } from '../common/session.guard';
import { Roles } from '../common/roles.guard';
import { EntityStore } from '../storage/entity-store';
import { AuditService } from '../audit/audit.module';
import { DEFAULT_SETTINGS } from '../common/defaults';
import { AdminOrdersService } from './admin-orders.service';
import { AdminFunnelService } from './admin-funnel.service';

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
  constructor(
    private readonly orders: AdminOrdersService,
    private readonly entities: EntityStore,
    private readonly audit: AuditService,
  ) {}

  /** Mobile money on/off (BS47: absent = on) and the hold TTL, from settings. */
  private async payConfig() {
    const settings = await this.entities.read<any>('settings', DEFAULT_SETTINGS);
    const methods = settings?.methodsEnabled && typeof settings.methodsEnabled === 'object' ? settings.methodsEnabled : {};
    return {
      mobileEnabled: methods.mobile !== false,
      holdTtlSecs: Number.isInteger(settings?.hold_ttl_seconds) ? settings.hold_ttl_seconds : 900,
    };
  }

  /** GET /api/admin/orders/filters — the dropdown vocabulary (events, orgs,
      statuses) so the UI never hard-codes a status list that drifts. */
  @Get('filters')
  async filters() {
    return this.orders.filters();
  }

  /**
   * GET /api/admin/orders?status=&outcome=&event=&organizer=&q=&limit=&cursor=&days=
   *
   * BS157: `outcome` is one of the cart outcomes (@zora/core CART_OUTCOMES);
   * an unknown value is ignored.
   *
   * `days=0` explicitly disables the recent window — allowed, but it has to be
   * asked for; the default never scans the whole table.
   */
  @Get()
  async list(
    @Query('status') status?: string,
    @Query('outcome') outcome?: string,
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
      outcome: outcome && outcome !== 'all' ? outcome : null,
      eventId: event && event !== 'all' ? event : null,
      organizerHandle: organizer && organizer !== 'all' ? organizer : null,
      q: q || null,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : null,
      cursor: cursor || null,
      days: Number.isFinite(parsedDays) ? parsedDays : null,
    });
  }

  /** BS153: GET /api/admin/orders/:id — one cart inside out: attempts with their
      gateway refs and errors, passes, check-ins, and the step-by-step timeline
      (logged events merged with ones derived from the tables for old orders).
      Declared after `filters` so that path still wins. */
  @Get(':id')
  async detail(@Param('id') id: string, @Query('reconcile') refresh?: string) {
    // BS158: the push panel polls with ?reconcile=1 so an open attempt is read
    // from x-bridge (like the buyer's status page) instead of waiting on a callback.
    if (refresh === '1' && /^[0-9a-f-]{36}$/i.test(id)) {
      const sql = db();
      const open = await sql`
        select transaction_id from payment_transaction
         where order_id = ${id}::uuid and error is null and status in ('created', 'pending', 'processing')
         order by created_at asc limit 5`;
      for (const t of open) {
        try { await reconcile(sql, t.transaction_id); }
        catch (e) { console.error('admin reconcile failed', t.transaction_id, (e as Error)?.message); }
      }
    }
    const order = await this.orders.detail(id);
    if (!order) throw new NotFoundException({ error: 'order_not_found' });
    const { mobileEnabled } = await this.payConfig();
    const push = await adminPushPreview(db(), id, { mobileEnabled }).catch((e) => {
      console.error('admin push preview failed', (e as Error)?.message);
      return null;
    });
    return { ...order, push };
  }

  /**
   * BS158: POST /api/admin/orders/:id/push { phone?, note? } — send a mobile-money
   * prompt for the cart's own amount. Refusals: 400 invalid_phone, 403
   * method_disabled, 404 order_not_found, 409 not_payable | attempt_in_flight |
   * inventory_unavailable, 429 rate_limited. A gateway refusal is 502 with the
   * sanitized error (also stored on the attempt). Every call is audited.
   */
  @Post(':id/push')
  async push(@Param('id') id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return res.status(404).json({ error: 'order_not_found' });
    const phone = body?.phone == null ? null : String(body.phone).slice(0, 40);
    const note = body?.note == null ? null : String(body.note).slice(0, 280);
    const s: any = req.session || {};
    const admin = { id: String(s.userId || 'admin'), name: String(s.userId ? `user ${s.userId}` : 'admin') };
    const { mobileEnabled, holdTtlSecs } = await this.payConfig();
    const callbackUrl = `${process.env.PUBLIC_ORIGIN || ''}/api/webhooks/xbridge`;
    const audit = (result: string, masked: string | null, amount: number | null) =>
      this.audit.record(
        'admin.order.push',
        `${admin.name} → order ${id} · ${masked ?? 'no number'} · ${amount != null ? `${amount} TZS` : 'amount n/a'} · ${result}${note ? ` · note: ${note}` : ''}`,
        req.ip, admin.id,
      ).catch((e) => console.error('audit write failed', (e as Error)?.message));

    try {
      const r = await adminPush(db(), { orderId: id, phone, note, admin, mobileEnabled, callbackUrl, holdTtlSecs });
      await audit(r.gateway === 'accepted' ? `accepted (${r.transactionId})` : `gateway rejected (${r.transactionId}): ${r.error}`, r.phone, r.amount);
      const out = {
        transactionId: r.transactionId, status: r.status, gateway: r.gateway,
        ...(r.error ? { error: r.error } : {}),
        amount: r.amount, phone: r.phone, scheduleN: r.scheduleN, revivedFrom: r.revivedFrom,
      };
      return res.status(r.gateway === 'accepted' ? 200 : 502).json(out);
    } catch (e) {
      if (e instanceof AdminPushRefused) {
        await audit(`refused: ${e.code}`, e.extra.phone ?? maskPhone(phone), e.extra.amount ?? null);
        if (e.extra.retryAfterSecs) res.setHeader('Retry-After', String(e.extra.retryAfterSecs));
        return res.status(e.httpStatus).json({
          error: e.code, message: e.message,
          ...(e.extra.status ? { status: e.extra.status } : {}),
          ...(e.extra.reason ? { reason: e.extra.reason } : {}),
          ...(e.extra.retryAfterSecs ? { retryAfterSecs: e.extra.retryAfterSecs } : {}),
        });
      }
      console.error('admin push failed', (e as Error)?.message);
      await audit('error', maskPhone(phone), null);
      return res.status(500).json({ error: 'push_failed' });
    }
  }

  /**
   * BS164: POST /api/admin/orders/:id/gateway-check — ask x-bridge for the status
   * of every attempt on the cart (expired ones included) and apply it: open and
   * late-settled attempts settle like the poller while the cart still awaits the
   * money; money the cart can't take, and a disagreement with a finished attempt,
   * are flagged (ops alert), never applied. 404 order_not_found, 429
   * rate_limited (one check per cart per 10 s). Every call is audited.
   */
  @Post(':id/gateway-check')
  async gatewayCheck(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''))) return res.status(404).json({ error: 'order_not_found' });
    const s: any = req.session || {};
    const admin = { id: String(s.userId || 'admin'), name: String(s.userId ? `user ${s.userId}` : 'admin') };
    const audit = (result: string) =>
      this.audit.record('admin.order.gateway_check', `${admin.name} → order ${id} · ${result}`, req.ip, admin.id)
        .catch((e) => console.error('audit write failed', (e as Error)?.message));
    try {
      const r = await checkOrderWithGateway(db(), id, { admin });
      await audit(`checked ${r.attempts.length} · updated ${r.updated} · mismatches ${r.mismatches} · needs refund ${r.needsRefund} · errors ${r.errors} · ${r.orderStatusBefore} → ${r.orderStatusAfter}`);
      return res.status(200).json(r);
    } catch (e) {
      if (e instanceof GatewayCheckRefused) {
        // Refusals change nothing; only real checks go in the audit log.
        if (e.retryAfterSecs) res.setHeader('Retry-After', String(e.retryAfterSecs));
        return res.status(e.httpStatus).json({ error: e.code, message: e.message, ...(e.retryAfterSecs ? { retryAfterSecs: e.retryAfterSecs } : {}) });
      }
      console.error('admin gateway check failed', (e as Error)?.message);
      await audit('error');
      return res.status(500).json({ error: 'gateway_check_failed' });
    }
  }
}

/* BS153: GET /api/admin/funnel?days=7|30|90&org=&event= — stage counts with the
   drop-off between each, plus the top reasons carts did not pay. Same guard. */
@Roles('super_admin')
@Controller('admin/funnel')
@UseGuards(SessionGuard)
export class AdminFunnelController {
  constructor(private readonly funnel: AdminFunnelService) {}

  @Get()
  async get(@Query('days') days?: string, @Query('org') org?: string, @Query('event') event?: string) {
    return this.funnel.funnel({
      days: days ? parseInt(days, 10) : null,
      org: org && org !== 'all' ? org : null,
      event: event && event !== 'all' ? event : null,
    });
  }
}
