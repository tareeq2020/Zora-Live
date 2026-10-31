/* BS124: seat inventory — expand a published seat-map plan into deterministic
   seat rows, diff against what is stored, and publish safely.

   Ownership (plan A6): inventory_pool decides CAPACITY per tier; seat_inventory
   only decides WHICH seat. Holds/sales on seats (BS125) always move the tier
   pool in the same transaction. */

import { normalizeSeatMapPlan, type SeatMapPlan } from './seatmap';

type Sql = any;

export type SeatState = 'available' | 'held' | 'sold' | 'reserved' | 'blocked';

export interface SeatRowSpec {
  seatId: string;
  zoneId: string;
  kind: 'seat' | 'table';
  label: string;
  rowLabel: string | null;
  seatNumber: number | null;
  tierId: string | null;
  seatsCount: number;
  priceMode: 'per_seat' | 'per_table';
}

export interface StoredSeat extends SeatRowSpec {
  state: SeatState;
}

/** A, B, … Z, AA, AB … — spreadsheet-style row labels. */
export function rowLabel(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const MAX_SEATS_PER_ZONE = 5000;

/** Expand seated + table zones into seat rows. GA zones produce none. */
export function expandPlanSeats(input: SeatMapPlan | unknown): SeatRowSpec[] {
  const plan = normalizeSeatMapPlan(input as any);
  const out: SeatRowSpec[] = [];
  const seen = new Set<string>();
  const push = (row: SeatRowSpec) => {
    if (!row.seatId || seen.has(row.seatId)) return; // duplicate ids would collide on the PK
    seen.add(row.seatId);
    out.push(row);
  };
  for (const z of plan.zones) {
    if (!z.id) continue;
    const tierId = z.tierId ?? null;
    const raw = z as any;
    if (z.type === 'seated') {
      if (Array.isArray(z.seats) && z.seats.length) {
        z.seats.slice(0, MAX_SEATS_PER_ZONE).forEach((s, i) =>
          push({ seatId: s.id || `${z.id}-S${i + 1}`, zoneId: z.id, kind: 'seat', label: s.label || s.id, rowLabel: s.row ?? null, seatNumber: s.number ?? null, tierId, seatsCount: 1, priceMode: 'per_seat' }));
      } else {
        const rows = Math.max(1, z.rows ?? 1);
        const per = Math.max(1, z.perRow ?? 1);
        for (let r = 0; r < rows && r * per < MAX_SEATS_PER_ZONE; r++) {
          const rl = rowLabel(r);
          for (let c = 1; c <= per; c++) {
            push({ seatId: `${z.id}-${rl}${c}`, zoneId: z.id, kind: 'seat', label: `${rl}${c}`, rowLabel: rl, seatNumber: c, tierId, seatsCount: 1, priceMode: 'per_seat' });
          }
        }
      }
    } else if (z.type === 'table') {
      const priceMode = raw.priceMode === 'per_seat' ? 'per_seat' : 'per_table';
      if (Array.isArray(z.tableItems) && z.tableItems.length) {
        z.tableItems.slice(0, MAX_SEATS_PER_ZONE).forEach((t, i) =>
          push({ seatId: t.id || `${z.id}-T${i + 1}`, zoneId: z.id, kind: 'table', label: t.label || `Table ${i + 1}`, rowLabel: null, seatNumber: i + 1, tierId, seatsCount: Math.max(1, t.seats), priceMode }));
      } else {
        const n = Math.min(MAX_SEATS_PER_ZONE, Math.max(1, z.tables ?? 1));
        for (let i = 1; i <= n; i++) {
          push({ seatId: `${z.id}-T${i}`, zoneId: z.id, kind: 'table', label: `Table ${i}`, rowLabel: null, seatNumber: i, tierId, seatsCount: Math.max(1, z.perTable ?? 1), priceMode });
        }
      }
    }
  }
  return out;
}

export interface SeatDiff {
  insert: SeatRowSpec[];
  /** Existing seats whose label/tier/size changed and that are safe to update. */
  update: SeatRowSpec[];
  /** Existing available/blocked seats no longer in the plan. */
  remove: string[];
  /** Seats the edit would remove or re-tier while held, sold or reserved. */
  conflicts: { seatId: string; label: string; state: SeatState; reason: 'removed' | 'retiered' | 'resized' }[];
}

const LOCKED: SeatState[] = ['held', 'sold', 'reserved'];

export function diffSeats(existing: StoredSeat[], desired: SeatRowSpec[]): SeatDiff {
  const byId = new Map(existing.map((s) => [s.seatId, s]));
  const want = new Map(desired.map((s) => [s.seatId, s]));
  const diff: SeatDiff = { insert: [], update: [], remove: [], conflicts: [] };
  for (const d of desired) {
    const cur = byId.get(d.seatId);
    if (!cur) { diff.insert.push(d); continue; }
    const locked = LOCKED.includes(cur.state);
    if (locked && (cur.tierId ?? null) !== (d.tierId ?? null)) { diff.conflicts.push({ seatId: d.seatId, label: cur.label, state: cur.state, reason: 'retiered' }); continue; }
    if (locked && cur.seatsCount !== d.seatsCount) { diff.conflicts.push({ seatId: d.seatId, label: cur.label, state: cur.state, reason: 'resized' }); continue; }
    if (cur.label !== d.label || (cur.tierId ?? null) !== (d.tierId ?? null) || cur.seatsCount !== d.seatsCount || cur.priceMode !== d.priceMode || cur.zoneId !== d.zoneId) diff.update.push(d);
  }
  for (const cur of existing) {
    if (want.has(cur.seatId)) continue;
    if (LOCKED.includes(cur.state)) diff.conflicts.push({ seatId: cur.seatId, label: cur.label, state: cur.state, reason: 'removed' });
    else diff.remove.push(cur.seatId);
  }
  return diff;
}

export type PublishSeatMapResult =
  | { ok: true; version: number; seats: number; inserted: number; updated: number; removed: number }
  | { ok: false; error: 'seat_conflicts'; conflicts: SeatDiff['conflicts'] };

/** Publish a plan as the event's live seat inventory. Atomic; serialised per event. */
export async function publishSeatMap(sql: Sql, eventId: string, plan: unknown, actor: string | null): Promise<PublishSeatMapResult> {
  const desired = expandPlanSeats(plan);
  return sql.begin(async (t: Sql) => {
    await t`select pg_advisory_xact_lock(hashtext(${'seatmap:' + eventId}))`;
    const rows = await t`
      select seat_id, zone_id, kind, label, row_label, seat_number, tier_id, seats_count, price_mode, state
        from seat_inventory where event_id = ${eventId} for update`;
    const existing: StoredSeat[] = rows.map((r: any) => ({
      seatId: r.seat_id, zoneId: r.zone_id, kind: r.kind, label: r.label, rowLabel: r.row_label,
      seatNumber: r.seat_number, tierId: r.tier_id, seatsCount: r.seats_count, priceMode: r.price_mode, state: r.state,
    }));
    const diff = diffSeats(existing, desired);
    if (diff.conflicts.length) return { ok: false, error: 'seat_conflicts', conflicts: diff.conflicts } as const;

    const [{ v }] = await t`select coalesce(max(version), 0) + 1 as v from seatmap_version where event_id = ${eventId}`;
    const version = Number(v);
    if (diff.remove.length) await t`delete from seat_inventory where event_id = ${eventId} and seat_id = any(${diff.remove}) and state in ('available', 'blocked')`;
    for (const s of diff.update) {
      await t`update seat_inventory set zone_id = ${s.zoneId}, label = ${s.label}, row_label = ${s.rowLabel}, seat_number = ${s.seatNumber},
                tier_id = ${s.tierId}, seats_count = ${s.seatsCount}, price_mode = ${s.priceMode}, layout_version = ${version}, updated_at = now()
               where event_id = ${eventId} and seat_id = ${s.seatId}`;
    }
    if (diff.insert.length) {
      const values = diff.insert.map((s) => ({
        event_id: eventId, seat_id: s.seatId, zone_id: s.zoneId, kind: s.kind, label: s.label, row_label: s.rowLabel,
        seat_number: s.seatNumber, tier_id: s.tierId, seats_count: s.seatsCount, price_mode: s.priceMode, layout_version: version,
      }));
      for (let i = 0; i < values.length; i += 1000) await t`insert into seat_inventory ${t(values.slice(i, i + 1000))}`;
    }
    await t`insert into seatmap_version (event_id, version, published_by, seat_count) values (${eventId}, ${version}, ${actor}, ${desired.length})`;
    return { ok: true, version, seats: desired.length, inserted: diff.insert.length, updated: diff.update.length, removed: diff.remove.length } as const;
  });
}

export interface SeatAvailabilityRow {
  seatId: string;
  zoneId: string;
  kind: 'seat' | 'table';
  label: string;
  /** BS126: row letter + seat number so the buyer map can say "Row C seat 7". */
  rowLabel: string | null;
  seatNumber: number | null;
  tierId: string | null;
  seatsCount: number;
  priceMode: 'per_seat' | 'per_table';
  /** Public state: an expired hold reads as available; blocked reads as reserved. */
  state: 'available' | 'held' | 'sold' | 'reserved';
}

/** Buyer-facing availability for an event's seats (no order ids leave). */
export async function readSeatAvailability(sql: Sql, eventId: string): Promise<{ version: number; seats: SeatAvailabilityRow[] }> {
  const [{ v }] = await sql`select coalesce(max(version), 0) as v from seatmap_version where event_id = ${eventId}`;
  const rows = await sql`
    select seat_id, zone_id, kind, label, row_label, seat_number, tier_id, seats_count, price_mode,
           case when state = 'held' and hold_expires_at <= now() then 'available'
                when state = 'blocked' then 'reserved'
                else state end as state
      from seat_inventory where event_id = ${eventId} order by zone_id, seat_number nulls last, seat_id`;
  return {
    version: Number(v),
    seats: rows.map((r: any) => ({ seatId: r.seat_id, zoneId: r.zone_id, kind: r.kind, label: r.label, rowLabel: r.row_label ?? null, seatNumber: r.seat_number == null ? null : Number(r.seat_number), tierId: r.tier_id, seatsCount: r.seats_count, priceMode: r.price_mode, state: r.state })),
  };
}

/** BS126: a buyer who abandons a seated checkout and starts again (same browser
    session) must not be blocked by their OWN earlier hold. Releases the previous
    order only when it is still pending, has never started a payment, and holds
    at least one of the seats now being asked for. Returns true if released. */
export async function releaseOwnSeatHold(sql: Sql, prevOrderId: string, seatIds: string[]): Promise<boolean> {
  if (!prevOrderId || !/^[0-9a-f-]{36}$/i.test(prevOrderId) || !seatIds.length) return false;
  return sql.begin(async (t: Sql) => {
    const [o] = await t`select id from "order" where id = ${prevOrderId}::uuid and status = 'pending' for update`;
    if (!o) return false;
    const [paying] = await t`select 1 from payment_transaction where order_id = ${prevOrderId}::uuid limit 1`;
    if (paying) return false;
    const [mine] = await t`select 1 from seat_inventory where hold_order_id = ${prevOrderId}::uuid and state = 'held' and seat_id = any(${seatIds}) limit 1`;
    if (!mine) return false;
    await t`select release_order_holds(${prevOrderId}::uuid)`;
    await t`update seat_inventory set state = 'available', hold_order_id = null, hold_expires_at = null, updated_at = now()
             where hold_order_id = ${prevOrderId}::uuid and state = 'held'`;
    await t`update "order" set status = 'expired' where id = ${prevOrderId}::uuid and status = 'pending'`;
    return true;
  });
}
