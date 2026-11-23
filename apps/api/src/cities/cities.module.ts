import {
  BadRequestException, Body, Controller, Get, HttpException, Module, NotFoundException, Param, Post, Put, Query, Req, Res, ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { db, tx, cities, cityKey, citySlug, rowToCity, isUpcoming, CityCache, fetchCities, type City, type Sql } from '@zora/core';
import { SessionGuard } from '../common/session.guard';
import { OrganizerGuard } from '../common/organizer.guard';
import { Roles } from '../common/roles.guard';
import { AuditService } from '../audit/audit.module';
import { OrgModule } from '../org/org.module';
import { OrgScopeService } from '../org/org-scope.service';
import { EventProvisioningService } from '../org/event-provisioning.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const eventsApi = require('../vendor/events');

/* BS168: cities, from the `city` table (migration 0039).

   GET  /api/cities              cities buyers can browse: active or hidden, with
                                 upcoming events, busiest first. ?all=1 adds active
                                 cities with none (tests and tools).
   GET  /api/cities/:id          one city page's city: active, or hidden with
                                 upcoming events; a merged id answers with `redirect`.
   Requested cities stay off both until an admin approves them; their events
   are still on sale, by link, search and the organizer's storefront.
   GET  /api/org/cities          the organizer picker: active cities, the org's
                                 own requests, its last city and past venues.
   POST /api/org/cities/request  { name, country? } ask for a city that isn't listed.
   GET  /api/admin/cities        every city with event counts (super admin).
   POST /api/admin/cities        add a city.
   PUT  /api/admin/cities/:id    edit name, country, currency, time zone,
                                 spellings, order, active/hidden.
   POST /api/admin/cities/:id/approve   a requested city goes live.
   POST /api/admin/cities/:id/merge     { into } move its events to another city.
   POST /api/admin/cities/:id/decline   refuse a request (only while no event uses it).
   Every admin write is audited and refreshes the city cache at once. */

const MAX_OPEN_REQUESTS_PER_ORG = 3;
const TZ_RE = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2}$/;

type PublicCity = Pick<City, 'id' | 'name' | 'country' | 'currency' | 'timezone'> & { upcoming: number };

function publicCity(c: City, upcoming: number): PublicCity {
  return { id: c.id, name: c.name, country: c.country, currency: c.currency, timezone: c.timezone, upcoming };
}

/* Upcoming public events per city id. Every Discover view asks for this, and
   it reads the whole events blob, so the result is kept per process for a
   short while and dropped on any admin city write. */
const COUNTS_TTL_MS = 30_000;
let countsMemo: { at: number; value: Map<string, number> } | null = null;

async function upcomingCounts(): Promise<Map<string, number>> {
  if (countsMemo && Date.now() - countsMemo.at < COUNTS_TTL_MS) return countsMemo.value;
  const cache = cities();
  await cache.ensureFresh();
  const cold = !cache.loaded();
  const events: any[] = await eventsApi.listEvents();
  const out = new Map<string, number>();
  for (const e of events) {
    const c = cache.get(e?.city);
    if (!c) continue;
    if (!isUpcoming(e.date, c.timezone)) continue;
    out.set(c.id, (out.get(c.id) ?? 0) + 1);
  }
  if (!cold) countsMemo = { at: Date.now(), value: out }; // never keep counts built without the city list
  return out;
}

/** Cities buyers can browse: active, or hidden with upcoming events (hiding stops new events, not existing ones). */
function browsable(c: City, upcoming: number): boolean {
  return c.status === 'active' || (c.status === 'hidden' && upcoming > 0);
}

/** 503 rather than an empty list or a 404 when the city table can't be read. */
function assertLoaded() {
  if (!cities().loaded()) throw new ServiceUnavailableException({ error: 'cities_unavailable' });
}

/** Busiest first, then the admin's order, then name. */
function byBusiest(a: PublicCity & { sort?: number }, b: PublicCity & { sort?: number }) {
  return b.upcoming - a.upcoming || (a.sort ?? 100) - (b.sort ?? 100) || a.name.localeCompare(b.name);
}

