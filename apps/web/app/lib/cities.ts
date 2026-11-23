/* BS168: cities come from the API (the `city` table), not from a list in code.

   GET /api/cities        cities with upcoming events, busiest first
   GET /api/cities/:id    one city page
   (The organizer picker uses GET /api/org/cities.)
   Events also carry `cityName` and `cityCurrency`, so cards never look a city up. */

import { cityKey } from '@zora/core/city-key';
export { cityKey };

export type PublicCity = { id: string; name: string; country: string; currency: string; timezone?: string; upcoming: number };

/** Where Vercel thinks the visitor is (x-vercel-ip-city / -country). Both optional. */
export type Geo = { city?: string | null; country?: string | null };

export const CITY_STORAGE_KEY = 'zp.discover.city';

/** "TZ" → "Tanzania" (the country name we store), via the browser/Node's own region names. */
export function countryName(code: string | null | undefined): string {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(c) || '';
  } catch {
    return '';
  }
}

function sameCountry(stored: string, geoName: string): boolean {
  const a = cityKey(stored);
  const b = cityKey(geoName);
  return !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a));
}

/**
 * The city Discover opens on, from cities that have events (busiest first):
 *   1. the city the buyer picked last time on this browser,
 *   2. the visitor's own city,
 *   3. the busiest city in the visitor's country,
 *   4. the busiest city.
 * Returns null when no city has events.
 */
export function pickStartCity(menu: PublicCity[], geo: Geo | undefined, stored: string | null): string | null {
  if (!menu.length) return null;
  if (stored && menu.some((c) => c.id === stored)) return stored;
  const gc = cityKey(geo?.city);
  if (gc) {
    const hit = menu.find((c) => cityKey(c.name) === gc || cityKey(c.id) === gc);
    if (hit) return hit.id;
  }
  const gn = countryName(geo?.country);
  if (gn) {
    const hit = menu.find((c) => sameCountry(c.country, gn));
    if (hit) return hit.id;
  }
  return menu[0].id;
}

/** The visitor's location, copied from Vercel's headers into a cookie by middleware.ts. */
export function readGeoCookie(): Geo | undefined {
  try {
    const m = /(?:^|;\s*)zp_geo=([^;]*)/.exec(document.cookie);
    if (!m) return undefined;
    const v = JSON.parse(decodeURIComponent(m[1])) as Geo;
    return { city: typeof v?.city === 'string' ? v.city : null, country: typeof v?.country === 'string' ? v.country : null };
  } catch {
    return undefined;
  }
}

export function readStoredCity(): string | null {
  try {
    return window.localStorage.getItem(CITY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeCity(id: string): void {
  try {
    window.localStorage.setItem(CITY_STORAGE_KEY, id);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
}

/** Build the menu from loaded events when /api/cities can't be read. */
export function menuFromEvents(events: { city: string; cityName: string; cityCur: string }[]): PublicCity[] {
  const by = new Map<string, PublicCity>();
  for (const e of events) {
    if (!e.city) continue;
    const c = by.get(e.city) ?? { id: e.city, name: e.cityName || e.city, country: '', currency: e.cityCur || '', upcoming: 0 };
    c.upcoming++;
    by.set(e.city, c);
  }
  return [...by.values()].sort((a, b) => b.upcoming - a.upcoming || a.name.localeCompare(b.name));
}
