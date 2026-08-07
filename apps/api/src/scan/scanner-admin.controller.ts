import {
  BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ScannerRole } from '@zora/core';
import { SessionGuard } from '../common/session.guard';
import { AuditService } from '../audit/audit.module';
import { ScannerUserRepo, publicScannerUser } from '../storage/scanner-user.repo';

/* /api/agents — the super-admin's SCANNER USERS panel (plan #1 "scanner users +
   roles"). The path is unchanged on purpose: the live admin console section
   (apps/web .../sections/scanner-users-section.tsx) already calls it, and this
   lane extends that panel rather than rebuilding it.

   What changed underneath: the JSON blob became `scanner_user` rows (see
   ScannerUserRepo for why a code that authenticates cannot live in a blob).
   What changed on the surface: ROLE and EVENT SCOPE are now real, settable
   fields, and REVOKE is a state change instead of a delete — `credential.
   scanned_by` points at these ids, so deleting one would erase the answer to
   "who let this person in".

   This whole surface is admin-session-gated. That is the security model the
   panel's own copy promises: codes are generated, rotated and revoked ONLY from
   here — an organizer can never issue one. */

const ROLES: ScannerRole[] = ['agent', 'supervisor'];

@UseGuards(SessionGuard)
@Controller()
export class ScannerAdminController {
  constructor(
    private readonly users: ScannerUserRepo,
    private readonly audit: AuditService,
  ) {}

  @Get('agents')
  async list() {
    return (await this.users.list()).map(publicScannerUser);
  }

  @Post('agents')
  async create(@Body() body: any, @Req() req: Request) {
    const { name, contact, event, role, eventScope } = body || {};
    if (!name || !contact) throw new BadRequestException({ error: 'Agent name and phone or email are required' });
    if (role != null && !ROLES.includes(role)) {
      throw new BadRequestException({ error: 'Role must be agent or supervisor' });
    }
    const user = await this.users.create({
      name: String(name),
      contact: String(contact),
      role: role as ScannerRole,
      // `event` is the legacy field name the console posts; `eventScope` is the
      // explicit one. Either may be used, and 'All events' means unscoped.
      eventScope: eventScope !== undefined ? eventScope : event,
    });
    await this.audit.record('scanner.create', `${user.name} (${user.role}${user.eventScope ? ' @ ' + user.eventScope : ''})`, req.ip);
    return publicScannerUser(user);
  }

  /** NEW CODE. Also ends any session minted under the old code. */
  @Post('agents/:id/rotate')
  async rotate(@Param('id') id: string, @Req() req: Request) {
    const user = await this.users.rotateCode(id);
    if (!user) throw new NotFoundException({ error: 'Not found' });
    await this.audit.record('scanner.rotate', user.name, req.ip);
    return publicScannerUser(user);
  }

  /** Assign role and/or event scope. Both optional; both take effect on the
      scanner's NEXT request (the guard reads the row, not the token). */
  @Put('agents/:id')
  async update(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const { role, eventScope, event } = body || {};
    let user = await this.users.byId(id);
    if (!user) throw new NotFoundException({ error: 'Not found' });

    if (role !== undefined) {
      if (!ROLES.includes(role)) throw new BadRequestException({ error: 'Role must be agent or supervisor' });
      user = (await this.users.setRole(id, role as ScannerRole)) ?? user;
    }
    if (eventScope !== undefined || event !== undefined) {
      const scope = ScannerUserRepo.normalizeScope(eventScope !== undefined ? eventScope : event);
      user = (await this.users.setScope(id, scope)) ?? user;
    }
    await this.audit.record('scanner.update', `${user.name} → ${user.role}${user.eventScope ? ' @ ' + user.eventScope : ' @ all events'}`, req.ip);
    return publicScannerUser(user);
  }

  /** REVOKE. Kept on the legacy DELETE verb so the console's REVOKE button is
      unchanged, but it flips status rather than dropping the row. */
  @Delete('agents/:id')
  async revoke(@Param('id') id: string, @Req() req: Request) {
    const user = await this.users.revoke(id);
    if (!user) throw new NotFoundException({ error: 'Not found' });
    await this.audit.record('scanner.revoke', user.name, req.ip);
    return { ok: true, agent: publicScannerUser(user) };
  }
}
