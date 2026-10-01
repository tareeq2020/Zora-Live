import { apiFetch } from './client';
import { getEvent, type RemoteEvent } from './events';
import type { FloorPlan, Seat, SeatStatus } from '../seatmap/types';
import { getBooking, type BookingEvent } from '../data/floorPlans';

type ApiTier = {
  tierId?: string;
  name?: string;
  unitPrice?: number;
  price?: number;
  currency?: string;
  seats?: number;
  disabled?: boolean;
};

type ApiZone = {
  id: string;
  name: string;
  type: 'ga' | 'seated' | 'table';
  x: number;
  y: number;
  w: number;
  h: number;
  tierId?: string;
  price?: number;
  rows?: number;
  perRow?: number;
  tables?: number;
  perTable?: number;
  seats?: { id: string; label: string; state?: string }[];
  tableItems?: { id: string; label: string; seats?: number; state?: string }[];
};

type ApiPlan = {
  space?: { w?: number; h?: number };
  stage?: { x: number; y: number; w: number; h: number; label?: string } | null;
  zones?: ApiZone[];
};

export interface MobileBooking extends BookingEvent {
  tiers: ApiTier[];
}

const statusOf = (raw?: string): SeatStatus => {
  if (raw === 'held' || raw === 'sold' || raw === 'selected') return raw;
  if (raw === 'reserved') return 'held';
  return 'available';
};

const eventCurrency = (ev: RemoteEvent, tiers: ApiTier[]) =>
  tiers.find((t) => t.currency)?.currency || (ev.city === 'nairobi' ? 'KES' : 'TZS');

const tierForZone = (zone: ApiZone, tiers: ApiTier[]) => {
  const direct = tiers.find((t) => t.tierId && t.tierId === zone.tierId);
  if (direct) return direct;
  const byName = tiers.find((t) => t.name?.toLowerCase() === zone.name.toLowerCase());
  return byName ?? tiers[0] ?? null;
};

function makeSeat(input: Partial<Seat> & { id: string; x: number; y: number; price: number }): Seat {
  return {
    r: input.r ?? 12,
    kind: input.kind ?? 'table',
    status: input.status ?? 'available',
    capacity: input.capacity ?? 1,
    label: input.label ?? input.id,
    sectionId: input.sectionId,
    ...input,
  };
}

function zoneSeats(zone: ApiZone, tiers: ApiTier[], width: number): Seat[] {
  const tier = tierForZone(zone, tiers);
  const price = Number(zone.price ?? tier?.unitPrice ?? tier?.price ?? 0);
  const tierId = tier?.tierId;

  if (zone.type === 'table') {
    const tables = zone.tableItems?.length
      ? zone.tableItems
      : Array.from({ length: Math.max(1, Number(zone.tables ?? 1)) }, (_, i) => ({
          id: `${zone.id}-t${i + 1}`,
          label: `T${i + 1}`,
          seats: Number(zone.perTable ?? tier?.seats ?? 6),
          state: 'available',
        }));
    return tables.map((table, i) => {
      const x = zone.x + zone.w * ((i + 1) / (tables.length + 1));
      const y = zone.y + zone.h * (i % 2 ? 0.68 : 0.38);
      return makeSeat({
        id: table.id,
        label: table.label,
        x,
        y,
        price,
        capacity: Math.max(1, Number(table.seats ?? zone.perTable ?? tier?.seats ?? 6)),
        sectionId: tierId,
        status: statusOf(table.state),
      });
    });
  }

  if (zone.type === 'seated') {
    const rows = Math.max(1, Number(zone.rows ?? 1));
    const perRow = Math.max(1, Number(zone.perRow ?? zone.seats?.length ?? 1));
    const seats = zone.seats?.length ? zone.seats : Array.from({ length: rows * perRow }, (_, i) => ({ id: `${zone.id}-s${i + 1}`, label: String(i + 1), state: 'available' }));
    return seats.map((seat, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      return makeSeat({
        id: seat.id,
        label: seat.label,
        kind: 'seat',
        x: zone.x + zone.w * ((col + 1) / (perRow + 1)),
        y: zone.y + zone.h * ((row + 1) / (rows + 1)),
        r: Math.max(8, width / 120),
        price,
        capacity: 1,
        sectionId: tierId,
        status: statusOf(seat.state),
      });
    });
  }

  return [makeSeat({
    id: `${zone.id}-ga`,
    label: zone.name,
    x: zone.x + zone.w / 2,
    y: zone.y + zone.h / 2,
    r: Math.max(14, Math.min(zone.w, zone.h) / 8),
    price,
    capacity: 1,
    sectionId: tierId,
  })];
}

function normalizePlan(plan: ApiPlan, tiers: ApiTier[]): FloorPlan {
  const width = Math.max(1, Number(plan.space?.w ?? 300));
  const height = Math.max(1, Number(plan.space?.h ?? 250));
  const scale = Math.min(1, 300 / width);
  const seats = (plan.zones ?? []).flatMap((zone) => zoneSeats(zone, tiers, width));
  const normalizedRadius = (seat: Seat) => {
    const scaled = seat.r * scale;
    if (seat.kind === 'table') return Math.max(12, scaled);
    return Math.max(7, scaled);
  };

  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    stage: plan.stage ? {
      x: plan.stage.x * scale,
      y: plan.stage.y * scale,
      w: plan.stage.w * scale,
      h: plan.stage.h * scale,
    } : undefined,
    stageLabel: plan.stage?.label ?? 'STAGE',
    seats: seats.map((seat) => ({
      ...seat,
      x: seat.x * scale,
      y: seat.y * scale,
      r: normalizedRadius(seat),
    })),
  };
}

export async function getMobileBooking(eventId?: string): Promise<MobileBooking> {
  const fallback = getBooking(eventId);
  if (!eventId) return { ...fallback, tiers: [] };

  const [ev, plan] = await Promise.all([
    getEvent(eventId),
    apiFetch<ApiPlan>(`/api/events/${encodeURIComponent(eventId)}/floorplan`, { auth: false }),
  ]);
  const tiers = Array.isArray((ev as any).webCheckout?.tiers)
    ? (ev as any).webCheckout.tiers.filter((t: ApiTier) => t?.tierId && !t.disabled)
    : [];
  const hasZones = Array.isArray(plan.zones) && plan.zones.length > 0;

  return {
    id: ev.id,
    name: ev.name,
    venue: ev.props.venue || fallback.venue,
    date: ev.props.dateLabel || fallback.date,
    currency: eventCurrency(ev, tiers),
    plan: hasZones ? normalizePlan(plan, tiers) : fallback.plan,
    tiers,
  };
}
