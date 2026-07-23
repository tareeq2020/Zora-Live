import { Injectable } from '@nestjs/common';
import type { Sql } from '@zora/core';

/* EventProvisioningService (C4) — the tx-based core that turns a drop into a
   SELLABLE one. MT2 wires these to POST/PUT /api/org/events; MT1 ships the
   atomic write core with a unit-tested happy path.

   Why a tx: the events blob IS a Postgres row (collection_store), so a single
   tx() from @zora/core spans the blob AND the relational catalog. ALL writes go
   on the passed tx handle `t` — never the vendored pool-based upsertEvent/writeAll
   (which use db()) — so blob + relational commit or roll back together.

   FK order (matches db/seed-tiers.mjs, lifted here onto the tx):
     event row → product_tier → (price_version, inventory_pool) → blob webCheckout.tiers

   Before the blob read-modify-write we SELECT … FOR UPDATE the events row so a
   concurrent org provisioning at the same time can't lose this update. */

export interface ProvisionTierInput {
  name: string;
  price: number;
  capacity: number;
  currency?: string;
  /** Optional explicit tier id; otherwise derived deterministically from the event id. */
  tierId?: string;
  /** BS10: opt this (table) tier into bill-split + its hold window. */
  splitEnabled?: boolean;
  splitWindowSecs?: number;
}

export interface ProvisionedTier {
  tierId: string;
  name: string;
  unitPrice: number;
  currency: string;
  split?: boolean;
}

function slugPart(name: string, index: number): string {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || `t${index + 1}`;
}

@Injectable()
export class EventProvisioningService {
  /**
   * Provision the sellable tiers for an event on the tx handle `t`, in FK order.
   * Idempotent per tier (ON CONFLICT DO NOTHING / price only when absent), lifted
   * from db/seed-tiers.mjs. Returns the { tierId, name, unitPrice, currency } shape
   * the storefront's webCheckout.tiers expects.
   */
  async provisionSellableTiers(
    t: Sql,
    eventId: string,
    tiers: ProvisionTierInput[],
    eventName?: string,
  ): Promise<ProvisionedTier[]> {
    // FK root: the event row must exist so product_tier's FK resolves.
    await t`insert into event (id, name) values (${eventId}, ${eventName || eventId})
            on conflict (id) do nothing`;

    const provisioned: ProvisionedTier[] = [];
    const seen = new Set<string>();
    let i = 0;
    for (const tier of tiers) {
      let tierId = tier.tierId || `${eventId}-${slugPart(tier.name, i)}`;
      // Guard against colliding derived ids within one call.
      while (seen.has(tierId)) tierId = `${tierId}-${i}`;
      seen.add(tierId);
      const currency = tier.currency || 'TZS';
      const capacity = Number(tier.capacity);
      const price = Number(tier.price);

      await t`insert into product_tier (id, event_id, name, capacity, kind, split_enabled, split_window_secs)
              values (${tierId}, ${eventId}, ${tier.name}, ${capacity},
                      ${tier.splitEnabled ? 'table' : 'shore'}, ${!!tier.splitEnabled}, ${tier.splitWindowSecs ?? 2700})
              on conflict (id) do nothing`;
      // Only add a price_version if this tier has none (no natural conflict key).
      await t`insert into price_version (tier_id, price, currency)
              select ${tierId}, ${price}, ${currency}
              where not exists (select 1 from price_version where tier_id = ${tierId})`;
      await t`insert into inventory_pool (product_tier_id, capacity, available_count)
              values (${tierId}, ${capacity}, ${capacity})
              on conflict (product_tier_id) do nothing`;

      provisioned.push({ tierId, name: tier.name, unitPrice: price, currency, split: !!tier.splitEnabled });
      i++;
    }
    return provisioned;
  }

  /**
   * Read the 'events' blob under a row lock (SELECT … FOR UPDATE). Call this
   * inside a tx before any blob read-modify-write to serialize concurrent
   * provisioning against lost updates.
   */
  async readEventsForUpdate(t: Sql): Promise<any[]> {
    const rows = await t<{ data: string }[]>`select data from collection_store where name = 'events' for update`;
    if (!rows.length) return [];
    const parsed = JSON.parse(rows[0].data);
    return Array.isArray(parsed) ? parsed : [];
  }

  /** Write the 'events' blob on the tx handle (upsert the single collection row). */
  async writeEventsOnTx(t: Sql, events: any[]): Promise<void> {
    const text = JSON.stringify(events);
    await t`insert into collection_store (name, data, updated_at) values ('events', ${text}, now())
            on conflict (name) do update set data = excluded.data, updated_at = now()`;
  }

  /**
   * Blob upsert-on-tx helper: merge `event` into the (row-locked) events blob and
   * persist on `t`. Mirrors vendor/events.js upsertEvent but on the tx handle so it
   * composes with relational writes in one atomic unit. Returns the stored row.
   */
  async upsertEventBlobOnTx(t: Sql, event: any): Promise<any> {
    const rows = await this.readEventsForUpdate(t);
    const row = { ...event, updated_at: new Date().toISOString() };
    if (!row.id) row.id = 'ev_' + Date.now().toString(36);
    const idx = rows.findIndex((e) => e && e.id === row.id);
    if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
    else rows.push(row);
    await this.writeEventsOnTx(t, rows);
    return idx >= 0 ? rows[idx] : rows[rows.length - 1];
  }

  /**
   * The full sellable-drop write, atomic on `t`. Locks the events blob first (C4),
   * provisions tiers in FK order, stamps webCheckout.tiers onto the event, and
   * upserts the blob — all on the same tx. `event` must carry an id (MT2 assigns
   * it on create). Returns the stored event row + the provisioned tiers.
   */
  async provisionSellableDrop(
    t: Sql,
    event: any,
    tiers: ProvisionTierInput[],
  ): Promise<{ event: any; tiers: ProvisionedTier[] }> {
    // Lock the events row up front so the whole read-modify-write is serialized.
    const rows = await this.readEventsForUpdate(t);
    // FK order: event row → product_tier → (price_version, inventory_pool).
    const provisioned = await this.provisionSellableTiers(t, event.id, tiers, event.name);
    // Then the blob webCheckout.tiers (storefront reads this to mount live checkout).
    const webTiers = provisioned.map((p) => ({
      tierId: p.tierId,
      name: p.name,
      unitPrice: p.unitPrice,
      currency: p.currency,
      ...(p.split ? { split: true } : {}),
    }));
    const row = { ...event, webCheckout: { tiers: webTiers }, updated_at: new Date().toISOString() };
    const idx = rows.findIndex((e) => e && e.id === row.id);
    if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
    else rows.push(row);
    await this.writeEventsOnTx(t, rows);
    return { event: idx >= 0 ? rows[idx] : rows[rows.length - 1], tiers: provisioned };
  }
}
