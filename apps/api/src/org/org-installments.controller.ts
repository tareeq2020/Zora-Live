import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  db, isFlagOn, readInstallmentConfig, upsertInstallmentConfig, sanitizeInstallmentConfig,
  orgInstallmentList, installmentPlanEvent, claimOrgReminder, releaseOrgReminder, secondsUntilEatMidnight,
  sendManualInstallmentReminder, ORG_INSTALLMENT_STATUSES, INSTALLMENT_MIN_COUNT, INSTALLMENT_MAX_COUNT,
  type InstallmentConfig,
} from '@zora/core';
import { OrganizerGuard } from '../common/organizer.guard';
import { Roles } from '../common/roles.guard';
import { EntityStore } from '../storage/entity-store';
import { AuditService } from '../audit/audit.module';
import { DEFAULT_SETTINGS } from '../common/defaults';
import { OrgScopeService } from './org-scope.service';

/* BS136 (F7 / DD5): the organizer side of installments.

   GET  /api/org/installments/enabled           → { enabled } (nav gate; flag for the acting org)
   GET  /api/org/events/:id/installments        → the event's offer + tiers + fee rate (settings tab)
   PUT  /api/org/events/:id/installments        → save the offer (validation mirrors the DB CHECKs)
   GET  /api/org/installments?event=&status=    → plans, KPIs, filter counts (buyer NAME only)
   POST /api/org/installments/:orderId/remind   → one SMS/email nudge, max 1 / day / order (429 after)

   Scoped to the acting org: events through assertOwnsEvent / ownedEventIds
   (404, never 403, for someone else's ids). Everything except the read of the
   offer needs the zp_installments flag for that org (features ship dark).
   Default rule: release + refund minus the service fee (owner decision 3) — the
   only rule the backend implements, so it is reported read-only. */

const DEFAULT_OFFER = {
  enabled: false, tiers: [] as string[], depositPct: 33 as number | null, depositAmount: null as number | null,
  count: 3, frequency: 'monthly', finalDueDaysBeforeEvent: 7, graceDays: 2,
};

@UseGuards(OrganizerGuard)
@Controller('org')
export class OrgInstallmentsController {
  constructor(
    private readonly scope: OrgScopeService,
    private readonly entities: EntityStore,
    private readonly audit: AuditService,
  ) {}

  private async settings(): Promise<any> {
    return this.entities.read<any>('settings', DEFAULT_SETTINGS).catch(() => ({}));
  }

  private async flagOn(handle: string, eventId?: string | null): Promise<boolean> {
    const s = await this.settings();
    return isFlagOn(s?.flags, 'zp_installments', { org: handle, event: eventId ?? null });
  }

  /** Org-level flag OR any owned event switched on (an event-pilot org still sees the page). */
  private async orgEnabled(handle: string): Promise<boolean> {
    const s = await this.settings();
    if (isFlagOn(s?.flags, 'zp_installments', { org: handle })) return true;
    const ids = await this.scope.ownedEventIds(handle);
    return ids.some((id) => isFlagOn(s?.flags, 'zp_installments', { org: handle, event: id }));
  }

  @Roles('owner', 'admin', 'finance')
  @Get('installments/enabled')
  async enabled(@Req() req: Request) {
    return { enabled: await this.orgEnabled(req.actingHandle as string) };
  }

