import { BadRequestException, Body, Controller, Get, Module, Put, Query, UseGuards } from '@nestjs/common';
import { PAYMENT_METHODS, resolveFlags, sanitizeFlagRules } from '@zora/core';
import { EntityStore } from '../storage/entity-store';
import { SessionGuard } from '../common/session.guard';
import { DEFAULT_SETTINGS } from '../common/defaults';

// BS47: which payment methods the customer-facing checkout offers at all, e.g.
// bill-pay can be pulled off the storefront while it isn't ready yet. (x-bridge
// picks the provider behind each method; there is no provider setting here.) Validates only
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
    // BS139: flag rules name organizers/events in pilots — only resolved
    // booleans leave via GET /api/flags, never the raw lists.
    const { flags: _flags, ...rest } = (await this.entities.read<Record<string, unknown>>('settings', DEFAULT_SETTINGS)) as Record<string, unknown>;
    return rest;
  }

  @UseGuards(SessionGuard)
  @Put('settings')
  async update(@Body() body: any) {
    // BS87: guard the money-critical rate on the generic write too.
    if (body?.usdRate !== undefined) body = { ...body, usdRate: validateUsdRate(body.usdRate) };
    // BS139: flags only change through the validated PUT /api/settings/flags.
    if (body && typeof body === 'object' && 'flags' in body) { const { flags: _f, ...rest } = body; body = rest; }
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

  // BS118: public resolved feature flags for one context (organizer handle and/or
  // event id). Only booleans leave the server — never the org/event lists.
  @Get('flags')
  async flags(@Query('org') org?: string, @Query('event') event?: string) {
    const current = await this.entities.read<Record<string, unknown>>('settings', DEFAULT_SETTINGS);
    return resolveFlags(current.flags, { org: org || null, event: event || null });
  }

  // BS140: admin read of the raw flag rules (pilot lists) for the flags page.
  @UseGuards(SessionGuard)
  @Get('settings/flags')
  async readFlags() {
    const current = await this.entities.read<Record<string, unknown>>('settings', DEFAULT_SETTINGS);
    return { flags: sanitizeFlagRules(current.flags) };
  }

  // BS118: admin-only flag rules save. Replaces settings.flags wholesale with the
  // sanitized rules (unknown flags and junk fields dropped).
  @UseGuards(SessionGuard)
  @Put('settings/flags')
  async updateFlags(@Body() body: any) {
    const flags = sanitizeFlagRules(body?.flags);
    const current = await this.entities.read<Record<string, unknown>>('settings', DEFAULT_SETTINGS);
    await this.entities.write('settings', { ...current, flags });
    return { flags };
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
