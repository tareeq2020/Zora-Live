import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { db, tx, poolSnapshots, type PoolSnapshot, type Sql } from '@zora/core';
import { OrganizerGuard } from '../common/organizer.guard';
import { EntityStore } from '../storage/entity-store';
import { AuditService } from '../audit/audit.module';
import { DEFAULT_ORGANIZERS } from '../common/defaults';
import { OrgScopeService } from './org-scope.service';
import { EventProvisioningService, type ProvisionTierInput } from './event-provisioning.service';

/* /api/org/events — the organizer-owned events CRUD (MT2). OrganizerGuard gates
   every route (real organizer OR admin impersonating), and req.actingHandle is the
   ONLY owner we ever trust — the body's organizerHandle is ignored on writes.

   Correctness contract (see mt-dashboard-plan.md "FINALIZED"):
     C2  sold = inventory_pool.sold_count (poolSnapshots) — never capacity−available.
     C4  sellable provisioning is ONE tx() spanning blob + relational, FK-ordered.
     C6  re-price = close the open price_version + insert a new one + update the blob
         webCheckout.tiers unitPrice, all in the same tx (never UPDATE the price).
     C7  capacity edit applies the delta to available_count and refuses to drop below
         what's already committed (sold+blocked+reserved / held) — a 400, not a 500.
     I1  DELETE is soft (blob status='archived'); 409 if the event has any paid order.
     I2  every write re-reads the organizer and rejects a suspended/missing principal.
     I3  create/edit/delete write the audit log (actor = actingHandle; admin noted on
         impersonation).
     I5  create dedupes on idempotencyKey.
     I6  publishing a sellable drop requires the org's kycStatus==='approved' (403).
     I7  a sellable event is single-currency. */

interface TierInput {
  tierId?: string;
  name: string;
  price: number;
  capacity: number;
  currency?: string;
  splitEnabled?: boolean;
  splitWindowSecs?: number;
  disabled?: boolean; // BS23: hidden from the storefront / not purchasable
}

const PAID_STATES = ['paid', 'paid_unseatable', 'payment_short'];

function slugify(s: string): string {
  return (
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'drop'
  );
}

@UseGuards(OrganizerGuard)
@Controller('org')
export class OrgEventsController {
  constructor(
    private readonly scope: OrgScopeService,
    private readonly prov: EventProvisioningService,
    private readonly entities: EntityStore,
    private readonly audit: AuditService,
  ) {}

  // ── GET /api/org/events ──────────────────────────────────────────────────────
  // Every event the acting org owns — INCLUDING drafts/archived — each shaped with
  // status, sellable, and tiers enriched from the live inventory pool (C2).
  @Get('events')
  async list(@Req() req: Request) {
    const handle = req.actingHandle as string;
    const owned = new Set(await this.scope.ownedEventIds(handle));
    const events = (await this.scope.readEvents()).filter((e) => e && owned.has(e.id));
    const snapById = new Map((await poolSnapshots(db())).map((s) => [s.tierId, s]));
    return events.map((e) => this.shape(e, snapById));
  }