function sanitizeName(v: unknown): string {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  // Letters required; no markup characters, no invisible format characters (bidi overrides, zero-width).
  if (s.length < 2 || s.length > 60 || !/\p{L}/u.test(s) || /[<>{}]/.test(s) || /\p{Cf}/u.test(s) || !cityKey(s)) {
    throw new BadRequestException({ error: 'name_invalid' });
  }
  return s;
}
function sanitizeCountry(v: unknown): string {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length > 60 || /[<>{}]/.test(s) || /\p{Cf}/u.test(s)) throw new BadRequestException({ error: 'country_invalid' });
  return s;
}
function sanitizeAliases(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : String(v ?? '').split(',');
  const out = new Set<string>();
  for (const a of raw) {
    const k = cityKey(a);
    if (k && k.length <= 60) out.add(k);
  }
  return [...out].slice(0, 20);
}

async function uniqueId(name: string, sql: Sql = db()): Promise<string> {
  const base = citySlug(name);
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(base)) throw new BadRequestException({ error: 'name_invalid' });
  for (let n = 1; n < 50; n++) {
    const id = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
    const [hit] = await sql`select 1 from city where id = ${id}`;
    if (!hit) return id;
  }
  throw new BadRequestException({ error: 'name_invalid' });
}

async function refreshCities() {
  countsMemo = null;
  await cities().refresh({ force: true }).catch((e) => console.error('city cache refresh failed', (e as Error)?.message));
}

// ── Public ──────────────────────────────────────────────────────────────────
@Controller('cities')
export class CitiesController {
  @Get()
  async list(@Query('all') all: string, @Res() res: Response) {
    try {
      const counts = await upcomingCounts();
      if (!cities().loaded()) return res.status(503).json({ error: 'cities_unavailable' });
      const rows = cities().all()
        .map((c) => ({ c, upcoming: counts.get(c.id) ?? 0 }))
        .filter(({ c, upcoming }) => browsable(c, upcoming) && (upcoming > 0 || (all === '1' && c.status === 'active')))
        .map(({ c, upcoming }) => ({ ...publicCity(c, upcoming), sort: c.sort }))
        .sort(byBusiest)
        .map(({ sort, ...c }) => c); // eslint-disable-line @typescript-eslint/no-unused-vars
      res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
      res.json({ cities: rows });
    } catch (e: any) {
      res.status(503).json({ error: e?.message || 'cities_unavailable' });
    }
  }

  @Get(':id')
  async one(@Param('id') id: string, @Res() res: Response) {
    const cache = cities();
    await cache.ensureFresh();
    if (!cache.loaded()) return res.status(503).json({ error: 'cities_unavailable' });
    const raw = String(id || '').toLowerCase();
    const c = cache.get(raw);
    const counts = await upcomingCounts();
    if (!c || !browsable(c, counts.get(c.id) ?? 0)) return res.status(404).json({ error: 'city_not_found' });
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    res.json({ city: publicCity(c, counts.get(c.id) ?? 0), ...(c.id !== raw ? { redirect: c.id } : {}) });
  }
}

// ── Organizer ───────────────────────────────────────────────────────────────
@Roles('owner', 'admin')
@UseGuards(OrganizerGuard)
@Controller('org/cities')
export class OrgCitiesController {
  constructor(private readonly scope: OrgScopeService, private readonly audit: AuditService) {}

  @Get()
  async list(@Req() req: Request) {
    const handle = req.actingHandle as string;
    const cache = cities();
    await cache.ensureFresh();
    const owned = new Set(await this.scope.ownedEventIds(handle));
    const mine = (await this.scope.readEvents()).filter((e) => e && owned.has(e.id));

    // Last city = the city of the event touched most recently.
    const stamp = (e: any) => String(e.updated_at || e.createdAt || e.created_at || e.date || '');
    const recent = mine.filter((e) => e.city).sort((a, b) => stamp(b).localeCompare(stamp(a)));
    const lastCityId = recent.length ? cache.canon(recent[0].city) : null;
    const last = lastCityId ? cache.get(lastCityId) : undefined;

    // Past venues, per city, most used first.
    const venues = new Map<string, { venue: string; city: string | null; uses: number; last: string }>();
    for (const e of mine) {
      const venue = String(e.venue ?? '').replace(/\s+/g, ' ').trim();
      if (!venue) continue;
      const city = e.city ? String(cache.canon(e.city)) : null;
      const key = `${city}|${venue.toLowerCase()}`;
      const v = venues.get(key) ?? { venue, city, uses: 0, last: '' };
      v.uses++;
      if (stamp(e) > v.last) v.last = stamp(e);
      venues.set(key, v);
    }

    const requested = cache.all().filter((c) => c.status === 'requested' && c.requestedBy === handle);
    return {
      cities: cache.active().map((c) => ({ id: c.id, name: c.name, country: c.country, currency: c.currency, aliases: c.aliases, status: c.status })),
      requested: requested.map((c) => ({ id: c.id, name: c.name, country: c.country, currency: c.currency, aliases: c.aliases, status: c.status })),
      lastCity: last && (last.status === 'active' || last.status === 'requested') ? last.id : null,
      venues: [...venues.values()]
        .sort((a, b) => b.uses - a.uses || b.last.localeCompare(a.last))
        .slice(0, 30)
        .map(({ venue, city, uses }) => ({ venue, city, uses })),
    };
  }

