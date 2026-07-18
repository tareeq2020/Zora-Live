import { Body, Controller, Get, Module, Put } from '@nestjs/common';
import { EntityStore } from '../storage/entity-store';

@Controller()
export class FloorplanController {
  constructor(private readonly entities: EntityStore) {}

  @Get('floorplan')
  async get() {
    return this.entities.read('floorplan', { space: { w: 1600, h: 900 }, stage: null, zones: [], updatedAt: null });
  }

  // OPEN in the demo so the standalone builder can publish without a login wall.
  // In production this is gated to the event's owning organizer.
  @Put('floorplan')
  async put(@Body() body: any) {
    const b = body || {};
    const zones = Array.isArray(b.zones) ? b.zones.slice(0, 300) : [];
    const plan = {
      space: b.space && b.space.w ? b.space : { w: 1600, h: 900 },
      stage: b.stage || null,
      zones,
      updatedAt: new Date().toISOString(),
    };
    await this.entities.write('floorplan', plan);
    return { ok: true, zones: zones.length, updatedAt: plan.updatedAt };
  }
}

@Module({ controllers: [FloorplanController] })
export class FloorplanModule {}
