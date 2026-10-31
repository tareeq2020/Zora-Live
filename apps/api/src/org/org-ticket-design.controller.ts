import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  db, isHexColour, loadTicketDesign, PASS_SHOW_FIELDS, PASS_TEMPLATES, resolveTheme,
  type TicketDesignFields,
} from '@zora/core';
import { OrganizerGuard } from '../common/organizer.guard';
import { Roles } from '../common/roles.guard';
import { OrganizerRepo } from '../storage/organizer-repo';
import { OrgScopeService } from './org-scope.service';
import { PassBrandService } from '../tickets/pass-brand.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ticketSVG } = require('../vendor/ticket');

/* BS131 (F6): the organizer "Pass design" tab's API.

   GET  /api/org/events/:id/ticket-design            → draft + published + what it inherits
   PUT  /api/org/events/:id/ticket-design            → save the DRAFT (buyers never see it)
   POST /api/org/events/:id/ticket-design/publish    → copy draft → live columns
   GET  /api/org/events/:id/ticket-design/preview.svg[?design=<json>]
        → the draft (or the unsaved form state) on a sample pass

   Owner/admin only, scoped to the acting org (assertOwnsEvent → 404, never a
   403 that would leak another org's event ids). Writes and the preview need
   the zp_pass_design flag for that org/event (features ship dark). */

const MAX_URL = 1000;

