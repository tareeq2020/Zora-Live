import { Body, Controller, Get, Module, Put, UseGuards } from '@nestjs/common';
import { EntityStore } from '../storage/entity-store';
import { SessionGuard } from '../common/session.guard';
import { DEFAULT_SETTINGS } from '../common/defaults';

@Controller()
export class SettingsController {
  constructor(private readonly entities: EntityStore) {}

  @Get('settings')
  async get() {
    return this.entities.read('settings', DEFAULT_SETTINGS);
  }

  @UseGuards(SessionGuard)
  @Put('settings')
  async update(@Body() body: any) {
    const current = await this.entities.read('settings', DEFAULT_SETTINGS);
    const updated = { ...current, ...body };
    await this.entities.write('settings', updated);
    return updated;
  }
}

@Module({ controllers: [SettingsController] })
export class SettingsModule {}
