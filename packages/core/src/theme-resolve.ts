/* BS130 (plan F6 / A14): the ONE theme resolver.

   Share cards and passes both call this, so an organizer's colours never drift
   between surfaces. Layers, lowest to highest:

     1. defaults           — Zora pass defaults, or the caller's own defaults
     2. storefront theme   — the organizer's `theme` row (accent, bg, logo, …)
     3. event              — the event's cover artwork
     4. ticket design      — `ticket_design` overrides (PUBLISHED columns only,
                             unless the caller asks for the draft — the
                             organizer preview)

   A blank value at any layer falls through to the layer below. The ticket
   design can turn the storefront layer off (`inherit_storefront = false`).

   Text on the accent is picked automatically: bone or black, whichever reads
   at contrast ≥ 4.5:1 (WCAG AA); pure white/black only if neither does. */

import { db } from './db';

export const PASS_TEMPLATES = ['artwork_top', 'classic_black', 'full_colour'] as const;
export type PassTemplate = (typeof PASS_TEMPLATES)[number];

export const PASS_SHOW_FIELDS = ['guest_name', 'seat', 'pass_type', 'dress_code'] as const;
export type PassShowField = (typeof PASS_SHOW_FIELDS)[number];

/** ZoraPass design tokens (handoff 01_TOKENS): black surface, bone ink, yellow. */
export const ZP_BLACK = '#111111';
export const ZP_BONE = '#F7F5EE';
export const ZP_YELLOW = '#FFD21F';

export interface ThemeDefaults {
  brandName: string;
  accent: string;
  secondary: string;
  bg: string;
  card: string;
  typography: string;
  logoUrl: string;
}

/** Defaults for a pass when nobody has branded anything. */
export const ZORA_PASS_DEFAULTS: ThemeDefaults = {
  brandName: 'ZoraPass',
  accent: ZP_YELLOW,
  secondary: ZP_BONE,
  bg: ZP_BLACK,
  card: ZP_BLACK,
  typography: 'zorapass',
  logoUrl: '',
};

export interface StorefrontThemeLayer {
  brandName?: string | null;
  accent?: string | null;
  secondary?: string | null;
  bg?: string | null;
  card?: string | null;
  typography?: string | null;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  updatedAt?: string | null;
}

export interface EventThemeLayer {
  coverUrl?: string | null;
  updatedAt?: string | null;
}

export interface TicketDesignFields {
  template?: string | null;
  accent?: string | null;
  bgColor?: string | null;
  bgImage?: string | null;
  logoUrl?: string | null;
  organizerLogoUrl?: string | null;
  sponsorLogos?: string[] | null;
  showFields?: string[] | null;
  inheritStorefront?: boolean | null;
}

export interface TicketDesignLayer extends TicketDesignFields {
  updatedAt?: string | null;
}

export interface ResolvedTheme {
  brandName: string;
  accent: string;
  /** Readable text colour ON the accent (bone or black). */
  onAccent: string;
  /** The accent when it reads on the black pass surface, else bone. */
  accentOnBlack: string;
  secondary: string;
  bg: string;
  card: string;
  typography: string;
  /** Organizer logo (ticket design → storefront). */
  logoUrl: string;
  /** Event logo (ticket design only). */
  eventLogoUrl: string;
  bannerUrl: string;
  /** Header artwork: ticket design bg image → event cover. */
  artworkUrl: string;
  bgColor: string;
  template: PassTemplate;
  sponsorLogos: string[];
  showFields: PassShowField[];
  updatedAt: string;
}

/* ── colour maths ─────────────────────────────────────────────────────────── */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColour(v: unknown): v is string {
  return typeof v === 'string' && HEX.test(v.trim());
}

