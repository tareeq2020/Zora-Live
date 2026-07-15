import { Body, Controller, Get, Module, Put, UseGuards } from '@nestjs/common';
import { FileStore } from '../storage/file-store.service';
import { SessionGuard } from '../common/session.guard';
import { SLOTS } from '../common/defaults';

@Controller()
export class PlacementsController {
  constructor(private readonly store: FileStore) {}

  @Get('placements')
  get() {
    const saved = this.store.readJson<Record<string, string>>('placements.json', {});
    const placements: Record<string, { label: string; url: string }> = {};
    SLOTS.forEach((s) => (placements[s.key] = { label: s.label, url: saved[s.key] || s.def }));
    return { slots: SLOTS.map((s) => ({ key: s.key, label: s.label })), placements };
  }

  @UseGuards(SessionGuard)
  @Put('placements')
  put(@Body() body: any) {
    const b = body || {};
    const saved = this.store.readJson<Record<string, string>>('placements.json', {});
    SLOTS.forEach((s) => {
      if (typeof b[s.key] === 'string' && b[s.key]) saved[s.key] = b[s.key];
    });
    this.store.writeJson('placements.json', saved);
    return { ok: true, placements: saved };
  }
}

@Module({ controllers: [PlacementsController] })
export class PlacementsModule {}