  @Roles('owner', 'admin')
  @Get('events/:id/installments')
  async getConfig(@Req() req: Request, @Param('id') id: string) {
    const handle = req.actingHandle as string;
    const ev = await this.scope.assertOwnsEvent(handle, id);
    const sql = db();
    const tiers = await sql`
      select pt.id, pt.name, pv.price, pv.currency, pv.fee_treatment
        from product_tier pt
        left join lateral (select price, currency, fee_treatment from price_version
                            where tier_id = pt.id and effective_to is null order by effective_from desc limit 1) pv on true
       where pt.event_id = ${id} and coalesce(pt.disabled, false) = false
       order by pv.price nulls last, pt.name`;
    const config = await readInstallmentConfig(sql, id);
    const s = await this.settings();
    const date = typeof ev.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ev.date) ? ev.date.slice(0, 10) : null;
    return {
      enabled: await this.flagOn(handle, id),
      eventId: id,
      eventName: ev.name ?? '',
      eventDate: date,
      feeRate: typeof s?.feeRate === 'number' ? s.feeRate : 0,
      tiers: tiers.map((t: any) => ({
        id: t.id, name: t.name, price: t.price == null ? null : Number(t.price), currency: t.currency || 'TZS',
        feePassed: t.fee_treatment === 'passed',
      })),
      configured: !!config,
      config: config ? { ...config } : { eventId: id, ...DEFAULT_OFFER },
      limits: { minCount: INSTALLMENT_MIN_COUNT, maxCount: INSTALLMENT_MAX_COUNT, maxGraceDays: 30, maxFinalDueDays: 365 },
      defaultRule: 'refund_minus_service_fee',
    };
  }

  @Roles('owner', 'admin')
  @Put('events/:id/installments')
  async putConfig(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    const handle = req.actingHandle as string;
    await this.scope.assertOwnsEvent(handle, id);
    if (!(await this.flagOn(handle, id))) throw new ForbiddenException({ error: 'feature_off' });
    if (body?.defaultRule != null && body.defaultRule !== 'refund_minus_service_fee') {
      throw new BadRequestException({ error: 'invalid_config', errors: ['default_rule_unsupported'] });
    }
    const r = sanitizeInstallmentConfig(id, body);
    if (!r.ok) throw new BadRequestException({ error: 'invalid_config', errors: r.errors });
    const sql = db();
    if (r.config.tiers.length) {
      const known = await sql`select id from product_tier where event_id = ${id} and id = any(${r.config.tiers})`;
      if (known.length !== r.config.tiers.length) throw new BadRequestException({ error: 'invalid_config', errors: ['unknown_tier'] });
    }
    let saved: InstallmentConfig;
    try {
      saved = await upsertInstallmentConfig(sql, r.config);
    } catch (e: any) {
      // The table CHECKs are the backstop; a violation is the caller's input.
      if (e?.code === '23514') throw new BadRequestException({ error: 'invalid_config', errors: [String(e.constraint_name || 'check')] });
      throw e;
    }
    await this.audit.record('org_installments_saved', `event ${id} · ${saved.enabled ? 'on' : 'off'} · ${saved.count}×${saved.frequency}`, req.ip, handle);
    return { ok: true, config: saved };
  }

  @Roles('owner', 'admin', 'finance')
  @Get('installments')
  async list(@Req() req: Request, @Query('event') event?: string, @Query('status') status?: string) {
    const handle = req.actingHandle as string;
    if (status && status !== 'all' && !(ORG_INSTALLMENT_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException({ error: 'invalid_status' });
    }
    const owned = await this.scope.ownedEventIds(handle);
    if (event && !owned.includes(event)) throw new NotFoundException({ error: 'Not found' });
    const events = (await this.scope.readEvents())
      .filter((e) => e && e.organizerHandle === handle)
      .map((e) => ({ id: e.id as string, name: (e.name as string) || e.id }));
    const data = await orgInstallmentList(db(), owned, { event: event || null, status: status && status !== 'all' ? status : null });
    return { enabled: await this.orgEnabled(handle), events, ...data };
  }

  @Roles('owner', 'admin')
  @Post('installments/:orderId/remind')
  async remind(@Req() req: Request, @Param('orderId') orderId: string, @Res() res: Response) {
    const handle = req.actingHandle as string;
    const sql = db();
    const plan = await installmentPlanEvent(sql, orderId);
    const owned = plan ? await this.scope.ownedEventIds(handle) : [];
    if (!plan || !owned.includes(plan.eventId)) return res.status(404).json({ error: 'Not found' });
    if (!(await this.flagOn(handle, plan.eventId))) return res.status(403).json({ error: 'feature_off' });
    if (plan.status !== 'active') return res.status(409).json({ error: 'not_remindable', status: plan.status });
    if (!(await claimOrgReminder(sql, orderId))) {
      const retry = secondsUntilEatMidnight();
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: 'already_reminded_today', retryAfterSecs: retry });
    }
    let out: { sent: boolean; sms: boolean; email: boolean };
    try {
      out = await sendManualInstallmentReminder(sql, orderId);
    } catch (e) {
      await releaseOrgReminder(sql, orderId).catch(() => {});
      throw e;
    }
    if (!out.sent) {
      await releaseOrgReminder(sql, orderId).catch(() => {});
      return res.status(409).json({ error: 'not_remindable' });
    }
    await this.audit.record('org_installment_reminder', `order ${orderId}`, req.ip, handle);
    return res.status(200).json({ ok: true, sms: out.sms, email: out.email });
  }
}
