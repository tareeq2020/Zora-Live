import type { Metadata } from 'next';
import Link from 'next/link';
import { GetTicketButton } from '../../../../events/[id]/event-cta';
import type { CheckoutTier } from '../../../../../components/checkout-flow';
import styles from './tenant-event.module.css';

// The BRANDED white-label single-event leaf: /@handle/events/:id. Zora consumer
// DARK canvas + Space Grotesk/Inter (the system every consumer screen uses); the
// organizer supplies only the ACCENT, LOGO, BANNER (+ a per-event cover). One hero
// (cover overrides banner). GET TICKET opens the real <CheckoutFlow> in the accent.
// See STOREFRONT-BRAND-SPEC.md.

export const dynamic = 'force-dynamic';

const API_URL = process.env.API_URL || 'http://localhost:4101';
const CUR: Record<string, string> = { dar: 'TZS', zanzibar: 'TZS', nairobi: 'KES', accra: 'GHS', lagos: 'NGN' };

type StorefrontTheme = { brandName?: string; accent?: string; secondary?: string; logoUrl?: string; bannerUrl?: string };
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

export async function generateMetadata({ params }: { params: { handle: string; id: string } }): Promise<Metadata> {
  const [ev, org, theme] = await Promise.all([fetchEvent(params.id), fetchTenant(params.handle), fetchTheme()]);
  if (!ev) return { title: 'Event — Zora white-label store' };
  const orgName = theme.brandName || org?.name || ev.organizer || 'Organizer';
  return { title: `${ev.name} — ${orgName}`, description: ev.tagline || `${ev.name} on ${orgName}.` };
}

export default async function TenantEventPage({ params }: { params: { handle: string; id: string } }) {
  const [ev, org, theme] = await Promise.all([fetchEvent(params.id), fetchTenant(params.handle), fetchTheme()]);

  if (!ev) {
    return <main className={styles.page}><div className={styles.wrap}><div className={styles.notFound}>This event could not be found.</div></div></main>;
  }

  const orgName = theme.brandName || org?.name || ev.organizer || 'Organizer';
  const subdomain = org?.subdomain || ev.subdomain || '';
  const cur = CUR[ev.city || ''] || 'TZS';
  const price = (ev.priceFrom != null ? ev.priceFrom : 0).toLocaleString();
  const when = [ev.dateLabel || 'TBA', ev.time, ev.venue].filter(Boolean).join(' · ').toUpperCase();

  const accent = theme.accent || '#4C6FFF';
  // Only the accent is organizer-driven; the canvas + fonts are the fixed Zora system.
  const themeVars = { ['--accent']: accent, ['--secondary']: theme.secondary || '#3FE0FF' } as React.CSSProperties;

  // ONE hero: per-event cover overrides the store banner; else an accent gradient.
  const heroImg = ev.cover || theme.bannerUrl || '';

  // BS22: every published package is shown on the leaf (not just the FROM price),
  // splittable ones flagged with a badge + a direct entry into the split flow.
  const tiers = (ev.webCheckout?.tiers || []).filter((t) => t.tierId);
  const fmtN = (n: number) => n.toLocaleString('en-US');
  const splitHrefFor = (t: CheckoutTier) =>
    `/split/new?tier=${encodeURIComponent(t.tierId)}&event=${encodeURIComponent(ev.name)}&price=${t.unitPrice}&cap=${t.seats || 8}`;

  return (
    <main className={styles.page} style={themeVars}>
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
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
          <span className={styles.whitelabel}>WHITE-LABEL</span>
        </div>

        {/* Single hero — cover / banner image, else accent gradient. Logo brand-mark bottom-left. */}
        <div className={`${styles.hero}${heroImg ? '' : ' ' + styles.heroFallback}`} style={heroImg ? { backgroundImage: `url(${heroImg})` } : undefined}>
          {theme.logoUrl ? <span className={styles.brandmark} style={{ backgroundImage: `url(${theme.logoUrl})` }} aria-hidden /> : null}
        </div>

        <p className={styles.eyebrow}>{(ev.category || 'EVENT').toUpperCase()} · {(ev.city || '').toUpperCase()}</p>
        <h1 className={styles.title}>{ev.name}</h1>
        {ev.tagline ? <p className={styles.tagline}>{ev.tagline}</p> : null}

        <div className={styles.meta}>
          <div><div className={styles.metaKey}>DATE</div><div className={styles.metaVal}>{ev.dateLabel || 'TBA'}{ev.time ? ` · ${ev.time}` : ''}</div></div>
          <div><div className={styles.metaKey}>VENUE</div><div className={styles.metaVal}>{ev.venue || 'TBA'}</div></div>
        </div>

        {tiers.length > 0 ? (
          <div className={styles.packages}>
            <p className={styles.pkgHead}>{tiers.length} PACKAGE{tiers.length === 1 ? '' : 'S'}</p>
            {tiers.map((t) => (
              <div className={`${styles.pkg}${t.split ? ' ' + styles.pkgSplit : ''}`} key={t.tierId}>
                <div className={styles.pkgTop}>
                  <span className={styles.pkgName}>
                    {t.name}
                    {t.split ? <span className={styles.pkgBadge}>SPLITTABLE</span> : null}
                  </span>
                  <span className={styles.pkgPrice}>{t.currency || cur} {fmtN(t.unitPrice)}</span>
                </div>
                {t.split ? (
                  <div className={styles.pkgSplitRow}>
                    <span className={styles.pkgSplitNote}>Seats {t.seats || 8} · everyone pays their own share</span>
                    <Link href={splitHrefFor(t)} className={styles.pkgSplitCta}>Split this table →</Link>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className={`${styles.buy}${tiers.length > 0 ? ' ' + styles.buyFull : ''}`}>
          {tiers.length > 0 ? null : (
            <span><small className={styles.priceLabel}>FROM</small><b className={styles.priceVal}>{cur} {price}</b></span>
          )}
          {ev.seated ? (
            <Link href={`/events/${encodeURIComponent(ev.id)}/seats`} className={styles.seatsCta}>CHOOSE YOUR SEATS →</Link>
          ) : (
            <GetTicketButton eventName={ev.name} when={when} tiers={ev.webCheckout?.tiers} accent={accent} />
          )}
        </div>

        <p className={styles.nofee}>The price is the price. No fees at checkout.</p>

        <div className={styles.foot}>
          <span>runs on zora</span>
          <Link href={`/@${params.handle}`}>← back to the store</Link>
        </div>
      </div>
    </main>
  );
}
