import type { Metadata } from 'next';
import Link from 'next/link';
import { GetTicketButton } from '../../../../events/[id]/event-cta';
import type { CheckoutTier } from '../../../../../components/checkout-flow';
import styles from './tenant-event.module.css';
import { shareCardImage } from '@/app/lib/share-card';
import { seatmapEnabledFor } from '@/app/lib/seatmap-gate';
import ViewBeacon from '@/app/components/view-beacon';
import { fetchInstallmentOffer, InstallmentOfferNote } from '@/app/components/installment-offer';
import { CITIES } from '@/app/lib/cities';
import { eventDateLabel } from '@/app/lib/event-date';

// The BRANDED white-label single-event leaf: /@handle/events/:id. ZoraPass handoff
// system (BS119): bone ground, Bricolage Grotesque / Bungee / IBM Plex Mono, flat.
// The organizer supplies the NAME, LOGO, BANNER (+ a per-event cover); the accent is
// only handed to the checkout. One hero (cover overrides banner). GET PASSES opens
// the real <CheckoutFlow>. See STOREFRONT-BRAND-SPEC.md.

export const dynamic = 'force-dynamic';

const API_URL = process.env.API_URL || 'http://localhost:4101';
const CUR: Record<string, string> = { dar: 'TZS', zanzibar: 'TZS', nairobi: 'KES', accra: 'GHS', lagos: 'NGN' };

type StorefrontTheme = { brandName?: string; accent?: string; secondary?: string; bg?: string; card?: string; logoUrl?: string; bannerUrl?: string };
type TenantEvent = {
  id: string; name: string; tagline?: string; category?: string; city?: string;
  venue?: string; dateLabel?: string; time?: string; priceFrom?: number; seated?: boolean;
  cover?: string; organizer?: string; organizerHandle?: string; subdomain?: string;
  webCheckout?: { tiers?: CheckoutTier[] };
};
type Organizer = { handle: string; name: string; subdomain: string };

