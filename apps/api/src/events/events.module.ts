import { Body, Controller, Get, Module, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionGuard } from '../common/session.guard';
import { TenantService } from '../tenant/tenant.module';
import { EntityStore } from '../storage/entity-store';
import { AuditModule } from '../audit/audit.module';
import { AdminEventsController } from './admin-events.controller';

// Vendored events data-access (copied from lib/events.js): file store or Supabase.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const eventsApi = require('../vendor/events');

/* Marketplace fetches ONLY events in our own database, each returned enriched with
   its organizer + subdomain so the client can route to the tenant store. */
@Controller()
export class EventsController {
  constructor(
    private readonly tenant: TenantService,
    private readonly entities: EntityStore,
  ) {}

  @Get('events')
  async list(@Query('city') city: string, @Req() req: Request, @Res() res: Response) {
    try {
      const events = await eventsApi.listEvents(city);
      res.json(await Promise.all(events.map((ev: any) => this.tenant.enrichEvent(ev, req))));
    } catch (e: any) {
      res.status(503).json({ error: e.message });
    }
  }

  @Get('events/:id')
  async get(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    try {
      res.json(await this.tenant.enrichEvent(await eventsApi.getEvent(id), req));
    } catch (e: any) {
      res.status(404).json({ error: e.message });
    }
  }

  @UseGuards(SessionGuard)
  @Post('events')
  async create(@Body() body: any, @Res() res: Response) {
    try {
      res.json(await eventsApi.upsertEvent(body));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  @UseGuards(SessionGuard)
  @Put('events/:id')
  async update(@Param('id') id: string, @Body() body: any, @Res() res: Response) {
    try {
      res.json(await eventsApi.upsertEvent({ ...body, id }));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }

  // BS50: super-admin "mega event" pin. discover-app.tsx already has this fully
  // wired — `mapEvent` reads `e.mega`, and the `feat` memo already picks
  // whichever event in the VIEWER'S CITY has it set (falling back to "JUST
  // DROPPED" when none does; the city scoping is deliberate — a Dar headliner
  // pinned over a Lagos listing reads as a bug and a wrong price in the wrong
  // currency, see the `feat` memo's own comment). It was just never reachable,
  // since nothing ever set `mega: true`. The invariant here follows that same
  // city scoping: at most one mega event PER CITY, not one globally — setting
  // a new Dar mega event clears any other Dar event's flag, but leaves a
  // Lagos mega event (if any) untouched.
  @UseGuards(SessionGuard)
  @Put('events/:id/mega')
  async setMega(@Param('id') id: string, @Body() body: any, @Res() res: Response) {
    const mega = body?.mega === true;
    const rows = await this.entities.read<any[]>('events', []);
    const idx = rows.findIndex((e) => e && e.id === id);
    if (idx < 0) return res.status(404).json({ error: 'event_not_found' });
    const city = rows[idx].city;
    const next = rows.map((e, i) => {
      if (i === idx) return { ...e, mega };
      if (mega && e.mega && e.city === city) return { ...e, mega: false }; // per-city invariant
      return e;
    });
    await this.entities.write('events', next);
    res.json({ ok: true, id, mega });
  }
}

@Module({ imports: [AuditModule], controllers: [EventsController, AdminEventsController] })
export class EventsModule {}