export function validUrl(v: unknown): boolean {
  if (typeof v !== 'string' || v.length > MAX_URL) return false;
  if (/^https:\/\/[^\s"'<>]+$/i.test(v)) return true;
  return /^\/(media|uploads)\/[A-Za-z0-9._\-/]+$/.test(v); // a media upload path
}

/** Validate an organizer-submitted design. Throws 400 with the first problem. */
export function validateDesign(body: any): TicketDesignFields {
  const b = body && typeof body === 'object' ? body : {};
  const bad = (field: string, error: string) => { throw new BadRequestException({ error, field }); };
  const out: TicketDesignFields = {};

  if (b.template != null && b.template !== '') {
    if (!(PASS_TEMPLATES as readonly string[]).includes(b.template)) bad('template', 'invalid_template');
    out.template = b.template;
  } else out.template = null;

  for (const k of ['accent', 'bgColor'] as const) {
    const v = b[k];
    if (v == null || v === '') { out[k] = null; continue; }
    if (!isHexColour(v)) bad(k, 'invalid_colour');
    out[k] = String(v).trim().toUpperCase();
  }

  for (const k of ['bgImage', 'logoUrl', 'organizerLogoUrl'] as const) {
    const v = b[k];
    if (v == null || v === '') { out[k] = null; continue; }
    if (!validUrl(v)) bad(k, 'invalid_url');
    out[k] = v;
  }

  const sponsors = b.sponsorLogos == null ? [] : b.sponsorLogos;
  if (!Array.isArray(sponsors)) bad('sponsorLogos', 'invalid_sponsors');
  if (sponsors.length > 4) bad('sponsorLogos', 'too_many_sponsors');
  for (const u of sponsors) if (!validUrl(u)) bad('sponsorLogos', 'invalid_url');
  out.sponsorLogos = sponsors;

  if (b.showFields == null) out.showFields = null;
  else {
    if (!Array.isArray(b.showFields)) bad('showFields', 'invalid_show_fields');
    for (const f of b.showFields) if (!(PASS_SHOW_FIELDS as readonly string[]).includes(f)) bad('showFields', 'invalid_show_fields');
    out.showFields = PASS_SHOW_FIELDS.filter((f) => b.showFields.includes(f));
  }

  if (b.inheritStorefront != null && typeof b.inheritStorefront !== 'boolean') bad('inheritStorefront', 'invalid_boolean');
  out.inheritStorefront = b.inheritStorefront !== false;
  return out;
}

@Roles('owner', 'admin')
@UseGuards(OrganizerGuard)
@Controller('org')
export class OrgTicketDesignController {
  constructor(
    private readonly scope: OrgScopeService,
    private readonly brand: PassBrandService,
    private readonly organizers: OrganizerRepo,
  ) {}

  private async owned(req: Request, id: string) {
    const handle = req.actingHandle as string;
    const ev = await this.scope.assertOwnsEvent(handle, id); // 404 if not owned
    return { handle, ev };
  }

  private async requireFlag(handle: string, id: string) {
    if (!(await this.brand.flagOn(handle, id))) throw new ForbiddenException({ error: 'feature_off' });
  }

  @Get('events/:id/ticket-design')
  async get(@Req() req: Request, @Param('id') id: string) {
    const { handle, ev } = await this.owned(req, id);
    const enabled = await this.brand.flagOn(handle, id);
    const rec = await loadTicketDesign(id);
    const org = await this.organizers.byHandle(handle);
    // What the pass inherits with no overrides (drives "From storefront ✓").
    const inherited = await resolveTheme({
      organizerId: org?.id ?? null, brandFallback: org?.name || '',
      event: { id, cover: ev.cover ?? null }, includeDesign: false,
    });
    const draft = rec ? rec.draft : null;
    const resolved = await resolveTheme({
      organizerId: org?.id ?? null, brandFallback: org?.name || '',
      event: { id, cover: ev.cover ?? null }, designOverride: draft || {},
    });
    return {
      enabled,
      eventId: id,
      eventName: ev.name ?? '',
      status: rec?.status ?? 'draft',
      draft,
      published: rec?.published ?? null,
      updatedAt: rec?.updatedAt || null,
      publishedAt: rec?.publishedAt || null,
      inherited: { accent: inherited.accent, logoUrl: inherited.logoUrl, artworkUrl: inherited.artworkUrl, brandName: inherited.brandName },
      resolved: { accent: resolved.accent, onAccent: resolved.onAccent, template: resolved.template },
    };
  }

  @Put('events/:id/ticket-design')
  async put(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    const { handle } = await this.owned(req, id);
    await this.requireFlag(handle, id);
    const d = validateDesign(body);
    await db()`
      insert into ticket_design (event_id, status, draft, updated_at)
      values (${id}, 'draft', ${db().json(d as any)}, now())
      on conflict (event_id) do update set draft = excluded.draft, status = 'draft', updated_at = now()`;
    return { ok: true, status: 'draft', draft: d };
  }

  @Post('events/:id/ticket-design/publish')
  async publish(@Req() req: Request, @Param('id') id: string) {
    const { handle } = await this.owned(req, id);
    await this.requireFlag(handle, id);
    const rec = await loadTicketDesign(id);
    if (!rec) throw new BadRequestException({ error: 'no_draft' });
    // Re-validate: the draft is what we're about to show every buyer.
    const d = validateDesign(rec.draft);
    await db()`
      update ticket_design set
        template = ${d.template ?? null}, accent = ${d.accent ?? null}, bg_color = ${d.bgColor ?? null},
        bg_image = ${d.bgImage ?? null}, logo_url = ${d.logoUrl ?? null}, organizer_logo_url = ${d.organizerLogoUrl ?? null},
        sponsor_logos = ${db().json((d.sponsorLogos || []) as any)},
        show_fields = ${d.showFields ? db().json(d.showFields as any) : null},
        inherit_storefront = ${d.inheritStorefront !== false},
        status = 'published', published_at = now(), updated_at = now()
      where event_id = ${id}`;
    return { ok: true, status: 'published' };
  }

  @Get('events/:id/ticket-design/preview.svg')
  async preview(@Req() req: Request, @Param('id') id: string, @Query('design') design: string | undefined, @Res() res: Response) {
    const { handle, ev } = await this.owned(req, id);
    await this.requireFlag(handle, id);
    let override: TicketDesignFields | null = null;
    if (design) {
      let parsed: unknown;
      try { parsed = JSON.parse(design); } catch { throw new BadRequestException({ error: 'invalid_design' }); }
      override = validateDesign(parsed);
    } else {
      override = (await loadTicketDesign(id))?.draft ?? {};
    }
    const brand = await this.brand.forEvent(ev, { force: true, design: override });
    const tiers: any[] = Array.isArray(ev.tiers) ? ev.tiers : [];
    // Sample guest = the handoff's PassBranded mockup values; event fields are real.
    const svg = ticketSVG({
      event: ev.name, dateLabel: ev.dateLabel, venue: ev.venue,
      guest: 'Amina Juma', ticketId: 'ZP-1107-0418', tier: tiers[0]?.name || 'General',
      seat: ev.seated ? 'Table T5 · Seat 3' : '', dressCode: ev.dressCode || '',
      qr: 'zorapass:preview',
    }, { brand });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  }
}
