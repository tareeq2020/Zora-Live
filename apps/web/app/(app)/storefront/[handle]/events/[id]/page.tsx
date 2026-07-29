import type { Metadata } from 'next';
import Link from 'next/link';
import { GetTicketButton } from '../../../../events/[id]/event-cta';
import type { CheckoutTier } from '../../../../../components/checkout-flow';
import styles from './tenant-event.module.css';

// The BRANDED white-label single-event leaf: /@handle/events/:id. Now theme-aware:
// it reads the SAME published storefront theme the /@handle index uses (fonts,
// brand colours, logo, banner) so the page matches the organizer's store, plus a
// per-event cover image. The GET TICKET CTA opens the real <CheckoutFlow>.

export const dynamic = 'force-dynamic';

const API_URL = process.env.API_URL || 'http://localhost:4101';
const CUR: Record<string, string> = { dar: 'TZS', zanzibar: 'TZS', nairobi: 'KES', accra: 'GHS', lagos: 'NGN' };

// Typography presets — mirror the storefront index so the leaf renders identically.
const FONTS: Record<string, { display: string; body: string }> = {
  editorial: { display: "'Fraunces',serif", body: "'Archivo',system-ui,sans-serif" },
  grotesque: { display: "'Archivo',system-ui,sans-serif", body: "'Archivo',system-ui,sans-serif" },
  monoforward: { display: "'IBM Plex Mono',monospace", body: "'Archivo',system-ui,sans-serif" },
};

type StorefrontTheme = {
  brandName?: string;
  accent?: string; secondary?: string; bg?: string; card?: string;
  typography?: string; logoUrl?: string; bannerUrl?: string;
};

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
    return (await res.json()) as TenantEvent;
  } catch (err) { console.error(`[zora-web] tenant-event fetch FAILED: ${err instanceof Error ? err.message : String(err)}`); return null; }
}
async function fetchTenant(handle: string): Promise<Organizer | null> {
  try {
    const res = await fetch(`${API_URL}/api/tenant/${encodeURIComponent(handle)}`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as Organizer) : null;
  } catch { return null; }
}
async function fetchTheme(): Promise<StorefrontTheme> {
  try {
    const res = await fetch(`${API_URL}/api/storefront-theme`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as StorefrontTheme) : {};
  } catch { return {}; }
}

