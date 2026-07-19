import { Body, Controller, Get, Module, Param, Put } from '@nestjs/common';
import { EntityStore } from '../storage/entity-store';

// Vendored events data-access — reused here for canonical slug resolution so
// /api/events/offshore/floorplan and /api/events/offshore-001/floorplan hit the
// same scoped collection.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const eventsApi = require('../vendor/events');

const EMPTY_PLAN = { space: { w: 1600, h: 900 }, stage: null, zones: [] as any[], updatedAt: null as string | null };

function normalizePlan(body: any) {
  const b = body || {};
  const zones = Array.isArray(b.zones) ? b.zones.slice(0, 300) : [];
  return {
    space: b.space && b.space.w ? b.space : { w: 1600, h: 900 },
    stage: b.stage || null,
    zones,
    updatedAt: new Date().toISOString(),
  };
}

@Controller()
export class FloorplanController {
  constructor(private readonly entities: EntityStore) {}

  @Get('floorplan')
  async get() {
    return this.entities.read('floorplan', EMPTY_PLAN);
  }

  // OPEN in the demo so the standalone builder can publish without a login wall.
  // In production this is gated to the event's owning organizer.
  @Put('floorplan')
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
  constructor(private readonly entities: EntityStore) {}

  private key(id: string) {
    return `floorplan:${eventsApi.resolveSlug(id)}`;
  }

  @Get('events/:id/floorplan')
  async get(@Param('id') id: string) {
    const scoped = await this.entities.read<any>(this.key(id), null);
    if (scoped) return scoped;
    return this.entities.read('floorplan', EMPTY_PLAN);
  }

  // Gated to the event's owning organizer in production; OPEN in the demo, matching
  // the global builder endpoint above.
  @Put('events/:id/floorplan')
  async put(@Param('id') id: string, @Body() body: any) {
    const plan = normalizePlan(body);
    await this.entities.write(this.key(id), plan);
    return { ok: true, zones: plan.zones.length, updatedAt: plan.updatedAt };
  }
}

@Module({ controllers: [FloorplanController, EventFloorplanController] })
export class FloorplanModule {}
