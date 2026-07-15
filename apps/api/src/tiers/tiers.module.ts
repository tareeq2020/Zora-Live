import { Body, Controller, Delete, Get, Module, Param, Post, Put, NotFoundException, UseGuards } from '@nestjs/common';
import { FileStore } from '../storage/file-store.service';
import { SessionGuard } from '../common/session.guard';
import { DEFAULT_TIERS } from '../common/defaults';

@Controller()
export class TiersController {
  constructor(private readonly store: FileStore) {}

  @Get('tiers')
  list() {
    const tiers = this.store.readJson<any[]>('tiers.json', DEFAULT_TIERS);
    tiers.sort((a, b) => (a.order || 0) - (b.order || 0));
    return tiers;
  }

  @UseGuards(SessionGuard)
  @Post('tiers')
  create(@Body() body: any) {
    const tiers = this.store.readJson<any[]>('tiers.json', []);
    const item = { id: Date.now().toString(36), ...body };
    tiers.push(item);
    this.store.writeJson('tiers.json', tiers);
    return item;
  }

  @UseGuards(SessionGuard)
  @Put('tiers/:id')
  update(@Param('id') id: string, @Body() body: any) {
    const tiers = this.store.readJson<any[]>('tiers.json', []);
    const i = tiers.findIndex((x) => x.id === id);
    if (i === -1) throw new NotFoundException({ error: 'Not found' });
    tiers[i] = { ...tiers[i], ...body, id: tiers[i].id };
    this.store.writeJson('tiers.json', tiers);
    return tiers[i];
  }

  @UseGuards(SessionGuard)
  @Delete('tiers/:id')
  remove(@Param('id') id: string) {
    this.store.writeJson('tiers.json', this.store.readJson<any[]>('tiers.json', []).filter((x) => x.id !== id));
    return { ok: true };
  }
}

@Module({ controllers: [TiersController] })
export class TiersModule {}
