/* BS168: the city list, from the `city` table (migration 0039).

   Events live in a JSON blob, so `event.city` can't join to the table. Every
   read and write instead goes through a small in-memory copy of the table,
   refreshed on a short TTL and right after an admin edit (same shape as the
   suspended-organizer set). Lookups are synchronous.

   canon(v) turns whatever an event carries (an id, a name, an old spelling, a
   merged city's id) into the current city id. An unknown value passes through
   unchanged: we never drop a city we don't recognise. */

import { cityKey, citySlug } from './city-key';
export { cityKey, citySlug };

import type { Sql } from './db';
import { db } from './db';

export type CityStatus = 'active' | 'hidden' | 'requested' | 'merged' | 'declined';
export const CITY_STATUSES: readonly CityStatus[] = ['active', 'hidden', 'requested', 'merged', 'declined'];

export interface City {
  id: string;
  name: string;
  country: string;
  currency: string;
  timezone: string;
  aliases: string[];
  status: CityStatus;
  sort: number;
  mergedInto: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
}

export const CITIES_TTL_MS = 30_000;
/** After a failed read, wait this long before asking the database again. */
export const CITIES_RETRY_MS = 5_000;

export function rowToCity(r: any): City {
  return {
    id: String(r.id),
    name: String(r.name),
    country: String(r.country ?? ''),
    currency: String(r.currency ?? 'TZS'),
    timezone: String(r.timezone ?? 'Africa/Dar_es_Salaam'),
    aliases: Array.isArray(r.aliases) ? r.aliases.map(String) : [],
    status: r.status as CityStatus,
    sort: Number(r.sort ?? 100),
    mergedInto: r.merged_into ?? null,
    requestedBy: r.requested_by ?? null,
    requestedAt: r.requested_at ? new Date(r.requested_at).toISOString() : null,
  };
}

export async function fetchCities(sql: Sql): Promise<City[]> {
  const rows = await sql`select * from city order by sort, name`;
  return (rows as any[]).map(rowToCity);
}

export class CityCache {
  private rows: City[] = [];
  private byId = new Map<string, City>();
  private byKey = new Map<string, string>();
  private loadedAt = 0;
  private failedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly fetcher: () => Promise<City[]>,
    private readonly ttlMs: number = CITIES_TTL_MS,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Replace the list (used by refresh, and by tests). */
  load(rows: City[]): void {
    this.rows = rows;
    this.byId = new Map(rows.map((c) => [c.id, c]));
    const byKey = new Map<string, string>();
    const put = (k: string, id: string) => {
      if (k && !byKey.has(k)) byKey.set(k, id); // an empty key (e.g. a non-Latin name) matches nothing
    };
    // Live cities (active, hidden, requested) are keyed before closed ones
    // (merged, declined), so a city added later under a declined or matched
    // city's name is the one that name finds. Within each group: ids, then
    // names, then other spellings.
    const closed = (c: City) => c.status === 'merged' || c.status === 'declined';
    for (const group of [rows.filter((c) => !closed(c)), rows.filter(closed)]) {
      for (const c of group) put(cityKey(c.id), c.id);
      for (const c of group) put(cityKey(c.name), c.id);
      for (const c of group) for (const a of c.aliases) put(cityKey(a), c.id);
    }
    this.byKey = byKey;
    this.loadedAt = this.clock();
  }

  /**
   * Reload from the database. Concurrent callers share one read. With
   * `force`, a read that started before this call is not trusted (it may
   * predate a write the caller just made): a fresh one runs after it.
   */
  async refresh(opts: { force?: boolean } = {}): Promise<void> {
    // Forced: let a read that started earlier finish, then share only a read
    // started after this call (or start one).
    if (opts.force && this.inflight) await this.inflight.catch(() => undefined);
    if (!this.inflight) {
      this.inflight = (async () => {
        try {
          this.load(await this.fetcher());
          this.failedAt = 0;
        } catch (e) {
          this.failedAt = this.clock();
          throw e;
        }
      })().finally(() => {
        this.inflight = null;
      });
    }
    await this.inflight;
  }

  /** Load when cold or stale. Fails open: on error the last list is kept, and
      a cold cache leaves city values as stored. */
  async ensureFresh(): Promise<void> {
    if (this.loadedAt !== 0 && this.clock() - this.loadedAt < this.ttlMs) return;
    // Don't hammer a failing database on every request.
    if (this.failedAt !== 0 && this.clock() - this.failedAt < CITIES_RETRY_MS) return;
    try {
      await this.refresh();
    } catch (e) {
      console.error('[cities] could not read the city table; keeping the last list', (e as Error)?.message);
    }
  }

  /** The current city id for a stored value. Follows merges. Unknown → unchanged. */
  canon<T>(v: T): T | string {
    if (v == null || v === '') return v;
    let id = this.byKey.get(cityKey(v));
    if (!id) return v;
    for (let hops = 0; hops < 5; hops++) {
      const c = this.byId.get(id);
      if (!c || c.status !== 'merged' || !c.mergedInto) break;
      id = c.mergedInto;
    }
    return id;
  }

  /** The city record for a stored value (after canon), or undefined. */
  get(v: unknown): City | undefined {
    const id = this.canon(v as any);
    return typeof id === 'string' ? this.byId.get(id) : undefined;
  }

  all(): City[] {
    return this.rows.slice();
  }

  /** Cities an organizer may pick for a new event. */
  active(): City[] {
    return this.rows.filter((c) => c.status === 'active');
  }

  loaded(): boolean {
    return this.loadedAt !== 0;
  }
}

let _singleton: CityCache | null = null;

export function cities(sql: Sql = db()): CityCache {
  if (!_singleton) _singleton = new CityCache(() => fetchCities(sql));
  return _singleton;
}

export function __resetCities(): void {
  _singleton = null;
}

/** Today's date (YYYY-MM-DD) in a time zone. Falls back to UTC on a bad zone. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** An event is upcoming unless its ISO date is before today in its city. No date → upcoming. */
export function isUpcoming(date: unknown, timezone: string, now: Date = new Date()): boolean {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(date ?? ''));
  if (!m) return true;
  return m[1] >= todayIn(timezone, now);
}

/* Each event carries its city's display name and currency, so no surface needs
   its own copy of the list. */
export function withCityFields<E extends { city?: unknown }>(e: E, cache: CityCache): E & { cityName?: string; cityCurrency?: string } {
  if (!e || e.city == null || e.city === '') return e;
  const id = cache.canon(e.city as any);
  const c = cache.get(id);
  return c ? { ...e, city: id, cityName: c.name, cityCurrency: c.currency } : { ...e, city: id };
}