  // ── POST /api/org/events ─────────────────────────────────────────────────────
  @Post('events')
  async create(@Req() req: Request, @Body() body: any) {
    const handle = req.actingHandle as string;
    await this.assertActiveOrganizer(handle); // I2
    const sellable = body?.sellable === true;
    // A DRAFT only needs a name — "fill what you know, publish when you're ready".
    // Full field validation (date/city/venue/category/priceFrom/seated) is enforced
    // only when PUBLISHING a sellable, public drop.
    const fields = sellable ? this.validateEventFields(body) : this.validateDraftFields(body);
    const tiers = this.normalizeTiers(body?.tiers, sellable);
    const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : null;

    if (sellable) await this.assertKycApproved(handle); // I6 (before any write)

    const result = await tx(async (t) => {
      const rows = await this.prov.readEventsForUpdate(t); // C4 lock

      // I5: an identical idempotencyKey from the same org returns the first result.
      if (idempotencyKey) {
        const dup = rows.find(
          (e) => e && e.organizerHandle === handle && e.idempotencyKey === idempotencyKey,
        );
        if (dup) return { event: dup, deduped: true };
      }

      const id = this.uniqueId(rows, fields.name);
      const base = {
        id,
        organizerHandle: handle, // stamped from the session — never from the body
        ...fields,
        idempotencyKey: idempotencyKey || undefined,
      };

      if (sellable) {
        const provTiers: ProvisionTierInput[] = tiers.map((t2) => ({
          name: t2.name,
          price: t2.price,
          capacity: t2.capacity,
          currency: t2.currency,
          splitEnabled: t2.splitEnabled,
          splitWindowSecs: t2.splitWindowSecs,
          disabled: t2.disabled,
        }));
        const { event } = await this.prov.provisionSellableDrop(
          t,
          { ...base, status: 'published' },
          provTiers,
        );
        return { event, deduped: false };
      }

      // Draft: blob only (no relational catalog, absent from /api/events).
      const event = await this.prov.upsertEventBlobOnTx(t, { ...base, status: 'draft', tiers });
      return { event, deduped: false };
    });

    if (!result.deduped) {
      await this.writeAudit(req, sellable ? 'org_event_create_sellable' : 'org_event_create_draft', result.event.id);
    }
    return this.shapeFresh(result.event);
  }

  // ── PUT /api/org/events/:id ──────────────────────────────────────────────────
  @Put('events/:id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    const handle = req.actingHandle as string;
    await this.assertActiveOrganizer(handle); // I2
    await this.scope.assertOwnsEvent(handle, id); // 404 if not owned

    const wantPublish = body?.sellable === true;
    const incomingTiers = Array.isArray(body?.tiers) ? this.normalizeTiers(body.tiers, false) : null;

    const updated = await tx(async (t) => {
      const rows = await this.prov.readEventsForUpdate(t);
      const idx = rows.findIndex((e) => e && e.id === id && e.organizerHandle === handle);
      if (idx < 0) throw new NotFoundException({ error: 'Not found' }); // lost the row to a concurrent delete
      const ev = { ...rows[idx] };
      const wasSellable = this.isSellable(ev);

      // Scalar fields — only overwrite what the body actually carries.
      for (const k of ['name', 'dateLabel', 'city', 'venue', 'category', 'time', 'cover'] as const) {
        if (body?.[k] !== undefined) ev[k] = String(body[k]);
      }
      if (body?.priceFrom !== undefined) ev.priceFrom = Number(body.priceFrom);
      if (body?.seated !== undefined) ev.seated = !!body.seated;

      if (!wasSellable && wantPublish) {
        // Draft → published: KYC gate (I6) + fresh provisioning (C4).
        await this.assertKycApproved(handle);
        const tiers = this.normalizeTiers(body?.tiers ?? ev.tiers, true);
        const provisioned = await this.prov.provisionSellableTiers(
          t,
          ev.id,
          tiers.map((x) => ({ name: x.name, price: x.price, capacity: x.capacity, currency: x.currency, splitEnabled: x.splitEnabled, splitWindowSecs: x.splitWindowSecs, disabled: x.disabled })),
          ev.name,
        );
        ev.webCheckout = { tiers: provisioned.map((p) => ({ tierId: p.tierId, name: p.name, unitPrice: p.unitPrice, currency: p.currency, ...(p.split ? { split: true } : {}), ...(p.disabled ? { disabled: true } : {}) })) };
        ev.status = 'published';
        delete ev.tiers; // sellable events carry tiers via webCheckout + the pool
      } else if (wasSellable && incomingTiers) {
        await this.applyTierEdits(t, ev, incomingTiers); // C6 + C7
      } else if (!wasSellable && incomingTiers) {
        ev.tiers = incomingTiers; // still a draft — just refresh the stored tiers
      }

      rows[idx] = { ...ev, updated_at: new Date().toISOString() };
      await this.prov.writeEventsOnTx(t, rows);
      return rows[idx];
    });

    await this.writeAudit(req, 'org_event_update', id);
    return this.shapeFresh(updated);
  }

