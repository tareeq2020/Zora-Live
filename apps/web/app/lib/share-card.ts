import { headers } from 'next/headers';

/* BS86 — resolve the absolute og:image / twitter:image URL for the server-rendered
   share card (GET /api/share-card/…png). The card route lives on the API; the web
   proxies /api/* to it, so the crawler-facing URL is on the PUBLIC web origin (built
   from the request host) and carries the ?v=<digest> the meta endpoint computes, so
   unfurl crawlers hit the CDN/edge cache rather than a fresh render.

   Returns null when the org/event isn't publicly shareable (suspended / unpublished
   → the meta route 404s) so the page simply omits the tag. */

const API_URL = process.env.API_URL || 'http://localhost:4101';

export type ShareCardImage = { url: string; width: number; height: number; alt: string };

export async function shareCardImage(
  handle: string | undefined | null,
  eventId?: string | null,
  alt = 'Share card',
): Promise<ShareCardImage | null> {
  if (!handle) return null;
  try {
    const metaPath = eventId
      ? `${encodeURIComponent(handle)}/${encodeURIComponent(eventId)}/meta`
      : `${encodeURIComponent(handle)}/meta`;
    const res = await fetch(`${API_URL}/api/share-card/${metaPath}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { path?: string };
    if (!data.path) return null;

    const h = headers();
    const host = h.get('host') || '';
    const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
    const url = host ? `${proto}://${host}${data.path}` : data.path;
    return { url, width: 1200, height: 630, alt };
  } catch {
    return null;
  }
}
