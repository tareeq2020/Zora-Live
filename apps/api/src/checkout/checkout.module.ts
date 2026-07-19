import { Controller, Get, Module, Post, Body, Res } from '@nestjs/common';
import type { Response } from 'express';
import { db, createGaVipOrder, poolSnapshotsCached } from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { signSession } from '../common/session-cookie';
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
  constructor(private readonly entities: EntityStore) {}

  @Post('checkout')
  async checkout(@Body() body: any, @Res() res: Response) {
    const { phone, email, ageAttested, cart } = body || {};

    // 1) PURE validation (no I/O), in the mandated order.
    if (ageAttested !== true) return res.status(400).json({ error: 'age_attestation_required' });
    if (!phone || !String(phone).trim()) return res.status(400).json({ error: 'phone_required' });
    if (!email || !String(email).trim()) return res.status(400).json({ error: 'email_required' });
    if (!Array.isArray(cart) || cart.length === 0) return res.status(400).json({ error: 'cart_required' });
    for (const line of cart) {
      const badTier = !line || typeof line.tier !== 'string' || !line.tier.trim();
      const badQty = !Number.isInteger(line?.quantity) || line.quantity < 1;
      if (badTier || badQty) return res.status(400).json({ error: 'invalid_cart_line' });
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
      const feeRate = typeof settings?.feeRate === 'number' ? settings.feeRate : 0.05;
      const holdTtl = Number.isInteger(settings?.hold_ttl_seconds) ? settings.hold_ttl_seconds : 900;
      const normPhone = normalizeTzPhone(phone);

      const result = await createGaVipOrder(db(), {
        phone: normPhone,
        email: String(email).trim(),
        cart: cart.map((l: any) => ({ tier: l.tier, quantity: l.quantity })),
        feeRate,
        holdTtl,
      });

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
      return res.status(200).json({ orderId: result.orderId, total: result.total });
    } finally {
      inFlight--;
    }
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
