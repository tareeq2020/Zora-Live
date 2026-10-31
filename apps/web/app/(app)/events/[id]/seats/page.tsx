import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { seatmapEnabledFor } from '@/app/lib/seatmap-gate';
import { SeatMap } from './seat-map';

// /events/:id/seats — the event-scoped live seat map (BS126). Shown only when the
// zp_seatmap flag (or env override) is on for the event AND it has published
// seats; otherwise the buyer goes back to the event page's normal checkout.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Choose your seats — ZoraPass',
  description: 'Pick your exact seat, table or standing zone. Live availability.',
};

const API_URL = process.env.API_URL || 'http://localhost:4101';

async function organizerOf(id: string): Promise<{ id: string; org: string | null }> {
  try {
    const res = await fetch(`${API_URL}/api/events/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!res.ok) return { id, org: null };
    const ev = await res.json();
    return { id: typeof ev?.id === 'string' && ev.id ? ev.id : id, org: ev?.organizerHandle || null };
  } catch {
    return { id, org: null };
  }
}

export default async function SeatsPage({ params }: { params: { id: string } }) {
  const ev = await organizerOf(params.id);
  if (!(await seatmapEnabledFor(ev.id, ev.org))) redirect(`/events/${encodeURIComponent(params.id)}`);
  return <SeatMap eventId={params.id} />;
}
