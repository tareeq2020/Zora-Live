import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { db, type ScannerRole } from '@zora/core';
import { OrganizerGuard } from '../common/organizer.guard';
import { Roles } from '../common/roles.guard';
import { OrgScopeService } from '../org/org-scope.service';
import { AuditService } from '../audit/audit.module';
import { ScannerUserRepo, publicScannerUser } from '../storage/scanner-user.repo';

/* /api/org/scanners (BS106) — ORGANIZER-provisioned door staff. The scanning
   engine (scanner_user, /scan PWA, code→scoped token, two-step verify→confirm,
   lockout, rotation) is unchanged; this only lets an owner/admin create + manage
   THEIR OWN scanners, scoped to THEIR OWN events.

   Hard rules:
     · every scanner is pinned to a specific event the org OWNS (assertOwnsEvent);
       an org scanner is NEVER unscoped (event_scope NULL = every event on the
       platform — that's admin-only). A missing event → 400.
     · every read/mutation is filtered by organizer_handle (byIdOwned), so an org
       can only see/touch its own scanners; another org's id → 404. */
const ROLES: ScannerRole[] = ['agent', 'supervisor'];

@Roles('owner', 'admin')
@Controller('org/scanners')
@UseGuards(OrganizerGuard)
export class OrgScannersController {
  constructor(
    private readonly scanners: ScannerUserRepo,
    private readonly scope: OrgScopeService,
    private readonly audit: AuditService,
  ) {}

  /** GET /api/org/scanners — this org's scanners (code included; owner/admin-gated). */
  @Get()
  async list(@Req() req: Request) {
    const handle = req.actingHandle as string;
    return (await this.scanners.listByOrganizer(handle)).map(publicScannerUser);
  }

  /** GET /api/org/scanners/sales (BS107) — per-seller gate-sales reconciliation:
      how much CASH each door person took (owes the org) plus their mobile total.
      Scoped to THIS org's scanners; cash is the number that matters at settlement. */
  @Get('sales')
  async sales(@Req() req: Request) {
    const handle = req.actingHandle as string;
    const mine = await this.scanners.listByOrganizer(handle);
    const nameById = new Map(mine.map((s) => [s.id, s.name]));
    const ids = mine.map((s) => s.id);
    if (ids.length === 0) return { sellers: [], totals: { cash: 0, mobile: 0 } };

    const rows = await db()`
      select o.sold_by,
             sum(case when o.channel = 'gate_cash'   then oi.amt else 0 end)::bigint as cash,
             sum(case when o.channel = 'gate_mobile' then oi.amt else 0 end)::bigint as mobile,
             count(*)::int as orders
        from "order" o
        join (select order_id, sum(unit_price * quantity) as amt from order_item group by order_id) oi on oi.order_id = o.id
       where o.status = 'paid' and o.channel in ('gate_cash','gate_mobile') and o.sold_by = any(${ids})
       group by o.sold_by`;
    let cash = 0, mobile = 0;
    const sellers = rows.map((r: any) => {
      cash += Number(r.cash || 0); mobile += Number(r.mobile || 0);
      return { sellerId: r.sold_by, name: nameById.get(r.sold_by) ?? r.sold_by, cash: Number(r.cash || 0), mobile: Number(r.mobile || 0), orders: Number(r.orders || 0) };
    });
    return { sellers, totals: { cash, mobile } };
  }

  /** POST /api/org/scanners { name, contact, eventId, role } — create + pin to an owned event. */
  @Post()
  async create(@Req() req: Request, @Body() body: any) {
    const handle = req.actingHandle as string;
    const name = String(body?.name ?? '').trim();
    const contact = String(body?.contact ?? '').trim();
    const eventId = String(body?.eventId ?? '').trim();
    if (!name) throw new BadRequestException({ error: 'name_required', message: 'Enter the door person’s name.' });
    if (!contact) throw new BadRequestException({ error: 'contact_required', message: 'Enter a phone or email.' });
    if (!eventId) throw new BadRequestException({ error: 'event_required', message: 'Pick which event this scanner works.' });
    const role = this.parseRole(body?.role);

    const canSell = body?.canSell === true;
    await this.scope.assertOwnsEvent(handle, eventId); // 404 if not owned
    const user = await this.scanners.create({ name, contact, role, eventScope: eventId, organizerHandle: handle, canSell });
    await this.audit.record('org.scanner.create', `${user.name} (${user.role}${canSell ? '+seller' : ''} @ ${eventId})`, req.ip, handle);
    return publicScannerUser(user);
  }

  /** PUT /api/org/scanners/:id { role?, eventId? } — change role and/or re-pin to
      another OWNED event. Never clears the scope. */
  @Put(':id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    const handle = req.actingHandle as string;
    let user = await this.scanners.byIdOwned(id, handle);
    if (!user) throw new NotFoundException({ error: 'not_found', message: 'That scanner no longer exists.' });

    if (body?.role !== undefined) {
      user = (await this.scanners.setRole(id, this.parseRole(body.role))) ?? user;
    }
    if (body?.canSell !== undefined) {
      user = (await this.scanners.setCanSell(id, body.canSell === true)) ?? user;
    }
    if (body?.eventId !== undefined) {
      const eventId = String(body.eventId ?? '').trim();
      if (!eventId) throw new BadRequestException({ error: 'event_required', message: 'A scanner must stay pinned to an event.' });
      await this.scope.assertOwnsEvent(handle, eventId);
      user = (await this.scanners.setScope(id, eventId)) ?? user;
    }
    await this.audit.record('org.scanner.update', `${user.name} (${user.role} @ ${user.eventScope ?? '—'})`, req.ip, handle);
    return publicScannerUser(user);
  }

  /** POST /api/org/scanners/:id/rotate — new code; ends the door person's live session. */
  @Post(':id/rotate')
  async rotate(@Req() req: Request, @Param('id') id: string) {
    const handle = req.actingHandle as string;
    const owned = await this.scanners.byIdOwned(id, handle);
    if (!owned) throw new NotFoundException({ error: 'not_found', message: 'That scanner no longer exists.' });
    const user = (await this.scanners.rotateCode(id)) ?? owned;
    await this.audit.record('org.scanner.rotate', user.name, req.ip, handle);
    return publicScannerUser(user);
  }

  /** POST /api/org/scanners/:id/revoke — deactivate (the code stops working). */
  @Post(':id/revoke')
  async revoke(@Req() req: Request, @Param('id') id: string) {
    const handle = req.actingHandle as string;
    const owned = await this.scanners.byIdOwned(id, handle);
    if (!owned) throw new NotFoundException({ error: 'not_found', message: 'That scanner no longer exists.' });
    const user = (await this.scanners.revoke(id)) ?? owned;
    await this.audit.record('org.scanner.revoke', user.name, req.ip, handle);
    return publicScannerUser(user);
  }

  private parseRole(v: unknown): ScannerRole {
    const role = String(v ?? 'agent');
    if (!ROLES.includes(role as ScannerRole)) throw new BadRequestException({ error: 'role_invalid', message: 'Role must be agent or supervisor.' });
    return role as ScannerRole;
  }
}
