export type SeatStatus = 'available' | 'held' | 'sold' | 'selected';

export interface Seat {
  id: string;
  x: number;              // intrinsic map coordinate (same units as FloorPlan.width/height)
  y: number;
  r: number;              // draw + hit radius, in map units
  status: SeatStatus;
  kind: 'seat' | 'table';
  label?: string;
  price: number;          // minor units (e.g. TZS cents)
  capacity?: number;
  sectionId?: string;
}

export interface FloorPlan {
  width: number;          // intrinsic design size — the SVG viewBox
  height: number;
  stageLabel?: string;
  stage?: { x: number; y: number; w: number; h: number };
  seats: Seat[];
}
