import { BadRequestException, Body, Controller, Get, Module, Param, Post, Put, UseGuards } from '@nestjs/common';
import * as path from 'path';
import { FileStore } from '../storage/file-store.service';
import { SessionGuard } from '../common/session.guard';
import { MediaService } from './media.service';

@Controller()
export class MediaController {
  constructor(private readonly media: MediaService, private readonly store: FileStore) {}

  @UseGuards(SessionGuard)
  @Get('media')
  list() {
    return this.media.listMedia();
  }

  @UseGuards(SessionGuard)
  @Put('media/:name/status')
  status(@Param('name') name: string, @Body() body: any) {
    const nm = path.basename(name);
    const { status, flagReason } = body || {};
    if (!['approved', 'flagged', 'pending'].includes(status)) throw new BadRequestException({ error: 'Bad status' });
    const statuses = this.store.readJson<Record<string, any>>('media.json', {});
    statuses[nm] = { status, flagReason: status === 'flagged' ? flagReason || 'Flagged by admin' : '' };
    this.store.writeJson('media.json', statuses);
    return { ok: true, name: nm, status };
  }

  // Open in the demo so the organizer Studio can upload; gated in production.
  @Post('upload')
  upload(@Body() body: any) {
    const { name, dataUrl } = body || {};
    return this.media.upload(name, dataUrl);
  }
}

@Module({ controllers: [MediaController], providers: [MediaService] })
export class MediaModule {}
