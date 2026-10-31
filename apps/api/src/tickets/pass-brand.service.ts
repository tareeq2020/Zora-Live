import { Injectable } from '@nestjs/common';
import { isFlagOn, resolveTheme, type ResolvedTheme, type TicketDesignFields } from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { OrganizerRepo } from '../storage/organizer-repo';
import { DEFAULT_SETTINGS } from '../common/defaults';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fetchCover } = require('../vendor/share-card');

/* BS130 (F6): everything the branded pass renderer needs for one event.

   Gate: flag `zp_pass_design` for (organizer handle, event id). Flag off →
   `null`, and callers render the classic pass exactly as before.

   Images are fetched once (hard byte/time cap, png/jpeg/gif only — the
   share-card fetcher) and embedded as data: URIs, because an SVG shown through
   <img> may not load external resources. A small in-process cache keeps a busy
   pass page from refetching the same logo on every render. */

export type PassBrand = {
  template: string;
  accent: string;
  onAccent: string;
  accentOnBlack: string;
  bgColor: string;
  brandName: string;
  logoUrl: string;
  showFields: string[];
  artworkDataUri: string | null;
  logoDataUri: string | null;
  eventLogoDataUri: string | null;
  sponsorDataUris: string[];
  theme: ResolvedTheme;
};

const IMG_TTL_MS = 10 * 60 * 1000;
const IMG_MAX = 200;

@Injectable()
export class PassBrandService {
  private imgCache = new Map<string, { at: number; uri: string | null }>();

  constructor(private readonly entities: EntityStore, private readonly organizers: OrganizerRepo) {}

  async flagOn(orgHandle: string | null | undefined, eventId: string | null | undefined): Promise<boolean> {
    try {
      const settings = await this.entities.read<Record<string, unknown>>('settings', DEFAULT_SETTINGS);
      return isFlagOn(settings?.flags, 'zp_pass_design', { org: orgHandle || null, event: eventId || null });
    } catch {
      return false;
    }
  }

  async image(url: string | null | undefined): Promise<string | null> {
    if (!url) return null;
    if (/^data:image\/(png|jpe?g|gif);base64,/i.test(url)) return url;
    const hit = this.imgCache.get(url);
    if (hit && Date.now() - hit.at < IMG_TTL_MS) return hit.uri;
    const uri: string | null = await fetchCover(url, { maxBytes: 1_500_000, timeoutMs: 2000 }).catch(() => null);
    if (this.imgCache.size >= IMG_MAX) this.imgCache.delete(this.imgCache.keys().next().value as string);
    this.imgCache.set(url, { at: Date.now(), uri });
    return uri;
  }

  /** Resolve the brand for an event (the events-blob object). `force` skips the
      flag (organizer preview); `useDraft` / `design` select the draft layer. */
  async forEvent(
    ev: Record<string, any> | null | undefined,
    opts: { force?: boolean; useDraft?: boolean; design?: TicketDesignFields | null; images?: boolean } = {},
  ): Promise<PassBrand | null> {
    if (!ev || !ev.id) return null;
    const handle: string | null = ev.organizerHandle || null;
    if (!opts.force && !(await this.flagOn(handle, ev.id))) return null;
    const org = handle ? await this.organizers.byHandle(handle).catch(() => null) : null;
    const theme = await resolveTheme({
      organizerId: org?.id ?? null,
      brandFallback: org?.name || '',
      event: { id: ev.id, cover: ev.cover ?? null, updatedAt: ev.updated_at ?? null },
      includeDesign: true,
      useDraft: !!opts.useDraft,
      designOverride: opts.design ?? null,
    });
    const images = opts.images !== false;
    const [artworkDataUri, logoDataUri, eventLogoDataUri, ...sponsorDataUris] = images
      ? await Promise.all([
          this.image(theme.artworkUrl),
          this.image(theme.logoUrl),
          this.image(theme.eventLogoUrl),
          ...theme.sponsorLogos.map((u) => this.image(u)),
        ])
      : [null, null, null];
    return {
      template: theme.template,
      accent: theme.accent,
      onAccent: theme.onAccent,
      accentOnBlack: theme.accentOnBlack,
      bgColor: theme.bgColor,
      brandName: theme.brandName,
      logoUrl: theme.logoUrl,
      showFields: theme.showFields,
      artworkDataUri,
      logoDataUri,
      eventLogoDataUri,
      sponsorDataUris: sponsorDataUris.filter((x): x is string => !!x),
      theme,
    };
  }

  /** The events-blob object for an id. */
  async event(eventId: string | null | undefined): Promise<Record<string, any> | undefined> {
    if (!eventId) return undefined;
    const events = await this.entities.read<any[]>('events', []);
    return Array.isArray(events) ? events.find((e) => e && e.id === eventId) : undefined;
  }
}
