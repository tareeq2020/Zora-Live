import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import StorefrontClient, { type StorefrontEvent, type StorefrontTheme } from './storefront-client';
import type { InventoryPool } from '../../../components/event-card';
import { shareCardImage } from '@/app/lib/share-card';
import { eventDateLabel, isPastEvent } from '@/app/lib/event-date';

// PR-F5 — the tenant STOREFRONT INDEX route. The middleware rewrites the /@handle
// front door (and a tenant subdomain's "/") to /storefront/:handle, which lands
// here. This resolves the handle -> organizer + their event index via the API and
// renders the multi-event storefront (StorefrontClient). Distinct from the
// single-event leaf (/@handle/events/:id -> the storefront/[handle]/events/[id]
// React route). Lives in the (app) group
// (app-plane chrome — no marketing nav/footer).

export const dynamic = 'force-dynamic';

const API_URL = process.env.API_URL || 'http://localhost:4101';

const CITY_LABEL: Record<string, string> = {
  dar: 'Dar es Salaam',
  zanzibar: 'Zanzibar',
  nairobi: 'Nairobi',
  accra: 'Accra',
  lagos: 'Lagos',
};

type Organizer = { handle: string; name: string; subdomain: string; status?: string };

async function fetchTenant(handle: string): Promise<Organizer | null> {
  try {
    const res = await fetch(`${API_URL}/api/tenant/${encodeURIComponent(handle)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as Organizer;
  } catch {
    return null;
  }
}

// BS24: a web-sellable drop whose tiers are ALL disabled has nothing on sale — it's
// hidden from the storefront entirely (no card, no leaf). App-claim drops (no web
// catalog) are untouched. This mirrors the leaf's not-available guard.
function hasSomethingOnSale(ev: StorefrontEvent): boolean {
  const tiers = ev.webCheckout?.tiers;
  if (!tiers || tiers.length === 0) return true; // app-claim / no web catalog
  return tiers.some((t) => t.tierId && !t.disabled);
}

async function fetchEvents(handle: string): Promise<StorefrontEvent[]> {
  try {
    const res = await fetch(`${API_URL}/api/events`, { cache: 'no-store' });
    if (!res.ok) return [];
    const all = (await res.json()) as Array<StorefrontEvent & { organizerHandle?: string }>;
    // BS147: only what's ON (past dates drop off) and one consistent date label.
    return all
      .filter((ev) => ev.organizerHandle === handle)
      .filter(hasSomethingOnSale)
      .filter((ev) => !isPastEvent((ev as { date?: string }).date))
      .map((ev) => ({ ...ev, dateLabel: eventDateLabel((ev as { date?: string }).date, ev.dateLabel) }));
  } catch {
    return [];
  }
}

// BS120: live stock per tier (capacity + available) so the card chip reflects
// real tier state (ON SALE / FEW LEFT / ALMOST GONE / SOLD OUT). Fails soft: no
// inventory → null → the cards carry no stock chip (never a guessed one).
async function fetchInventory(): Promise<Record<string, InventoryPool> | null> {
  try {
    const res = await fetch(`${API_URL}/api/inventory`, { cache: 'no-store' });
    if (!res.ok) return null;
    const d = (await res.json()) as { pools?: InventoryPool[] };
    const map: Record<string, InventoryPool> = {};
    for (const p of d.pools || []) if (p && p.tierId) map[p.tierId] = p;
    return map;
  } catch {
    return null;
  }
}

// Published storefront theme, scoped to this organizer's own row (BS47 — the
// endpoint used to serve a single global theme; every organizer now gets theirs).
async function fetchTheme(handle: string): Promise<StorefrontTheme & { brandName?: string }> {
  try {
    const res = await fetch(`${API_URL}/api/storefront-theme?handle=${encodeURIComponent(handle)}`, { cache: 'no-store' });
    if (!res.ok) return {};
    return (await res.json()) as StorefrontTheme & { handle?: string; brandName?: string };
  } catch {
    return {};
  }
}

// Owner-only: does the current viewer own THIS handle? (F-AUTH: /api/me ->
// { role, organizerHandle }.) Forward the request cookie so the session resolves.
async function isOwner(handle: string): Promise<boolean> {
  try {
    const cookie = headers().get('cookie') || '';
    const me = await fetch(`${API_URL}/api/me`, { headers: { cookie }, cache: 'no-store' }).then((r) => r.json());
    return me && me.role === 'organizer' && me.organizerHandle === handle;
  } catch {
    return false;
  }
}

export async function generateMetadata({ params }: { params: { handle: string } }): Promise<Metadata> {
  const org = await fetchTenant(params.handle);
  if (!org) return { title: 'Storefront — ZoraPass' };
  const title = `${org.name} — ZoraPass`;
  const description = `Live events from ${org.name}. Passes run on ZoraPass.`;
  // BS86: the server-rendered, brand-matched share card is this page's unfurl image.
  const card = await shareCardImage(params.handle, null, `${org.name} on ZoraPass`);
  const images = card ? [{ url: card.url, width: card.width, height: card.height, alt: card.alt }] : undefined;
  return {
    title,
    description,
    openGraph: { title, description, type: 'website', ...(images ? { images } : {}) },
    ...(images ? { twitter: { card: 'summary_large_image', title, description, images: [card!.url] } } : {}),
  };
}

export default async function StorefrontPage({ params }: { params: { handle: string } }) {
  const handle = params.handle;
  const [org, events, theme, owner, pools] = await Promise.all([
    fetchTenant(handle),
    fetchEvents(handle),
    fetchTheme(handle),
    isOwner(handle),
    fetchInventory(),
  ]);

  if (!org) notFound();

  const brandName = theme.brandName || org.name;
  const cityCode = events.find((e) => e.city)?.city || '';
  const cityLabel = (CITY_LABEL[cityCode] || cityCode).toUpperCase();
  const eyebrow = cityLabel ? `${cityLabel} · STOREFRONT` : 'STOREFRONT';
  const lede = `Live events from ${brandName}. Passes run on ZoraPass, and your table is your table.`;
  const aboutHeading = `Every event from ${brandName}, in one place.`; // BS147: reads right for "The Brunch City"
  const aboutBody =
    `This is the ${brandName} storefront — the full index of upcoming events. Passes are issued ` +
    `and honoured by ZoraPass, and your pass lives in your pocket.`;

  return (
    <StorefrontClient
      handle={handle}
      brandName={brandName}
      subdomain={org.subdomain}
      eyebrow={eyebrow}
      lede={lede}
      aboutHeading={aboutHeading}
      aboutBody={aboutBody}
      events={events}
      theme={theme}
      canManage={owner}
      pools={pools}
    />
  );
}
