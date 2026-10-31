import { Controller, Get, Module, Post, Body, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { db, createGaVipOrder, poolSnapshotsCached, releaseOwnSeatHold } from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { CommissionService } from '../common/commission.module';
import { signSession, verifySession } from '../common/session-cookie';
import { readNamedCookie } from '../common/consumer';
import { resolveSessionSecret } from '../common/secret';
import { DEFAULT_SETTINGS } from '../common/defaults';

/* The public checkout write path. The order + inventory logic lives in
   @zora/core (createGaVipOrder); this controller is the HTTP edge — input
   validation, two load-protection gates, and the checkout session cookie.

   Protection order matters: cheap PURE validation first (no I/O), then the
   in-memory load-shed valve BEFORE any DB touch (so a surge is rejected without
   ever hitting Postgres), then the sales_paused kill-switch, then the order. */

// ── Load-shed valve — cap concurrent checkouts per instance. In-memory only;
// releasing a slot in `finally` guarantees the counter never leaks on error.
const MAX_CONCURRENT = 50;
let inFlight = 0;

// ── settings cache (~10s) — the kill-switch + fee/ttl config are read together
// so the hot path makes at most one settings query per 10s per instance.
const SETTINGS_TTL_MS = 10_000;
let settingsCache: { at: number; data: any } | null = null;
async function readSettingsCached(entities: EntityStore, now = Date.now()): Promise<any> {
  if (settingsCache && now - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.data;
  const data = await entities.read<any>('settings', DEFAULT_SETTINGS);
  settingsCache = { at: now, data };
  return data;
}

// Tanzania MSISDN → 255XXXXXXXXX (digits only). Accepts +255…, 0…, or bare 9-digit.
function normalizeTzPhone(raw: string): string {
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('255')) return d;
  if (d.startsWith('0')) return '255' + d.slice(1);
  if (d.length === 9) return '255' + d;
  return d;
}

@Controller()
export class CheckoutController {
  constructor(
    private readonly entities: EntityStore,
    private readonly commission: CommissionService,
  ) {}

  @Post('checkout')
  async checkout(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    const { phone, email, ageAttested, cart } = body || {};

    // 1) PURE validation (no I/O), in the mandated order.
    if (ageAttested !== true) return res.status(400).json({ error: 'age_attestation_required' });
    if (!phone || !String(phone).trim()) return res.status(400).json({ error: 'phone_required' });
    if (!email || !String(email).trim()) return res.status(400).json({ error: 'email_required' });
    if (!Array.isArray(cart) || cart.length === 0) return res.status(400).json({ error: 'cart_required' });
    for (const line of cart) {
      const badTier = !line || typeof line.tier !== 'string' || !line.tier.trim();
      const badQty = !Number.isInteger(line?.quantity) || line.quantity < 1;
      // BS125: optional seat ids for a seated tier (server derives the quantity).
      const badSeats = line?.seatIds !== undefined &&
        (!Array.isArray(line.seatIds) || line.seatIds.length === 0 || line.seatIds.length > 50 ||
         line.seatIds.some((x: unknown) => typeof x !== 'string' || !x || x.length > 120));
      if (badTier || badQty || badSeats) return res.status(400).json({ error: 'invalid_cart_line' });
    }

    // 2) Load-shed valve — BEFORE any DB. Reject a surge in-memory.
    if (inFlight >= MAX_CONCURRENT) {
      res.setHeader('Retry-After', '2');
      return res.status(503).json({ error: 'busy' });
    }
    inFlight++;
    try {
      // 3) sales_paused kill-switch (cached ~10s).
      const settings = await readSettingsCached(this.entities);
      if (settings?.sales_paused === true || settings?.salesPaused === true) {
        res.setHeader('Retry-After', '600');
        return res.status(503).json({ error: 'sales_paused' });
      }

      // 4) Resolve config, then create the order. Config is read HERE (outside the
      // tx) and passed by value into createGaVipOrder — never queried inside the tx.
      // BS31 (model A): the buyer pays FACE — no platform markup at checkout. The
      // platform's cut is the per-organizer commission (netted from payout), not a
      // buyer fee. feeRate defaults to 0; an admin can still set a pass-through.
      const feeRate = typeof settings?.feeRate === 'number' ? settings.feeRate : 0;
      const holdTtl = Number.isInteger(settings?.hold_ttl_seconds) ? settings.hold_ttl_seconds : 900;
      const normPhone = normalizeTzPhone(phone);
      // BS35 (#6): resolve the platform commission for THIS purchase (event
      // override → org rate → default) BEFORE the tx, like every other config
      // here, and stamp it on the order. Historical earnings then never move when
      // an organizer's rate is edited later.
      const commissionRate = await this.commission.forTier(cart[0].tier);

      // BS126: a buyer re-entering a seated checkout (same browser) is never
      // blocked by their own earlier, still-unpaid hold on the same seats.
      const wantSeats: string[] = cart.flatMap((l: any) => (Array.isArray(l.seatIds) ? l.seatIds : []));
      if (wantSeats.length) {
        const prevToken = readNamedCookie(req, 'zora_checkout');
        const prev = prevToken ? (verifySession(prevToken, resolveSessionSecret()) as any) : null;
        if (prev?.orderId && prev.phone === normPhone) {
          try { await releaseOwnSeatHold(db(), String(prev.orderId), wantSeats); } catch { /* best effort */ }
        }
      }

      const result = await createGaVipOrder(db(), {
        phone: normPhone,
        email: String(email).trim(),
        cart: cart.map((l: any) => ({ tier: l.tier, quantity: l.quantity, ...(Array.isArray(l.seatIds) ? { seatIds: l.seatIds } : {}) })),
        feeRate,
        holdTtl,
        commissionRate,
      });

      if (!result.ok && result.reason === 'seat_taken') return res.status(409).json({ error: 'seat_taken', seats: result.seats });
      if (!result.ok) return res.status(409).json({ error: 'sold_out', tier: result.tier });

      // 5) Bind the pending order to the buyer via a signed, httpOnly cookie.
      const cookie = signSession({ orderId: result.orderId, phone: normPhone } as any, resolveSessionSecret());
      res.cookie('zora_checkout', cookie, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true',
        path: '/',
        maxAge: 1000 * 3600, // 1h — the payment window
      });
      // BS121: the summary column shows subtotal, fee and total as separate lines,
      // so return the breakdown createGaVipOrder already computed, plus currency.
      const [cur] = await db()`
        select pv.currency from order_item oi
          join price_version pv on pv.id = oi.price_version_id
         where oi.order_id = ${result.orderId} limit 1`;
      return res.status(200).json({
        orderId: result.orderId,
        subtotal: result.subtotal,
        fee: result.fee,
        total: result.total,
        currency: cur?.currency ?? 'TZS',
        holdExpiresAt: new Date(Date.now() + holdTtl * 1000).toISOString(),
      });
    } finally {
      inFlight--;
    }
  }

  // BS121: payment-method groups for checkout, in display order. Methods come
  // from x-bridge; until its /v1 method list exists the groups are configured
  // here and gated by settings.methodsEnabled (absent key = enabled). QR stays
  // off until x-bridge ships QR collection.
  @Get('payment-methods')
  async paymentMethods() {
    const settings = await readSettingsCached(this.entities);
    const en = settings?.methodsEnabled && typeof settings.methodsEnabled === 'object' ? settings.methodsEnabled : {};
    return {
      groups: [
        { id: 'mobile', label: 'Mobile money', enabled: en.mobile !== false, networks: 'from_number' },
        { id: 'card', label: 'Card', enabled: en.card !== false },
        { id: 'qr', label: 'Scan to pay (QR)', enabled: en.qr === true },
        { id: 'billpay', label: 'Control number', enabled: en.billpay !== false },
      ],
    };
  }

  // Storefront inventory read — coalesced ~2s cache, edge-cacheable.
  @Get('inventory')
  async inventory(@Res() res: Response) {
    const pools = await poolSnapshotsCached(db());
    res.setHeader('Cache-Control', 'public, max-age=2, stale-while-revalidate=5');
    return res.status(200).json({ pools });
  }
}

@Module({ controllers: [CheckoutController] })
export class CheckoutModule {}
