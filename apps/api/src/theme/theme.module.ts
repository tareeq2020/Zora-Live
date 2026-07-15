import { Body, Controller, Get, Module, Put } from '@nestjs/common';
import { FileStore } from '../storage/file-store.service';
import { DEFAULT_THEME } from '../common/defaults';

@Controller()
export class ThemeController {
  constructor(private readonly store: FileStore) {}

  @Get('storefront-theme')
  get() {
    return this.store.readJson('theme.json', DEFAULT_THEME);
  }

  // Open in the demo; gated to the owning organizer in production.
  @Put('storefront-theme')
  put(@Body() body: any) {
    const updated = { ...this.store.readJson('theme.json', DEFAULT_THEME), ...(body || {}) };
    this.store.writeJson('theme.json', updated);
    return { ok: true, theme: updated };
  }
}

@Module({ controllers: [ThemeController] })
export class ThemeModule {}
