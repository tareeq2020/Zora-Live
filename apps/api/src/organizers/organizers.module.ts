import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { EntityStore } from '../storage/entity-store';
import { SessionService } from '../common/session.module';
import { SessionGuard } from '../common/session.guard';
import { AuditService } from '../audit/audit.module';
import { DEFAULT_ORGANIZERS } from '../common/defaults';

@Controller()
export class OrganizersController {
  constructor(
    private readonly entities: EntityStore,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  @UseGuards(SessionGuard)
  @Get('organizers')
  async list() {
    // Never leak the bcrypt passwordHash added in PR-F-AUTH. Records without one
    // (e.g. the seed data) round-trip byte-identically.
    const orgs = await this.entities.read<any[]>('organizers', DEFAULT_ORGANIZERS);
    return orgs.map(({ passwordHash, ...rest }) => rest);
  }

  // PR-F-AUTH: admin-only way to (re)set an organizer's login password. Mirrors the
  // admin POST /api/password flow; bcrypt hash lands on the organizer record and is
  // stripped from GET /api/organizers. This is how an organizer gets a credential so
  // they can POST /api/org/login.
  @UseGuards(SessionGuard)
  @Put('organizers/:id/password')
  async setPassword(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const orgs = await this.entities.read<any[]>('organizers', DEFAULT_ORGANIZERS);
    const o = orgs.find((x) => x.id === id);
    if (!o) throw new NotFoundException({ error: 'Not found' });
    const next = body && body.password;
    if (!next || next.length < 8) throw new BadRequestException({ error: 'Password must be at least 8 characters' });
    o.passwordHash = bcrypt.hashSync(next, 10);
    await this.entities.write('organizers', orgs);
    await this.audit.record('set_organizer_password', o.name + ' (' + o.handle + ')', req.ip);
    return { ok: true };
  }

  @UseGuards(SessionGuard)
  @Put('organizers/:id/status')
  async setStatus(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const orgs = await this.entities.read<any[]>('organizers', DEFAULT_ORGANIZERS);
    const o = orgs.find((x) => x.id === id);
    if (!o) throw new NotFoundException({ error: 'Not found' });
    const status = body && body.status;
    if (!['active', 'suspended'].includes(status)) throw new BadRequestException({ error: 'Bad status' });
    o.status = status;
    await this.entities.write('organizers', orgs);
    await this.audit.record(status === 'suspended' ? 'suspend_organizer' : 'unlock_organizer', o.name + ' (' + o.handle + ')', req.ip);
    return o;
  }

  // Admin session temporarily "acts on behalf" of an organizer (impersonation
  // lives in the signed session cookie).
  // DEFER (comes with the app.zora.com move): the cross-subdomain impersonation
  // handoff. Today admin + organizer surfaces are same-origin under a path prefix,
  // so the one signed cookie carries the claim directly; once organizer surfaces
  // move to a separate subdomain this will need an explicit signed hand-off token.
  @UseGuards(SessionGuard)
  @Post('organizers/:id/impersonate')
  async impersonate(@Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const orgs = await this.entities.read<any[]>('organizers', DEFAULT_ORGANIZERS);
    const o = orgs.find((x) => x.id === id);
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