  // ── DELETE /api/org/events/:id ───────────────────────────────────────────────
  @Delete('events/:id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    const handle = req.actingHandle as string;
    await this.assertActiveOrganizer(handle); // I2
    await this.scope.assertOwnsEvent(handle, id); // 404 if not owned

    // I1: refuse if any order for this event is paid (never orphan a sold ticket).
    const paid = await db()`select 1 from "order" where event_id = ${id}
                            and status = any(${PAID_STATES}) limit 1`;
    if (paid.length) throw new ConflictException({ error: 'has_paid_orders' });

    await tx(async (t) => {
      const rows = await this.prov.readEventsForUpdate(t);
      const idx = rows.findIndex((e) => e && e.id === id && e.organizerHandle === handle);
      if (idx < 0) throw new NotFoundException({ error: 'Not found' });
      rows[idx] = { ...rows[idx], status: 'archived', updated_at: new Date().toISOString() }; // soft-delete
      await this.prov.writeEventsOnTx(t, rows);
    });

    await this.writeAudit(req, 'org_event_delete', id);
    return { ok: true };
  }

  // ── DELETE /api/org/events/:id/tiers/:tierId ─────────────────────────────────
  // BS23: hard-delete a single ticket tier, allowed ONLY when it has never been
  // sold or held. product_tier is referenced WITHOUT on-delete-cascade by
  // order_item, table_split, and credential, so a referenced tier both "has sales"
  // AND would FK-violate on delete — we fail closed on all three (plus any committed
  // pool units) with 409 tier_has_sales, and steer the organizer to DISABLE instead.
  // The catalog delete cascades to price_version + inventory_pool; the blob tier is
  // spliced out in the same tx. The last remaining tier can't be deleted (a sellable
  // event needs ≥1) — 409 last_tier.
  @Delete('events/:id/tiers/:tierId')
  async removeTier(@Req() req: Request, @Param('id') id: string, @Param('tierId') tierId: string) {
    const handle = req.actingHandle as string;
    await this.assertActiveOrganizer(handle); // I2
    await this.scope.assertOwnsEvent(handle, id); // 404 if not owned

    await tx(async (t) => {
      const rows = await this.prov.readEventsForUpdate(t); // C4 lock (blob)
      const idx = rows.findIndex((e) => e && e.id === id && e.organizerHandle === handle);
      if (idx < 0) throw new NotFoundException({ error: 'Not found' });
      const ev = { ...rows[idx] };
      const web: any[] = Array.isArray(ev.webCheckout?.tiers) ? ev.webCheckout.tiers : [];
      const tierIdx = web.findIndex((w) => w.tierId === tierId);
      if (tierIdx < 0) throw new NotFoundException({ error: 'tier_not_found' });
      if (web.length <= 1) throw new ConflictException({ error: 'last_tier' });

      // Lock the pool row, then fail closed on ANY reference or committed unit.
      const pool = await t<{ sold_count: number; blocked_count: number; reserved_count: number }[]>`
        select sold_count, blocked_count, reserved_count from inventory_pool
          where product_tier_id = ${tierId} for update`;
      const committed = pool.length
        ? Number(pool[0].sold_count) + Number(pool[0].blocked_count) + Number(pool[0].reserved_count)
        : 0;
      const [refs] = await t<{ has_orders: boolean; has_splits: boolean; has_creds: boolean }[]>`
        select exists(select 1 from order_item  where product_tier_id = ${tierId}) as has_orders,
               exists(select 1 from table_split  where product_tier_id = ${tierId}) as has_splits,
               exists(select 1 from credential   where tier_id        = ${tierId}) as has_creds`;
      if (committed > 0 || refs.has_orders || refs.has_splits || refs.has_creds) {
        throw new ConflictException({ error: 'tier_has_sales' });
      }

      // Hard delete: cascades price_version + inventory_pool; drop it from the blob.
      await t`delete from product_tier where id = ${tierId}`;
      web.splice(tierIdx, 1);
      ev.webCheckout = { tiers: web };
      rows[idx] = { ...ev, updated_at: new Date().toISOString() };
      await this.prov.writeEventsOnTx(t, rows);
    });

    await this.writeAudit(req, 'org_tier_delete', `${id}/${tierId}`);
    return { ok: true };
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** C6 + C7: re-price via versioning, capacity via delta, add new tiers. On `t`. */
  private async applyTierEdits(t: Sql, ev: any, incoming: TierInput[]): Promise<void> {
    const web: any[] = Array.isArray(ev.webCheckout?.tiers) ? ev.webCheckout.tiers : [];
    for (const tier of incoming) {
      const match = web.find((w) => (tier.tierId && w.tierId === tier.tierId) || w.name === tier.name);

      if (!match) {
        // A brand-new tier on an already-sellable event — provision it in FK order.
        const [p] = await this.prov.provisionSellableTiers(
          t,
          ev.id,
          [{ name: tier.name, price: tier.price, capacity: tier.capacity, currency: tier.currency, splitEnabled: tier.splitEnabled, splitWindowSecs: tier.splitWindowSecs, disabled: tier.disabled }],
          ev.name,
        );
        web.push({ tierId: p.tierId, name: p.name, unitPrice: p.unitPrice, currency: p.currency, ...(p.split ? { split: true } : {}), ...(p.disabled ? { disabled: true } : {}) });
        continue;
      }

      // BS23 — disable/enable an EXISTING sellable tier: persist the flag and mirror
      // it onto the blob (the storefront filters disabled tiers; checkout rejects them).
      if (tier.disabled !== undefined) {
        await t`update product_tier set disabled = ${!!tier.disabled} where id = ${match.tierId}`;
        if (tier.disabled) match.disabled = true; else delete match.disabled;
      }

      // BS10 — split toggle on an EXISTING sellable tier: persist the flag + window
      // and mirror it onto the blob webCheckout tier (drives the storefront CTA).
      if (tier.splitEnabled !== undefined) {
        await t`update product_tier
                   set split_enabled = ${!!tier.splitEnabled},
                       split_window_secs = ${tier.splitWindowSecs ?? 2700},
                       kind = ${tier.splitEnabled ? 'table' : 'shore'}
                 where id = ${match.tierId}`;
        if (tier.splitEnabled) match.split = true; else delete match.split;
      }

      // C6 — re-price: close the open version, open a new one, update the blob price.
      if (Number.isFinite(tier.price) && Number(tier.price) !== Number(match.unitPrice)) {
        await t`update price_version set effective_to = now()
                where tier_id = ${match.tierId} and effective_to is null`;
        await t`insert into price_version (tier_id, price, currency)
                values (${match.tierId}, ${Number(tier.price)}, ${match.currency || tier.currency || 'TZS'})`;
        match.unitPrice = Number(tier.price);
      }

      // C7 — capacity: apply the delta to available too; refuse below what's committed.
      if (Number.isFinite(tier.capacity)) {
        const newCap = Number(tier.capacity);
        const pool = await t<{ capacity: number; available_count: number; sold_count: number; blocked_count: number; reserved_count: number }[]>`
          select capacity, available_count, sold_count, blocked_count, reserved_count
            from inventory_pool where product_tier_id = ${match.tierId} for update`;
        if (pool.length) {
          const p = pool[0];
          const committed = Number(p.sold_count) + Number(p.blocked_count) + Number(p.reserved_count);
          const delta = newCap - Number(p.capacity);
          const newAvail = Number(p.available_count) + delta;
          // Below committed (or would drive available negative against active holds) → 400, not a 500.
          if (newCap < committed || newAvail < 0) {
            throw new BadRequestException({
              error: 'capacity_below_committed',
              tier: match.tierId,
              committed,
              requested: newCap,
            });
          }
          if (delta !== 0) {
            await t`update inventory_pool
                      set capacity = capacity + ${delta}, available_count = available_count + ${delta}
                    where product_tier_id = ${match.tierId}`;
            await t`update product_tier set capacity = ${newCap} where id = ${match.tierId}`;
          }
        }
      }
    }
    ev.webCheckout = { tiers: web };
  }

  private isSellable(e: any): boolean {
    return !!(e && e.webCheckout && Array.isArray(e.webCheckout.tiers) && e.webCheckout.tiers.length);
  }

  /** Shape a stored blob event for the API, joining live pool snapshots (C2). */
  private shape(e: any, snapById: Map<string, PoolSnapshot>) {
    const sellable = this.isSellable(e);
    const source: any[] = sellable
      ? e.webCheckout.tiers.map((w: any) => ({ tierId: w.tierId, name: w.name, unitPrice: w.unitPrice, currency: w.currency, split: !!w.split, disabled: !!w.disabled }))
      : Array.isArray(e.tiers)
        ? e.tiers
        : [];
    const tiers = source.map((t: any) => {
      const snap = t.tierId ? snapById.get(t.tierId) : undefined;
      const capacity = snap ? snap.capacity : Number(t.capacity ?? 0);
      return {
        tierId: t.tierId ?? null,
        name: t.name,
        unitPrice: Number(t.unitPrice ?? t.price ?? 0),
        capacity,
        sold: snap ? snap.sold : 0, // C2: sold_count, never capacity−available
        available: snap ? snap.available : capacity,
        currency: t.currency || 'TZS',
        // BS23/BS10: reflect saved flags so the editor's toggles hydrate correctly.
        split: !!(t.split ?? t.splitEnabled),
        disabled: !!t.disabled,
      };
    });
    return {
      id: e.id,
      name: e.name,
      category: e.category ?? null,
      city: e.city ?? null,
      venue: e.venue ?? null,
      dateLabel: e.dateLabel ?? null,
      time: e.time ?? null,
      priceFrom: e.priceFrom ?? null,
      seated: !!e.seated,
      status: e.status || 'published',
      sellable,
      tiers,
    };
  }

  /** Re-read the live pool once and shape a single event (post-write response). */
  private async shapeFresh(e: any) {
    const snapById = new Map((await poolSnapshots(db())).map((s) => [s.tierId, s]));
    return this.shape(e, snapById);
  }

  private uniqueId(rows: any[], name: string): string {
    const taken = new Set(rows.map((r) => r && r.id));
    const base = slugify(name);
    let id = base;
    let n = 1;
    while (taken.has(id)) id = `${base}-${++n}`;
    return id;
  }

  private validateEventFields(body: any) {
    const req = (k: string) => {
      const v = body?.[k];
      if (typeof v !== 'string' || !v.trim()) throw new BadRequestException({ error: `${k}_required` });
      return v.trim();
    };
    const name = req('name');
    const dateLabel = req('dateLabel');
    const city = req('city');
    const venue = req('venue');
    const category = req('category');
    const priceFrom = Number(body?.priceFrom);
    if (!Number.isFinite(priceFrom) || priceFrom < 0) throw new BadRequestException({ error: 'priceFrom_invalid' });
    if (typeof body?.seated !== 'boolean') throw new BadRequestException({ error: 'seated_required' });
    const time = typeof body?.time === 'string' ? body.time.trim() : undefined;
    const cover = typeof body?.cover === 'string' ? body.cover.trim() : undefined; // per-event hero image URL
    return { name, dateLabel, city, venue, category, priceFrom, seated: body.seated, time, cover };
  }

  // A draft only requires a name. Every other field is optional and stored as
  // given, so an organizer can "fill what they know" and finish later. Publishing
  // (sellable) re-runs validateEventFields, which enforces the full set.
  private validateDraftFields(body: any) {
    const name = body?.name;
    if (typeof name !== 'string' || !name.trim()) throw new BadRequestException({ error: 'name_required' });
    const out: Record<string, unknown> = { name: name.trim() };
    for (const k of ['dateLabel', 'city', 'venue', 'category', 'time', 'cover'] as const) {
      if (typeof body?.[k] === 'string' && body[k].trim()) out[k] = body[k].trim();
    }
    const priceFrom = Number(body?.priceFrom);
    if (Number.isFinite(priceFrom) && priceFrom >= 0) out.priceFrom = priceFrom;
    if (typeof body?.seated === 'boolean') out.seated = body.seated;
    return out as { name: string } & Record<string, unknown>;
  }

  private normalizeTiers(raw: any, requireNonEmpty: boolean): TierInput[] {
    if (!Array.isArray(raw)) {
      if (requireNonEmpty) throw new BadRequestException({ error: 'tiers_required' });
      return [];
    }
    const tiers = raw.map((t: any, i: number) => {
      const name = typeof t?.name === 'string' ? t.name.trim() : '';
      if (!name) throw new BadRequestException({ error: `tier_${i}_name_required` });
      const price = Number(t?.price);
      if (!Number.isFinite(price) || price < 0) throw new BadRequestException({ error: `tier_${i}_price_invalid` });
      const capacity = Number(t?.capacity);
      if (!Number.isInteger(capacity) || capacity <= 0) throw new BadRequestException({ error: `tier_${i}_capacity_invalid` });
      return {
        tierId: typeof t?.tierId === 'string' ? t.tierId : undefined, name, price, capacity,
        currency: (t?.currency || 'TZS') as string,
        splitEnabled: !!t?.splitEnabled,
        splitWindowSecs: Number.isInteger(t?.splitWindowSecs) ? Number(t.splitWindowSecs) : undefined,
        disabled: t?.disabled === undefined ? undefined : !!t.disabled,
      };
    });
    if (requireNonEmpty && !tiers.length) throw new BadRequestException({ error: 'tiers_required' });
    // I7: a sellable event is single-currency.
    if (tiers.length) {
      const cur = tiers[0].currency;
      if (tiers.some((t) => t.currency !== cur)) throw new BadRequestException({ error: 'mixed_currency' });
    }
    return tiers;
  }

  /** Read the organizer record fresh from the store. */
  private async readOrg(handle: string): Promise<any | null> {
    const orgs = await this.entities.read<any[]>('organizers', DEFAULT_ORGANIZERS);
    return orgs.find((o) => o && o.handle === handle) || null;
  }

  /** I2: reject a suspended or missing principal on every write. */
  private async assertActiveOrganizer(handle: string): Promise<any> {
    const org = await this.readOrg(handle);
    if (!org || org.status === 'suspended') throw new ForbiddenException({ error: 'suspended' });
    return org;
  }

  /** I6: publishing a sellable drop requires an admin-approved KYC status. */
  private async assertKycApproved(handle: string): Promise<void> {
    const org = await this.readOrg(handle);
    if (!org || org.kycStatus !== 'approved') throw new ForbiddenException({ error: 'kyc_required' });
  }

  /** I3: audit trail — actor is the acting handle; impersonation names the admin. */
  private async writeAudit(req: Request, action: string, eventId: string): Promise<void> {
    const handle = req.actingHandle as string;
    const via = req.actingViaImpersonation ? ` (admin ${req.actingAdminId || 'admin'} impersonating)` : '';
    await this.audit.record(action, `event ${eventId}${via}`, req.ip, handle);
  }
}
