import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  db, sellGateCash, voidGateSale, createGaVipOrder, initiatePayment,
  DEFAULT_FSP_ROUTE_MAP, type FspRouteMap,
} from '@zora/core';
import { ScanGuard } from './scan.guard';
import { EntityStore } from '../storage/entity-store';
import { AuditService } from '../audit/audit.module';
import { DEFAULT_SETTINGS } from '../common/defaults';

/* /api/scan/sell (BS107 / #184) — EVENT-DAY selling from the gate PWA. The seller
   is a scanner_user with can_sell, logged into /scan, selling for THEIR scoped
   event. Cash settles immediately (sellGateCash); mobile fires an x-bridge STK
   push to the buyer and the unchanged webhook confirms + mints + delivers.

   We do NOT port Str8Up's SMS-match queue — the webhook replaces it. Price is
   always server-computed from tier × qty; the seller never types an amount. */
@Controller('scan/sell')
export class SellController {
  constructor(
    private readonly entities: EntityStore,
    private readonly audit: AuditService,
  ) {}

  private seller(req: Request) {
    const s = req.scanner!;
    if (!s.canSell) throw new ForbiddenException({ error: 'not_a_seller', message: 'This code can scan but not sell.' });
    if (!s.eventScope) throw new ForbiddenException({ error: 'no_event', message: 'This scanner is not pinned to an event.' });
    return s;
  }

  /** GET /api/scan/sell/catalog — the seller's event tiers + price + availability. */
  @UseGuards(ScanGuard)
  @Get('catalog')
  async catalog(@Req() req: Request) {
    const s = this.seller(req);
    const rows = await db()`
      select pt.id as tier_id, pt.name, pv.price,
             coalesce(ip.available_count, 0) as available
        from product_tier pt
        join price_version pv on pv.tier_id = pt.id and pv.effective_to is null
        left join inventory_pool ip on ip.product_tier_id = pt.id
       where pt.event_id = ${s.eventScope} and pt.disabled = false
       order by pv.price asc`;
    return {
      eventId: s.eventScope,
      tiers: rows.map((r: any) => ({ tierId: r.tier_id, name: r.name, price: Number(r.price), available: Number(r.available) })),
    };
  }

  /** POST /api/scan/sell { tier, qty, method:'cash'|'mobile', buyerPhone?, buyerEmail? } */
  @UseGuards(ScanGuard)
  @Post()
  async sell(@Req() req: Request, @Body() body: any) {
    const s = this.seller(req);
    const tier = String(body?.tier ?? '').trim();
    const qty = Math.floor(Number(body?.qty));
    const method = String(body?.method ?? '').trim();
    const buyerPhone = typeof body?.buyerPhone === 'string' ? body.buyerPhone.trim() : '';
    const buyerEmail = typeof body?.buyerEmail === 'string' ? body.buyerEmail.trim() : '';
    if (!tier) throw new BadRequestException({ error: 'tier_required' });
    if (!Number.isFinite(qty) || qty < 1 || qty > 50) throw new BadRequestException({ error: 'qty_invalid', message: 'Quantity must be 1–50.' });
    if (method !== 'cash' && method !== 'mobile') throw new BadRequestException({ error: 'method_invalid', message: 'Choose cash or mobile.' });

    // The tier MUST belong to the seller's scoped event.
    const [tierRow] = await db()`select event_id from product_tier where id = ${tier}`;
    if (!tierRow || tierRow.event_id !== s.eventScope) throw new ForbiddenException({ error: 'wrong_event', message: 'That ticket is not for your event.' });

    if (method === 'cash') {
      const r = await sellGateCash(db(), { tier, quantity: qty, sellerId: s.id, buyerPhone, buyerEmail });
      if (!r.ok) throw new ConflictException({ error: 'sold_out', message: 'Not enough seats left in that tier.' });
      await this.audit.record('gate.sell.cash', `${s.name}: ${qty}× ${tier} = ${r.amount} TZS (order ${r.orderId})`, req.ip, s.id);
      return { ok: true, method: 'cash', status: 'paid', orderId: r.orderId, amount: r.amount, ticketCount: r.ticketCount };
    }

    // mobile — buyer's phone is required for the STK prompt.
    if (!buyerPhone) throw new BadRequestException({ error: 'phone_required', message: 'Enter the buyer’s phone for the mobile prompt.' });
    const created = await createGaVipOrder(db(), {
      phone: buyerPhone, email: buyerEmail || null, cart: [{ tier, quantity: qty }],
      feeRate: 0, holdTtl: 900, commissionRate: null, soldBy: s.id, channel: 'gate_mobile',
    });
    if (!created.ok) throw new ConflictException({ error: 'sold_out', message: 'Not enough seats left in that tier.' });

    const settings = await this.entities.read<any>('settings', DEFAULT_SETTINGS);
    const routeMap: FspRouteMap = settings?.fspRouteMap && typeof settings.fspRouteMap === 'object' ? settings.fspRouteMap : DEFAULT_FSP_ROUTE_MAP;
    const feeRateByFsp: Record<string, number> = settings?.feeRateByFsp && typeof settings.feeRateByFsp === 'object' ? settings.feeRateByFsp : {};
    const callbackUrl = `${process.env.PUBLIC_ORIGIN || ''}/api/webhooks/xbridge`;
    const pay = await initiatePayment(db(), {
      orderId: created.orderId, method: 'mobile', payerPhone: buyerPhone,
      callbackUrl, routeMap, feeRateByFsp, holdTtlSecs: 900,
    });
    await this.audit.record('gate.sell.mobile', `${s.name}: ${qty}× ${tier} = ${created.total} TZS STK (order ${created.orderId})`, req.ip, s.id);
    return { ok: true, method: 'mobile', status: 'pending', orderId: created.orderId, amount: created.total, transactionId: pay.transactionId, billPayNumber: pay.billPayNumber, redirectUrl: pay.redirectUrl };
  }

  /** POST /api/scan/sell/:orderId/void — reverse a cash mistake BEFORE it's scanned. */
  @UseGuards(ScanGuard)
  @Post(':orderId/void')
  async void(@Req() req: Request, @Param('orderId') orderId: string) {
    const s = this.seller(req);
    const r = await voidGateSale(db(), orderId, s.id);
    if (!r.ok) {
      if (r.reason === 'not_found') throw new BadRequestException({ error: 'not_found', message: 'That sale is not yours or no longer exists.' });
      if (r.reason === 'already_scanned') throw new ConflictException({ error: 'already_scanned', message: 'Someone already went in on that ticket — it can’t be voided.' });
      throw new BadRequestException({ error: r.reason, message: 'That sale can’t be voided.' });
    }
    await this.audit.record('gate.sell.void', `${s.name} voided order ${orderId}`, req.ip, s.id);
    return { ok: true };
  }
}