function rgb(hex: string): [number, number, number] {
  let h = hex.trim().slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours (1 … 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text colour for `bg`: bone or black, whichever passes 4.5:1 (best wins);
    pure white/black when neither of the brand inks reaches it. */
export function pickTextOn(bg: string): string {
  if (!isHexColour(bg)) return ZP_BONE;
  const black = contrastRatio(bg, ZP_BLACK);
  const bone = contrastRatio(bg, ZP_BONE);
  const best = black >= bone ? ZP_BLACK : ZP_BONE;
  if (Math.max(black, bone) >= 4.5) return best;
  return contrastRatio(bg, '#000000') >= contrastRatio(bg, '#FFFFFF') ? '#000000' : '#FFFFFF';
}

/* ── pure merge (unit-tested) ─────────────────────────────────────────────── */

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const colour = (v: unknown): string => (isHexColour(v) ? (v as string).trim() : '');
const first = (...vals: unknown[]): string => {
  for (const v of vals) { const s = str(v); if (s) return s; }
  return '';
};
const firstColour = (...vals: unknown[]): string => {
  for (const v of vals) { const s = colour(v); if (s) return s; }
  return '';
};

export function normaliseTemplate(v: unknown): PassTemplate {
  return (PASS_TEMPLATES as readonly string[]).includes(v as string) ? (v as PassTemplate) : 'artwork_top';
}

export function normaliseShowFields(v: unknown): PassShowField[] {
  if (!Array.isArray(v)) return ['guest_name', 'seat', 'pass_type'];
  return PASS_SHOW_FIELDS.filter((f) => v.includes(f));
}

export function mergeTheme(input: {
  defaults?: ThemeDefaults;
  storefront?: StorefrontThemeLayer | null;
  event?: EventThemeLayer | null;
  design?: TicketDesignLayer | null;
}): ResolvedTheme {
  const d = input.defaults || ZORA_PASS_DEFAULTS;
  const td = input.design || null;
  const sf = td && td.inheritStorefront === false ? null : input.storefront || null;
  const ev = input.event || null;

  // Storefront values pass through as stored (the storefront itself renders
  // them, so the share card must too); design-layer values are hex-validated.
  const accent = firstColour(td?.accent) || first(sf?.accent, d.accent) || ZORA_PASS_DEFAULTS.accent;
  const bg = first(sf?.bg, d.bg);
  const sponsors = Array.isArray(td?.sponsorLogos)
    ? td!.sponsorLogos!.filter((u) => typeof u === 'string' && u.trim()).slice(0, 4)
    : [];
  const stamps = [sf?.updatedAt, ev?.updatedAt, td?.updatedAt].map(str).filter(Boolean).sort();

  return {
    brandName: first(sf?.brandName, d.brandName),
    accent,
    onAccent: pickTextOn(accent),
    accentOnBlack: isHexColour(accent) && contrastRatio(accent, ZP_BLACK) >= 4.5 ? accent : ZP_BONE,
    secondary: first(sf?.secondary, d.secondary),
    bg,
    card: first(sf?.card, d.card),
    typography: first(sf?.typography, d.typography),
    logoUrl: first(td?.organizerLogoUrl, sf?.logoUrl, d.logoUrl),
    eventLogoUrl: first(td?.logoUrl),
    bannerUrl: first(sf?.bannerUrl),
    artworkUrl: first(td?.bgImage, ev?.coverUrl),
    bgColor: firstColour(td?.bgColor),
    template: normaliseTemplate(td?.template),
    sponsorLogos: sponsors,
    showFields: normaliseShowFields(td ? td.showFields : undefined),
    updatedAt: stamps.length ? stamps[stamps.length - 1] : '',
  };
}

/* ── DB loaders ───────────────────────────────────────────────────────────── */

const iso = (v: unknown): string => (v ? new Date(v as string).toISOString() : '');

/** The organizer's storefront row (the SAME read the storefront makes). */
export async function loadStorefrontTheme(organizerId: string | null | undefined): Promise<StorefrontThemeLayer | null> {
  if (!organizerId) return null;
  try {
    const rows = await db()<{
      brand_name: string | null; accent: string | null; secondary: string | null; bg: string | null;
      card: string | null; typography: string | null; logo_url: string | null; banner_url: string | null;
      updated_at: Date | null;
    }[]>`
      select brand_name, accent, secondary, bg, card, typography, logo_url, banner_url, updated_at
        from theme where organizer_id = ${organizerId}`;
    const r = rows[0];
    if (!r) return null;
    return {
      brandName: r.brand_name, accent: r.accent, secondary: r.secondary, bg: r.bg, card: r.card,
      typography: r.typography, logoUrl: r.logo_url, bannerUrl: r.banner_url, updatedAt: iso(r.updated_at),
    };
  } catch {
    return null;
  }
}

type DesignRow = {
  event_id: string; template: string | null; accent: string | null; bg_color: string | null;
  bg_image: string | null; logo_url: string | null; organizer_logo_url: string | null;
  sponsor_logos: unknown; show_fields: unknown; inherit_storefront: boolean | null;
  status: string; draft: unknown; updated_at: Date | null; published_at: Date | null;
};

export interface TicketDesignRecord {
  eventId: string;
  status: 'draft' | 'published';
  /** The live (published) columns, or null if never published. */
  published: TicketDesignFields | null;
  /** The working copy organizers edit (falls back to the published one). */
  draft: TicketDesignFields;
  updatedAt: string;
  publishedAt: string;
}

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function draftFields(v: unknown): TicketDesignFields | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return {
    template: (o.template as string) ?? null,
    accent: (o.accent as string) ?? null,
    bgColor: (o.bgColor as string) ?? null,
    bgImage: (o.bgImage as string) ?? null,
    logoUrl: (o.logoUrl as string) ?? null,
    organizerLogoUrl: (o.organizerLogoUrl as string) ?? null,
    sponsorLogos: strList(o.sponsorLogos),
    showFields: Array.isArray(o.showFields) ? strList(o.showFields) : null,
    inheritStorefront: o.inheritStorefront === false ? false : true,
  };
}

/** The event's ticket_design row (both the live columns and the draft). */
export async function loadTicketDesign(eventId: string | null | undefined): Promise<TicketDesignRecord | null> {
  if (!eventId) return null;
  try {
    const rows = await db()<DesignRow[]>`select * from ticket_design where event_id = ${eventId}`;
    const r = rows[0];
    if (!r) return null;
    const published: TicketDesignFields | null = r.published_at
      ? {
          template: r.template, accent: r.accent, bgColor: r.bg_color, bgImage: r.bg_image,
          logoUrl: r.logo_url, organizerLogoUrl: r.organizer_logo_url,
          sponsorLogos: strList(r.sponsor_logos),
          showFields: Array.isArray(r.show_fields) ? strList(r.show_fields) : null,
          inheritStorefront: r.inherit_storefront !== false,
        }
      : null;
    return {
      eventId: r.event_id,
      status: r.status === 'published' ? 'published' : 'draft',
      published,
      draft: draftFields(r.draft) || published || {},
      updatedAt: iso(r.updated_at),
      publishedAt: iso(r.published_at),
    };
  } catch {
    // table missing (pre-0030) or DB hiccup → no design layer.
    return null;
  }
}

/** Full resolution for one organizer (+ optional event). `useDraft` is the
    organizer preview; buyers only ever see the published columns. */
export async function resolveTheme(opts: {
  organizerId?: string | null;
  brandFallback?: string;
  defaults?: ThemeDefaults;
  event?: { id?: string | null; cover?: string | null; updatedAt?: string | null } | null;
  /** Apply ticket_design (false for share cards). */
  includeDesign?: boolean;
  useDraft?: boolean;
  /** Use this design instead of loading one (e.g. a draft not yet saved). */
  designOverride?: TicketDesignFields | null;
}): Promise<ResolvedTheme> {
  const defaults = { ...(opts.defaults || ZORA_PASS_DEFAULTS) };
  if (opts.brandFallback) defaults.brandName = opts.brandFallback;
  const storefront = await loadStorefrontTheme(opts.organizerId);
  let design: TicketDesignLayer | null = null;
  if (opts.designOverride) {
    design = opts.designOverride;
  } else if (opts.includeDesign && opts.event?.id) {
    const rec = await loadTicketDesign(opts.event.id);
    if (rec) design = opts.useDraft ? { ...rec.draft, updatedAt: rec.updatedAt } : rec.published ? { ...rec.published, updatedAt: rec.publishedAt } : null;
  }
  return mergeTheme({
    defaults,
    storefront,
    event: opts.event ? { coverUrl: opts.event.cover ?? null, updatedAt: opts.event.updatedAt ?? null } : null,
    design,
  });
}
