// Shared organizer-event state. Dashboard reads it (and it ticks live via a
// simulated sales feed); the Edit screen writes to it via applyEdit().
import { create } from 'zustand';

export interface Tier { name: string; price: number; sold: number; cap: number }

export interface OrganizerEvent {
  name: string;
  tag: string;
  date: string;
  city: string;
  status: 'live' | 'upcoming' | 'draft' | 'past';
  cap: number;            // total venue capacity
  checked: number;        // through the gate
  velo: number;           // sales / hour
  pendingTZS: number;     // pending settlement
  tiers: Tier[];
}

interface EventStore {
  event: OrganizerEvent;
  recordSale: (tierIndex: number, qty: number) => void;
  applyEdit: (patch: { cap?: number; tiers?: Tier[] }) => void;
}

const OFFSHORE: OrganizerEvent = {
  name: 'OFFSHORE',
  tag: 'Daytime Yacht Groove',
  date: 'Sat 25 Jul 2026',
  city: 'Dar es Salaam',
  status: 'live',
  cap: 3200,
  checked: 842,
  velo: 148,
  pendingTZS: 27_200_000,
  tiers: [
    { name: 'Wave 01', price: 65_000, sold: 1000, cap: 1000 },
    { name: 'Wave 02', price: 85_000, sold: 250, cap: 1200 },
    { name: 'Cabana — crew of 6', price: 900_000, sold: 34, cap: 40 },
  ],
};

export const useEventStore = create<EventStore>((set) => ({
  event: OFFSHORE,
  recordSale: (tierIndex, qty) =>
    set((s) => ({
      event: {
        ...s.event,
        tiers: s.event.tiers.map((t, i) => (i === tierIndex ? { ...t, sold: Math.min(t.cap, t.sold + qty) } : t)),
      },
    })),
  applyEdit: (patch) =>
    set((s) => ({ event: { ...s.event, cap: patch.cap ?? s.event.cap, tiers: patch.tiers ?? s.event.tiers } })),
}));

// Derived values (single source of truth: numbers come from the tiers).
export const soldOf = (e: OrganizerEvent) => e.tiers.reduce((n, t) => n + t.sold, 0);
export const grossOf = (e: OrganizerEvent) => e.tiers.reduce((n, t) => n + t.sold * t.price, 0);

// Formatters
export const mTZS = (n: number) => (n >= 1_000_000 ? 'TZS ' + (n / 1_000_000).toFixed(1) + 'M' : 'TZS ' + n.toLocaleString());
export const kTZS = (n: number) =>
  n >= 1_000_000 ? 'TZS ' + (n / 1_000_000).toFixed(1) + 'M' : n >= 1000 ? 'TZS ' + Math.round(n / 1000) + 'k' : 'TZS ' + n;
