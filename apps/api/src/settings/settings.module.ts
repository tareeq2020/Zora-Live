import { BadRequestException, Body, Controller, Get, Module, Put, UseGuards } from '@nestjs/common';
import { FSP_IDS, PAYMENT_METHODS, type FspId, type FspRouteMap } from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { SessionGuard } from '../common/session.guard';
import { DEFAULT_SETTINGS } from '../common/defaults';

const FSP_SET = new Set<string>(FSP_IDS);

/* Validate the admin FSP-routing map before it lands in settings. The payments
   pay endpoint reads settings.fspRouteMap and feeds it to resolveFsp, so a bad
   value here would misroute real money — reject anything that isn't a known
   method / FSP, and honour GODIGITAL's mobile-only capability. */
function validateFspRouteMap(raw: unknown): FspRouteMap {
  if (!raw || typeof raw !== 'object') throw new BadRequestException({ error: 'invalid_fsp_route_map' });
  const out: Record<string, Record<string, FspId>> = {};
  for (const method of PAYMENT_METHODS) {
    const m = (raw as Record<string, unknown>)[method];
    if (m == null) continue;
    if (typeof m !== 'object') throw new BadRequestException({ error: `invalid_method_${method}` });
    const entry: Record<string, FspId> = {};
    for (const [key, val] of Object.entries(m as Record<string, unknown>)) {
      if (val == null || val === '') continue; // blank = fall back to the method default
      if (typeof val !== 'string' || !FSP_SET.has(val)) throw new BadRequestException({ error: `invalid_fsp:${method}.${key}` });
      if (val === 'GODIGITAL' && method !== 'mobile') throw new BadRequestException({ error: 'godigital_mobile_only' });
      if (key !== 'default' && !/^[A-Z][A-Z0-9_]{1,20}$/.test(key)) throw new BadRequestException({ error: `invalid_network:${key}` });
      entry[key] = val as FspId;
    }
    if (Object.keys(entry).length) out[method] = entry;
  }
  return out as FspRouteMap;
}

// BS47: which payment methods the customer-facing checkout offers at all — a
// method with routing configured above can still be pulled off the storefront
// without touching that routing, e.g. bill-pay isn't ready yet. Validates only
// the SHAPE of the submitted patch (known method keys, boolean values); the
// controller checks the shape of the merged RESULT — a single-field patch like
// {card:false} is never "all false" on its own, so that check has to happen
// after merging onto the existing map, not here. Checkout's own guard treats
// an absent map, or an absent key within it, as enabled (fail-open), so this
// ships without a data migration and an untouched platform behaves exactly as
// it does today.
function validateMethodsEnabled(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object') throw new BadRequestException({ error: 'invalid_methods_enabled' });
  const out: Record<string, boolean> = {};
  for (const method of PAYMENT_METHODS) {
    const v = (raw as Record<string, unknown>)[method];
    if (v == null) continue;
    if (typeof v !== 'boolean') throw new BadRequestException({ error: `invalid_method_flag:${method}` });
    out[method] = v;
  }
  return out;
}

// BS87: the global USD→TZS rate. Money-critical — a zero/negative/absurd rate would
// make every USD-priced tier free or nonsensical, so reject anything outside a sane
// band and round to a whole TZS-per-USD figure.
function validateUsdRate(raw: unknown): number {
  const r = Number(raw);
  if (!Number.isFinite(r) || r <= 0 || r > 1_000_000) throw new BadRequestException({ error: 'invalid_usd_rate' });
  return Math.round(r);
}

@Controller()
export class SettingsController {
  constructor(private readonly entities: EntityStore) {}

  @Get('settings')
  async get() {
    return this.entities.read('settings', DEFAULT_SETTINGS);
  }

  @UseGuards(SessionGuard)
  @Put('settings')
  async update(@Body() body: any) {
    // BS87: guard the money-critical rate on the generic write too.
    if (body?.usdRate !== undefined) body = { ...body, usdRate: validateUsdRate(body.usdRate) };
    const current = await this.entities.read('settings', DEFAULT_SETTINGS);
    const updated = { ...current, ...body };
    await this.entities.write('settings', updated);
    return updated;
  }

  // BS87: admin-only USD→TZS rate. Organizers price tiers in USD; the API charges
  // TZS = round(usd * usdRate). This is the ONE global rate for the platform.
  @UseGuards(SessionGuard)
  @Put('settings/usd-rate')
  async updateUsdRate(@Body() body: any) {
    const usdRate = validateUsdRate(body?.usdRate);
    const current = await this.entities.read<Record<string, unknown>>('settings', DEFAULT_SETTINGS);
    await this.entities.write('settings', { ...current, usdRate });
    return { usdRate };
  }

  // Admin-only, validated payment-routing save (the FSP the x-bridge gateway uses
  // per method / mobile network). Replaces settings.fspRouteMap wholesale with the
  // validated map — the UI always submits the complete intended routing.
  @UseGuards(SessionGuard)
  @Put('settings/fsp-routing')
  async updateFspRouting(@Body() body: any) {
    const fspRouteMap = validateFspRouteMap(body?.fspRouteMap);
    const current = await this.entities.read<Record<string, unknown>>('settings', DEFAULT_SETTINGS);
    await this.entities.write('settings', { ...current, fspRouteMap });
    return { fspRouteMap };
  }

  // BS47: admin-only, validated which-methods-are-offered save. Merges onto the
  // existing map (a method not present in the payload keeps its current value)
  // so the UI can submit a single toggle flip rather than the full set.
  @UseGuards(SessionGuard)
  @Put('settings/methods-enabled')
  async updateMethodsEnabled(@Body() body: any) {
    const patch = validateMethodsEnabled(body?.methodsEnabled);
    const current = await this.entities.read<Record<string, unknown>>('settings', DEFAULT_SETTINGS);
    const existing = (current.methodsEnabled && typeof current.methodsEnabled === 'object' ? current.methodsEnabled : {}) as Record<string, boolean>;
    const methodsEnabled = { ...existing, ...patch };
    // Fail-open semantics: an ABSENT key means enabled, so this must check all
    // three known methods explicitly — {card:false} alone is never "all
    // disabled" even though it's the only key present in the stored object.
    if (PAYMENT_METHODS.every((m) => methodsEnabled[m] === false)) {
      throw new BadRequestException({ error: 'all_methods_disabled' });
    }
    await this.entities.write('settings', { ...current, methodsEnabled });
    return { methodsEnabled };
  }
}

@Module({ controllers: [SettingsController] })
export class SettingsModule {}
