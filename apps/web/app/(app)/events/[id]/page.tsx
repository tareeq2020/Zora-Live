import type { Metadata } from 'next';
import Link from 'next/link';
import { GetTicketButton } from './event-cta';
import type { CheckoutTier } from '../../../components/checkout-flow';
import styles from './event-page.module.css';
import { shareCardImage } from '@/app/lib/share-card';
import { seatmapEnabledFor } from '@/app/lib/seatmap-gate';
import ViewBeacon from '@/app/components/view-beacon';
import { fetchInstallmentOffer, InstallmentOfferNote } from '@/app/components/installment-offer';
import { eventDateLabel } from '@/app/lib/event-date';

// Canonical EVENT CONTRACT route. One <EventPage> serves /events/:id (and, via the
// slug alias in the API's getEvent, the flagship URL /events/offshore). Lives
// OUTSIDE the (marketing) group: an event page is app-plane chrome, not the
// marketing <nav>/<footer>.

export const dynamic = 'force-dynamic';

const API_URL = process.env.API_URL || 'http://localhost:4101';
const CUR: Record<string, string> = { dar: 'TZS', zanzibar: 'TZS', nairobi: 'KES', accra: 'GHS', lagos: 'NGN' };
// City names in full in body copy (04_UI_COPY rule 7).
const CITY: Record<string, string> = {
  dar: 'Dar es Salaam', zanzibar: 'Zanzibar', nairobi: 'Nairobi', accra: 'Accra', lagos: 'Lagos',
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
  cover?: string;
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
    const ev = (await res.json()) as ZoraEvent & { date?: string };
    return { ...ev, dateLabel: eventDateLabel(ev.date, ev.dateLabel) }; // BS147
  } catch (err) {
    console.error(`[zora-web] event-page fetch ${target} FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const ev = await fetchEvent(params.id);
  if (!ev) return { title: 'Event — ZoraPass' };
  const title = `${ev.name} — ZoraPass`;
  const description = ev.tagline || `${ev.name} on ZoraPass.`;
  const canonical = `/events/${params.id}`;
  // BS86: the brand-matched drop card is the unfurl image when the event belongs to
  // an organizer (the card reads that org's theme + this event's cover).
  const card = await shareCardImage(ev.organizerHandle, ev.id, `${ev.name} — get passes`);
  const images = card ? [{ url: card.url, width: card.width, height: card.height, alt: card.alt }] : undefined;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: 'website', ...(images ? { images } : {}) },
    twitter: { card: 'summary_large_image', title, description, ...(images ? { images: [card!.url] } : {}) },
  };
}

export default async function EventPage({ params }: { params: { id: string } }) {
  const ev = await fetchEvent(params.id);

  if (!ev) {
    return (
      <div className={styles.page}>
        <main className={styles.wrap}>
          <div className={styles.notFound}>This event could not be found.</div>
        </main>
      </div>
    );
  }

  // BS126: live seat map only when zp_seatmap is on AND seats are published.
  const [seatmap, instOffer] = await Promise.all([
    seatmapEnabledFor(ev.id || params.id, ev.organizerHandle),
    // BS134: installment note — absent when the flag/offer is off or the API is older.
    fetchInstallmentOffer(ev.id || params.id),
  ]);
  const cur = CUR[ev.city || ''] || 'TZS';
  // 04_UI_COPY money: `TSh 25,000`, symbol first, thousands separators.
  const curLabel = cur === 'TZS' ? 'TSh' : cur;
  const price = (ev.priceFrom != null ? ev.priceFrom : 0).toLocaleString('en-US');
  // Same "when" line the storefront sheet builds, so both surfaces open an
  // identically-labelled checkout.
  const when = [ev.dateLabel || 'TBA', ev.time, ev.venue].filter(Boolean).join(' · ').toUpperCase();
  const city = ev.city ? CITY[ev.city] || ev.city : '';

  return (
    <div className={styles.page}>
      <ViewBeacon kind="event" org={ev.organizerHandle} event={ev.id} />
      <header className={styles.top}>
        <Link href="/" className={styles.logo} aria-label="ZoraPass home">
          <img src="/brand/logo/svg/zorapass-wordmark-black.svg" alt="ZoraPass" />
        </Link>
        <Link href="/discover.html" className={styles.back}>
          ← WHAT&apos;S ON
        </Link>
      </header>

      <div className={styles.wrap}>
        <main className={styles.main}>
          <div className={styles.cover} role="img" aria-label={`${ev.name} artwork`}>
            <img
              className={styles.stamp}
              src="/brand/stamps/svg/zp-stamp-zorapass-dar-signal.svg"
              alt=""
              aria-hidden="true"
            />
          </div>

          {/* One chip, only when true. The platform-featured ("mega") event is a ZORA PICK. */}
          {ev.mega ? (
            <div className={styles.chips}>
              <span className={`${styles.chip} zp-chip--zora-pick`}>ZORA PICK</span>
            </div>
          ) : null}

          <h1 className={styles.title}>{ev.name}</h1>
          {ev.organizer ? <p className={styles.by}>by {ev.organizer}</p> : null}
          {ev.tagline ? <p className={styles.tagline}>{ev.tagline}</p> : null}

          <dl className={styles.meta}>
            <dt>DATE</dt>
            <dd>{(ev.dateLabel || 'TBA').toUpperCase()}</dd>
            {ev.time ? (
              <>
                <dt>TIME</dt>
                <dd>{ev.time}</dd>
              </>
            ) : null}
            <dt>VENUE</dt>
            <dd>{ev.venue || 'TBA'}</dd>
            {city ? (
              <>
                <dt>CITY</dt>
                <dd>{city}</dd>
              </>
            ) : null}
          </dl>

        </main>

        <aside className={styles.panel} aria-label="Passes">
          <span className={styles.label}>From</span>
          <b className={styles.priceVal}>
            {curLabel} {price}
          </b>
          <InstallmentOfferNote offer={instOffer} />
          {seatmap ? (
            <Link href={`/events/${params.id}/seats`} className={styles.primary}>
              GET PASSES<span className={styles.arrow} aria-hidden="true">→</span>
            </Link>
          ) : (
            <GetTicketButton
              eventName={ev.name}
              eventId={params.id}
              when={when}
              tiers={ev.webCheckout?.tiers}
              organizerHandle={ev.organizerHandle}
              artwork={ev.cover}
              dateLabel={ev.dateLabel}
              time={ev.time}
              venue={ev.venue}
              city={city}
            />
          )}
          <p className={styles.nofee}>Fees shown before you pay.</p>
        </aside>

        <div className={styles.foot}>
          <span>RUNS ON ZORAPASS</span>
          <Link href="/discover.html">SEE ALL EVENTS →</Link>
        </div>
      </div>

    </div>
  );
}
