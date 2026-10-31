'use client';

/* PR-F5 — the tenant STOREFRONT INDEX (the /@handle front door), a faithful
   React port of the multi-event storefront layout that used to live as the
   static public/thebrunchcity.html. Distinct from the single-event leaf
   (tenant.html at /@handle/events/:id): this is the organizer's own event
   INDEX. Content is data-driven (organizer + their events resolved from the
   API). BS119: styled on the ZoraPass handoff (bone ground, board black, signal
   yellow, flat). The organizer supplies the name, logo and banner; their accent
   colour no longer recolours the page chrome.

   BS120: every event renders through the shared <EventCard> (one link, chip
   only when true, GET PASSES strip). For a web-sellable event the card click
   opens the live <CheckoutFlow> in place (the fastest path — no page load); the
   card's href is the event page with ?buy=1, so open-in-new-tab lands on the
   same checkout. App-claim events and sold-out cards navigate to the event page.
   The server page (page.tsx) fetches and passes everything in as props. */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import CheckoutFlow, { type CheckoutTier } from '../../../components/checkout-flow';
import ViewBeacon from '@/app/components/view-beacon';
import { EventCard, pickStatus, stockForTiers, stockStatus, type InventoryPool } from '../../../components/event-card';
import { CITIES } from '../../../lib/cities';

export type StorefrontEvent = {
  id: string;
  name: string;
  category?: string;
  city?: string;
  venue?: string;
  dateLabel?: string;
  time?: string;
  priceFrom?: number;
  seated?: boolean;
  mega?: boolean;
  cover?: string; // per-event hero poster (event blob `cover`)
  // PR-11: real product tiers wired to the payments backend. Present only on
  // web-sellable events (webCheckout.tiers in the event store); when absent the
  // event stays app-claim (the old sheet).
  webCheckout?: { tiers?: CheckoutTier[] };
};

export type StorefrontTheme = {
  accent?: string;
  secondary?: string;
  bg?: string;
  card?: string;
  typography?: string;
  logoUrl?: string;
  bannerUrl?: string;
};

export type StorefrontProps = {
  handle: string;
  brandName: string;
  subdomain: string;
  eyebrow: string;
  lede: string;
  aboutHeading: string;
  aboutBody: string;
  events: StorefrontEvent[];
  theme: StorefrontTheme;
  canManage: boolean;
  /** Live inventory pools by tierId (null when /api/inventory was unreachable). */
  pools?: Record<string, InventoryPool> | null;
};

const CUR: Record<string, string> = { dar: 'TZS', zanzibar: 'TZS', nairobi: 'KES', accra: 'GHS', lagos: 'NGN' };
// Type is FIXED to the ZoraPass system (Bricolage Grotesque / Bungee / IBM Plex
// Mono); organizers customise their name, logo and banner, not fonts or chrome
// colour (STOREFRONT-BRAND-SPEC.md D2 + the BS119 handoff migration).

const fmt = (n: number) => n.toLocaleString('en-US');
// Money per 04_UI_COPY: `TSh 25,000` (currency first, thousands separators).
const curLabel = (c: string) => (c === 'TZS' ? 'TSh' : c);
const money = (n: number, c: string) => `${curLabel(c)} ${fmt(n)}`;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('') || 'Z';

// A poster tile that shows the WHOLE image (event flyers are portrait), never
// cropped: the full poster is contained on a flat board-black frame (handoff:
// artwork sits in a rectangle, never cropped into a brand shape, no blur).
function Poster({ src, variant, alt }: { src: string; variant: 'hero' | 'cover'; alt: string }) {
  return (
    <div className={`poster ${variant}`}>
      <img className="poster-img" src={src} alt={alt} loading={variant === 'hero' ? 'eager' : 'lazy'} />
    </div>
  );
}

