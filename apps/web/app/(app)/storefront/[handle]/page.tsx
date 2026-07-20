import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import StorefrontClient, { type StorefrontEvent, type StorefrontTheme } from './storefront-client';

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

async function fetchEvents(handle: string): Promise<StorefrontEvent[]> {
  try {
    const res = await fetch(`${API_URL}/api/events`, { cache: 'no-store' });
    if (!res.ok) return [];
    const all = (await res.json()) as Array<StorefrontEvent & { organizerHandle?: string }>;
    return all.filter((ev) => ev.organizerHandle === handle);
  } catch {
    return [];
  }
}

// Published storefront theme. The endpoint is a single published theme; only apply
// it when it belongs to THIS handle (otherwise fall back to the default palette).
async function fetchTheme(handle: string): Promise<StorefrontTheme & { brandName?: string }> {
  try {
    const res = await fetch(`${API_URL}/api/storefront-theme`, { cache: 'no-store' });
    if (!res.ok) return {};
    const t = (await res.json()) as StorefrontTheme & { handle?: string; brandName?: string };
    return t && t.handle === handle ? t : {};
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
  if (!org) return { title: 'Storefront — ZORA' };
  const title = `${org.name} — ZORA`;
  const description = `Live events from ${org.name}. Passes run on Zora — no fees at checkout, ever.`;
  return { title, description, openGraph: { title, description, type: 'website' } };
}

export default async function StorefrontPage({ params }: { params: { handle: string } }) {
  const handle = params.handle;
  const [org, events, theme, owner] = await Promise.all([
    fetchTenant(handle),
    fetchEvents(handle),
    fetchTheme(handle),
    isOwner(handle),
  ]);

  if (!org) notFound();

  const brandName = theme.brandName || org.name;
  const cityCode = events.find((e) => e.city)?.city || '';
  const cityLabel = (CITY_LABEL[cityCode] || cityCode).toUpperCase();
  const eyebrow = cityLabel ? `${cityLabel} · STOREFRONT` : 'STOREFRONT';
  const lede =
    `Live events from ${brandName}. What you see is what you pay — passes run on Zora, ` +
    `with no fees appearing at the last second, and your table is your table.`;
  const aboutHeading = `Every ${brandName} event, in one place.`;
  const aboutBody =
    `This is the ${brandName} storefront — the full index of upcoming events. Tickets are issued ` +
    `and honored by Zora: honest pricing, no surprise fees, and a pass that lives in your pocket.`;

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
    />
  );
}
