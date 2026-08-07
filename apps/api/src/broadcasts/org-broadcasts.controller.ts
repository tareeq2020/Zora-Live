import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { smsUnitCost } from '@zora/core';
import { OrganizerGuard } from '../common/organizer.guard';
import { AuditService } from '../audit/audit.module';
import { OrganizerRepo } from '../storage/organizer-repo';
import { BroadcastsService, defaultSenderIdFor, normalizeSenderId, type ScopeRequest } from './broadcasts.service';

/* /api/org/broadcasts (BS43 / #2) — the ORGANIZER side of messaging.

   OrganizerGuard stamps req.actingHandle (a real organizer, or an admin actively
   impersonating one). Every read and write below is keyed on THAT handle: the
   audience picker only offers their events, and the scope resolver re-checks
   ownership server-side before anything is counted or sent. An organizer cannot
   target another organizer's buyers — there is no request field that could say
   so, and the resolver would refuse it if there were.

   Sending is GATED (eng review OV5): the org must be verified, must supply a
   sender ID, and must fit inside the monthly SMS allowance. Composing is NOT
   gated — a pending org can write and preview, they just cannot send, and the
   response says exactly that. */
@Controller('org/broadcasts')
@UseGuards(OrganizerGuard)
export class OrgBroadcastsController {
  constructor(
    private readonly broadcasts: BroadcastsService,
    private readonly organizers: OrganizerRepo,
    private readonly audit: AuditService,
  ) {}

  /** GET /api/org/broadcasts — history + everything the composer needs to render:
      the audience options, the allowance, the verification state and the price
      the cost estimate is built from. One round trip, so the composer has no
      half-loaded state. */
  @Get()
  async view(@Req() req: Request, @Query('limit') limit?: string) {
    const handle = req.actingHandle as string;
    const org = await this.organizers.byHandle(handle);
    const parsed = limit != null ? parseInt(limit, 10) : NaN;
    const [broadcasts, cap, events] = await Promise.all([
      this.broadcasts.history(handle, Number.isFinite(parsed) ? parsed : undefined),
      this.broadcasts.capFor(handle),
      this.broadcasts.audienceOptions(handle),
    ]);
    return {
      scopeKind: 'org' as const,
      verified: org?.kycStatus === 'approved',
      senderHandle: handle,
      defaultSenderId: defaultSenderIdFor(org?.name ?? null, handle),
      smsUnitCost: smsUnitCost(),
      currency: 'TZS',
      cap,
      events,
      broadcasts,
    };
  }

  /** POST /api/org/broadcasts/preview — the LIVE recipient count behind the
      audience picker, plus the estimated SMS spend the cost-confirm gate shows
      before send is enabled. A POST because the scope is a structured object,
      not because it changes anything: nothing is written here. */
  @Post('preview')
  async preview(@Req() req: Request, @Body() body: { scope?: ScopeRequest; bodySms?: unknown }) {
    const handle = req.actingHandle as string;
    const resolved = await this.broadcasts.resolveOrgScope(handle, body?.scope ?? {});
    if (!resolved.ok) throw new BadRequestException({ error: resolved.code, message: resolved.message });
    const bodySms = typeof body?.bodySms === 'string' ? body.bodySms : '';
    const preview = await this.broadcasts.preview(resolved.scope, handle, 'org', bodySms);
    return { ...preview, scopeLabel: resolved.label };
  }

  /** POST /api/org/broadcasts — validate, gate, queue. Nothing is sent inline:
      the worker fans it out in bounded batches (ARCH-4), so a 5,000-person blast
      returns in milliseconds and does not hold a web request open. */
  @Post()
  async send(
    @Req() req: Request,
    @Body()
    body: {
      scope?: ScopeRequest; channel?: unknown; subject?: unknown;
      bodySms?: unknown; bodyEmail?: unknown; senderId?: unknown;
    },
  ) {
    const handle = req.actingHandle as string;
    const org = await this.organizers.byHandle(handle);

    const resolved = await this.broadcasts.resolveOrgScope(handle, body?.scope ?? {});
    if (!resolved.ok) {
      // A forbidden scope is a 403 and says nothing about whether the event
      // exists — same non-leaking posture as assertOwnsEvent.
      if (resolved.code === 'scope_forbidden') {
        throw new ForbiddenException({ error: resolved.code, message: resolved.message });
      }
      throw new BadRequestException({ error: resolved.code, message: resolved.message });
    }

    const senderId = normalizeSenderId(body?.senderId) || defaultSenderIdFor(org?.name ?? null, handle);
    const result = await this.broadcasts.send({
      senderHandle: handle,
      senderKind: 'org',
      scope: resolved.scope,
      channel: String(body?.channel ?? '').toLowerCase() as any,
      subject: typeof body?.subject === 'string' ? body.subject.slice(0, 200) : null,
      bodySms: typeof body?.bodySms === 'string' ? body.bodySms.slice(0, 1200) : null,
      bodyEmail: typeof body?.bodyEmail === 'string' ? body.bodyEmail.slice(0, 20000) : null,
      senderId,
      // OV5 — the verification gate, decided from the organizer ROW, never from
      // a session claim the client could be stale about.
      verified: org?.kycStatus === 'approved',
    });

    if (!result.ok) {
      throw new BadRequestException({
        error: result.code,
        message: result.message,
        ...(result.audience ? { audience: result.audience } : {}),
        ...(result.cap ? { cap: result.cap } : {}),
      });
    }

    await this.audit.record(
      'broadcast.send',
      `${resolved.scope.kind}${resolved.scope.eventId ? ` ${resolved.scope.eventId}` : ''} ` +
        `channel=${result.broadcast.channel} sms=${result.broadcast.smsCount} email=${result.broadcast.emailCount} ` +
        `(broadcast ${result.broadcast.id})`,
      req.ip,
      req.actingViaImpersonation ? `admin(as ${handle})` : handle,
    );

    return { ok: true, broadcast: result.broadcast, audience: result.audience, cap: result.cap };
  }
}
