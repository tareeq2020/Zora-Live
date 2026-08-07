import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { db, resolveUnsubscribeToken, unsubscribeByToken } from '@zora/core';

/* /api/unsubscribe/:token (BS43 / #2) — the PUBLIC opt-out.

   No guard, by design: the person clicking this link has no Zora account and
   must not need one. The token is the whole authorization — a 16-hex random per
   recipient row, so it grants exactly one power (silence this address) and
   reveals nothing else.

   GET does NOT unsubscribe. Corporate mail scanners and link previewers follow
   every URL in a message; a GET that opted people out would quietly delete an
   organizer's audience one security appliance at a time. GET only describes the
   target (with the address MASKED, so a leaked link does not publish someone's
   number), and POST performs it.

   The suppression it writes is SCOPED: opting out of an organizer's blast
   silences that organizer, not Zora's own ticket receipts. Opting out of a
   platform broadcast is platform-wide. That mapping lives in @zora/core. */
@Controller('unsubscribe')
export class UnsubscribeController {
  /** GET /api/unsubscribe/:token — what the confirmation page renders. */
  @Get(':token')
  async describe(@Param('token') token: string) {
    const target = await resolveUnsubscribeToken(db(), token);
    // A bad/expired token is a 404 with no detail — never a hint about which
    // tokens are real.
    if (!target) throw new NotFoundException({ error: 'unknown_token', message: 'This unsubscribe link is not valid.' });
    return {
      channel: target.channel,
      address: target.addressMasked,
      sender: target.senderLabel,
      platformWide: target.scopeHandle == null,
      unsubscribed: target.alreadySuppressed,
    };
  }

  /** POST /api/unsubscribe/:token — confirm. Idempotent: clicking twice is a
      success, not an error the person has to interpret. */
  @Post(':token')
  async confirm(@Param('token') token: string, @Body() body: { reason?: unknown }) {
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 280) : null;
    const result = await unsubscribeByToken(db(), token, reason);
    if (!result.ok || !result.target) {
      throw new NotFoundException({ error: 'unknown_token', message: 'This unsubscribe link is not valid.' });
    }
    return {
      ok: true,
      channel: result.target.channel,
      address: result.target.addressMasked,
      sender: result.target.senderLabel,
      platformWide: result.target.scopeHandle == null,
      unsubscribed: true,
    };
  }
}
