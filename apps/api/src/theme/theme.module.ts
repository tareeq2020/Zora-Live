import { Body, Controller, Get, Module, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { db } from '@zora/core';
import { OrganizerGuard } from '../common/organizer.guard';
import { OrganizerRepo } from '../storage/organizer-repo';
import { DEFAULT_THEME } from '../common/defaults';

type ThemeRow = {
  brand_name: string | null;
  accent: string | null;
  secondary: string | null;
  bg: string | null;
  card: string | null;
  typography: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  banner_url: string | null;
};

function toApi(handle: string, brandNameFallback: string, row?: ThemeRow) {
  return {
    handle,
    brandName: row?.brand_name || brandNameFallback,
    accent: row?.accent || DEFAULT_THEME.accent,
    secondary: row?.secondary || DEFAULT_THEME.secondary,
    bg: row?.bg || DEFAULT_THEME.bg,
    card: row?.card || DEFAULT_THEME.card,
    typography: row?.typography || DEFAULT_THEME.typography,
    logoUrl: row?.logo_url || '',
    faviconUrl: row?.favicon_url || '',
    bannerUrl: row?.banner_url || '',
  };
}

/* BS47: theme moved off the global collection_store singleton — every
   organizer's storefront read AND wrote the exact same row (name='theme'),
   so whichever organizer last saved via Studio silently painted every other
   organizer's storefront. Now keyed by organizer_id in the `theme` table,
   which has existed since 0001_init.sql but was never actually used (the same
   shape of gap organizer.ts closed for organizers in BS35).

   GET is public (storefronts are public pages) and requires ?handle= — no
   handle falls back to the platform default rather than 404ing, so an
   unrecognized/absent handle degrades to generic branding instead of an error.
   PUT requires the organizer's own session (previously unguarded entirely —
   "gated to the owning organizer in production" was still a TODO) and always
   writes to the CALLER'S OWN row; a `handle` field in the body is accepted but
   never used to pick which row is written, so a client can no longer target
   another organizer's branding by sending a different handle. */
@Controller()
export class ThemeController {
  constructor(private readonly organizers: OrganizerRepo) {}

  @Get('storefront-theme')
  async get(@Query('handle') handle?: string) {
    if (!handle) return DEFAULT_THEME;
    const org = await this.organizers.byHandle(handle);
    if (!org) return { ...DEFAULT_THEME, handle };
    const rows = await db()<ThemeRow[]>`
      select brand_name, accent, secondary, bg, card, typography, logo_url, favicon_url, banner_url
        from theme where organizer_id = ${org.id}`;
    return toApi(handle, org.name, rows[0]);
  }

  @Put('storefront-theme')
  @UseGuards(OrganizerGuard)
  async put(@Body() body: any, @Req() req: Request) {
    const handle = req.actingHandle as string;
    const org = await this.organizers.byHandle(handle);
    if (!org) return { ok: false, error: 'organizer_not_found' };
    const b = body || {};
    await db()`
      insert into theme (organizer_id, brand_name, accent, secondary, bg, card, typography, logo_url, favicon_url, banner_url, updated_at)
      values (${org.id}, ${b.brandName ?? null}, ${b.accent ?? null}, ${b.secondary ?? null}, ${b.bg ?? null},
              ${b.card ?? null}, ${b.typography ?? null}, ${b.logoUrl ?? null}, ${b.faviconUrl ?? null}, ${b.bannerUrl ?? null}, now())
      on conflict (organizer_id) do update set
        brand_name = excluded.brand_name, accent = excluded.accent, secondary = excluded.secondary,
        bg = excluded.bg, card = excluded.card, typography = excluded.typography,
        logo_url = excluded.logo_url, favicon_url = excluded.favicon_url, banner_url = excluded.banner_url,
        updated_at = now()`;
    const rows = await db()<ThemeRow[]>`
      select brand_name, accent, secondary, bg, card, typography, logo_url, favicon_url, banner_url
        from theme where organizer_id = ${org.id}`;
    return { ok: true, theme: toApi(handle, org.name, rows[0]) };
  }
}

@Module({ controllers: [ThemeController] })
export class ThemeModule {}
