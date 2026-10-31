import { Controller, Get, Module, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { db, qrPayload } from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { TICKET_FIELDS } from '../common/defaults';
import { PassBrandService } from './pass-brand.service';

// Vendored, framework-agnostic renderer (copied verbatim from lib/ticket.js).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ticketSVG, ticketPNG } = require('../vendor/ticket');

@Controller('tickets')
export class TicketsController {
  constructor(private readonly entities: EntityStore, private readonly brand: PassBrandService) {}

  // A stored ticket (tickets collection) rendered by code; any field overridable
  // via query string for live preview in the organizer studio.
  private async resolveTicket(code: string, query: Record<string, any>): Promise<{ data: Record<string, any>; event?: Record<string, any> }> {
    let event: Record<string, any> | undefined;
    const store = await this.entities.read<Record<string, any>>('tickets', {});
    const base = code && store[code] ? store[code] : {};
    const data: Record<string, any> = { ...base };
    if (code && !data.ticketId) data.ticketId = code;
    TICKET_FIELDS.forEach((f) => {
      if (query[f] != null && query[f] !== '') data[f] = query[f];
    });
    // When :code is a REAL credential, fill the pass from it: the SIGNED QR
    // (`zora:<code>:<signature>`, so the gate scanner can parse AND verify it —
    // otherwise vendor/ticket.js defaults to the unscannable `zora://t/<ref>`
    // deep link), AND the event / tier / guest details — otherwise the renderer
    // falls back to its "Untitled Event / Date TBA / Venue TBA" placeholders,
    // which is exactly what a delivered pass showed (XBR-348). Anything already
    // set by an explicit query field (studio preview) or the tickets store wins;
    // an unknown code keeps the vendor defaults.
    if (code) {
      try {
        // `c.*` (not a fixed list) so seat columns are read when they exist
        // (BS125 adds seat_id / seat_label) and simply absent before that.
        const [cred] = (await db()`
          select c.*, pt.name as tier_name
            from credential c
            left join product_tier pt on pt.id = c.tier_id
           where upper(c.public_ref) = upper(${code}) or c.code = ${code}
           limit 1`) as {
          code: string; signature: string; public_ref: string | null;
          event_id: string | null; holder_name: string | null; tier_name: string | null;
          seat_label?: string | null; seat_id?: string | null; zone_label?: string | null; table_label?: string | null;
        }[];
        if (cred) {
          if ((query.qr == null || query.qr === '') && cred.code && cred.signature) {
            data.qr = qrPayload(cred.code, cred.signature);
          }
          const setIfEmpty = (k: string, v: unknown) => {
            if (v != null && v !== '' && (data[k] == null || data[k] === '')) data[k] = v;
          };
          const ev = await this.brand.event(cred.event_id);
          event = ev;
          setIfEmpty('event', ev?.name);
          setIfEmpty('dateLabel', ev?.dateLabel);
          setIfEmpty('venue', ev?.venue);
          setIfEmpty('tableName', cred.tier_name);
          setIfEmpty('tier', cred.tier_name);
          setIfEmpty('guest', cred.holder_name);
          if (cred.public_ref) setIfEmpty('ticketId', cred.public_ref);
          // BS130: seat / zone / table onto the pass when the credential has them.
          const seat = [cred.zone_label, cred.table_label, cred.seat_label].filter((x) => x && String(x).trim()).join(' · ');
          if (seat) { setIfEmpty('seat', seat); setIfEmpty('tableNo', seat); }
          setIfEmpty('dressCode', ev?.dressCode);
        }
      } catch {
        // DB hiccup: fall back to defaults rather than fail the image.
      }
    }
    return { data, event };
  }

  // BS130: flag zp_pass_design on for this event's organizer → branded pass;
  // off (or no real credential) → the classic pass, unchanged.
  private async render(code: string, query: Record<string, any>) {
    const { data, event } = await this.resolveTicket(code, query);
    const brand = event ? await this.brand.forEvent(event).catch(() => null) : null;
    return { data, opts: brand ? { brand } : { theme: query.theme } };
  }

  @Get(':code.svg')
  async svg(@Param('code') code: string, @Query() query: Record<string, any>, @Res() res: Response) {
    const { data, opts } = await this.render(code, query);
    const svg = ticketSVG(data, opts);
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  }

  @Get(':code.png')
  async png(@Param('code') code: string, @Query() query: Record<string, any>, @Res() res: Response) {
    try {
      const { data, opts } = await this.render(code, query);
      const png = await ticketPNG(data, { ...opts, scale: Math.min(3, Number(query.scale) || 2) });
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

@Module({ controllers: [TicketsController, PassesController], providers: [PassBrandService], exports: [PassBrandService] })
export class TicketsModule {}
