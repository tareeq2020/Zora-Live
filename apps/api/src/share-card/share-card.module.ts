import { Controller, Get, Module, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { db, suspendedHandles } from '@zora/core';
import { OrganizerRepo } from '../storage/organizer-repo';
import { DEFAULT_THEME, ROOT_DOMAIN } from '../common/defaults';

// Vendored, framework-agnostic renderer (SVG→PNG via the tickets @resvg path).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const card = require('../vendor/share-card');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const eventsApi = require('../vendor/events');

/* BS86 — the share-card route + og:image source (the virality KEYSTONE).

   GET /api/share-card/:handle.png            → the STORE card (brand-forward)
   GET /api/share-card/:handle/:eventId.png   → the DROP card (event cover + theme)
   GET /api/share-card/:handle[/:eventId]/meta → { v, going, path } for og:image

   Eng-review locks:
     R1 — composes a themed SVG + rasterizes with the tickets renderer; NO
          headless browser. Cover is fetched with a hard byte/timeout cap; any
          failure degrades to a branded fallback card (never a 500).
     R2 — the PNG carries `Cache-Control: public, s-maxage=…` keyed by ?v=<digest>
          of (theme-version · price · sold-bucket · event-version), so unfurl
          crawlers hit the CDN, not a fresh render.
     R3 — "{N} going" is inventory_pool.sold_count, thresholded (≥10) and
          coarse-bucketed into the digest so a single sale never re-renders.
     R4 — read-only + suspension-aware: a suspended org / unpublished event 404s
          exactly like its storefront (reuses isPublicEvent / the suspended set). */

const CACHE = 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800';
const NOCACHE = 'no-store';

type ThemeRow = {
  brand_name: string | null; accent: string | null; secondary: string | null;
  bg: string | null; card: string | null; logo_url: string | null; updated_at: Date | string | null;
};

@Controller('share-card')
export class ShareCardController {
  constructor(private readonly organizers: OrganizerRepo) {}

  // ── theme, read the SAME way the storefront reads it (never a write) ────────
  private async themeFor(handle: string, orgId: string, brandFallback: string) {
    try {
      const rows = await db()<ThemeRow[]>`
        select brand_name, accent, secondary, bg, card, logo_url, updated_at
          from theme where organizer_id = ${orgId}`;
      const r = rows[0];
      return {
        brandName: r?.brand_name || brandFallback || DEFAULT_THEME.brandName,
        accent: r?.accent || DEFAULT_THEME.accent,
        bg: r?.bg || DEFAULT_THEME.bg,
        card: r?.card || DEFAULT_THEME.card,
        logoUrl: r?.logo_url || '',
        updatedAt: r?.updated_at ? new Date(r.updated_at).toISOString() : '',
      };
    } catch {
      return {
        brandName: brandFallback || DEFAULT_THEME.brandName,
        accent: DEFAULT_THEME.accent, bg: DEFAULT_THEME.bg, card: DEFAULT_THEME.card,
        logoUrl: '', updatedAt: '',
      };
    }
  }

  // sold_count for one event (C2: inventory_pool.sold_count via product_tier map).
  private async soldForEvent(eventId: string): Promise<number> {
    try {
      const rows = await db()<{ sold: string | number }[]>`
        select coalesce(sum(ip.sold_count), 0) as sold
          from inventory_pool ip
          join product_tier pt on pt.id = ip.product_tier_id
         where pt.event_id = ${eventId}`;
      return Number(rows[0]?.sold ?? 0);
    } catch { return 0; }
  }

  // sold_count across all of an org's published events (the store card headline).
  private async soldForStore(handle: string): Promise<number> {
    try {
      const events = await eventsApi.listEvents();
      const ids = events.filter((e: any) => e && e.organizerHandle === handle).map((e: any) => e.id);
      if (!ids.length) return 0;
      const rows = await db()<{ sold: string | number }[]>`
        select coalesce(sum(ip.sold_count), 0) as sold
          from inventory_pool ip
          join product_tier pt on pt.id = ip.product_tier_id
         where pt.event_id = any(${ids})`;
      return Number(rows[0]?.sold ?? 0);
    } catch { return 0; }
  }

  private storeUrl(handle: string) { return `${ROOT_DOMAIN}/${handle}`; }
  private eventUrl(handle: string) { return `${ROOT_DOMAIN}/${handle}`; }

  private send(res: Response, png: Buffer, name: string) {
    res.type('image/png').set('Cache-Control', CACHE)
      .set('Content-Disposition', `inline; filename="${name}.png"`).send(png);
  }

  // ── STORE meta (og:image descriptor) ───────────────────────────────────────
  @Get(':handle/meta')
  async storeMeta(@Param('handle') handle: string, @Query('format') format: string, @Res() res: Response) {
    const org = await this.organizers.byHandle(handle);
    const suspended = suspendedHandles();
    await suspended.ensureFresh();
    if (!card.storeCardVisible(org, suspended)) {
      return res.status(404).set('Cache-Control', NOCACHE).json({ error: 'not_found' });
    }
    const theme = await this.themeFor(handle, org!.id, org!.name);
    const sold = await this.soldForStore(handle);
    const fmt = format === 'story' ? 'story' : 'og';
    const v = card.computeCardDigest({ format: fmt, theme, sold, title: theme.brandName });
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300').json({
      v, going: card.goingLabel(sold),
      path: `/api/share-card/${encodeURIComponent(handle)}.png?v=${v}${fmt === 'story' ? '&format=story' : ''}`,
    });
  }

  // ── STORE card PNG ──────────────────────────────────────────────────────────
  @Get(':handle.png')
  async storeCard(@Param('handle') handle: string, @Query('format') format: string, @Res() res: Response) {
    const org = await this.organizers.byHandle(handle);
    const suspended = suspendedHandles();
    await suspended.ensureFresh();
    if (!card.storeCardVisible(org, suspended)) {
      return res.status(404).set('Cache-Control', NOCACHE).json({ error: 'not_found' });
    }
    const theme = await this.themeFor(handle, org!.id, org!.name);
    const sold = await this.soldForStore(handle);
    const png = await card.shareCardPNG({
      format: format === 'story' ? 'story' : 'og',
      theme,
      title: theme.brandName,
      url: this.storeUrl(handle),
      going: card.goingLabel(sold),
      hype: 'Live events — get your passes',
    });
    this.send(res, png, `${handle}-store`);
  }

  // ── DROP (event) meta ───────────────────────────────────────────────────────
  @Get(':handle/:eventId/meta')
  async eventMeta(
    @Param('handle') handle: string,
    @Param('eventId') eventId: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    let ev: any;
    try { ev = await eventsApi.getEvent(eventId); } catch { ev = null; }
    // getEvent already applies isPublicEvent (unpublished / suspended → throws).
    if (!ev || ev.organizerHandle !== handle) {
      return res.status(404).set('Cache-Control', NOCACHE).json({ error: 'not_found' });
    }
    const org = await this.organizers.byHandle(handle);
    const theme = org ? await this.themeFor(handle, org.id, org.name) : DEFAULT_THEME;
    const sold = await this.soldForEvent(eventId);
    const fmt = format === 'story' ? 'story' : 'og';
    const v = card.computeCardDigest({
      format: fmt, theme, sold, title: ev.name,
      priceFrom: ev.priceFrom, eventUpdatedAt: ev.updated_at || '',
    });
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300').json({
      v, going: card.goingLabel(sold),
      path: `/api/share-card/${encodeURIComponent(handle)}/${encodeURIComponent(eventId)}.png?v=${v}${fmt === 'story' ? '&format=story' : ''}`,
    });
  }

  // ── DROP (event) card PNG ────────────────────────────────────────────────────
  @Get(':handle/:eventId.png')
  async eventCard(
    @Param('handle') handle: string,
    @Param('eventId') eventId: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    let ev: any;
    try { ev = await eventsApi.getEvent(eventId); } catch { ev = null; }
    if (!ev || ev.organizerHandle !== handle) {
      return res.status(404).set('Cache-Control', NOCACHE).json({ error: 'not_found' });
    }
    const org = await this.organizers.byHandle(handle);
    const theme = org ? await this.themeFor(handle, org.id, org.name) : DEFAULT_THEME;
    const sold = await this.soldForEvent(eventId);
    const cover = await card.fetchCover(ev.cover);
    const png = await card.shareCardPNG({
      format: format === 'story' ? 'story' : 'og',
      theme,
      title: ev.name,
      city: ev.city,
      dateLabel: ev.dateLabel,
      url: this.eventUrl(handle),
      coverDataUri: cover,
      going: card.goingLabel(sold),
      hype: 'It’s live — get your passes',
    });
    this.send(res, png, `${handle}-${eventId}`);
  }
}

@Module({ controllers: [ShareCardController] })
export class ShareCardModule {}