// Luminance test so text/hairlines read correctly on either a light or dark brand bg.
function isLightHex(hex?: string): boolean {
  const h = String(hex || '').replace('#', '');
  if (h.length < 6) return true;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

export async function generateMetadata({ params }: { params: { handle: string; id: string } }): Promise<Metadata> {
  const [ev, org, theme] = await Promise.all([fetchEvent(params.id), fetchTenant(params.handle), fetchTheme()]);
  if (!ev) return { title: 'Event — Zora white-label store' };
  const orgName = theme.brandName || org?.name || ev.organizer || 'Organizer';
  return { title: `${ev.name} — ${orgName}`, description: ev.tagline || `${ev.name} on ${orgName}.` };
}

export default async function TenantEventPage({ params }: { params: { handle: string; id: string } }) {
  const [ev, org, theme] = await Promise.all([fetchEvent(params.id), fetchTenant(params.handle), fetchTheme()]);

  if (!ev) {
    return (
      <main className={styles.page}>
        <div className={styles.wrap}><div className={styles.notFound}>This event could not be found.</div></div>
      </main>
    );
  }

  const orgName = theme.brandName || org?.name || ev.organizer || 'Organizer';
  const subdomain = org?.subdomain || ev.subdomain || '';
  const cur = CUR[ev.city || ''] || 'TZS';
  const price = (ev.priceFrom != null ? ev.priceFrom : 0).toLocaleString();
  const when = [ev.dateLabel || 'TBA', ev.time, ev.venue].filter(Boolean).join(' · ').toUpperCase();

  // Brand tokens (fall back to the store's editorial defaults).
  const bg = theme.bg || '#F7F1E7';
  const card = theme.card || '#FFFDF8';
  const accent = theme.accent || '#C46A28';
  const light = isLightHex(bg);
  const ink = light ? '#191510' : '#F4F1EA';
  const mut = light ? '#7A7365' : '#9A97A6';
  const hair = light ? 'rgba(25,21,16,.14)' : 'rgba(255,255,255,.14)';
  const font = FONTS[theme.typography || 'editorial'] || FONTS.editorial;

  const themeVars: Record<string, string> = {
    ['--paper']: bg, ['--card']: card, ['--ink']: ink, ['--mut']: mut,
    ['--hair']: hair, ['--accent']: accent, ['--display']: font.display,
    ['--body']: font.body, ['--font-mono']: "'IBM Plex Mono',monospace",
  };

  const splitTier = ev.webCheckout?.tiers?.find((t) => t.split);
  const splitHref = splitTier
    ? `/split/new?tier=${encodeURIComponent(splitTier.tierId)}&event=${encodeURIComponent(ev.name)}&price=${splitTier.unitPrice}&cap=${splitTier.seats || 8}`
    : null;

  return (
    <main className={styles.page} style={themeVars as React.CSSProperties}>
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400..500&family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <div className={styles.wrap}>
        <div className={styles.topbar}>
          <div className={styles.store}>
            {theme.logoUrl ? (
              <span className={styles.logo} style={{ backgroundImage: `url(${theme.logoUrl})` }} aria-label={orgName} />
            ) : (
              <div className={styles.badge}>{orgName.charAt(0)}</div>
            )}
            <div>
              <div className={styles.sn}>{orgName}</div>
              {subdomain ? <div className={styles.su}>{subdomain}</div> : null}
            </div>
          </div>
          <span className={styles.whitelabel}>WHITE-LABEL STORE</span>
        </div>

        {theme.bannerUrl ? <div className={styles.banner} style={{ backgroundImage: `url(${theme.bannerUrl})` }} /> : null}

        <div className={`${styles.auraLine} ${styles.aura}`} />

        <p className={styles.eyebrow}>{(ev.category || 'EVENT').toUpperCase()} · {(ev.city || '').toUpperCase()}</p>
        <h1 className={styles.title}>{ev.name}</h1>
        {ev.tagline ? <p className={styles.tagline}>{ev.tagline}</p> : null}

        {ev.cover ? (
          <div className={styles.cover} style={{ backgroundImage: `url(${ev.cover})` }} />
        ) : (
          <div className={`${styles.cover} ${styles.coverFallback}`} />
        )}

        <div className={styles.meta}>
          <div>
            <div className={styles.metaKey}>DATE</div>
            <div className={styles.metaVal}>{ev.dateLabel || 'TBA'}{ev.time ? ` · ${ev.time}` : ''}</div>
          </div>
          <div>
            <div className={styles.metaKey}>VENUE</div>
            <div className={styles.metaVal}>{ev.venue || 'TBA'}</div>
          </div>
        </div>

        <div className={styles.buy}>
          <span>
            <small className={styles.priceLabel}>FROM</small>
            <b className={styles.priceVal}>{cur} {price}</b>
          </span>
          {ev.seated ? (
            <Link href={`/events/${encodeURIComponent(ev.id)}/seats`} className={styles.seatsCta}>CHOOSE YOUR SEATS →</Link>
          ) : (
            <GetTicketButton eventName={ev.name} when={when} tiers={ev.webCheckout?.tiers} />
          )}
        </div>

        {splitHref ? (
          <Link href={splitHref} className={styles.splitCta}>Split a table with your crew — everyone pays their share →</Link>
        ) : null}

        <p className={styles.nofee}>The price is the price. No fees at checkout.</p>

        <div className={styles.foot}>
          <span>runs on zora</span>
          <Link href={`/@${params.handle}`}>← back to the store</Link>
        </div>
      </div>
    </main>
  );
}
