export type SeatMapZoneKind = 'ga' | 'seated' | 'table';
export type SeatMapAvailability = 'available' | 'selected' | 'held' | 'sold' | 'reserved';

export interface SeatMapSpace {
  w: number;
  h: number;
}

export interface SeatMapPoint {
  x: number;
  y: number;
}

export interface SeatMapStage extends SeatMapPoint {
  w: number;
  h: number;
  label?: string;
}

export interface SeatMapSeat {
  id: string;
  label: string;
  row?: string;
  number?: number;
  state: SeatMapAvailability;
}

export interface SeatMapTable {
  id: string;
  label: string;
  seats: number;
  state: SeatMapAvailability;
}

export interface SeatMapZone {
  id: string;
  name: string;
  type: SeatMapZoneKind;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  tierId?: string;
  price?: number;
  capacity?: number;
  sold?: number;
  rows?: number;
  perRow?: number;
  tables?: number;
  perTable?: number;
  /** BS127: table zones charge per table (default) or per seat. */
  priceMode?: 'per_table' | 'per_seat';
  seats?: SeatMapSeat[];
  tableItems?: SeatMapTable[];
}

export interface SeatMapPlan {
  version: 1;
  eventId?: string;
  venueName?: string;
  mapImageUrl?: string;
  space: SeatMapSpace;
  stage?: SeatMapStage | null;
  zones: SeatMapZone[];
  updatedAt?: string | null;
}

export interface SeatMapSelection {
  zoneId: string;
  kind: SeatMapZoneKind;
  quantity?: number;
  seatIds?: string[];
  tableIds?: string[];
}

export interface SeatMapHold {
  id: string;
  eventId: string;
  expiresAt: string;
  selections: SeatMapSelection[];
}

const DEFAULT_SPACE: SeatMapSpace = { w: 1600, h: 900 };
const MAX_ZONE_SEATS = 5000;
/** BS139: finite number or fallback (Number('x') is NaN). */
const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const AVAILABILITY_ALIASES: Record<string, SeatMapAvailability> = {
  avail: 'available',
  available: 'available',
  selected: 'selected',
  held: 'held',
  hold: 'held',
  sold: 'sold',
  reserved: 'reserved',
};

export function normalizeSeatMapAvailability(raw: unknown): SeatMapAvailability {
  return AVAILABILITY_ALIASES[String(raw ?? '').toLowerCase()] ?? 'available';
}

export function normalizeSeatMapZoneKind(raw: unknown): SeatMapZoneKind {
  const kind = String(raw ?? '').toLowerCase();
  if (kind === 'ga' || kind === 'table' || kind === 'seated') return kind;
  return 'seated';
}

export function zoneCapacity(zone: Pick<SeatMapZone, 'type' | 'capacity' | 'rows' | 'perRow' | 'tables' | 'perTable' | 'seats' | 'tableItems'>): number {
  if (zone.type === 'ga') return Math.max(0, Number(zone.capacity ?? 0));
  if (zone.type === 'table') {
    if (Array.isArray(zone.tableItems) && zone.tableItems.length) {
      return zone.tableItems.reduce((sum, table) => sum + Math.max(0, Number(table.seats ?? 0)), 0);
    }
    return Math.max(0, Number(zone.tables ?? 0)) * Math.max(1, Number(zone.perTable ?? 1));
  }
  if (Array.isArray(zone.seats) && zone.seats.length) return zone.seats.length;
  return Math.max(1, Number(zone.rows ?? 1)) * Math.max(1, Number(zone.perRow ?? 1));
}

export function normalizeSeatMapPlan(input: any, eventId?: string): SeatMapPlan {
  const zones = Array.isArray(input?.zones) ? input.zones : [];
  return {
    version: 1,
    eventId: eventId ?? input?.eventId,
    venueName: input?.venueName,
    mapImageUrl: input?.mapImageUrl,
    space: {
      w: Math.max(1, num(input?.space?.w, DEFAULT_SPACE.w)),
      h: Math.max(1, num(input?.space?.h, DEFAULT_SPACE.h)),
    },
    stage: input?.stage ?? null,
    zones: zones.map(normalizeSeatMapZone),
    updatedAt: input?.updatedAt ?? null,
  };
}

function normalizeSeatMapZone(zone: any): SeatMapZone {
  const type = normalizeSeatMapZoneKind(zone?.type);
  const normalized: SeatMapZone = {
    id: String(zone?.id ?? ''),
    name: String(zone?.name ?? 'Zone'),
    type,
    x: num(zone?.x, 0),
    y: num(zone?.y, 0),
    w: Math.max(1, num(zone?.w, 100)),
    h: Math.max(1, num(zone?.h, 100)),
    color: zone?.color,
    tierId: zone?.tierId,
    price: zone?.price == null ? undefined : Number(zone.price),
  };

  if (type === 'ga') {
    normalized.capacity = Math.max(0, Number(zone?.capacity ?? zone?.cap ?? 0));
    normalized.sold = Math.max(0, Number(zone?.sold ?? 0));
  } else if (type === 'table') {
    normalized.tables = Math.max(1, Number(zone?.tables ?? 1));
    normalized.perTable = Math.max(1, Number(zone?.perTable ?? 1));
    normalized.priceMode = zone?.priceMode === 'per_seat' ? 'per_seat' : 'per_table';
    if (Array.isArray(zone?.tableItems)) {
      normalized.tableItems = zone.tableItems.slice(0, MAX_ZONE_SEATS).map((table: any) => ({
        id: String(table?.id ?? ''),
        label: String(table?.label ?? table?.num ?? 'Table'),
        seats: Math.max(1, Number(table?.seats ?? zone?.perTable ?? 1)),
        state: normalizeSeatMapAvailability(table?.state),
      }));
    }
  } else {
    normalized.rows = Math.max(1, Number(zone?.rows ?? 1));
    normalized.perRow = Math.max(1, Number(zone?.perRow ?? 1));
    if (Array.isArray(zone?.seats)) {
      normalized.seats = zone.seats.slice(0, MAX_ZONE_SEATS).map((seat: any) => ({
        id: String(seat?.id ?? ''),
        label: String(seat?.label ?? ''),
        row: seat?.row == null ? undefined : String(seat.row),
        number: seat?.number == null ? undefined : Number(seat.number),
        state: normalizeSeatMapAvailability(seat?.state),
      }));
    }
  }

  return normalized;
}
