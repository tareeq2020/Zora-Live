import { Body, Controller, Get, Module, Put } from '@nestjs/common';
import { EntityStore } from '../storage/entity-store';
import { DEFAULT_THEME } from '../common/defaults';

@Controller()
export class ThemeController {
  constructor(private readonly entities: EntityStore) {}

  @Get('storefront-theme')
  async get() {
    return this.entities.read('theme', DEFAULT_THEME);
  }

  // Open in the demo; gated to the owning organizer in production.
  @Put('storefront-theme')
  async put(@Body() body: any) {
    const updated = { ...(await this.entities.read('theme', DEFAULT_THEME)), ...(body || {}) };
    await this.entities.write('theme', updated);
    return { ok: true, theme: updated };
  }
}

@Module({ controllers: [ThemeController] })
export class ThemeModule {}
