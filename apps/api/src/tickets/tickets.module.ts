import { Controller, Get, Module, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { FileStore } from '../storage/file-store.service';
import { TICKET_FIELDS } from '../common/defaults';

// Vendored, framework-agnostic renderer (copied verbatim from lib/ticket.js).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ticketSVG, ticketPNG } = require('../vendor/ticket');

@Controller('tickets')
export class TicketsController {
  constructor(private readonly store: FileStore) {}

  // A stored ticket (data/tickets.json) rendered by code; any field overridable
  // via query string for live preview in the organizer studio.
  private resolveTicket(code: string, query: Record<string, any>) {
    const store = this.store.readJson<Record<string, any>>('tickets.json', {});
    const base = code && store[code] ? store[code] : {};
    const data: Record<string, any> = { ...base };
    if (code && !data.ticketId) data.ticketId = code;
    TICKET_FIELDS.forEach((f) => {
      if (query[f] != null && query[f] !== '') data[f] = query[f];
    });
    return data;
  }

  @Get(':code.svg')
  svg(@Param('code') code: string, @Query() query: Record<string, any>, @Res() res: Response) {
    const svg = ticketSVG(this.resolveTicket(code, query), { theme: query.theme });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  }

  @Get(':code.png')
  async png(@Param('code') code: string, @Query() query: Record<string, any>, @Res() res: Response) {
    try {
      const png = await ticketPNG(this.resolveTicket(code, query), {
        theme: query.theme,
        scale: Math.min(3, Number(query.scale) || 2),
      });
      res.type('image/png').set('Cache-Control', 'no-store').set('Content-Disposition', `inline; filename="${code}.png"`).send(png);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
}

@Module({ controllers: [TicketsController] })
export class TicketsModule {}
