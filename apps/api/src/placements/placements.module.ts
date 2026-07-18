import { Body, Controller, Get, Module, Put, UseGuards } from '@nestjs/common';
import { EntityStore } from '../storage/entity-store';
import { SessionGuard } from '../common/session.guard';
import { SLOTS } from '../common/defaults';

@Controller()
export class PlacementsController {
  constructor(private readonly entities: EntityStore) {}

  @Get('placements')
  async get() {
    const saved = await this.entities.read<Record<string, string>>('placements', {});
    const placements: Record<string, { label: string; url: string }> = {};
    SLOTS.forEach((s) => (placements[s.key] = { label: s.label, url: saved[s.key] || s.def }));
    return { slots: SLOTS.map((s) => ({ key: s.key, label: s.label })), placements };
  }

  @UseGuards(SessionGuard)
  @Put('placements')
  async put(@Body() body: any) {
    const b = body || {};
    const saved = await this.entities.read<Record<string, string>>('placements', {});
    SLOTS.forEach((s) => {
      if (typeof b[s.key] === 'string' && b[s.key]) saved[s.key] = b[s.key];
    });
    await this.entities.write('placements', saved);
    return { ok: true, placements: saved };
  }
}

@Module({ controllers: [PlacementsController] })
export class PlacementsModule {}
