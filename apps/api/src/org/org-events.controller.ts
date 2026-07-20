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
    const fields = this.validateEventFields(body);
    const sellable = body?.sellable === true;
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
      for (const k of ['name', 'dateLabel', 'city', 'venue', 'category', 'time'] as const) {
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
          tiers.map((x) => ({ name: x.name, price: x.price, capacity: x.capacity, currency: x.currency })),
          ev.name,
        );
        ev.webCheckout = { tiers: provisioned.map((p) => ({ tierId: p.tierId, name: p.name, unitPrice: p.unitPrice, currency: p.currency })) };
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
          [{ name: tier.name, price: tier.price, capacity: tier.capacity, currency: tier.currency }],
          ev.name,
        );
        web.push({ tierId: p.tierId, name: p.name, unitPrice: p.unitPrice, currency: p.currency });
        continue;
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
      ? e.webCheckout.tiers.map((w: any) => ({ tierId: w.tierId, name: w.name, unitPrice: w.unitPrice, currency: w.currency }))
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
    return { name, dateLabel, city, venue, category, priceFrom, seated: body.seated, time };
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
      return { tierId: typeof t?.tierId === 'string' ? t.tierId : undefined, name, price, capacity, currency: (t?.currency || 'TZS') as string };
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
