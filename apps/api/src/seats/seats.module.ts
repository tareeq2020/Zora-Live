import { Body, Controller, Get, Module, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { db, publishSeatMap, readSeatAvailability, applySeatAction, readOrgSeats } from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { OrganizerGuard } from '../common/organizer.guard';
import { OrgModule } from '../org/org.module';
import { OrgScopeService } from '../org/org-scope.service';
import { AuditService } from '../audit/audit.module';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const eventsApi = require('../vendor/events');

/* BS124: seat inventory endpoints (Web Premium v1, F5).
   - POST /api/org/events/:id/seatmap/publish — the owning organizer turns the
     saved floor plan into live seat inventory (versioned; 409 lists seats an
     edit would remove/re-tier while held, sold or reserved).
   - GET  /api/events/:id/seats — buyer availability, coalesced ~2s per event per
     instance with an ETag, so 5s polling scales with events, not viewers (A12).
   BS127 (owner only, OrganizerGuard + assertOwnsEvent → 404 for another org):
   - GET  /api/org/events/:id/seats — real states (blocked stays blocked),
     reserved notes, live version and counts.
   - POST /api/org/events/:id/seats/actions {action: block|reserve|release,
     seatIds, note?} — block/reserve only from available; release only from
     blocked/reserved. Tier pool counts move in the same transaction. */

const CACHE_MS = 2000;
const cache = new Map<string, { at: number; etag: string; body: string }>();

@Controller()
export class SeatsController {
  constructor(
    private readonly entities: EntityStore,
    private readonly scope: OrgScopeService,
    private readonly audit: AuditService,
  ) {}

  @UseGuards(OrganizerGuard)
  @Get('org/events/:id/seats')
  async orgSeats(@Param('id') id: string, @Req() req: Request) {
    const eventId = eventsApi.resolveSlug(id);
    await this.scope.assertOwnsEvent(req.actingHandle as string, eventId);
    return readOrgSeats(db(), eventId);
  }

  @UseGuards(OrganizerGuard)
  @Post('org/events/:id/seats/actions')
  async seatActions(@Param('id') id: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    const eventId = eventsApi.resolveSlug(id);
    await this.scope.assertOwnsEvent(req.actingHandle as string, eventId);
    const action = body?.action;
    const seatIds = body?.seatIds;
    if (action !== 'block' && action !== 'reserve' && action !== 'release') return res.status(400).json({ error: 'invalid_action' });
    if (!Array.isArray(seatIds) || !seatIds.length || seatIds.length > 500 || seatIds.some((x: unknown) => typeof x !== 'string' || !x || x.length > 120)) {
      return res.status(400).json({ error: 'invalid_seats' });
    }
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 200) : null;
    const result = await applySeatAction(db(), eventId, action, seatIds, note);
    cache.delete(eventId);
    if (!result.ok) return res.status(409).json(result);
    await this.audit.record(`seat.${action}`, `${eventId}: ${seatIds.length} seat(s)${note ? ` · ${note}` : ''}`, req.ip, req.actingHandle as string);
    return res.status(200).json(result);
  }

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
    // BS143: buyers read the PUBLISHED plan, never the builder's draft (which the
    // builder overwrites on every save, even when a publish then fails with 409).
    await this.entities.write(`floorplan_published:${eventId}`, { ...plan, publishedVersion: result.version, publishedAt: new Date().toISOString() });
    return res.status(200).json(result);
  }

  // BS143: the published plan (zones, prices, tier links) for the buyer map.
  // 404 until the organizer publishes — the map then stays hidden.
  @Get('events/:id/seatmap')
  async published(@Param('id') id: string, @Res() res: Response) {
    const eventId = eventsApi.resolveSlug(id);
    const plan = await this.entities.read<any>(`floorplan_published:${eventId}`, null);
    if (!plan) return res.status(404).json({ error: 'not_published' });
    res.setHeader('Cache-Control', 'public, max-age=10');
    return res.status(200).json(plan);
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

@Module({ imports: [OrgModule], controllers: [SeatsController] }) // AuditService is @Global
export class SeatsModule {}
