import { Controller, Get, Module, Post, Param, Body, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'crypto';
import {
  db, initiatePayment, reconcile, resolveTransactionId, qrPayload,
  DEFAULT_FSP_ROUTE_MAP, type FspRouteMap, type PaymentMethod,
} from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { signSession, verifySession } from '../common/session-cookie';
import { resolveSessionSecret } from '../common/secret';
import { DEFAULT_SETTINGS } from '../common/defaults';

/* PR-9: the payment HTTP edge. The state machine + apply-exactly-once logic lives
   in @zora/core; this controller is the thin edge:
   - POST /api/checkout/:orderId/pay  — start a collection
   - GET  /api/orders/:orderId/status — self-healing status read (reconciles the
     order's non-terminal attempts) + payer auto-verify (checkout → buyer cookie)
   - POST /api/webhooks/xbridge       — provider callback (RAW body; ALWAYS 200)

   The webhook path is served the RAW request body: main.ts mounts a raw body
   parser on /api/webhooks/xbridge BEFORE the global express.json, so the sha256
   dedup key is computed over the exact bytes the provider sent. */

const TERMINAL = new Set(['successful', 'failed', 'partial', 'expired']);

/** Read a single named cookie from the raw Cookie header (readSessionCookie only
    reads zora_session; the checkout cookie is zora_checkout). */
function readNamedCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

@Controller()
export class PaymentsController {
  constructor(private readonly entities: EntityStore) {}

  // ── Start a collection for a pending/failed order ─────────────────────────
  @Post('checkout/:orderId/pay')
  async pay(@Param('orderId') orderId: string, @Body() body: any, @Res() res: Response) {
    const { method, payerPhone, payerName, mno } = body || {};
    if (method !== 'mobile' && method !== 'billpay' && method !== 'card') {
      return res.status(400).json({ error: 'invalid_method' });
    }
    if (!payerPhone || !String(payerPhone).trim()) {
      return res.status(400).json({ error: 'payer_phone_required' });
    }

    // Route map + per-FSP fee overrides are policy (settings); default to the
    // built-in map. callbackUrl is where x-bridge posts finality.
    const settings = await this.entities.read<any>('settings', DEFAULT_SETTINGS);
    const routeMap: FspRouteMap =
      settings?.fspRouteMap && typeof settings.fspRouteMap === 'object' ? settings.fspRouteMap : DEFAULT_FSP_ROUTE_MAP;
    const feeRateByFsp: Record<string, number> =
      settings?.feeRateByFsp && typeof settings.feeRateByFsp === 'object' ? settings.feeRateByFsp : {};
    const callbackUrl = `${process.env.PUBLIC_ORIGIN || ''}/api/webhooks/xbridge`;

    try {
      const r = await initiatePayment(db(), {
        orderId,
        method: method as PaymentMethod,
        payerPhone: String(payerPhone),
        payerName: payerName ? String(payerName) : undefined,
        mno: mno ? String(mno) : undefined,
        callbackUrl,
        routeMap,
        feeRateByFsp,
      });
      return res.status(200).json({
        transactionId: r.transactionId,
        status: r.status,
        ...(r.billPayNumber ? { billPayNumber: r.billPayNumber } : {}),
        ...(r.redirectUrl ? { redirectUrl: r.redirectUrl } : {}),
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg === 'order not found') return res.status(404).json({ error: 'order_not_found' });
      if (msg.startsWith('order not payable')) return res.status(409).json({ error: 'not_payable' });
      if (msg === 'inventory no longer available') return res.status(409).json({ error: 'inventory_unavailable' });
      console.error('pay failed', e);
      return res.status(500).json({ error: 'payment_init_failed' });
    }
  }

  // ── Self-healing status read + payer auto-verify ──────────────────────────
  @Get('orders/:orderId/status')
  async status(@Param('orderId') orderId: string, @Req() req: Request, @Res() res: Response) {
    const sql = db();

    // Self-heal: reconcile every non-terminal attempt against x-bridge so a status
    // read never lags a settlement the webhook missed.
    const txns = await sql`
      select transaction_id from payment_transaction
       where order_id = ${orderId} and status in ('created', 'pending', 'processing')
       order by created_at asc`;
    for (const t of txns) {
      try { await reconcile(sql, t.transaction_id); }
      catch (e) { console.error('status reconcile failed', t.transaction_id, e); }
    }

    const [order] = await sql`select status from "order" where id = ${orderId}`;
    if (!order) return res.status(404).json({ error: 'order_not_found' });

    const creds = await sql`
      select c.tier_id, c.state, c.code, c.signature, c.public_ref
        from credential c join order_item oi on oi.id = c.order_item_id
       where oi.order_id = ${orderId}
       order by c.tier_id, c.seat_index`;
    const credentials = creds.map((c: any) => ({
      tier: c.tier_id,
      state: c.state,
      qr: qrPayload(c.code, c.signature),
      code: c.code,
      publicRef: c.public_ref,
    }));

    // Payer auto-verify: a paid order whose zora_checkout cookie matches this order
    // promotes the buyer to a verified zora_buyer session (7d).
    const checkoutToken = readNamedCookie(req, 'zora_checkout');
    if (checkoutToken && order.status === 'paid') {
      const secret = resolveSessionSecret();
      const payload = verifySession(checkoutToken, secret) as any;
      if (payload && payload.orderId === orderId) {
        const buyer = signSession({ phone: payload.phone, verified: true } as any, secret);
        res.cookie('zora_buyer', buyer, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.COOKIE_SECURE === 'true',
          path: '/',
          maxAge: 1000 * 3600 * 24 * 7, // 7d
        });
      }
    }

    return res.status(200).json({ status: order.status, credentials });
  }

  // ── Provider webhook — RAW body, dedup, reconcile. ALWAYS 200. ────────────
  @Post('webhooks/xbridge')
  async webhook(@Req() req: Request, @Res() res: Response) {
    try {
      const b: any = (req as any).body;
      const rawBody = Buffer.isBuffer(b) ? b.toString('utf8') : typeof b === 'string' ? b : JSON.stringify(b ?? {});
      const dedupKey = createHash('sha256').update(rawBody).digest('hex');
      const sql = db();

      const transactionId = await resolveTransactionId(sql, rawBody);
      const [inserted] = await sql`
        insert into webhook_event (provider, dedup_key, transaction_id)
        values ('bridge', ${dedupKey}, ${transactionId})
        on conflict (provider, dedup_key) do nothing returning id`;
      if (!inserted) return res.status(200).json({ received: true, deduped: true });

      if (transactionId) await reconcile(sql, transactionId); // trust status, not the payload
      await sql`update webhook_event set applied = true where id = ${inserted.id}`;
      return res.status(200).json({ received: true, deduped: false });
    } catch (e) {
      // NEVER 5xx the provider — the worker reconcile is the durable backstop.
      console.error('xbridge webhook error', e);
      return res.status(200).json({ received: true, reconcileLater: true });
    }
  }
}

@Module({ controllers: [PaymentsController] })
export class PaymentsModule {}
