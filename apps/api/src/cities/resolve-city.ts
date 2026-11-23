import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { cities, cityKey } from '@zora/core';

/* BS168: kept apart from cities.module.ts so the org module can use it without
   a circular import (cities.module imports OrgModule). */

/**
 * The city an event may be saved with.
 *
 * - The value the event already has is always allowed, even when it matches
 *   no listed city (an old freetext city, a hidden or declined one), so editing
 *   the name or tiers never fails on the city. A known one is stored as its id.
 * - Otherwise: an active city, or a requested one (waiting for approval).
 * - On a miss the cache is refreshed once before refusing, so a city added or
 *   requested a moment ago on another API instance is found.
 * - If the city list can't be read at all: 503 cities_unavailable, never a
 *   city_invalid that blames the organizer.
 *
 * Callers handle a blank value themselves.
 */
export async function resolveEventCity(value: unknown, current?: unknown): Promise<string> {
  const cache = cities();
  const raw = String(value ?? '').trim();
  const key = cityKey(raw);
  // Same city as stored. A name that normalises to nothing (e.g. non-Latin
  // script) is compared as typed, so two different such names never match.
  const unchanged = current != null && String(current).trim() !== '' &&
    (key !== '' ? key === cityKey(current) : raw === String(current).trim());

  const look = () => cache.get(raw);
  let c = look();
  if (!c && !unchanged) {
    await cache.refresh().catch(() => undefined);
    c = look();
  }
  if (unchanged) return c ? c.id : String(current);
  if (!cache.loaded()) throw new ServiceUnavailableException({ error: 'cities_unavailable', message: 'Cities could not be loaded. Try again in a moment.' });
  if (c && (c.status === 'active' || c.status === 'requested')) return c.id;
  throw new BadRequestException({ error: 'city_invalid' });
}