  @Post('request')
  async request(@Req() req: Request, @Body() body: any) {
    const handle = req.actingHandle as string;
    const name = sanitizeName(body?.name);
    const country = sanitizeCountry(body?.country);
    // One request at a time (a global lock: requests are rare), so the
    // open-request cap and the same-name check can't be raced.
    const out = await tx(async (t) => {
      await t`select pg_advisory_xact_lock(hashtext('zora:city-request'))`;
      // Read the city list on this transaction's own connection: a second pool
      // connection here could deadlock the pool while others wait on the lock.
      const cache = new CityCache(async () => []);
      cache.load(await fetchCities(t));

      const existing = cache.get(name);
      if (existing) {
        if (existing.status === 'active' || existing.status === 'requested') return { city: existing, matched: true };
        if (existing.status === 'hidden') throw new HttpException({ error: 'city_unavailable', message: `ZoraPass isn't taking new events in ${existing.name} right now.` }, 409);
        if (existing.status === 'declined') throw new HttpException({ error: 'city_declined', message: `${existing.name} was looked at and isn't available. Pick the nearest listed city.` }, 409);
      }

      const [{ n }] = await t`select count(*)::int as n from city where status = 'requested' and requested_by = ${handle}`;
      if (n >= MAX_OPEN_REQUESTS_PER_ORG) {
        throw new HttpException({ error: 'too_many_requests', message: 'You already have cities waiting for approval. We\'ll review those first.' }, 429);
      }

      const id = await uniqueId(name, t);
      const [row] = await t`
        insert into city (id, name, country, status, sort, requested_by, requested_at)
        values (${id}, ${name}, ${country}, 'requested', 100, ${handle}, now())
        returning *`;
      return { city: rowToCity(row), matched: false };
    });
    if (out.matched) return { city: shapeOrg(out.city), matched: true };
    const id = out.city.id;
    await refreshCities();
    await this.audit.record('org.city.request', `${handle} asked for ${name}${country ? `, ${country}` : ''} (${id})`, req.ip, handle)
      .catch((e) => console.error('audit write failed', (e as Error)?.message));
    return { city: shapeOrg(out.city), matched: false };
  }
}

function shapeOrg(c: City) {
  return { id: c.id, name: c.name, country: c.country, currency: c.currency, aliases: c.aliases, status: c.status };
}

// ── Admin ───────────────────────────────────────────────────────────────────
@Roles('super_admin')
@UseGuards(SessionGuard)
@Controller('admin/cities')
export class AdminCitiesController {
  constructor(
    private readonly scope: OrgScopeService,
    private readonly prov: EventProvisioningService,
    private readonly audit: AuditService,
  ) {}

  private actor(req: Request) {
    const s: any = req.session || {};
    return String(s.userId || 'admin');
  }
  private async log(req: Request, action: string, detail: string) {
    const who = this.actor(req);
    await this.audit.record(action, `${who} ${detail}`, req.ip, who).catch((e) => console.error('audit write failed', (e as Error)?.message));
  }

