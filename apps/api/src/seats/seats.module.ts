import { Controller, Get, Module, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { db, publishSeatMap, readSeatAvailability } from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { OrganizerGuard } from '../common/organizer.guard';
import { OrgModule } from '../org/org.module';
import { OrgScopeService } from '../org/org-scope.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const eventsApi = require('../vendor/events');

/* BS124: seat inventory endpoints (Web Premium v1, F5).
   - POST /api/org/events/:id/seatmap/publish — the owning organizer turns the
     saved floor plan into live seat inventory (versioned; 409 lists seats an
     edit would remove/re-tier while held, sold or reserved).
   - GET  /api/events/:id/seats — buyer availability, coalesced ~2s per event per
     instance with an ETag, so 5s polling scales with events, not viewers (A12). */

const CACHE_MS = 2000;
const cache = new Map<string, { at: number; etag: string; body: string }>();

@Controller()
export class SeatsController {
  constructor(
    private readonly entities: EntityStore,
    private readonly scope: OrgScopeService,
  ) {}

  @UseGuards(OrganizerGuard)
  @Post('org/events/:id/seatmap/publish')
  async publish(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const eventId = eventsApi.resolveSlug(id);
    await this.scope.assertOwnsEvent(req.actingHandle as string, eventId);
    const plan = await this.entities.read<any>(`floorplan:${eventId}`, null);
    if (!plan || !Array.isArray(plan.zones) || plan.zones.length === 0) {
      return res.status(400).json({ error: 'no_floorplan' });
    }
    const result = await publishSeatMap(db(), eventId, plan, req.actingHandle as string);
    cache.delete(eventId);
    if (!result.ok) return res.status(409).json(result);
    return res.status(200).json(result);
  }

  @Get('events/:id/seats')
  async seats(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const eventId = eventsApi.resolveSlug(id);
    const now = Date.now();
    let hit = cache.get(eventId);
    if (!hit || now - hit.at >= CACHE_MS) {
      const data = await readSeatAvailability(db(), eventId);
      const body = JSON.stringify(data);
      hit = { at: now, etag: '"' + createHash('sha1').update(body).digest('base64url').slice(0, 20) + '"', body };
      cache.set(eventId, hit);
      if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
    }
    res.setHeader('ETag', hit.etag);
    res.setHeader('Cache-Control', 'public, max-age=2');
    if (req.headers['if-none-match'] === hit.etag) return res.status(304).end();
    res.type('application/json').send(hit.body);
  }
}

@Module({ imports: [OrgModule], controllers: [SeatsController] })
export class SeatsModule {}
