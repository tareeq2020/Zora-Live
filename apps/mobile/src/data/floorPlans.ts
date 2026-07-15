// One floor plan per event. Layouts differ (grid / club / rooftop / warehouse)
// so each event books against its own map, prices and availability.
import type { FloorPlan, Seat } from '../seatmap/types';

type Layout = 'grid' | 'club' | 'rooftop' | 'warehouse';

// price is in minor units (e.g. TZS/KES cents).
const seat = (id: string, x: number, y: number, r: number, price: number, cap: number, sold: boolean): Seat => ({
  id, x, y, r, kind: 'table', label: id, price, capacity: cap, status: sold ? 'sold' : 'available',
});

function gridTables(price: number, seed: number): Seat[] {
  const s: Seat[] = [];
  const cols = [80, 150, 220];
  const rows = [70, 105, 140];
  let i = 1;
  for (const y of rows) for (const x of cols) { s.push(seat('T' + i, x, y, 13, price, 6, (i + seed) % 7 === 0 || (i + seed) % 9 === 0)); i++; }
  s.push(seat('T10', 45, 118, 11, Math.round(price * 0.66), 4, seed % 2 === 0));
  s.push(seat('T11', 255, 118, 11, Math.round(price * 0.66), 4, seed % 2 === 1));
  return s;
}
function clubTables(price: number, seed: number): Seat[] {
  const s: Seat[] = [];
  let i = 1;
  for (let k = 0; k < 4; k++) { s.push(seat('L' + (k + 1), 50, 72 + k * 40, 12, price, 6, (i + seed) % 5 === 0)); i++; }
  for (let k = 0; k < 4; k++) { s.push(seat('R' + (k + 1), 250, 72 + k * 40, 12, price, 6, (i + seed) % 4 === 0)); i++; }
  for (let k = 0; k < 3; k++) { s.push(seat('F' + (k + 1), 110 + k * 40, 205, 13, Math.round(price * 1.3), 8, (i + seed) % 6 === 0)); i++; }
  return s;
}
function rooftopTables(price: number, seed: number): Seat[] {
  const pos = [[90, 82], [210, 82], [60, 132], [150, 122], [240, 132], [110, 182], [190, 182], [150, 216]];
  return pos.map((p, i) => seat('R' + (i + 1), p[0], p[1], 14, price, 4, (i + seed) % 5 === 0));
}
function warehouseTables(price: number, seed: number): Seat[] {
  const s: Seat[] = [];
  let i = 1;
  for (let k = 0; k < 5; k++) { s.push(seat('A' + (k + 1), 60 + k * 45, 82, 12, Math.round(price * 1.4), 6, (i + seed) % 4 === 0)); i++; }
  for (let k = 0; k < 5; k++) { s.push(seat('B' + (k + 1), 60 + k * 45, 122, 12, price, 6, (i + seed) % 5 === 0)); i++; }
  return s;
}

function buildPlan(layout: Layout, price: number, seed: number, stageLabel = 'STAGE'): FloorPlan {
  const seats =
    layout === 'grid' ? gridTables(price, seed)
    : layout === 'club' ? clubTables(price, seed)
    : layout === 'rooftop' ? rooftopTables(price, seed)
    : warehouseTables(price, seed);
  const stage = layout === 'rooftop' ? { x: 100, y: 14, w: 100, h: 24 } : { x: 70, y: 12, w: 160, h: 26 };
  return { width: 300, height: 250, stageLabel, stage, seats };
}

export interface BookingEvent {
  id: string;
  name: string;
  venue: string;
  date: string;
  currency: string;
  plan: FloorPlan;
}

export const bookingCatalog: Record<string, BookingEvent> = {
  offshore:  { id: 'offshore',  name: 'OFFSHORE',         venue: 'Yacht · Dar',        date: 'Sat 25 Jul', currency: 'TZS', plan: buildPlan('grid', 90_000_000, 0) },
  kultur:    { id: 'kultur',    name: 'KULTUR NIGHTS',    venue: 'Nairobi',            date: 'Fri 15 Aug', currency: 'KES', plan: buildPlan('club', 4_000_000, 2) },
  sundowner: { id: 'sundowner', name: 'SUNDOWNER 03',     venue: 'Rooftop · Zanzibar', date: 'Sun 24 Aug', currency: 'TZS', plan: buildPlan('rooftop', 30_000_000, 1, 'DJ') },
  warehouse: { id: 'warehouse', name: 'WAREHOUSE',        venue: 'Dar',                date: 'Sat 6 Sep',  currency: 'TZS', plan: buildPlan('warehouse', 25_000_000, 3) },
  jazz:      { id: 'jazz',      name: 'RIVERSIDE JAZZ',   venue: 'Dar',                date: 'Fri 12 Sep', currency: 'TZS', plan: buildPlan('club', 40_000_000, 4) },
  amapiano:  { id: 'amapiano',  name: 'AMAPIANO ALL DAY', venue: 'Dar',                date: 'Sat 20 Sep', currency: 'TZS', plan: buildPlan('grid', 35_000_000, 5) },
};

export const getBooking = (id?: string): BookingEvent => (id ? bookingCatalog[id] : undefined) ?? bookingCatalog.offshore;