  @Get()
  async list() {
    const cache = cities();
    await cache.refresh();
    const upcoming = await upcomingCounts();
    const events = await this.scope.readEvents();
    const total = new Map<string, number>();
    for (const e of events) {
      if (!e?.city) continue;
      const id = String(cache.canon(e.city));
      total.set(id, (total.get(id) ?? 0) + 1);
    }
    const ORDER: Record<string, number> = { requested: 0, active: 1, hidden: 2, merged: 3, declined: 4 };
    const rows = cache.all()
      .map((c) => ({ ...c, events: total.get(c.id) ?? 0, upcoming: upcoming.get(c.id) ?? 0 }))
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.sort - b.sort || a.name.localeCompare(b.name));
    // Stored values that match no city (old freetext) so they can be fixed.
    const unknown = [...total.entries()].filter(([id]) => !cache.get(id)).map(([value, n]) => ({ value, events: n }));
    return { cities: rows, unknown };
  }

  @Post()
  async create(@Req() req: Request, @Body() body: any) {
    const name = sanitizeName(body?.name);
    const fields = this.editable(body);
    await this.assertNoClash(null, name, fields.aliases ?? []);
    const id = body?.id ? String(body.id).trim().toLowerCase() : await uniqueId(name);
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) throw new BadRequestException({ error: 'id_invalid' });
    const [hit] = await db()`select 1 from city where id = ${id}`;
    if (hit) throw new HttpException({ error: 'city_exists', message: `The id ${id} is taken.` }, 409);
    const [row] = await db()`
      insert into city (id, name, country, currency, timezone, aliases, status, sort)
      values (${id}, ${name}, ${fields.country ?? ''}, ${fields.currency ?? 'TZS'}, ${fields.timezone ?? 'Africa/Dar_es_Salaam'},
              ${fields.aliases ?? []}, ${fields.status ?? 'active'}, ${fields.sort ?? 100})
      returning *`;
    await refreshCities();
    await this.log(req, 'admin.city.create', `added ${name} (${id})`);
    return { city: rowToCity(row) };
  }

  @Put(':id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    const cur = await this.load(id);
    if (cur.status === 'merged' || cur.status === 'declined') throw new HttpException({ error: 'city_closed' }, 409);
    const f = this.editable(body);
    const name = body?.name !== undefined ? sanitizeName(body.name) : cur.name;
    if (f.status && cur.status === 'requested') throw new HttpException({ error: 'use_approve' }, 409);
    await this.assertNoClash(cur.id, name, f.aliases ?? cur.aliases);
    const [row] = await db()`
      update city set
        name = ${name},
        country = ${f.country ?? cur.country},
        currency = ${f.currency ?? cur.currency},
        timezone = ${f.timezone ?? cur.timezone},
        aliases = ${f.aliases ?? cur.aliases},
        sort = ${f.sort ?? cur.sort},
        status = ${f.status ?? cur.status},
        updated_at = now()
      where id = ${cur.id}
      returning *`;
    await refreshCities();
    await this.log(req, 'admin.city.update', `edited ${cur.id}: ${JSON.stringify({ name, ...f })}`);
    return { city: rowToCity(row) };
  }

  @Post(':id/approve')
  async approve(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    const cur = await this.load(id);
    if (cur.status !== 'requested') throw new HttpException({ error: 'not_requested' }, 409);
    const f = this.editable(body);
    const name = body?.name !== undefined ? sanitizeName(body.name) : cur.name;
    await this.assertNoClash(cur.id, name, f.aliases ?? cur.aliases);
    const [row] = await db()`
      update city set name = ${name}, country = ${f.country ?? cur.country}, currency = ${f.currency ?? cur.currency},
             timezone = ${f.timezone ?? cur.timezone}, aliases = ${f.aliases ?? cur.aliases}, sort = ${f.sort ?? cur.sort},
             status = 'active', updated_at = now()
       where id = ${cur.id} and status = 'requested'
      returning *`;
    if (!row) throw new HttpException({ error: 'not_requested' }, 409);
    await refreshCities();
    await this.log(req, 'admin.city.approve', `approved ${name} (${cur.id}), asked for by ${cur.requestedBy ?? 'unknown'}`);
    return { city: rowToCity(row) };
  }

  @Post(':id/merge')
  async merge(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    const cur = await this.load(id);
    const into = await this.load(String(body?.into ?? ''));
    if (cur.id === into.id) throw new BadRequestException({ error: 'same_city' });
    if (into.status !== 'active') throw new HttpException({ error: 'target_not_active' }, 409);
    if (cur.status === 'merged') throw new HttpException({ error: 'city_closed' }, 409);

    const cache = cities();
    await cache.refresh({ force: true });
    // An event belongs to `cur` if it resolves there: its id, name, another
    // spelling, or a city earlier merged into it.
    const belongs = (v: unknown) => v != null && v !== '' && (cache.canon(v as any) === cur.id || cityKey(v) === cityKey(cur.name));

    const result = await tx(async (t) => {
      const [target] = await t`select * from city where id = ${into.id} for update`;
      if (!target || target.status !== 'active') throw new HttpException({ error: 'target_not_active' }, 409);
      const intoNow = rowToCity(target);
      const rows = await this.prov.readEventsForUpdate(t);
      // One mega event per city: if the target already has one, the moved events lose theirs.
      const targetHasMega = rows.some((e: any) => e && e.mega && cache.canon(e.city) === intoNow.id);
      const moved: { id: string; from: string }[] = [];
      const next = rows.map((e: any) => {
        if (!e || !belongs(e.city)) return e;
        moved.push({ id: String(e.id), from: String(e.city) });
        return { ...e, city: intoNow.id, ...(targetHasMega && e.mega ? { mega: false } : {}) };
      });
      if (moved.length) await this.prov.writeEventsOnTx(t, next);
      // The old name becomes a spelling of the target, so typing it still finds it.
      const extra = [cityKey(cur.name), ...cur.aliases].filter((a) => a && !intoNow.aliases.includes(a) && a !== cityKey(intoNow.name));
      if (extra.length) await t`update city set aliases = ${[...intoNow.aliases, ...extra].slice(0, 20)}, updated_at = now() where id = ${intoNow.id}`;
      await t`update city set status = 'merged', merged_into = ${intoNow.id}, updated_at = now() where id = ${cur.id}`;
      return moved;
    });
    await refreshCities();
    // The moved events and their old values, so a mistaken match can be undone by hand.
    const list = result.slice(0, 50).map((m) => `${m.id}:${m.from}`).join(', ');
    await this.log(req, 'admin.city.merge', `matched ${cur.name} (${cur.id}) to ${into.name} (${into.id}); moved ${result.length} event(s)${list ? ` [${list}${result.length > 50 ? ', …' : ''}]` : ''}`);
    const moved = result.length;
    return { moved, into: into.id };
  }

  @Post(':id/decline')
  async decline(@Req() req: Request, @Param('id') id: string) {
    const cur = await this.load(id);
    if (cur.status !== 'requested') throw new HttpException({ error: 'not_requested' }, 409);
    // Events already in this city would be stranded: match it to a listed city instead.
    const cache = cities();
    const using = (await this.scope.readEvents()).filter((e) => e && e.city != null && cache.canon(e.city) === cur.id).length;
    if (using) {
      throw new HttpException({ error: 'city_in_use', message: `${using} event${using === 1 ? ' uses' : 's use'} ${cur.name}. Match it to a listed city instead, so they move with it.` }, 409);
    }
    await db()`update city set status = 'declined', updated_at = now() where id = ${cur.id} and status = 'requested'`;
    await refreshCities();
    await this.log(req, 'admin.city.decline', `declined ${cur.name} (${cur.id}), asked for by ${cur.requestedBy ?? 'unknown'}`);
    return { ok: true };
  }

  /** A name or spelling must not already mean another city (lookups would silently pick one). */
  private async assertNoClash(selfId: string | null, name: string, aliases: string[]) {
    const cache = cities();
    await cache.refresh({ force: true });
    for (const k of [name, ...aliases]) {
      const hit = cache.get(k);
      if (hit && hit.id !== selfId && hit.status !== 'declined') {
        throw new HttpException({ error: 'city_exists', message: `"${k}" already means ${hit.name}.` }, 409);
      }
    }
  }

  private async load(id: string): Promise<City> {
    const [row] = await db()`select * from city where id = ${String(id || '').toLowerCase()}`;
    if (!row) throw new NotFoundException({ error: 'city_not_found' });
    return rowToCity(row);
  }

  private editable(body: any): Partial<Pick<City, 'country' | 'currency' | 'timezone' | 'aliases' | 'sort'>> & { status?: 'active' | 'hidden' } {
    const out: any = {};
    if (body?.country !== undefined) out.country = sanitizeCountry(body.country);
    if (body?.currency !== undefined) {
      const c = String(body.currency).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(c)) throw new BadRequestException({ error: 'currency_invalid' });
      out.currency = c;
    }
    if (body?.timezone !== undefined) {
      const tz = String(body.timezone).trim();
      let ok = TZ_RE.test(tz);
      try { if (ok) new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { ok = false; }
      if (!ok) throw new BadRequestException({ error: 'timezone_invalid' });
      out.timezone = tz;
    }
    if (body?.aliases !== undefined) out.aliases = sanitizeAliases(body.aliases);
    if (body?.sort !== undefined) {
      const n = Number(body.sort);
      if (!Number.isInteger(n) || n < 0 || n > 10000) throw new BadRequestException({ error: 'sort_invalid' });
      out.sort = n;
    }
    if (body?.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'hidden') throw new BadRequestException({ error: 'status_invalid' });
      out.status = body.status;
    }
    return out;
  }
}

@Module({
  imports: [OrgModule],
  controllers: [CitiesController, OrgCitiesController, AdminCitiesController],
})
export class CitiesModule {}
