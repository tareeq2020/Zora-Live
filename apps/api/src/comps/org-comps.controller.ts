import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { db, createComp, resendOrderTickets, type TicketDeliveryResult } from '@zora/core';
import { OrganizerGuard } from '../common/organizer.guard';
import { Roles } from '../common/roles.guard';
import { OrgScopeService } from '../org/org-scope.service';
import { AuditService } from '../audit/audit.module';
import { normalizeTzPhone, isValidTzMsisdn } from '../common/phone';

/* /api/org/comps (BS104, BS105) — COMPLIMENTARY passes. A comp is a $0 order that
   draws down real capacity, mints credentials and delivers by SMS AND/OR email —
   and can be EDITED + re-sent if a contact was wrong (BS105). Delivery targets the
   comp's own phone/email (not a shared buyer record), so a fix never touches
   anyone else.

   OrganizerGuard + owner/admin only. Every comp is scoped to an event the acting
   org OWNS (assertOwnsEvent). */
type Channel = 'sms' | 'email' | 'both';

/** Parse the recipient contacts from the body (discrete phone/email, with a
    legacy single `contact` fallback). At least one is required. */
function parseContacts(body: any): { phone: string | null; email: string | null } {
  let phoneRaw = typeof body?.phone === 'string' ? body.phone.trim() : '';
  let emailRaw = typeof body?.email === 'string' ? body.email.trim() : '';
  const legacy = typeof body?.contact === 'string' ? body.contact.trim() : '';
  if (!phoneRaw && !emailRaw && legacy) {
    if (legacy.includes('@')) emailRaw = legacy; else phoneRaw = legacy;
  }
  let phone: string | null = null;
  if (phoneRaw) {
    phone = normalizeTzPhone(phoneRaw);
    if (!isValidTzMsisdn(phone)) throw new BadRequestException({ error: 'contact_invalid', message: 'Enter a valid phone number.' });
  }
  let email: string | null = null;
  if (emailRaw) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) throw new BadRequestException({ error: 'contact_invalid', message: 'Enter a valid email address.' });
    email = emailRaw;
  }
  if (!phone && !email) throw new BadRequestException({ error: 'contact_required', message: 'Enter a phone, an email, or both.' });
  return { phone, email };
}

const channelOf = (phone: string | null, email: string | null): Channel =>
  phone && email ? 'both' : email ? 'email' : 'sms';

/** Delivered when at least one PROVIDED channel actually sent (both carry the same
    ticket); failed otherwise. */
function deliveryStatus(phone: string | null, email: string | null, d: TicketDeliveryResult | null): 'delivered' | 'failed' {
  if (!d) return 'failed';
  const smsOk = !!phone && d.sms === 'sent';
  const emailOk = !!email && d.email === 'sent';
  return smsOk || emailOk ? 'delivered' : 'failed';
}