async function fetchEvent(id: string): Promise<TenantEvent | null> {
  try {
    const res = await fetch(`${API_URL}/api/events/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!res.ok) { console.error(`[zora-web] tenant-event fetch -> HTTP ${res.status}`); return null; }
    const ev = (await res.json()) as TenantEvent & { date?: string };
    return { ...ev, dateLabel: eventDateLabel(ev.date, ev.dateLabel) }; // BS147
  } catch (err) { console.error(`[zora-web] tenant-event fetch FAILED: ${err instanceof Error ? err.message : String(err)}`); return null; }
}
async function fetchTenant(handle: string): Promise<Organizer | null> {
  try {
    const res = await fetch(`${API_URL}/api/tenant/${encodeURIComponent(handle)}`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as Organizer) : null;
  } catch { return null; }
}
// BS47: scoped to this organizer's own row — used to be one global theme shared
// (and silently mismatched) across every organizer's event page.
async function fetchTheme(handle: string): Promise<StorefrontTheme> {
  try {
    const res = await fetch(`${API_URL}/api/storefront-theme?handle=${encodeURIComponent(handle)}`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as StorefrontTheme) : {};
  } catch { return {}; }
}

export async function generateMetadata({ params }: { params: { handle: string; id: string } }): Promise<Metadata> {
  const [ev, org, theme] = await Promise.all([fetchEvent(params.id), fetchTenant(params.handle), fetchTheme(params.handle)]);
  if (!ev) return { title: 'Event — ZoraPass' };
  const orgName = theme.brandName || org?.name || ev.organizer || 'Organizer';
  const title = `${ev.name} — ${orgName}`;
  const description = ev.tagline || `${ev.name} on ${orgName}.`;
  // BS86: brand-matched drop card (event cover + org theme) as the unfurl image.
  const card = await shareCardImage(params.handle, params.id, `${ev.name} — get passes`);
  const images = card ? [{ url: card.url, width: card.width, height: card.height, alt: card.alt }] : undefined;
  return {
    title,
    description,
    openGraph: { title, description, type: 'website', ...(images ? { images } : {}) },
    ...(images ? { twitter: { card: 'summary_large_image', title, description, images: [card!.url] } } : {}),
  };
}

export default async function TenantEventPage({ params }: { params: { handle: string; id: string } }) {
  const [ev, org, theme] = await Promise.all([fetchEvent(params.id), fetchTenant(params.handle), fetchTheme(params.handle)]);

  if (!ev) {
    return <main className={styles.page}><div className={styles.wrap}><div className={styles.notFound}>This event could not be found.</div></div></main>;
  }

  const orgName = theme.brandName || org?.name || ev.organizer || 'Organizer';
  const subdomain = org?.subdomain || ev.subdomain || '';
  // BS126: live seat map only when zp_seatmap is on AND seats are published.
  const [seatmap, instOffer] = await Promise.all([
    seatmapEnabledFor(ev.id || params.id, ev.organizerHandle || params.handle),
    // BS134: installment note — absent when the flag/offer is off or the API is older.
    fetchInstallmentOffer(ev.id || params.id),
  ]);
  const cur = CUR[ev.city || ''] || 'TZS';
  // Money per 04_UI_COPY: `TSh 25,000` (currency first, thousands separators).
  const curLabel = (c: string) => (c === 'TZS' ? 'TSh' : c);
  const fmtN = (n: number) => n.toLocaleString('en-US');
  const price = fmtN(ev.priceFrom != null ? ev.priceFrom : 0);
  const when = [ev.dateLabel || 'TBA', ev.time, ev.venue].filter(Boolean).join(' · ').toUpperCase();

  // Handed to the checkout only (BS122 owns its redesign); the page chrome is fixed.
  const accent = theme.accent || '#4C6FFF';

  // ONE hero: per-event cover overrides the store banner; else a flat black frame.
  const heroImg = ev.cover || theme.bannerUrl || '';

  // BS22: every published package is shown on the leaf (not just the FROM price),
  // splittable ones carry a direct entry into the split flow.
  const tiers = (ev.webCheckout?.tiers || []).filter((t) => t.tierId && !t.disabled);
  const storeHref = `/@${params.handle}`;

  const topbar = (
    <header className={styles.topbar}>
      <div className={styles.topbarIn}>
        <Link href={storeHref} className={styles.store}>
          {theme.logoUrl ? (
            <span className={styles.logo} style={{ backgroundImage: `url(${theme.logoUrl})` }} aria-hidden />
          ) : (
            <span className={styles.badge} aria-hidden>{orgName.charAt(0).toUpperCase()}</span>
          )}
          <span style={{ minWidth: 0 }}>
            <span className={styles.sn} style={{ display: 'block' }}>{orgName}</span>
            {subdomain ? <span className={styles.su} style={{ display: 'block' }}>{subdomain}</span> : null}
          </span>
        </Link>
        <Link href={storeHref} className={styles.back}>← ALL EVENTS</Link>
      </div>
    </header>
  );

  // BS24: a web-sellable event with every tier disabled has nothing on sale — don't
  // advertise a stale FROM price + dead GET PASSES. Show a "not on sale" state (the
  // storefront index already drops it from the listing). App-claim events unaffected.
  const hasWebCatalog = (ev.webCheckout?.tiers || []).some((t) => t.tierId);
  if (hasWebCatalog && tiers.length === 0) {
    return (
      <main className={styles.page}>
        {topbar}
        <div className={styles.wrap}>
          <div className={styles.notFound}>Passes for “{ev.name}” aren’t on sale right now. Check back soon.</div>
        </div>
      </main>
    );
  }

  const splitHrefFor = (t: CheckoutTier) =>
    `/split/new?tier=${encodeURIComponent(t.tierId)}&event=${encodeURIComponent(ev.name)}&price=${t.unitPrice}&cap=${t.seats || 8}`;

  return (
    <main className={styles.page}>
      <ViewBeacon kind="event" org={params.handle} event={params.id} />
      {topbar}
      <div className={styles.wrap}>
        <div className={styles.main}>
          {/* Single hero — the full flyer contained on a black frame so nothing is
              cropped. Logo brand-mark bottom-left, ZORAPASS stamp bottom-right. */}
          <div className={`${styles.hero}${heroImg ? '' : ' ' + styles.heroFallback}`}>
            {heroImg ? (
              <img className={styles.heroImg} src={heroImg} alt={ev.name} />
            ) : (
              <span className={styles.heroFallbackName} aria-hidden>{ev.name}</span>
            )}
            {theme.logoUrl ? <span className={styles.brandmark} style={{ backgroundImage: `url(${theme.logoUrl})` }} aria-hidden /> : null}
            <img className={styles.stamp} src="/brand/stamps/svg/zp-stamp-zorapass-dar-signal.svg" alt="" aria-hidden="true" />
          </div>

          <p className={styles.eyebrow}>{(ev.category || 'EVENT').toUpperCase()}{ev.city ? ` · ${ev.city.toUpperCase()}` : ''}</p>
          <h1 className={styles.title}>{ev.name}</h1>
          <div className={styles.by}>by {orgName}</div>
          {ev.tagline ? <p className={styles.tagline}>{ev.tagline}</p> : null}

          <dl className={styles.meta}>
            <dt className={styles.metaKey}>DATE</dt>
            <dd className={styles.metaVal}>{(ev.dateLabel || 'TBA').toUpperCase()}</dd>
            {ev.time ? (
              <>
                <dt className={styles.metaKey}>TIME</dt>
                <dd className={styles.metaVal}>{ev.time}</dd>
              </>
            ) : null}
            <dt className={styles.metaKey}>VENUE</dt>
            <dd className={styles.metaVal}>{ev.venue || 'TBA'}</dd>
          </dl>
        </div>

        <aside className={styles.aside} aria-label="Passes">
          {tiers.length > 0 ? (
            <>
              <p className={styles.pkgHead}>CHOOSE YOUR PASSES</p>
              <div className={styles.packages}>
                {tiers.map((t) => (
                  <div className={styles.pkg} key={t.tierId}>
                    <div className={styles.pkgTop}>
                      <span className={styles.pkgName}>{t.name}</span>
                      <span className={styles.pkgPrice}>{curLabel(t.currency || cur)} {fmtN(t.unitPrice)}{t.usd ? ` ($${fmtN(t.usd)})` : ''}</span>
                    </div>
                    {t.split ? (
                      <div className={styles.pkgSplitRow}>
                        <span className={styles.pkgSplitNote}>Seats {t.seats || 8} · everyone pays their share.</span>
                        <Link href={splitHrefFor(t)} className={styles.pkgSplitCta}>Split with Tuchange</Link>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {tiers.length > 0 ? <InstallmentOfferNote offer={instOffer} /> : null}

          <div className={styles.buy}>
            {tiers.length > 0 ? null : (
              <span className={styles.price}><small className={styles.priceLabel}>FROM</small><b className={styles.priceVal}>{curLabel(cur)} {price}</b></span>
            )}
            {seatmap ? (
              <Link href={`/events/${encodeURIComponent(ev.id)}/seats`} className={styles.seatsCta}>
                GET PASSES<span aria-hidden="true">→</span>
              </Link>
            ) : (
              <div className={styles.ctaWrap}>
                <GetTicketButton
                  eventName={ev.name}
                  eventId={params.id}
                  when={when}
                  tiers={ev.webCheckout?.tiers}
                  accent={accent}
                  organizerHandle={params.handle}
                  artwork={heroImg || undefined}
                  dateLabel={ev.dateLabel}
                  time={ev.time}
                  venue={ev.venue}
                  city={CITIES.find((c) => c.id === ev.city)?.city || ev.city}
                />
              </div>
            )}
          </div>
        </aside>
      </div>

      <div className={styles.foot}>
        <span className={styles.runs}>
          RUNS ON{' '}
          <img className={styles.runsMark} src="/brand/logo/svg/zorapass-wordmark-black.svg" alt="ZoraPass" />
        </span>
        <span className={styles.footLinks}>
          <Link href="/help">Help &amp; Support</Link>
          <Link href={storeHref}>← Back to the store</Link>
        </span>
      </div>
    </main>
  );
}
