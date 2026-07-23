import type { Metadata } from 'next';
import Link from 'next/link';
import { GetTicketButton } from '../../../../events/[id]/event-cta';
import type { CheckoutTier } from '../../../../../components/checkout-flow';
import styles from './tenant-event.module.css';

// The BRANDED white-label single-event leaf: /@handle/events/:id. The middleware
// rewrites that URL here. Replaces the retired static public/tenant.html — same
// white-label chrome, but the GET TICKET CTA now opens the real <CheckoutFlow>
// (via GetTicketButton) for web-sellable drops instead of the app-claim toast.

export const dynamic = 'force-dynamic';

const API_URL = process.env.API_URL || 'http://localhost:4101';
const CUR: Record<string, string> = { dar: 'TZS', zanzibar: 'TZS', nairobi: 'KES', accra: 'GHS', lagos: 'NGN' };
const PAL: Record<string, string> = {
  Festivals: '#B23A17', Nightlife: '#3D2A8F', Concerts: '#1E4FD8', Daytime: '#C46A28', Arts: '#0F6E56',
};

type TenantEvent = {
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
  organizer?: string;
  organizerHandle?: string;
  subdomain?: string;
  webCheckout?: { tiers?: CheckoutTier[] };
};

type Organizer = { handle: string; name: string; subdomain: string };

async function fetchEvent(id: string): Promise<TenantEvent | null> {
  const target = `${API_URL}/api/events/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(target, { cache: 'no-store' });
    if (!res.ok) {
      console.error(`[zora-web] tenant-event fetch ${target} -> HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as TenantEvent;
  } catch (err) {
    console.error(`[zora-web] tenant-event fetch ${target} FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function fetchTenant(handle: string): Promise<Organizer | null> {
  try {
    const res = await fetch(`${API_URL}/api/tenant/${encodeURIComponent(handle)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as Organizer;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { handle: string; id: string } }): Promise<Metadata> {
  const [ev, org] = await Promise.all([fetchEvent(params.id), fetchTenant(params.handle)]);
  if (!ev) return { title: 'Event — Zora white-label store' };
  const orgName = org?.name || ev.organizer || 'Organizer';
  return { title: `${ev.name} — ${orgName}`, description: ev.tagline || `${ev.name} on ${orgName}.` };
}

export default async function TenantEventPage({ params }: { params: { handle: string; id: string } }) {
  const [ev, org] = await Promise.all([fetchEvent(params.id), fetchTenant(params.handle)]);

  if (!ev) {
    return (
      <main className={styles.page}>
        <div className={styles.wrap}>
          <div className={styles.notFound}>This event could not be found.</div>
        </div>
      </main>
    );
  }

  const orgName = org?.name || ev.organizer || 'Organizer';
  const subdomain = org?.subdomain || ev.subdomain || '';
  const cur = CUR[ev.city || ''] || 'TZS';
  const price = (ev.priceFrom != null ? ev.priceFrom : 0).toLocaleString();
  const cover = PAL[ev.category || ''] || '#4C6FFF';
  const when = [ev.dateLabel || 'TBA', ev.time, ev.venue].filter(Boolean).join(' · ').toUpperCase();

  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <div className={styles.topbar}>
          <div className={styles.store}>
            <div className={styles.badge}>{orgName.charAt(0)}</div>
            <div>
              <div className={styles.sn}>{orgName}</div>
              {subdomain ? <div className={styles.su}>{subdomain}</div> : null}
            </div>
          </div>
          <span className={styles.whitelabel}>WHITE-LABEL STORE</span>
        </div>

        <div className={`${styles.auraLine} ${styles.aura}`} />

        <p className={styles.eyebrow}>
          {(ev.category || 'EVENT').toUpperCase()} · {(ev.city || '').toUpperCase()}
        </p>
        <h1 className={styles.title}>{ev.name}</h1>
        {ev.tagline ? <p className={styles.tagline}>{ev.tagline}</p> : null}

        <div className={styles.cover} style={{ ['--coverA' as string]: cover }} />

        <div className={styles.meta}>
          <div>
            <div className={styles.metaKey}>DATE</div>
            <div className={styles.metaVal}>
              {ev.dateLabel || 'TBA'}
              {ev.time ? ` · ${ev.time}` : ''}
            </div>
          </div>
          <div>
            <div className={styles.metaKey}>VENUE</div>
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
            <Link href={`/events/${encodeURIComponent(ev.id)}/seats`} className={styles.seatsCta}>
              CHOOSE YOUR SEATS →
            </Link>
          ) : (
            <GetTicketButton eventName={ev.name} when={when} tiers={ev.webCheckout?.tiers} />
          )}
        </div>

        {(() => {
          // BS8: if a table tier is split-enabled, offer "Split a table" → the host flow.
          const splitTier = ev.webCheckout?.tiers?.find((t) => t.split);
          if (!splitTier) return null;
          const href = `/split/new?tier=${encodeURIComponent(splitTier.tierId)}&event=${encodeURIComponent(ev.name)}&price=${splitTier.unitPrice}&cap=${splitTier.seats || 8}`;
          return (
            <Link href={href} className={styles.splitCta}>
              Split a table with your crew — everyone pays their share →
            </Link>
          );
        })()}

        <p className={styles.nofee}>The price is the price. No fees at checkout.</p>

        <div className={styles.foot}>
          <span>runs on zora</span>
          <Link href={`/@${params.handle}`}>← back to the store</Link>
        </div>
      </div>
    </main>
  );
}
