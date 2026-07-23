import { Body, Controller, Get, Module, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { db, requestOtp, verifyOtp, normalizeMsisdn, sendSms, qrPayload } from '@zora/core';
import { ConsumerGuard, mintConsumerCookie, type ConsumerIdentity } from '../common/consumer';

/* BS4: consumer identity over SMS-OTP (D6/A3). Request → hashed challenge + SMS;
   verify → consumer session cookie. /me/tickets returns the signed-in buyer's
   credentials (both bill-split seats and ordinary GA/VIP passes; F3). */
@Controller()
export class ConsumerController {
  // ── POST /api/otp/request { phone } ───────────────────────────────────────
  @Post('otp/request')
  async otpRequest(@Body() body: any, @Res() res: Response) {
    const phone = normalizeMsisdn(String(body?.phone ?? ''));
    if (!phone || phone.length < 11) return res.status(400).json({ error: 'phone_required' });
    const r = await requestOtp(db(), phone);
    if (!r.ok) { res.setHeader('Retry-After', String(r.retryAfterSec)); return res.status(429).json({ error: 'throttled', retryAfterSec: r.retryAfterSec }); }
    try { await sendSms(phone, `Your Zora code is ${r.code}. Expires in 5 min. Never share it.`); }
    catch (e) { console.error('otp sms failed', e); }
    // OTP_ECHO exposes the code for the e2e harness ONLY — never set in prod.
    return res.status(200).json({ ok: true, expiresInSec: r.expiresInSec, ...(process.env.OTP_ECHO === 'true' ? { code: r.code } : {}) });
  }

  // ── POST /api/otp/verify { phone, code } → consumer session ───────────────
  @Post('otp/verify')
  async otpVerify(@Body() body: any, @Res() res: Response) {
    const phone = normalizeMsisdn(String(body?.phone ?? ''));
    const code = String(body?.code ?? '');
    const r = await verifyOtp(db(), phone, code);
    if (!r.ok) return res.status(401).json({ error: r.reason, ...(r.attemptsLeft != null ? { attemptsLeft: r.attemptsLeft } : {}) });
    const [cust] = await db()`
      insert into customer (phone) values (${phone})
      on conflict (phone) do update set phone = excluded.phone returning id`;
    mintConsumerCookie(res, { phone, customerId: cust.id });
    return res.status(200).json({ ok: true, role: 'consumer', phone });
  }

  // ── GET /api/me/tickets — the signed-in buyer's passes (split + GA/VIP) ────
  @UseGuards(ConsumerGuard)
  @Get('me/tickets')
  async myTickets(@Req() req: Request, @Res() res: Response) {
    const { customerId } = (req as any).consumer as ConsumerIdentity;
    const rows = await db()`
      select cr.code, cr.signature, cr.public_ref, cr.tier_id, cr.seat_index, cr.table_no, e.name as event_name
        from credential cr
        join event e on e.id = cr.event_id
       where cr.state <> 'revoked' and (
         cr.split_share_id in (select id from split_share where customer_id = ${customerId})
         or cr.order_item_id in (
           select oi.id from order_item oi join "order" o on o.id = oi.order_id where o.customer_id = ${customerId})
       )
       order by cr.issued_at desc`;
    const tickets = rows.map((r: any) => ({
      publicRef: r.public_ref, tier: r.tier_id, eventName: r.event_name,
      seatIndex: r.seat_index, tableNo: r.table_no, code: r.code, qr: qrPayload(r.code, r.signature),
    }));
    return res.status(200).json({ tickets });
  }
}

@Module({ controllers: [ConsumerController] })
export class ConsumerModule {}
