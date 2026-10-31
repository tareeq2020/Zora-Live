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

  // Canonical event URL. BS147: always the path form zorapass.com/@handle/events/id
  // (the {domain}/{store} convention, BS83). There is no wildcard DNS for
  // <handle>.zorapass.com, and building it from the request Host sent buyers to
  // dead http:// subdomains once the API saw a zorapass.com Host. Opt back in to
  // subdomains only when wildcard DNS + TLS exist (TENANT_SUBDOMAINS=1).
  tenantEventUrl(handle: string, id: string, _req?: Request): string {
    const path = `/@${handle}/events/${encodeURIComponent(id)}`;
    if (process.env.TENANT_SUBDOMAINS === '1') return `https://${handle}.${ROOT_DOMAIN}/events/${encodeURIComponent(id)}`;
    return path;
  }

  async enrichEvent(ev: any, req: Request) {
    const org = await this.organizerByHandle(ev.organizerHandle);
    return {
      ...ev,
      organizer: org ? org.name : null,
      subdomain: ev.organizerHandle ? `${ROOT_DOMAIN}/${ev.organizerHandle}` : null,
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
    return { handle: org.handle, name: org.name, subdomain: `${ROOT_DOMAIN}/${org.handle}`, status: org.status };
  }
}

@Global()
@Module({ controllers: [TenantController], providers: [TenantService], exports: [TenantService] })
export class TenantModule {}
