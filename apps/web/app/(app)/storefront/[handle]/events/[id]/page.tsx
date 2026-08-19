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
    return (await res.json()) as TenantEvent;
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
  if (!ev) return { title: 'Event — Zora white-label store' };
  const orgName = theme.brandName || org?.name || ev.organizer || 'Organizer';
  return { title: `${ev.name} — ${orgName}`, description: ev.tagline || `${ev.name} on ${orgName}.` };
}

export default async function TenantEventPage({ params }: { params: { handle: string; id: string } }) {
  const [ev, org, theme] = await Promise.all([fetchEvent(params.id), fetchTenant(params.handle), fetchTheme(params.handle)]);

  if (!ev) {
    return <main className={styles.page}><div className={styles.wrap}><div className={styles.notFound}>This event could not be found.</div></div></main>;
  }

  const orgName = theme.brandName || org?.name || ev.organizer || 'Organizer';
  const subdomain = org?.subdomain || ev.subdomain || '';
  const cur = CUR[ev.city || ''] || 'TZS';
  const price = (ev.priceFrom != null ? ev.priceFrom : 0).toLocaleString();
  const when = [ev.dateLabel || 'TBA', ev.time, ev.venue].filter(Boolean).join(' · ').toUpperCase();

  const accent = theme.accent || '#4C6FFF';
  // Accent + secondary are always organizer-driven. Per-org LIGHT mode
  // (STOREFRONT-BRAND-SPEC.md D1a): if the org saved bg + card, flip the canvas
  // and derived text/hairline tokens light; else the fixed Zora dark holds.
  const light = !!(theme.bg && theme.card);
  const themeVars = {
    ['--accent']: accent,
    ['--secondary']: theme.secondary || '#3FE0FF',
    ...(light
      ? {
          ['--bg']: theme.bg!,
          ['--surface']: theme.card!,
          ['--surface2']: theme.card!,
          ['--ink']: '#14161F',
          ['--mut']: '#5B6272',
          ['--mut2']: '#8A90A6',
          ['--hair']: 'rgba(16,18,27,.12)',
          ['--hair2']: 'rgba(16,18,27,.2)',
        }
      : {}),
  } as React.CSSProperties;

  // ONE hero: per-event cover overrides the store banner; else an accent gradient.
  const heroImg = ev.cover || theme.bannerUrl || '';

  // BS22: every published package is shown on the leaf (not just the FROM price),
  // splittable ones flagged with a badge + a direct entry into the split flow.
  const tiers = (ev.webCheckout?.tiers || []).filter((t) => t.tierId && !t.disabled);

  // BS24: a web-sellable event with every tier disabled has nothing on sale — don't
  // advertise a stale FROM price + dead GET TICKET. Show a "not on sale" state (the
  // storefront index already drops it from the listing). App-claim events unaffected.
  const hasWebCatalog = (ev.webCheckout?.tiers || []).some((t) => t.tierId);
  if (hasWebCatalog && tiers.length === 0) {
    return (
      <main className={styles.page} style={{ ['--accent']: accent } as React.CSSProperties}>
        <div className={styles.wrap}>
          <div className={styles.notFound}>Tickets for “{ev.name}” aren’t on sale right now. Check back soon.</div>
        </div>
      </main>
    );
  }

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
        </div>

        {/* Single hero — the full flyer (contain) over a blurred fill of itself so
            nothing is cropped; else an accent gradient. Logo brand-mark bottom-left. */}
        <div className={`${styles.hero}${heroImg ? '' : ' ' + styles.heroFallback}`}>
          {heroImg ? (
            <>
              <div className={styles.heroBg} style={{ backgroundImage: `url("${heroImg}")` }} aria-hidden />
              <img className={styles.heroImg} src={heroImg} alt="" />
            </>
          ) : null}
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
                  <span className={styles.pkgPrice}>{t.currency || cur} {fmtN(t.unitPrice)}{t.usd ? ` ($${fmtN(t.usd)})` : ''}</span>
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

        <div className={styles.foot}>
          <span className={styles.runs}>
            runs on{' '}
            <img
              className={styles.runsMark}
              src={light ? '/assets/zora-wordmark-black.png' : '/assets/zora-wordmark-white.png'}
              alt="Zora"
            />
          </span>
          <span className={styles.footLinks}>
            <Link href="/help">Help &amp; Support</Link>
            <Link href={`/@${params.handle}`}>← back to the store</Link>
          </span>
        </div>
      </div>
    </main>
  );
}
