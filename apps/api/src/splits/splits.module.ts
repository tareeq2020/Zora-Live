import { Body, Controller, Get, Module, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { db, createTableSplit, claimShare, createShareOrder, normalizeMsisdn } from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { DEFAULT_SETTINGS } from '../common/defaults';
import { signSession } from '../common/session-cookie';
import { resolveSessionSecret } from '../common/secret';
import { ConsumerGuard, type ConsumerIdentity } from '../common/consumer';

/* BS4: bill-split HTTP edge. All the money logic is in @zora/core; this layer is
   validation + cookies. Paying a share reuses the EXISTING payment edge
   (POST /api/checkout/:orderId/pay + GET /api/orders/:orderId/status) — a share
   is just an order, so nothing new is needed there. */

/** Mint the checkout cookie the status endpoint auto-verifies into a buyer session
    (F2) — this is how a cold WhatsApp invitee gets recognized after they pay. */
function mintCheckoutCookie(res: Response, orderId: string, phone: string): void {
  const token = signSession({ orderId, phone } as any, resolveSessionSecret());
  res.cookie('zora_checkout', token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: 1000 * 3600 * 6,
  });
}

function maskName(name: string | null): string | null {
  if (!name) return null;
  const first = name.trim().split(/\s+/)[0];
  return first || null;
}

@Controller()
export class SplitsController {
  constructor(private readonly entities: EntityStore) {}

  // ── POST /api/splits — host creates a split (must be signed in) ────────────
  @UseGuards(ConsumerGuard)
  @Post('splits')
  async create(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    const { tierId, capacityN } = body || {};
    if (!tierId || typeof tierId !== 'string') return res.status(400).json({ error: 'tier_required' });
    if (!Number.isInteger(capacityN) || capacityN < 2) return res.status(400).json({ error: 'bad_capacity' });
    const host = (req as any).consumer as ConsumerIdentity;
    const settings = await this.entities.read<any>('settings', DEFAULT_SETTINGS);
    const feeRate = typeof settings?.feeRate === 'number' ? settings.feeRate : 0.05;

    const r = await createTableSplit(db(), { hostPhone: host.phone, tierId, capacityN, feeRate });
    if (!r.ok) {
      const code = r.reason === 'sold_out' ? 409 : 400;
      return res.status(code).json({ error: r.reason });
    }
    return res.status(200).json({
      splitId: r.splitId, target: r.target, hostShare: r.hostShare, inviteeShare: r.inviteeShare,
      shares: r.shares.map((s) => ({ index: s.index, amount: s.amount, isHost: s.isHost, token: s.token })),
    });
  }

  // ── GET /api/splits/:id — track "who's paid" (Postgres only; P1) ──────────
  @Get('splits/:id')
  async track(@Param('id') id: string, @Res() res: Response) {
    const [split] = await db()`
      select ts.id, ts.status, ts.capacity_n, ts.target_value, ts.window_expires_at, e.name as event_name,
             (select count(*) from split_share where split_id = ts.id and state = 'paid') as paid_count
        from table_split ts join event e on e.id = ts.event_id where ts.id = ${id}`;
    if (!split) return res.status(404).json({ error: 'not_found' });
    const shares = await db()`
      select s.share_index, s.is_host, s.state, s.amount, s.paid_at, c.name as payer_name
        from split_share s left join customer c on c.id = s.customer_id
       where s.split_id = ${id} order by s.share_index`;
    return res.status(200).json({
      id: split.id, status: split.status, capacityN: split.capacity_n,
      target: Number(split.target_value), windowExpiresAt: split.window_expires_at,
      eventName: split.event_name, paidCount: Number(split.paid_count),
      shares: shares.map((s: any) => ({
        index: s.share_index, isHost: s.is_host, state: s.state, amount: Number(s.amount),
        payerName: maskName(s.payer_name), paidAt: s.paid_at,
      })),
    });
  }

  // ── POST /api/splits/claim { token, phone, name? } — invitee via WhatsApp ──
  @Post('splits/claim')
  async claim(@Body() body: any, @Res() res: Response) {
    const token = String(body?.token ?? '');
    const phone = normalizeMsisdn(String(body?.phone ?? ''));
    if (!token) return res.status(400).json({ error: 'token_required' });
    if (!phone || phone.length < 11) return res.status(400).json({ error: 'phone_required' });
    const name = body?.name ? String(body.name) : null;

    const claimed = await claimShare(db(), token, phone, null, name);
    if (!claimed.ok) {
      const code = claimed.reason === 'bad_token' || claimed.reason === 'not_found' ? 404
        : claimed.reason === 'table_full' || claimed.reason === 'expired' ? 409 : 400;
      return res.status(code).json({ error: claimed.reason });
    }
    if (claimed.alreadyPaid) {
      return res.status(200).json({ alreadyPaid: true, splitId: claimed.splitId, shareIndex: claimed.shareIndex, amount: claimed.amount });
    }
    const order = await createShareOrder(db(), claimed.shareId, phone, null, name);
    if (!order.ok) return res.status(409).json({ error: order.reason });
    mintCheckoutCookie(res, order.orderId, phone); // F2
    return res.status(200).json({ orderId: order.orderId, amount: order.amount, splitId: claimed.splitId, shareIndex: claimed.shareIndex });
  }

  // ── POST /api/splits/:id/pay-mine — a signed-in payer pays their own share ─
  @UseGuards(ConsumerGuard)
  @Post('splits/:id/pay-mine')
  async payMine(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const me = (req as any).consumer as ConsumerIdentity;
    const [share] = await db()`
      select id from split_share where split_id = ${id} and customer_id = ${me.customerId} and state <> 'paid'
       order by is_host desc limit 1`;
    if (!share) return res.status(404).json({ error: 'no_unpaid_share' });
    const order = await createShareOrder(db(), share.id, me.phone);
    if (!order.ok) return res.status(409).json({ error: order.reason });
    mintCheckoutCookie(res, order.orderId, me.phone);
    return res.status(200).json({ orderId: order.orderId, amount: order.amount });
  }

  // ── POST /api/splits/:id/extend — host buys the table more time (once) ─────
  @UseGuards(ConsumerGuard)
  @Post('splits/:id/extend')
  async extend(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const me = (req as any).consumer as ConsumerIdentity;
    const EXTEND_SECS = 1800; // +30 min
    // Only the host, only while forming. Push the split window AND the reservation
    // TTL together (they must stay in sync or the sweep releases the table early).
    const [row] = await db()`
      update table_split ts set window_expires_at = ts.window_expires_at + make_interval(secs => ${EXTEND_SECS})
       where ts.id = ${id} and ts.status = 'forming' and ts.host_customer_id = ${me.customerId}
       returning ts.window_expires_at, ts.reservation_id`;
    if (!row) return res.status(409).json({ error: 'not_extendable' });
    if (row.reservation_id) {
      await db()`update inventory_reservation set expires_at = expires_at + make_interval(secs => ${EXTEND_SECS}) where id = ${row.reservation_id}`;
    }
    return res.status(200).json({ ok: true, windowExpiresAt: row.window_expires_at });
  }
}

@Module({ controllers: [SplitsController] })
export class SplitsModule {}
