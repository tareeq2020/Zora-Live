import { Body, Controller, Get, Module, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionGuard } from '../common/session.guard';
import { TenantService } from '../tenant/tenant.module';

// Vendored events data-access (copied from lib/events.js): file store or Supabase.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const eventsApi = require('../vendor/events');

/* Marketplace fetches ONLY events in our own database, each returned enriched with
   its organizer + subdomain so the client can route to the tenant store. */
@Controller()
export class EventsController {
  constructor(private readonly tenant: TenantService) {}

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
}

@Module({ controllers: [EventsController] })
export class EventsModule {}
