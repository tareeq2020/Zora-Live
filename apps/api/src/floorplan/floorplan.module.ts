import { Body, Controller, ForbiddenException, Get, Module, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { normalizeSeatMapPlan } from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { OrganizerGuard } from '../common/organizer.guard';
import { SessionGuard } from '../common/session.guard';
import { OrgModule } from '../org/org.module';
import { OrgScopeService } from '../org/org-scope.service';

// Vendored events data-access — reused here for canonical slug resolution so
// /api/events/offshore/floorplan and /api/events/offshore-001/floorplan hit the
// same scoped collection.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const eventsApi = require('../vendor/events');

const EMPTY_PLAN = normalizeSeatMapPlan({ space: { w: 1600, h: 900 }, stage: null, zones: [], updatedAt: null });

function normalizePlan(body: any, eventId?: string) {
  return normalizeSeatMapPlan({
    ...body,
    zones: Array.isArray(body?.zones) ? body.zones.slice(0, 300) : [],
    updatedAt: new Date().toISOString(),
  }, eventId);
}

@Controller()
export class FloorplanController {
  constructor(private readonly entities: EntityStore) {}

  @Get('floorplan')
  async get() {
    return this.entities.read('floorplan', EMPTY_PLAN);
  }

  // BS115 (A9): the global plan is the fallback every event without its own plan
  // renders, so only a platform admin may overwrite it. Organizers publish
  // event-scoped plans via PUT events/:id/floorplan below.
  @Put('floorplan')
  @UseGuards(SessionGuard)
  async put(@Body() body: any) {
    const plan = normalizePlan(body);
    await this.entities.write('floorplan', plan);
    return { ok: true, zones: plan.zones.length, updatedAt: plan.updatedAt };
  }
}

// Event-scoped floor plan. Each event owns its own seat map under the
// `floorplan:<id>` collection; the canonical flagship slug (offshore) resolves to
// its real id first. Falls back to the global `floorplan` plan so the seeded
// OFFSHORE map renders before any per-event plan is published.
@Controller()
export class EventFloorplanController {
  constructor(
    private readonly entities: EntityStore,
    private readonly scope: OrgScopeService,
  ) {}

  private key(id: string) {
    return `floorplan:${eventsApi.resolveSlug(id)}`;
  }

  @Get('events/:id/floorplan')
  async get(@Param('id') id: string) {
    const scoped = await this.entities.read<any>(this.key(id), null);
    if (scoped) return scoped;
    return this.entities.read('floorplan', EMPTY_PLAN);
  }

  // BS115 (A9): only the event's owning organizer (or an admin impersonating
  // that organizer) may publish its plan. Anon → 401 (OrganizerGuard); another
  // organizer → 403. Event existence is already public, so 403 leaks nothing.
  @Put('events/:id/floorplan')
  @UseGuards(OrganizerGuard)
  async put(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const eventId = eventsApi.resolveSlug(id);
    const events = await this.scope.readEvents();
    const ev = events.find((e) => e && e.id === eventId);
    if (!ev || ev.organizerHandle !== req.actingHandle) {
      throw new ForbiddenException({ error: 'forbidden', message: 'You do not own this event.' });
    }
    const plan = normalizePlan(body, eventsApi.resolveSlug(id));
    await this.entities.write(this.key(id), plan);
    return { ok: true, zones: plan.zones.length, updatedAt: plan.updatedAt };
  }
}

@Module({ imports: [OrgModule], controllers: [FloorplanController, EventFloorplanController] })
export class FloorplanModule {}
