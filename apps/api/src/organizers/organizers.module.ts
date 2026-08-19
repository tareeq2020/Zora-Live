import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { resolveCommissionRate, suspendedHandles } from '@zora/core';
import { OrganizerRepo, publicOrganizer } from '../storage/organizer-repo';
import { SessionService } from '../common/session.module';
import { SessionGuard } from '../common/session.guard';
import { AuditService } from '../audit/audit.module';

/* BS35: reads and writes go through OrganizerRepo (the relational `organizer`
   table), not the collection_store blob. Every mutation below is a single-row,
   single-column UPDATE, so two admins editing two organizers no longer clobber
   each other — the blob upsert rewrote the whole list on every save. The response
   bodies are byte-compatible with the blob era (see publicOrganizer). */
@Controller()
export class OrganizersController {
  constructor(
    private readonly organizers: OrganizerRepo,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  @UseGuards(SessionGuard)
  @Get('organizers')
  async list() {
    // Never leak the bcrypt passwordHash added in PR-F-AUTH — publicOrganizer is
    // the only way a record becomes a response body.
    // BS31: always surface a commissionRate so the admin UI can show/edit it, even
    // for records that predate the field (falls back to the platform default).
    const orgs = await this.organizers.list();
    return orgs.map((o) => publicOrganizer(o, resolveCommissionRate(null, o)));
  }

  // BS31: set the platform commission taken from this organizer's payout. Does NOT
  // change the ticket price a buyer pays — it nets the organizer's earnings. Stored
  // as a fraction (0.05 = 5%); capped at 50% as a guardrail.
  @UseGuards(SessionGuard)
  @Put('organizers/:id/commission')
  async setCommission(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    if (!(await this.organizers.byId(id))) throw new NotFoundException({ error: 'Not found' });
    const rate = Number(body?.commissionRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 0.5) throw new BadRequestException({ error: 'commission_out_of_range' });
    // BS35: changing this rate only affects FUTURE orders — every existing order
    // carries the rate that was stamped on it at pay time (migration 0010).
    const o = await this.organizers.setCommissionRate(id, rate);
    if (!o) throw new NotFoundException({ error: 'Not found' });
    await this.audit.record('set_organizer_commission', `${o.name} (${o.handle}) → ${(rate * 100).toFixed(1)}%`, req.ip);
    return { ok: true, commissionRate: rate };
  }

  // PR-F-AUTH: admin-only way to (re)set an organizer's login password. Mirrors the
  // admin POST /api/password flow; bcrypt hash lands on the organizer record and is
  // stripped from GET /api/organizers. This is how an organizer gets a credential so
  // they can POST /api/org/login.
  @UseGuards(SessionGuard)
  @Put('organizers/:id/password')
  async setPassword(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    if (!(await this.organizers.byId(id))) throw new NotFoundException({ error: 'Not found' });
    const next = body && body.password;
    if (!next || next.length < 8) throw new BadRequestException({ error: 'Password must be at least 8 characters' });
    const o = await this.organizers.setPasswordHash(id, bcrypt.hashSync(next, 10));
    if (!o) throw new NotFoundException({ error: 'Not found' });
    await this.audit.record('set_organizer_password', o.name + ' (' + o.handle + ')', req.ip);
    return { ok: true };
  }

  @UseGuards(SessionGuard)
  @Put('organizers/:id/status')
  async setStatus(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    if (!(await this.organizers.byId(id))) throw new NotFoundException({ error: 'Not found' });
    const status = body && body.status;
    if (!['active', 'suspended'].includes(status)) throw new BadRequestException({ error: 'Bad status' });
    const o = await this.organizers.setStatus(id, status);
    if (!o) throw new NotFoundException({ error: 'Not found' });
    // BS70 (#6/T7): the suspension cascade. Update the in-memory suspended-handle
    // set SYNCHRONOUSLY (optimistic, closes the stale window before any public
    // read), then reconcile it against the DB — so the org's events vanish from
    // (or return to) every public read on the very next request, not after a TTL.
    const suspended = suspendedHandles();
    suspended.markSuspended(o.handle, status === 'suspended');
    await suspended.refresh();
    await this.audit.record(status === 'suspended' ? 'suspend_organizer' : 'unlock_organizer', o.name + ' (' + o.handle + ')', req.ip);
    // publicOrganizer (not the raw record) — the blob version echoed passwordHash back.
    return publicOrganizer(o, resolveCommissionRate(null, o));
  }

  // Admin session temporarily "acts on behalf" of an organizer (impersonation
  // lives in the signed session cookie).
  // DEFER (comes with the app.zorapass.com move): the cross-subdomain impersonation
  // handoff. Today admin + organizer surfaces are same-origin under a path prefix,
  // so the one signed cookie carries the claim directly; once organizer surfaces
  // move to a separate subdomain this will need an explicit signed hand-off token.
  @UseGuards(SessionGuard)
  @Post('organizers/:id/impersonate')
  async impersonate(@Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const o = await this.organizers.byId(id);
    if (!o) throw new NotFoundException({ error: 'Not found' });
    if (o.status === 'suspended') throw new BadRequestException({ error: 'Cannot act on behalf of a suspended account' });
    const impersonating = { id: o.id, name: o.name, handle: o.handle, startedAt: new Date().toISOString() };
    this.sessions.set(res, { ...req.session, impersonating });
    await this.audit.record('impersonate_start', o.name + ' (' + o.handle + ')', req.ip);
    return { ok: true, impersonating };
  }

  @UseGuards(SessionGuard)
  @Post('impersonate/exit')
  async exitImpersonation(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const imp = req.session.impersonating;
    if (imp) await this.audit.record('impersonate_end', imp.name + ' (' + imp.handle + ')', req.ip);
    this.sessions.set(res, { ...req.session, impersonating: null });
    return { ok: true };
  }

  @Get('impersonation')
  impersonation(@Req() req: Request) {
    return { impersonating: (req.session && req.session.impersonating) || null };
  }
}

@Module({ controllers: [OrganizersController] })
export class OrganizersModule {}
