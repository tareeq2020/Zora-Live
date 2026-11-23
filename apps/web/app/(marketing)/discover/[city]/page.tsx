import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { DiscoverApp } from '../discover-app';
import { DISCOVER_CSS } from '../discover-shared';
import type { PublicCity } from '../../../lib/cities';

/* BS168: /discover/<city> — Discover opened on one city, a link organizers can
   share ("everything in Dar") and search engines can index. A city with no
   page (unknown, requested, declined, or hidden with no events) is a 404; a
   city an admin merged into another redirects there. */

const API_URL = process.env.API_URL || 'http://localhost:4101';

// Cached and refreshed every 30 s (the city list changes rarely).
export const revalidate = 30;

// No city pages are built ahead of time; each is rendered on first visit and
// then served from the cache (refreshed every 30 s).
export function generateStaticParams() {
  return [];
}

type Lookup = { city: PublicCity | null; redirect?: string; down?: boolean };

async function lookup(id: string): Promise<Lookup> {
  try {
    const r = await fetch(`${API_URL}/api/cities/${encodeURIComponent(id)}`, { next: { revalidate: 30 } });
    // Only the API's own "no such city" is a 404 page. Any other failure,
    // including an older API without this route during a deploy, is "down":
    // the page still opens and Discover handles it.
    if (r.status === 404) {
      const body = (await r.json().catch(() => null)) as { error?: string } | null;
      return body?.error === 'city_not_found' ? { city: null } : { city: null, down: true };
    }
    if (!r.ok) return { city: null, down: true };
    const d = (await r.json()) as { city?: PublicCity; redirect?: string };
    return { city: d.city ?? null, redirect: d.redirect };
  } catch {
    return { city: null, down: true };
  }
}

export async function generateMetadata({ params }: { params: { city: string } }): Promise<Metadata> {
  const { city } = await lookup(params.city);
  if (!city) return { title: "ZoraPass — What's on" };
  return {
    title: `What's on in ${city.name} — ZoraPass`,
    description: `Concerts, festivals, nights out and new experiences in ${city.name}.`,
    alternates: { canonical: `/discover/${city.id}` },
  };
}

export default async function DiscoverCityPage({ params }: { params: { city: string } }) {
  const { city, redirect, down } = await lookup(params.city);
  if (redirect) permanentRedirect(`/discover/${encodeURIComponent(redirect)}`);
  // The API being down is not a missing city: open Discover and let it show
  // its own error and retry.
  if (!city && !down) notFound();
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: DISCOVER_CSS }} />
      <div className="zd">
        <DiscoverApp initialCity={city} />
      </div>
    </>
  );
}
