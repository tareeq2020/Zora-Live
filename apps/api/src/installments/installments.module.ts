import { Controller, Get, Module, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  db, isFlagOn, eventInstallmentContext, installmentOffer, installmentQuote, installmentPayView,
  installmentOrderOwner, customerInstallments,
} from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { DEFAULT_SETTINGS } from '../common/defaults';
import { ConsumerGuard, type ConsumerIdentity } from '../common/consumer';
import { canReadBuyerOrder } from '../common/order-access';

/* BS134 (F7 / A5 / DD5): the buyer-facing installment reads.

     GET /api/events/:id/installments            offer + card hint (public)
     GET /api/installments/offers?events=a,b     the same for many cards (public)
     GET /api/events/:id/installments/quote?tier=a,b&qty=1,2
                                                 the schedule this cart would get
     GET /api/orders/:orderId/installments       the /pay/<orderId> page (BUYER ONLY)
     GET /api/me/installments                    the signed-in buyer's plans

   Public reads never carry PII and degrade to { offered:false } when the
   zp_installments flag is off for the event's organizer. The pay-page read
   carries amounts + the buyer's phone, so it needs the checkout cookie for the
   order or a verified buyer session for its customer — the order id in an SMS
   link alone gets 401 verify_required (the page then runs the SMS-OTP sign-in). */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^[A-Za-z0-9._:-]{1,120}$/;

const SETTINGS_TTL_MS = 10_000;
let settingsCache: { at: number; data: any } | null = null;

@Controller()
export class InstallmentsController {
  constructor(private readonly entities: EntityStore) {}

  private async settings(): Promise<any> {
    const now = Date.now();
    if (settingsCache && now - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.data;
    const data = await this.entities.read<any>('settings', DEFAULT_SETTINGS);
    settingsCache = { at: now, data };
    return data;
  }

  private async flagOn(eventId: string): Promise<boolean> {
    const s = await this.settings();
    const ctx = await eventInstallmentContext(db(), eventId);
    return isFlagOn(s?.flags, 'zp_installments', { org: ctx.orgHandle, event: eventId });
  }

  private async offerFor(eventId: string) {
    if (!(await this.flagOn(eventId))) return null;
    return installmentOffer(db(), eventId);
  }

  @Get('events/:id/installments')
  async offer(@Param('id') id: string, @Res() res: Response) {
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'invalid_event' });
    const o = await this.offerFor(id);
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    return res.status(200).json(o ? { offered: true, ...o } : { offered: false });
  }

  @Get('installments/offers')
  async offers(@Query('events') events: string | undefined, @Res() res: Response) {
    const ids = Array.from(new Set(String(events || '').split(',').map((s) => s.trim()).filter((s) => ID_RE.test(s)))).slice(0, 60);
    const out: Record<string, { count: number; perPayment: number; currency: string; finalDue: string }> = {};
    // One indexed read narrows the cards to events that have an enabled offer at all.
    const enabled = ids.length
      ? (await db()`select event_id from installment_config where enabled and event_id = any(${ids})`).map((r: any) => r.event_id)
      : [];
    for (const id of enabled) {
      const o = await this.offerFor(id);
      if (o) out[id] = { count: o.count, perPayment: o.perPayment, currency: o.currency, finalDue: o.finalDue };
    }
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    return res.status(200).json({ offers: out });
  }

  @Get('events/:id/installments/quote')
  async quote(@Param('id') id: string, @Query('tier') tier: string | undefined, @Query('qty') qty: string | undefined, @Res() res: Response) {
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'invalid_event' });
    const tiers = String(tier || '').split(',').map((s) => s.trim());
    const qtys = String(qty || '').split(',').map((s) => Number(s.trim()));
    if (!tiers.length || tiers.length > 20 || tiers.length !== qtys.length ||
        tiers.some((t) => !ID_RE.test(t)) || qtys.some((q) => !Number.isInteger(q) || q < 1 || q > 50)) {
      return res.status(400).json({ error: 'invalid_cart' });
    }
    // Same tier twice → one line (the order would hold both quantities).
    const merged = new Map<string, number>();
    tiers.forEach((t, i) => merged.set(t, (merged.get(t) || 0) + qtys[i]));
    res.setHeader('Cache-Control', 'no-store');
    if (!(await this.flagOn(id))) return res.status(200).json({ offered: false, reason: 'installments_disabled' });
    const s = await this.settings();
    const feeRate = typeof s?.feeRate === 'number' ? s.feeRate : 0;
    const q = await installmentQuote(db(), id, Array.from(merged, ([t, n]) => ({ tier: t, quantity: n })), feeRate);
    if (!q.ok) {
      if (q.reason === 'schedule_rejected') return res.status(200).json({ offered: false, reason: q.reason, code: q.code, message: q.message });
      return res.status(200).json({ offered: false, reason: q.reason });
    }
    const { ok: _ok, ...rest } = q;
    return res.status(200).json({ offered: true, ...rest });
  }

  @Get('orders/:orderId/installments')
  async payView(@Param('orderId') orderId: string, @Req() req: Request, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    if (!UUID_RE.test(orderId)) return res.status(404).json({ error: 'not_found' });
    const sql = db();
    const owner = await installmentOrderOwner(sql, orderId);
    // Unknown order and someone else's order look the same: 401, no data.
    if (!canReadBuyerOrder(req, orderId, owner)) return res.status(401).json({ error: 'verify_required' });
    const v = await installmentPayView(sql, orderId);
    if (!v) return res.status(401).json({ error: 'verify_required' });
    const { customerId: _c, ...view } = v;
    return res.status(200).json(view);
  }

  @UseGuards(ConsumerGuard)
  @Get('me/installments')
  async mine(@Req() req: Request, @Res() res: Response) {
    const { customerId } = (req as any).consumer as ConsumerIdentity;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ plans: await customerInstallments(db(), customerId) });
  }
}

@Module({ controllers: [InstallmentsController] })
export class InstallmentsModule {}
