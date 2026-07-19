import type { Metadata } from 'next';
import { SeatMap } from './seat-map';

// /events/:id/seats — the real, event-scoped seat-selection route that replaces
// the global seatmap.html?ev=NAME page. In the (app) plane (no marketing chrome);
// the map itself is a full-viewport client takeover.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Choose your seats — ZORA',
  description: 'Pick your exact seat or standing zone on the floor plan. Pinch to zoom, tap to select.',
};

export default function SeatsPage({ params }: { params: { id: string } }) {
  return <SeatMap eventId={params.id} />;
}
