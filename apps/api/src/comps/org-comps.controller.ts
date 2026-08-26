import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { db, createComp, resendOrderTickets, type CreateCompResult } from '@zora/core';
import { OrganizerGuard } from '../common/organizer.guard';
import { Roles } from '../common/roles.guard';
import { OrgScopeService } from '../org/org-scope.service';
import { AuditService } from '../audit/audit.module';
import { normalizeTzPhone, isValidTzMsisdn } from '../common/phone';

/* /api/org/comps (BS104) — COMPLIMENTARY passes, real this time. Replaces the UI
   stub (which faked delivery in the browser and sent nothing) with the actual
   pipeline: a comp is a $0 order that draws down real capacity, mints credentials
   and delivers them by SMS + email — then can be re-sent (BS59 resend).

   OrganizerGuard + owner/admin only (issuing free tickets is privileged). Every
   comp is scoped to an event the acting org OWNS (assertOwnsEvent), so an org can
   never comp another org's event. The `comp` table is the organizer-facing ledger;
   the credentials/inventory/resend all hang off its order_id. */
type Channel = 'sms' | 'email';

function deliveryStatus(channel: Channel, r: CreateCompResult): 'delivered' | 'failed' {
  if (!r.ok || !r.delivery) return 'failed';
  return channel === 'sms'
    ? r.delivery.sms === 'sent' ? 'delivered' : 'failed'
    : r.delivery.email === 'sent' ? 'delivered' : 'failed';
}

@Roles('owner', 'admin')
@Controller('org/comps')
@UseGuards(OrganizerGuard)
export class OrgCompsController {
  constructor(
    private readonly scope: OrgScopeService,
    private readonly audit: AuditService,
  ) {}

  /** GET /api/org/comps — the acting org's issued comps, newest first. */
  @Get()
  async list(@Req() req: Request) {
    const handle = req.actingHandle as string;
    const rows = await db()`
      select id, recipient_name, contact, channel, event_name, tier_name, qty, delivery, issued_at
        from comp where organizer_handle = ${handle}
       order by issued_at desc limit 200`;
    return rows.map((r: any) => ({
      id: r.id,
      name: r.recipient_name,
      contact: r.contact,
      channel: r.channel,
      eventName: r.event_name,
      tier: r.tier_name,
      qty: Number(r.qty),
      delivery: r.delivery,
      issuedAt: r.issued_at instanceof Date ? r.issued_at.toISOString() : String(r.issued_at),
    }));
  }

  /** POST /api/org/comps { name, contact, eventId, tier, qty } — issue + deliver. */
  @Post()
  async issue(
    @Req() req: Request,
    @Body() body: { name?: unknown; contact?: unknown; eventId?: unknown; tier?: unknown; qty?: unknown },
  ) {
    const handle = req.actingHandle as string;
    const name = String(body?.name ?? '').trim();
    const contactRaw = String(body?.contact ?? '').trim();
    const tierId = String(body?.tier ?? '').trim();
    const qty = Math.floor(Number(body?.qty));
    if (!name) throw new BadRequestException({ error: 'name_required', message: 'Enter the recipient name.' });
    if (!contactRaw) throw new BadRequestException({ error: 'contact_required', message: 'Enter a phone or email.' });
    if (!tierId) throw new BadRequestException({ error: 'tier_required', message: 'Choose a ticket tier.' });
    if (!Number.isFinite(qty) || qty < 1 || qty > 50) {
      throw new BadRequestException({ error: 'qty_invalid', message: 'Quantity must be 1–50.' });
    }

    // Channel + destination from the single contact field.
    let channel: Channel;
    let phone: string | null = null;
    let email: string | null = null;
    if (contactRaw.includes('@')) {
      channel = 'email';
      email = contactRaw;
    } else {
      channel = 'sms';
      phone = normalizeTzPhone(contactRaw);
      if (!isValidTzMsisdn(phone)) throw new BadRequestException({ error: 'contact_invalid', message: 'Enter a valid phone number or an email.' });
    }

    // The tier must exist and belong to an event the acting org OWNS.
    const [tierRow] = await db()`select event_id, name from product_tier where id = ${tierId}`;
    if (!tierRow) throw new BadRequestException({ error: 'tier_required', message: 'That ticket tier no longer exists.' });
    const eventId = tierRow.event_id as string;
    await this.scope.assertOwnsEvent(handle, eventId); // 404 if not owned
    const [eventRow] = await db()`select name from event where id = ${eventId}`;
    const eventName = (eventRow?.name as string) ?? eventId;
    const tierName = (tierRow.name as string) ?? tierId;

    const result = await createComp(db(), { tier: tierId, quantity: qty, recipientName: name, phone, email });
    if (!result.ok) {
      throw new ConflictException({ error: 'sold_out', message: `Not enough seats left in ${tierName} for ${qty} comp${qty === 1 ? '' : 's'}.` });
    }

    const delivery = deliveryStatus(channel, result);
    const [row] = await db()`
      insert into comp (order_id, organizer_handle, recipient_name, contact, channel, event_id, event_name, tier_name, qty, delivery)
      values (${result.orderId}, ${handle}, ${name}, ${contactRaw}, ${channel}, ${eventId}, ${eventName}, ${tierName}, ${qty}, ${delivery})
      returning id, issued_at`;

    await this.audit.record(
      'comp.issue',
      `${qty}× ${tierName} for ${eventName} → ${name} (${contactRaw}) [${channel}: ${delivery}]`,
      req.ip,
      req.actingViaImpersonation ? `admin(as ${handle})` : handle,
    );

    return {
      id: row.id, name, contact: contactRaw, channel, eventName, tier: tierName, qty, delivery,
      issuedAt: row.issued_at instanceof Date ? row.issued_at.toISOString() : String(row.issued_at),
    };
  }

  /** POST /api/org/comps/:id/resend — re-deliver a comp's tickets (BS59 pipeline). */
  @Post(':id/resend')
  async resend(@Req() req: Request, @Param('id') id: string) {
    const handle = req.actingHandle as string;
    const [comp] = await db()`
      select order_id, channel, recipient_name, event_name from comp
       where id = ${id} and organizer_handle = ${handle}`;
    if (!comp) throw new NotFoundException({ error: 'not_found', message: 'That comp no longer exists.' });

    const r = await resendOrderTickets(db(), comp.order_id as string);
    if (!r.ok) throw new BadRequestException({ error: r.reason, message: 'That comp could not be re-sent.' });

    const delivery = (comp.channel === 'sms'
      ? r.result.sms === 'sent' ? 'delivered' : 'failed'
      : r.result.email === 'sent' ? 'delivered' : 'failed') as 'delivered' | 'failed';
    await db()`update comp set delivery = ${delivery} where id = ${id}`;
    await this.audit.record('comp.resend', `${comp.recipient_name} · ${comp.event_name} [${comp.channel}: ${delivery}]`, req.ip, handle);
    return { ok: true, delivery };
  }
}
