import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { FileStore } from '../storage/file-store.service';
import { SessionGuard } from '../common/session.guard';
import { AuditService } from '../audit/audit.module';
import { DEFAULT_ORGANIZERS } from '../common/defaults';

@Controller()
export class OrganizersController {
  constructor(private readonly store: FileStore, private readonly audit: AuditService) {}

  @UseGuards(SessionGuard)
  @Get('organizers')
  list() {
    return this.store.readJson('organizers.json', DEFAULT_ORGANIZERS);
  }

  @UseGuards(SessionGuard)
  @Put('organizers/:id/status')
  setStatus(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const orgs = this.store.readJson<any[]>('organizers.json', DEFAULT_ORGANIZERS);
    const o = orgs.find((x) => x.id === id);
    if (!o) throw new NotFoundException({ error: 'Not found' });
    const status = body && body.status;
    if (!['active', 'suspended'].includes(status)) throw new BadRequestException({ error: 'Bad status' });
    o.status = status;
    this.store.writeJson('organizers.json', orgs);
    this.audit.record(status === 'suspended' ? 'suspend_organizer' : 'unlock_organizer', o.name + ' (' + o.handle + ')', req.ip);
    return o;
  }

  // Admin session temporarily "acts on behalf" of an organizer.
  @UseGuards(SessionGuard)
  @Post('organizers/:id/impersonate')
  impersonate(@Param('id') id: string, @Req() req: Request) {
    const orgs = this.store.readJson<any[]>('organizers.json', DEFAULT_ORGANIZERS);
    const o = orgs.find((x) => x.id === id);
    if (!o) throw new NotFoundException({ error: 'Not found' });
    if (o.status === 'suspended') throw new BadRequestException({ error: 'Cannot act on behalf of a suspended account' });
    req.session.impersonating = { id: o.id, name: o.name, handle: o.handle, startedAt: new Date().toISOString() };
    this.audit.record('impersonate_start', o.name + ' (' + o.handle + ')', req.ip);
    return { ok: true, impersonating: req.session.impersonating };
  }

  @UseGuards(SessionGuard)
  @Post('impersonate/exit')
  exitImpersonation(@Req() req: Request) {
    const imp = req.session.impersonating;
    if (imp) this.audit.record('impersonate_end', imp.name + ' (' + imp.handle + ')', req.ip);
    req.session.impersonating = null;
    return { ok: true };
  }

  @Get('impersonation')
  impersonation(@Req() req: Request) {
    return { impersonating: (req.session && req.session.impersonating) || null };
  }
}

@Module({ controllers: [OrganizersController] })
export class OrganizersModule {}
