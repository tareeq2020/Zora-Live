import { Controller, Get, Module, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { db, qrPayload } from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { TICKET_FIELDS } from '../common/defaults';

// Vendored, framework-agnostic renderer (copied verbatim from lib/ticket.js).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ticketSVG, ticketPNG } = require('../vendor/ticket');

@Controller('tickets')
export class TicketsController {
  constructor(private readonly entities: EntityStore) {}

  // A stored ticket (tickets collection) rendered by code; any field overridable
  // via query string for live preview in the organizer studio.
  private async resolveTicket(code: string, query: Record<string, any>) {
    const store = await this.entities.read<Record<string, any>>('tickets', {});
    const base = code && store[code] ? store[code] : {};
    const data: Record<string, any> = { ...base };
    if (code && !data.ticketId) data.ticketId = code;
    TICKET_FIELDS.forEach((f) => {
      if (query[f] != null && query[f] !== '') data[f] = query[f];
    });
    // The QR must carry the SIGNED credential payload (`zora:<code>:<signature>`)
    // so the gate scanner can parse AND verify it. Without this the renderer
    // defaults to the app deep link `zora://t/<ref>` (vendor/ticket.js), which
    // parseQrPayload rejects → every web pass scans as "not valid" (the app
    // that deep link targets doesn't exist yet). Look the pass up by its human
    // ref (or code) and, when it's a real credential, embed the signable QR.
    // Studio previews pass an arbitrary code that matches no credential and keep
    // the default. An explicit ?qr= override (studio) always wins.
    if (code && (query.qr == null || query.qr === '')) {
      try {
        const [cred] = (await db()`
          select code, signature from credential
           where upper(public_ref) = upper(${code}) or code = ${code}
           limit 1`) as { code: string; signature: string }[];
        if (cred?.code && cred?.signature) data.qr = qrPayload(cred.code, cred.signature);
      } catch {
        // DB hiccup: fall back to the default QR rather than fail the image.
      }
    }
    return data;
  }

  @Get(':code.svg')
  async svg(@Param('code') code: string, @Query() query: Record<string, any>, @Res() res: Response) {
    const svg = ticketSVG(await this.resolveTicket(code, query), { theme: query.theme });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  }

  @Get(':code.png')
  async png(@Param('code') code: string, @Query() query: Record<string, any>, @Res() res: Response) {
    try {
      const png = await ticketPNG(await this.resolveTicket(code, query), {
        theme: query.theme,
        scale: Math.min(3, Number(query.scale) || 2),
      });
      res.type('image/png').set('Cache-Control', 'no-store').set('Content-Disposition', `inline; filename="${code}.png"`).send(png);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
}

/* GET /api/passes/:ref (XBR-346) — every pass bought in the SAME order as :ref.
   A multi-ticket buyer gets one SMS link (/t/<first-ref>); the web pass must show
   ALL of their tickets, not just that one. Public, like the ticket image: the ref
   in the URL is the capability, and it only reveals its own order's siblings. */
@Controller('passes')
export class PassesController {
  @Get(':ref')
  async list(@Param('ref') ref: string) {
    const rows = (await db()`
      select c2.public_ref as ref,
             coalesce(pt.name, c2.tier_id) as tier,
             c2.seat_index as seat_index,
             e.name as event_name
        from credential c
        join order_item oi  on oi.id  = c.order_item_id
        join order_item oi2 on oi2.order_id = oi.order_id
        join credential c2  on c2.order_item_id = oi2.id
        left join product_tier pt on pt.id = c2.tier_id
        left join event e on e.id = c2.event_id
       where upper(c.public_ref) = upper(${ref})
         and c2.state <> 'revoked'
         and c2.public_ref is not null
       order by c2.tier_id nulls last, c2.seat_index nulls last`) as {
      ref: string; tier: string | null; seat_index: number | null; event_name: string | null;
    }[];

    const seen = new Set<string>();
    const passes: { ref: string; tier: string | null }[] = [];
    for (const r of rows) {
      if (seen.has(r.ref)) continue;
      seen.add(r.ref);
      passes.push({ ref: r.ref, tier: r.tier });
    }
    return { event: rows[0]?.event_name ?? null, passes };
  }
}

@Module({ controllers: [TicketsController, PassesController] })
export class TicketsModule {}
