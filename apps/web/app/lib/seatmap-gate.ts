import { SEATMAP_ENABLED } from './flags';

/* BS126: server-side gate for the live buyer seat map.

   An event uses the seat map only when BOTH hold:
     1. the seat map is switched on for it — the settings-backed `zp_seatmap`
        flag (GET /api/flags?org=&event=) or the NEXT_PUBLIC_ZP_SEATMAP env
        override, and
     2. the organizer has PUBLISHED seats (GET /api/events/:id/seats is non-empty).
   Anything else — flag off, no seats, or an API that predates the seats route
   (404) or is unreachable — falls back to the normal checkout. The API redeploys
   on its own schedule, so this must fail closed. */

const API_URL = process.env.API_URL || 'http://localhost:4101';

async function getJson(path: string): Promise<any | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function seatmapEnabledFor(eventId: string, orgHandle?: string | null): Promise<boolean> {
  if (!eventId) return false;
  const qs = new URLSearchParams({ event: eventId });
  if (orgHandle) qs.set('org', orgHandle);
  const [flags, seats] = await Promise.all([
    SEATMAP_ENABLED ? Promise.resolve(null) : getJson(`/api/flags?${qs.toString()}`),
    getJson(`/api/events/${encodeURIComponent(eventId)}/seats`),
  ]);
  const flagOn = SEATMAP_ENABLED || flags?.zp_seatmap === true;
  const hasSeats = Array.isArray(seats?.seats) && seats.seats.length > 0;
  return flagOn && hasSeats;
}
