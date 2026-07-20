import type { Metadata } from 'next';
import Link from 'next/link';
import { GetTicketButton } from './event-cta';
import type { CheckoutTier } from '../../../components/checkout-flow';
import styles from './event-page.module.css';

// Canonical EVENT CONTRACT route. One <EventPage> serves /events/:id (and, via the
// slug alias in the API's getEvent, the flagship URL /events/offshore). Lives
// OUTSIDE the (marketing) group: an event page is app-plane chrome, not the
// marketing <nav>/<footer>.

export const dynamic = 'force-dynamic';

const API_URL = process.env.API_URL || 'http://localhost:4101';
const CUR: Record<string, string> = { dar: 'TZS', zanzibar: 'TZS', nairobi: 'KES', accra: 'GHS', lagos: 'NGN' };
const PAL: Record<string, string> = {
  Festivals: '#B23A17', Nightlife: '#3D2A8F', Concerts: '#1E4FD8', Daytime: '#C46A28', Arts: '#0F6E56',
};

type ZoraEvent = {
  id: string;
  name: string;
  tagline?: string;
  category?: string;
  city?: string;
  venue?: string;
  dateLabel?: string;
  time?: string;
  priceFrom?: number;
  seated?: boolean;
  mega?: boolean;
  organizer?: string;
  organizerHandle?: string;
  // Present when the event is web-sellable (seed-tiers wires a GA tier). Its
  // presence flips the CTA from the app-claim toast to the real <CheckoutFlow>.
  webCheckout?: { tiers?: CheckoutTier[] };
};

async function fetchEvent(id: string): Promise<ZoraEvent | null> {
  const target = `${API_URL}/api/events/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(target, { cache: 'no-store' });
    if (!res.ok) {
      // The page renders its not-found branch on null. Log WHY so a proxy/API_URL
      // misconfig shows in Vercel runtime logs instead of a silent "not found".
      console.error(`[zora-web] event-page fetch ${target} -> HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as ZoraEvent;
  } catch (err) {
    console.error(`[zora-web] event-page fetch ${target} FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const ev = await fetchEvent(params.id);
  if (!ev) return { title: 'Event — ZORA' };
  const title = `${ev.name} — ZORA`;
  const description = ev.tagline || `${ev.name} on ZORA.`;
  const canonical = `/events/${params.id}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function EventPage({ params }: { params: { id: string } }) {
  const ev = await fetchEvent(params.id);

  if (!ev) {
    return (
      <main className={styles.wrap}>
        <div className={styles.notFound}>This event could not be found.</div>
      </main>
    );
  }

  const cur = CUR[ev.city || ''] || 'TZS';
  const price = (ev.priceFrom != null ? ev.priceFrom : 0).toLocaleString();
  const cover = PAL[ev.category || ''] || '#4C6FFF';
  // Same "when" line the storefront sheet builds, so both surfaces open an
  // identically-labelled checkout.
  const when = [ev.dateLabel || 'TBA', ev.time, ev.venue].filter(Boolean).join(' · ').toUpperCase();

  return (
    <main className={styles.wrap}>
      {ev.mega ? <div className={styles.megaBadge}>MEGA EVENT</div> : null}
      <p className={styles.eyebrow}>
        {(ev.category || 'EVENT').toUpperCase()} · {(ev.city || '').toUpperCase()}
      </p>
      <h1 className={styles.title}>{ev.name}</h1>
      {ev.tagline ? <p className={styles.tagline}>{ev.tagline}</p> : null}

      <div className={styles.cover} style={{ ['--coverA' as any]: cover }} />

      <div className={styles.meta}>
        <div>
          <div className={styles.metaKey}>Date</div>
          <div className={styles.metaVal}>
            {ev.dateLabel || 'TBA'}
            {ev.time ? ` · ${ev.time}` : ''}
          </div>
        </div>
        <div>
          <div className={styles.metaKey}>Venue</div>
          <div className={styles.metaVal}>{ev.venue || 'TBA'}</div>
        </div>
      </div>

      <div className={styles.buy}>
        <span>
          <small className={styles.priceLabel}>FROM</small>
          <b className={styles.priceVal}>
            {cur} {price}
          </b>
        </span>
        {ev.seated ? (
          <Link
            href={`/events/${params.id}/seats`}
            style={{
              color: '#fff',
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: '.02em',
              padding: '15px 26px',
              borderRadius: 12,
              textDecoration: 'none',
              background: 'var(--c-blue)',
            }}
          >
            CHOOSE YOUR SEATS →
          </Link>
        ) : (
          <GetTicketButton eventName={ev.name} when={when} tiers={ev.webCheckout?.tiers} />
        )}
      </div>

      <p className={styles.nofee}>The price is the price. No fees at checkout.</p>

      <div className={styles.foot}>
        <span>runs on zora</span>
        <Link href="/discover.html">← back to the marketplace</Link>
      </div>
    </main>
  );
}