const contactLabel = (phone: string | null, email: string | null): string =>
  [phone, email].filter(Boolean).join(' · ');

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
      select id, recipient_name, phone, email, contact, channel, event_name, tier_name, qty, delivery, issued_at
        from comp where organizer_handle = ${handle}
       order by issued_at desc limit 200`;
    return rows.map((r: any) => this.shape(r));
  }

  /** POST /api/org/comps { name, phone?, email?, eventId, tier, qty } — issue + deliver. */
  @Post()
  async issue(@Req() req: Request, @Body() body: any) {
    const handle = req.actingHandle as string;
    const name = String(body?.name ?? '').trim();
    const tierId = String(body?.tier ?? '').trim();
    const qty = Math.floor(Number(body?.qty));
    if (!name) throw new BadRequestException({ error: 'name_required', message: 'Enter the recipient name.' });
    if (!tierId) throw new BadRequestException({ error: 'tier_required', message: 'Choose a ticket tier.' });
    if (!Number.isFinite(qty) || qty < 1 || qty > 50) throw new BadRequestException({ error: 'qty_invalid', message: 'Quantity must be 1–50.' });
    const { phone, email } = parseContacts(body);

    const { eventId, eventName, tierName } = await this.resolveOwnedTier(handle, tierId);
    const result = await createComp(db(), { tier: tierId, quantity: qty, recipientName: name, phone, email });
    if (!result.ok) {
      throw new ConflictException({ error: 'sold_out', message: `Not enough seats left in ${tierName} for ${qty} comp${qty === 1 ? '' : 's'}.` });
    }

    const channel = channelOf(phone, email);
    const delivery = deliveryStatus(phone, email, result.delivery);
    const [row] = await db()`
      insert into comp (order_id, organizer_handle, recipient_name, phone, email, contact, channel, event_id, event_name, tier_name, qty, delivery)
      values (${result.orderId}, ${handle}, ${name}, ${phone}, ${email}, ${contactLabel(phone, email)}, ${channel}, ${eventId}, ${eventName}, ${tierName}, ${qty}, ${delivery})
      returning id, recipient_name, phone, email, contact, channel, event_name, tier_name, qty, delivery, issued_at`;
    await this.audit.record('comp.issue', `${qty}× ${tierName} · ${eventName} → ${name} (${contactLabel(phone, email)}) [${channel}: ${delivery}]`, req.ip, handle);
    return this.shape(row);
  }

  /** PUT /api/org/comps/:id { name?, phone?, email? } — fix the details and re-send
      (BS105). The seat/credentials are unchanged; only the destination moves. */
  @Put(':id')
  async edit(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    const handle = req.actingHandle as string;
    const [comp] = await db()`
      select id, order_id, recipient_name from comp where id = ${id} and organizer_handle = ${handle}`;
    if (!comp) throw new NotFoundException({ error: 'not_found', message: 'That comp no longer exists.' });

    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : (comp.recipient_name as string);
    const { phone, email } = parseContacts(body);
    const channel = channelOf(phone, email);

    const r = await resendOrderTickets(db(), comp.order_id as string, { phone, email, name });
    if (!r.ok) throw new BadRequestException({ error: r.reason, message: 'That comp could not be re-sent.' });
    const delivery = deliveryStatus(phone, email, r.result);

    const [row] = await db()`
      update comp set recipient_name = ${name}, phone = ${phone}, email = ${email},
             contact = ${contactLabel(phone, email)}, channel = ${channel}, delivery = ${delivery}
       where id = ${id}
      returning id, recipient_name, phone, email, contact, channel, event_name, tier_name, qty, delivery, issued_at`;
    await this.audit.record('comp.edit', `${name} · ${row.event_name} → ${contactLabel(phone, email)} [${channel}: ${delivery}]`, req.ip, handle);
    return this.shape(row);
  }

  /** POST /api/org/comps/:id/resend — re-deliver to the comp's current contacts. */
  @Post(':id/resend')
  async resend(@Req() req: Request, @Param('id') id: string) {
    const handle = req.actingHandle as string;
    const [comp] = await db()`
      select order_id, recipient_name, phone, email, channel, event_name from comp
       where id = ${id} and organizer_handle = ${handle}`;
    if (!comp) throw new NotFoundException({ error: 'not_found', message: 'That comp no longer exists.' });

    const r = await resendOrderTickets(db(), comp.order_id as string, { phone: comp.phone, email: comp.email, name: comp.recipient_name });
    if (!r.ok) throw new BadRequestException({ error: r.reason, message: 'That comp could not be re-sent.' });
    const delivery = deliveryStatus(comp.phone, comp.email, r.result);
    await db()`update comp set delivery = ${delivery} where id = ${id}`;
    await this.audit.record('comp.resend', `${comp.recipient_name} · ${comp.event_name} [${comp.channel}: ${delivery}]`, req.ip, handle);
    return { ok: true, delivery };
  }

  /* ── helpers ──────────────────────────────────────────────────────────────── */

  private async resolveOwnedTier(handle: string, tierId: string) {
    const [tierRow] = await db()`select event_id, name from product_tier where id = ${tierId}`;
    if (!tierRow) throw new BadRequestException({ error: 'tier_required', message: 'That ticket tier no longer exists.' });
    const eventId = tierRow.event_id as string;
    await this.scope.assertOwnsEvent(handle, eventId); // 404 if not owned
    const [eventRow] = await db()`select name from event where id = ${eventId}`;
    return { eventId, eventName: (eventRow?.name as string) ?? eventId, tierName: (tierRow.name as string) ?? tierId };
  }

  private shape(r: any) {
    return {
      id: r.id,
      name: r.recipient_name,
      phone: r.phone ?? null,
      email: r.email ?? null,
      contact: r.contact ?? contactLabel(r.phone ?? null, r.email ?? null),
      channel: r.channel,
      eventName: r.event_name,
      tier: r.tier_name,
      qty: Number(r.qty),
      delivery: r.delivery,
      issuedAt: r.issued_at instanceof Date ? r.issued_at.toISOString() : String(r.issued_at),
    };
  }
}
