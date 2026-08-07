import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { smsUnitCost } from '@zora/core';
import { SessionGuard } from '../common/session.guard';
import { AuditService } from '../audit/audit.module';
import { OrganizerRepo } from '../storage/organizer-repo';
import { BroadcastsService, normalizeSenderId, type ScopeRequest } from './broadcasts.service';

/* /api/admin/broadcasts (BS43 / #2) — the STAFF side.

   Same service, same core, same queue as the organizer surface (CQ2) — the only
   difference is the scope vocabulary: platform-wide, one organizer, one event,
   one tier. Admin is not verification-gated (there is no admin KYC), but every
   other rule is identical: sender ID required, opt-outs honoured, monthly cap
   counted, fan-out queued to the worker.

   The suppression scope differs too, and deliberately: an unsubscribe from a
   ZORA broadcast is platform-wide, because the person is telling the platform
   to stop, not one promoter. */
const ADMIN_SENDER = 'admin';

@Controller('admin/broadcasts')
@UseGuards(SessionGuard)
export class AdminBroadcastsController {
  constructor(
    private readonly broadcasts: BroadcastsService,
    private readonly organizers: OrganizerRepo,
    private readonly audit: AuditService,
  ) {}

  /** GET /api/admin/broadcasts — history + composer options (every event, every
      organizer) + the allowance. */
  @Get()
  async view(@Query('limit') limit?: string, @Query('scope') scope?: string) {
    const parsed = limit != null ? parseInt(limit, 10) : NaN;
    // `scope=all` shows what organizers sent too — the platform-wide messaging
    // log staff need when a fan asks "who texted me".
    const senderHandle = scope === 'all' ? null : ADMIN_SENDER;
    const [broadcasts, cap, events, orgs] = await Promise.all([
      this.broadcasts.history(senderHandle, Number.isFinite(parsed) ? parsed : undefined),
      this.broadcasts.capFor(ADMIN_SENDER),
      this.broadcasts.audienceOptions(null),
      this.organizers.list(),
    ]);
    return {
      scopeKind: 'admin' as const,
      verified: true,
      senderHandle: ADMIN_SENDER,
      defaultSenderId: 'ZORA',
      smsUnitCost: smsUnitCost(),
      currency: 'TZS',
      cap,
      events,
      organizers: orgs.map((o) => ({ handle: o.handle, name: o.name })),
      broadcasts,
    };
  }

  /** POST /api/admin/broadcasts/preview — live count + cost, any scope. */
  @Post('preview')
  async preview(@Body() body: { scope?: ScopeRequest; bodySms?: unknown }) {
    const resolved = await this.broadcasts.resolveAdminScope(body?.scope ?? {});
    if (!resolved.ok) throw new BadRequestException({ error: resolved.code, message: resolved.message });
    const bodySms = typeof body?.bodySms === 'string' ? body.bodySms : '';
    const preview = await this.broadcasts.preview(resolved.scope, ADMIN_SENDER, 'admin', bodySms);
    return { ...preview, scopeLabel: resolved.label };
  }

  /** POST /api/admin/broadcasts — queue a platform broadcast. */
  @Post()
  async send(
    @Req() req: Request,
    @Body()
    body: {
      scope?: ScopeRequest; channel?: unknown; subject?: unknown;
      bodySms?: unknown; bodyEmail?: unknown; senderId?: unknown;
    },
  ) {
    const resolved = await this.broadcasts.resolveAdminScope(body?.scope ?? {});
    if (!resolved.ok) throw new BadRequestException({ error: resolved.code, message: resolved.message });

    const result = await this.broadcasts.send({
      senderHandle: ADMIN_SENDER,
      senderKind: 'admin',
      scope: resolved.scope,
      channel: String(body?.channel ?? '').toLowerCase() as any,
      subject: typeof body?.subject === 'string' ? body.subject.slice(0, 200) : null,
      bodySms: typeof body?.bodySms === 'string' ? body.bodySms.slice(0, 1200) : null,
      bodyEmail: typeof body?.bodyEmail === 'string' ? body.bodyEmail.slice(0, 20000) : null,
      senderId: normalizeSenderId(body?.senderId) || 'ZORA',
      verified: true,
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
      `admin ${resolved.scope.kind}${resolved.scope.eventId ? ` ${resolved.scope.eventId}` : ''}` +
        `${resolved.scope.organizerHandle ? ` org=${resolved.scope.organizerHandle}` : ''} ` +
        `channel=${result.broadcast.channel} sms=${result.broadcast.smsCount} email=${result.broadcast.emailCount} ` +
        `(broadcast ${result.broadcast.id})`,
      req.ip,
    );

    return { ok: true, broadcast: result.broadcast, audience: result.audience, cap: result.cap };
  }
}
