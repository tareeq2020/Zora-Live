import { Body, Controller, Delete, Get, Module, Param, Post, Put, NotFoundException, UseGuards } from '@nestjs/common';
import { EntityStore } from '../storage/entity-store';
import { SessionGuard } from '../common/session.guard';
import { DEFAULT_TIERS } from '../common/defaults';

@Controller()
export class TiersController {
  constructor(private readonly entities: EntityStore) {}

  @Get('tiers')
  async list() {
    const tiers = await this.entities.read<any[]>('tiers', DEFAULT_TIERS);
    tiers.sort((a, b) => (a.order || 0) - (b.order || 0));
    return tiers;
  }

  @UseGuards(SessionGuard)
  @Post('tiers')
  async create(@Body() body: any) {
    const tiers = await this.entities.read<any[]>('tiers', []);
    const item = { id: Date.now().toString(36), ...body };
    tiers.push(item);
    await this.entities.write('tiers', tiers);
    return item;
  }

  @UseGuards(SessionGuard)
  @Put('tiers/:id')
  async update(@Param('id') id: string, @Body() body: any) {
    const tiers = await this.entities.read<any[]>('tiers', []);
    const i = tiers.findIndex((x) => x.id === id);
    if (i === -1) throw new NotFoundException({ error: 'Not found' });
    tiers[i] = { ...tiers[i], ...body, id: tiers[i].id };
    await this.entities.write('tiers', tiers);
    return tiers[i];
  }

  @UseGuards(SessionGuard)
  @Delete('tiers/:id')
  async remove(@Param('id') id: string) {
    const tiers = await this.entities.read<any[]>('tiers', []);
    await this.entities.write('tiers', tiers.filter((x) => x.id !== id));
    return { ok: true };
  }
}

@Module({ controllers: [TiersController] })
export class TiersModule {}