export default function StorefrontClient(props: StorefrontProps) {
  const { handle, subdomain, eyebrow, lede, aboutHeading, aboutBody, events, canManage, pools } = props;

  // Live theming: start from the published theme (props) and merge any `zora-theme`
  // postMessage the Studio preview iframe sends — mirrors the original page's
  // applyTheme() so the Studio's live preview keeps working against this route.
  const [theme, setTheme] = useState<StorefrontTheme>(props.theme);
  const [brandName, setBrandName] = useState(props.brandName);
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const d = ev.data;
      if (!d || d.type !== 'zora-theme' || !d.theme) return;
      const t = d.theme as StorefrontTheme & { brandName?: string };
      setTheme((prev) => ({ ...prev, ...t }));
      if (t.brandName != null) setBrandName(t.brandName);
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // The organizer accent is still handed to the live checkout (BS122 owns its
  // redesign); it no longer recolours the storefront chrome.
  const accent = theme.accent || '#C46A28';

  // ── in-place checkout (web-sellable events only) ──
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<StorefrontEvent | null>(null);

  const onSaleTiersOf = (ev: StorefrontEvent) => ev.webCheckout?.tiers?.filter((t) => t.tierId && !t.disabled) || [];
  const webTiers = active ? onSaleTiersOf(active) : [];
  const activeWhen = active
    ? [active.dateLabel || 'TBA', active.time, active.venue].filter(Boolean).join(' · ').toUpperCase()
    : '';

  return (
    <>
      <ViewBeacon kind="storefront" org={handle} />
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div className="zora-sf">
        {/* ── header: organizer name left, one quiet link right ── */}
        <nav>
          <div className="wrap nav-in">
            <a className="logo" href="#top">
              {theme.logoUrl ? (
                <span className="mark" style={{ backgroundImage: `url(${theme.logoUrl})` }} aria-hidden />
              ) : null}
              <span>{brandName}</span>
            </a>
            <div className="nav-actions">
              {canManage ? (
                <Link className="nav-manage" href="/dashboard">
                  MANAGE
                </Link>
              ) : null}
              <a className="nav-link" href="#events">
                What&apos;s on
              </a>
            </div>
          </div>
        </nav>

        {/* ── organizer band (black, per the storefront mockup) ── */}
        <header id="top">
          <div className="wrap band">
            {theme.logoUrl ? (
              <span className="badge badge-img" style={{ backgroundImage: `url(${theme.logoUrl})` }} aria-hidden />
            ) : (
              <span className="badge" aria-hidden>
                {initials(brandName)}
              </span>
            )}
            <div className="band-text">
              <p className="eyebrow">{eyebrow}</p>
              <h1>{brandName}</h1>
              <p className="lede">{lede}</p>
            </div>
            {theme.bannerUrl ? (
              <Poster src={theme.bannerUrl} variant="hero" alt={`${brandName} banner`} />
            ) : (
              <img className="stamp" src="/brand/stamps/svg/zp-stamp-zorapass-dar-signal.svg" alt="" aria-hidden="true" />
            )}
          </div>
        </header>

        {/* ── events ── */}
        <section id="events">
          <div className="wrap">
            <div className="sec-row">
              <h2 className="sec-h">WHAT&apos;S ON</h2>
              <p className="sec-count">
                {events.length} EVENT{events.length === 1 ? '' : 'S'}
              </p>
            </div>
            {events.length === 0 ? (
              <div className="empty">
                <p className="empty-h">NOTHING HERE YET.</p>
                <p>No upcoming events right now. Check back soon.</p>
              </div>
            ) : (
              <div className="event-grid">
                {events.map((ev, i) => {
                  const evCur = CUR[ev.city || ''] || 'TZS';
                  // BS26: the headline "FROM" must reflect what's actually on sale — the
                  // cheapest ENABLED tier — not the stale priceFrom scalar (which still
                  // points at a switched-off tier). Falls back to priceFrom for app-claim
                  // events (no web catalog).
                  const onSaleTiers = onSaleTiersOf(ev);
                  const cheapest = onSaleTiers.length
                    ? onSaleTiers.reduce((a, b) => (b.unitPrice < a.unitPrice ? b : a))
                    : null;
                  const fromPrice = cheapest ? cheapest.unitPrice : ev.priceFrom || 0;
                  const fromUsd = cheapest?.usd; // BS65: show the USD price in brackets
                  // BS120: the chip reflects REAL tier state — stock of the on-sale tiers
                  // from /api/inventory. App-claim events (no web tiers) or missing
                  // inventory → no stock chip (never a guessed ON SALE).
                  const stock = onSaleTiers.length ? stockForTiers(onSaleTiers.map((t) => t.tierId), pools) : null;
                  const status = pickStatus([stock ? stockStatus(stock.remaining, stock.capacity) : null, ev.mega ? 'ZORA PICK' : null]);
                  const soldOut = status === 'SOLD OUT';
                  const inPlace = onSaleTiers.length > 0 && !soldOut;
                  const base = `/@${handle}/events/${encodeURIComponent(ev.id)}`;
                  return (
                    <EventCard
                      key={ev.id}
                      href={inPlace ? `${base}?buy=1` : base}
                      name={ev.name}
                      artwork={ev.cover}
                      dateLabel={ev.dateLabel}
                      time={ev.time}
                      venue={ev.venue}
                      city={CITIES.find((c) => c.id === ev.city)?.city || ev.city}
                      priceFrom={fromPrice ? money(fromPrice, evCur) : undefined}
                      priceNote={fromUsd ? `($${fmt(fromUsd)})` : undefined}
                      status={status}
                      priority={i < 3}
                      onClick={
                        inPlace
                          ? (e) => {
                              // Plain left-click only; modified clicks keep the link.
                              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                              e.preventDefault();
                              setActive(ev);
                              setOpen(true);
                            }
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ── about strip ── */}
        <div className="about">
          <div className="wrap">
            <h2>{aboutHeading}</h2>
            <p>{aboutBody}</p>
          </div>
        </div>

        {/* ── footer: the platform's trust furniture ── */}
        <footer>
          <div className="wrap foot">
            <p className="foot-line">YOUR PASS TO WHAT&apos;S ON.</p>
            <div className="foot-meta">
              <span className="runs">
                RUNS ON <img src="/brand/logo/svg/zorapass-wordmark-chalk.svg" alt="ZoraPass" />
              </span>
              <a className="foot-help" href="/help">
                Help &amp; Support
              </a>
              <p className="legal">
                © {new Date().getFullYear()} {brandName} · {subdomain}
              </p>
            </div>
          </div>
        </footer>

        {/* PR-11: live payments flow for web-sellable events (real checkout → pay → QR) */}
        {active && webTiers.length > 0 ? (
          <CheckoutFlow
            open={open}
            onClose={() => setOpen(false)}
            eventName={active.name}
            eventId={active.id}
            when={activeWhen}
            tiers={webTiers}
            accent={accent}
          />
        ) : null}
      </div>
    </>
  );
}

/* ZoraPass handoff, scoped to .zora-sf. FIXED light (bone): primitive tokens only,
   because <html data-theme> defaults to dark and would flip the semantic --zp-*. */
const STYLE = `
.zora-sf{--bk:var(--zp-color-board-black);--bone:var(--zp-color-bone);--yl:var(--zp-color-signal-yellow);--line:var(--zp-color-line-light);--mut:var(--zp-color-ink-500);--mono:var(--zp-font-family-mono);--disp:var(--zp-font-family-display);--sans:var(--zp-font-family-sans);background:var(--bone);color:var(--bk);font-family:var(--sans);font-size:16px;line-height:1.4;-webkit-font-smoothing:antialiased;min-height:100vh}
.zora-sf *{margin:0;padding:0;box-sizing:border-box}
.zora-sf a{color:inherit;text-decoration:none}
.zora-sf ::selection{background-color:var(--yl);color:var(--bk)}
.zora-sf :focus-visible{outline:3px solid var(--bk);outline-offset:2px}
.zora-sf .wrap{max-width:var(--zp-layout-container-max);margin:0 auto;padding:0 var(--zp-layout-gutter-mobile)}
@media(min-width:768px){.zora-sf .wrap{padding:0 var(--zp-layout-gutter-tablet)}}
@media(min-width:1100px){.zora-sf .wrap{padding:0 var(--zp-layout-gutter-desktop)}}

/* header */
.zora-sf nav{border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bone);z-index:40}
.zora-sf .nav-in{display:flex;align-items:center;justify-content:space-between;gap:16px;height:64px}
.zora-sf .logo{display:flex;align-items:center;gap:12px;font-weight:700;font-size:22px;letter-spacing:-.02em;min-height:44px;min-width:0}
.zora-sf .logo span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.zora-sf .logo .mark{width:32px;height:32px;border-radius:8px;background:#fff center/cover no-repeat;border:1px solid var(--line);flex-shrink:0}
.zora-sf .nav-actions{display:flex;align-items:center;gap:16px;flex-shrink:0}
.zora-sf .nav-link{font-weight:700;font-size:16px;min-height:44px;display:inline-flex;align-items:center}
.zora-sf .nav-link:hover{text-decoration:underline}
.zora-sf .nav-manage{font-family:var(--mono);font-size:13px;letter-spacing:.08em;border:2px solid var(--bk);height:40px;min-width:44px;padding:0 16px;border-radius:var(--zp-radius-pill);display:inline-flex;align-items:center}
.zora-sf .nav-manage:hover{background:var(--bk);color:var(--yl)}

/* organizer band */
.zora-sf header{background:var(--bk);color:var(--bone)}
.zora-sf header :focus-visible{outline-color:var(--yl)}
.zora-sf .band{display:flex;align-items:center;gap:16px;padding-top:24px;padding-bottom:24px}
@media(min-width:768px){.zora-sf .band{gap:32px;padding-top:40px;padding-bottom:40px}}
.zora-sf .badge{width:56px;height:56px;border-radius:12px;background:var(--yl);color:var(--bk);display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-size:20px;flex-shrink:0;align-self:flex-start}
.zora-sf .badge-img{background:#fff center/cover no-repeat}
@media(min-width:768px){.zora-sf .badge{width:96px;height:96px;border-radius:16px;font-size:28px;align-self:center}}
.zora-sf .band-text{display:flex;flex-direction:column;gap:8px;flex:1;min-width:0}
.zora-sf .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--yl);text-transform:uppercase}
.zora-sf h1{font-weight:800;font-size:24px;letter-spacing:-.02em;line-height:1.08}
@media(min-width:768px){.zora-sf h1{font-size:40px}}
.zora-sf .lede{font-size:16px;color:var(--zp-color-ink-300);max-width:56ch;line-height:1.4}
@media(min-width:768px){.zora-sf .lede{font-size:18px}}
.zora-sf .stamp{width:128px;height:128px;transform:rotate(-10deg);flex-shrink:0;display:none}
@media(min-width:768px){.zora-sf .stamp{display:block}}

/* poster: full flyer contained on a flat black frame — never cropped, no blur */
.zora-sf .poster{position:relative;overflow:hidden;background:var(--bk);animation:posterIn .24s var(--zp-motion-easing-standard) both}
.zora-sf .poster-img{display:block;width:100%;height:100%;object-fit:contain;transition:transform .18s var(--zp-motion-easing-standard)}
.zora-sf .poster.hero{display:none;width:200px;aspect-ratio:4/5;border-radius:var(--zp-radius-md);border:1px solid var(--zp-color-line-dark);flex-shrink:0}
@media(min-width:768px){.zora-sf .poster.hero{display:block}}
@keyframes posterIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.zora-sf .poster{animation:none}.zora-sf .poster-img{transition:none}}

/* events */
.zora-sf section{padding:24px 0 48px}
@media(min-width:768px){.zora-sf section{padding:32px 0 48px}}
.zora-sf .sec-row{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px}
.zora-sf .sec-h{font-family:var(--disp);font-weight:400;font-size:24px;line-height:1}
@media(min-width:768px){.zora-sf .sec-h{font-size:32px}}
.zora-sf .sec-count{font-family:var(--mono);font-size:13px;letter-spacing:.08em;color:var(--mut)}
.zora-sf .empty{display:flex;flex-direction:column;gap:8px;padding:32px 0}
.zora-sf .empty-h{font-family:var(--disp);font-size:24px}
.zora-sf .empty p:last-child{color:var(--mut)}
.zora-sf .event-grid{display:grid;grid-template-columns:1fr;gap:16px}
@media(min-width:680px){.zora-sf .event-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}}
@media(min-width:1040px){.zora-sf .event-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}

/* about */
.zora-sf .about{background:var(--zp-color-white);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.zora-sf .about .wrap{padding-top:48px;padding-bottom:48px}
.zora-sf .about h2{font-weight:700;font-size:24px;letter-spacing:-.02em;line-height:1.1;max-width:24ch}
@media(min-width:768px){.zora-sf .about h2{font-size:32px}}
.zora-sf .about p{color:var(--zp-color-ink-600);max-width:60ch;margin-top:16px;font-size:16px}

/* footer band */
.zora-sf footer{background:var(--bk);color:var(--bone);padding:40px 0}
.zora-sf footer :focus-visible{outline-color:var(--yl)}
.zora-sf .foot{display:flex;flex-direction:column;gap:24px}
.zora-sf .foot-line{font-family:var(--disp);font-size:24px;line-height:1.05}
@media(min-width:768px){.zora-sf .foot-line{font-size:32px}}
.zora-sf .foot-meta{display:flex;align-items:center;gap:8px 24px;flex-wrap:wrap;font-family:var(--mono);font-size:13px;letter-spacing:.08em;color:var(--zp-color-ink-300)}
.zora-sf .runs{display:inline-flex;align-items:center;gap:10px}
.zora-sf .runs img{height:18px;width:auto;display:block}
.zora-sf .foot-help{min-height:44px;display:inline-flex;align-items:center;color:var(--bone)}
.zora-sf .foot-help:hover{text-decoration:underline}
.zora-sf .legal{font-size:12px}

`;
