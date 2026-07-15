import { Body, Controller, Get, Module, Put, UseGuards } from '@nestjs/common';
import { FileStore } from '../storage/file-store.service';
import { SessionGuard } from '../common/session.guard';
import { DEFAULT_SETTINGS } from '../common/defaults';

@Controller()
export class SettingsController {
  constructor(private readonly store: FileStore) {}

  @Get('settings')
  get() {
    return this.store.readJson('settings.json', DEFAULT_SETTINGS);
  }

  @UseGuards(SessionGuard)
  @Put('settings')
  update(@Body() body: any) {
    const current = this.store.readJson('settings.json', DEFAULT_SETTINGS);
    const updated = { ...current, ...body };
    this.store.writeJson('settings.json', updated);
    return updated;
  }
}

@Module({ controllers: [SettingsController] })
export class SettingsModule {}
