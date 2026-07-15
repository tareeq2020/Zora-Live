import { Body, Controller, Get, Module, Put } from '@nestjs/common';
import { FileStore } from '../storage/file-store.service';

@Controller()
export class FloorplanController {
  constructor(private readonly store: FileStore) {}

  @Get('floorplan')
  get() {
    return this.store.readJson('floorplan.json', { space: { w: 1600, h: 900 }, stage: null, zones: [], updatedAt: null });
  }

  // OPEN in the demo so the standalone builder can publish without a login wall.
  // In production this is gated to the event's owning organizer.
  @Put('floorplan')
  put(@Body() body: any) {
    const b = body || {};
    const zones = Array.isArray(b.zones) ? b.zones.slice(0, 300) : [];
    const plan = {
      space: b.space && b.space.w ? b.space : { w: 1600, h: 900 },
      stage: b.stage || null,
      zones,
      updatedAt: new Date().toISOString(),
    };
    this.store.writeJson('floorplan.json', plan);
    return { ok: true, zones: zones.length, updatedAt: plan.updatedAt };
  }
}

@Module({ controllers: [FloorplanController] })
export class FloorplanModule {}
