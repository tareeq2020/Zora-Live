import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { EntityStore } from '../storage/entity-store';
import { SessionGuard } from '../common/session.guard';
import { AuditService } from '../audit/audit.module';
import { DEFAULT_ORGANIZERS } from '../common/defaults';

@Controller()
export class OrganizersController {
  constructor(private readonly entities: EntityStore, private readonly audit: AuditService) {}

  @UseGuards(SessionGuard)
  @Get('organizers')
  async list() {
    return this.entities.read('organizers', DEFAULT_ORGANIZERS);
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

  // Admin session temporarily "acts on behalf" of an organizer.
  @UseGuards(SessionGuard)
  @Post('organizers/:id/impersonate')
  async impersonate(@Param('id') id: string, @Req() req: Request) {
    const orgs = await this.entities.read<any[]>('organizers', DEFAULT_ORGANIZERS);
    const o = orgs.find((x) => x.id === id);
    if (!o) throw new NotFoundException({ error: 'Not found' });
    if (o.status === 'suspended') throw new BadRequestException({ error: 'Cannot act on behalf of a suspended account' });
    req.session.impersonating = { id: o.id, name: o.name, handle: o.handle, startedAt: new Date().toISOString() };
    await this.audit.record('impersonate_start', o.name + ' (' + o.handle + ')', req.ip);
    return { ok: true, impersonating: req.session.impersonating };
  }

  @UseGuards(SessionGuard)
  @Post('impersonate/exit')
  async exitImpersonation(@Req() req: Request) {
    const imp = req.session.impersonating;
    if (imp) await this.audit.record('impersonate_end', imp.name + ' (' + imp.handle + ')', req.ip);
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
