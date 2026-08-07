import { Controller, Get, Global, Injectable, Module, NotFoundException, Param } from '@nestjs/common';
import type { Request } from 'express';
import { OrganizerRepo } from '../storage/organizer-repo';
import { ROOT_DOMAIN } from '../common/defaults';

/* White-label routing helpers — every marketplace event belongs to an organizer
   that owns <handle>.zorapass.com. Shared so EventsController can enrich events with
   their tenant URL. BS35: organizers are rows in the `organizer` table (this used
   to parse the whole 'organizers' blob on every public event render). */
@Injectable()
export class TenantService {
  constructor(private readonly organizers: OrganizerRepo) {}

  async organizerByHandle(handle: string) {
    return (await this.organizers.byHandle(handle)) ?? undefined;
  }

  // Canonical event URL. Real subdomain in prod; path alias on localhost (no wildcard DNS).
  tenantEventUrl(handle: string, id: string, req: Request): string {
    const host = req.headers.host || '';
    const onRootDomain = host.endsWith(ROOT_DOMAIN);
    if (!onRootDomain) return `/@${handle}/events/${encodeURIComponent(id)}`;
    return `${req.protocol}://${handle}.${ROOT_DOMAIN}/events/${encodeURIComponent(id)}`;
  }

  async enrichEvent(ev: any, req: Request) {
    const org = await this.organizerByHandle(ev.organizerHandle);
    return {
      ...ev,
      organizer: org ? org.name : null,
      subdomain: ev.organizerHandle ? `${ev.organizerHandle}.${ROOT_DOMAIN}` : null,
      url: ev.organizerHandle ? this.tenantEventUrl(ev.organizerHandle, ev.id, req) : null,
    };
  }
}

@Controller()
export class TenantController {
  constructor(private readonly tenant: TenantService) {}

  @Get('tenant/:handle')
  async get(@Param('handle') handle: string) {
    const org = await this.tenant.organizerByHandle(handle);
    if (!org) throw new NotFoundException({ error: 'Unknown organizer' });
    return { handle: org.handle, name: org.name, subdomain: `${org.handle}.${ROOT_DOMAIN}`, status: org.status };
  }
}

@Global()
@Module({ controllers: [TenantController], providers: [TenantService], exports: [TenantService] })
export class TenantModule {}
