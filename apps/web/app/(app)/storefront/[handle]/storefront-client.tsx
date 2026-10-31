'use client';

/* PR-F5 — the tenant STOREFRONT INDEX (the /@handle front door), a faithful
   React port of the multi-event storefront layout that used to live as the
   static public/thebrunchcity.html. Distinct from the single-event leaf
   (tenant.html at /@handle/events/:id): this is the organizer's own event
   INDEX. Content is data-driven (organizer + their events resolved from the
   API). BS119: styled on the ZoraPass handoff (bone ground, board black, signal
   yellow, flat). The organizer supplies the name, logo and banner; their accent
   colour no longer recolours the page chrome.

   Client component: it owns the ZoraPass checkout sheet (qty / honest no-fee
   pricing / crew split / app-claim step) and the per-event countdowns, exactly
   as the original page did — just expressed as React state instead of imperative
   DOM. The server page (page.tsx) fetches and passes everything in as props. */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import CheckoutFlow, { type CheckoutTier } from '../../../components/checkout-flow';
import ViewBeacon from '@/app/components/view-beacon';

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
};

const CUR: Record<string, string> = { dar: 'TZS', zanzibar: 'TZS', nairobi: 'KES', accra: 'GHS', lagos: 'NGN' };
// Type is FIXED to the ZoraPass system (Bricolage Grotesque / Bungee / IBM Plex
// Mono); organizers customise their name, logo and banner, not fonts or chrome
// colour (STOREFRONT-BRAND-SPEC.md D2 + the BS119 handoff migration).

const fmt = (n: number) => n.toLocaleString('en-US');
const pad = (n: number) => String(n).padStart(2, '0');
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

// Best-effort target date for the doors countdown. Events carry a human dateLabel
// ("Sat 08 Aug") + time ("12:00") but no ISO — reconstruct a Date, rolling to next
// year if the day has already passed. Client-only (Date.now) to avoid SSR skew.
function targetDate(ev: StorefrontEvent): number | null {
  if (!ev.dateLabel) return null;
  const clean = ev.dateLabel.replace(/^[A-Za-z]{3,}\s+/, ''); // strip weekday
  const now = new Date();
  for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
    const d = new Date(`${clean} ${year} ${ev.time || '12:00'}`);
    if (!isNaN(d.getTime()) && d.getTime() > now.getTime() - 86400000) return d.getTime();
  }
  const d = new Date(`${clean} ${now.getFullYear()} ${ev.time || '12:00'}`);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function Countdown({ ev }: { ev: StorefrontEvent }) {
  const [label, setLabel] = useState('DOORS IN --:--:--:--');
  useEffect(() => {
    const target = targetDate(ev);
    if (target == null) {
      setLabel('');
      return;
    }
    const tick = () => {
      const d = target - Date.now();
      if (d <= 0) {
        setLabel('LIVE NOW');
        return;
      }
      setLabel(
        'DOORS IN ' +
          pad(Math.floor(d / 86400000)) +
          ':' +
          pad(Math.floor(d / 3600000) % 24) +
          ':' +
          pad(Math.floor(d / 60000) % 60) +
          ':' +
          pad(Math.floor(d / 1000) % 60),
      );
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [ev]);
  if (!label) return null;
  return <p className="countdown">{label}</p>;
}

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
  const { handle, subdomain, eyebrow, lede, aboutHeading, aboutBody, events, canManage } = props;

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

  // ── checkout sheet state (faithful to the original) ──
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<StorefrontEvent | null>(null);
  const [qty, setQty] = useState(1);
  const [crew, setCrew] = useState(false);
  const [paid, setPaid] = useState(false);
  const orderRef = useRef('ORDER');

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  function openCheckout(ev: StorefrontEvent) {
    setActive(ev);
    setQty(1);
    setCrew(false);
    setPaid(false);
    setOpen(true);
  }
  function pay() {
    orderRef.current = 'ORDER ' + brandName.slice(0, 3).toUpperCase() + '-' + (4000 + Math.floor(Math.random() * 900)) + Math.floor(Math.random() * 9);
    setPaid(true);
  }

  const unit = active?.priceFrom || 0;
  const cur = CUR[active?.city || ''] || 'TZS';
  const total = unit * qty;

  // PR-11: a web-sellable event carries real product tiers → the live payments
  // flow replaces the old app-claim sheet. Everything else keeps the app-claim path.
  const webTiers = active?.webCheckout?.tiers?.filter((t) => t.tierId && !t.disabled) || [];
  const webSellable = webTiers.length > 0;
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
                {events.map((ev) => {
                  const evCur = CUR[ev.city || ''] || 'TZS';
                  // BS26: the headline "FROM" must reflect what's actually on sale — the
                  // cheapest ENABLED tier — not the stale priceFrom scalar (which still
                  // points at a switched-off tier). Falls back to priceFrom for app-claim
                  // events (no web catalog).
                  const onSaleTiers = ev.webCheckout?.tiers?.filter((t) => t.tierId && !t.disabled) || [];
                  const cheapest = onSaleTiers.length
                    ? onSaleTiers.reduce((a, b) => (b.unitPrice < a.unitPrice ? b : a))
                    : null;
                  const fromPrice = cheapest ? cheapest.unitPrice : ev.priceFrom || 0;
                  const fromUsd = cheapest?.usd; // BS65: show the USD price in brackets
                  const href = `/@${handle}/events/${encodeURIComponent(ev.id)}`;
                  return (
                    <article className="event" key={ev.id}>
                      <Link className="event-cover" href={href} aria-label={ev.name}>
                        {ev.cover ? (
                          <Poster src={ev.cover} variant="cover" alt={ev.name} />
                        ) : (
                          <div className="poster cover no-cover">{ev.name}</div>
                        )}
                        <span className="chip zp-chip--on-sale">ON SALE</span>
                      </Link>
                      <div className="event-body">
                        <p className="meta date">
                          {(ev.dateLabel || 'TBA').toUpperCase()}
                          {ev.time ? ` · ${ev.time}` : ''}
                        </p>
                        <Link className="name" href={href}>
                          {ev.name}
                        </Link>
                        <p className="venue">{ev.venue || 'Venue to be announced'}</p>
                        <p className="meta kind">
                          {(ev.category || 'EVENT').toUpperCase()}
                          {ev.seated ? ' · SEATED' : ' · GENERAL ADMISSION'}
                        </p>
                        <Countdown ev={ev} />
                        <p className="price">
                          From {money(fromPrice, evCur)}
                          {fromUsd ? <small> (${fmt(fromUsd)})</small> : null}
                        </p>
                        <button type="button" className="get" onClick={() => openCheckout(ev)}>
                          GET PASSES<span aria-hidden="true">→</span>
                        </button>
                        <Link className="details" href={href}>
                          Event details
                        </Link>
                      </div>
                    </article>
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
        {webSellable && (
          <CheckoutFlow
            open={open}
            onClose={() => setOpen(false)}
            eventName={active?.name || ''}
            eventId={active?.id}
            when={activeWhen}
            tiers={webTiers}
            accent={accent}
          />
        )}

        {/* ═══ ZORAPASS CHECKOUT SHEET (app-claim path; hidden when web-sellable) ═══ */}
        <div className={'sheet' + (open && !webSellable ? ' on' : '')} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          {active ? (
            <div className="checkout" role="dialog" aria-modal="true" aria-label={`Get passes for ${active.name}`}>
              <div className="co-head">
                <span className="secure">
                  SECURE CHECKOUT · <b>ZORAPASS</b>
                </span>
                <button type="button" className="x" aria-label="Close" onClick={() => setOpen(false)}>
                  ×
                </button>
              </div>

              {!paid ? (
                <div className="co-body">
                  <div className="co-welcome">A real ZoraPass pass, issued on payment.</div>
                  <p className="co-event">{active.name}</p>
                  <p className="co-when">
                    {active.dateLabel || 'TBA'}
                    {active.time ? ` · ${active.time}` : ''} · {active.venue || 'TBA'}
                  </p>

                  <div className="qty">
                    <span className="lab">How many passes?</span>
                    <div className="ctrl">
                      <button type="button" aria-label="Fewer" onClick={() => setQty((q) => Math.max(1, q - 1))}>
                        −
                      </button>
                      <span className="n" aria-live="polite">
                        {qty}
                      </span>
                      <button type="button" aria-label="More" onClick={() => setQty((q) => Math.min(10, q + 1))}>
                        +
                      </button>
                    </div>
                  </div>

                  <div className="honest">
                    <div className="line">
                      <span className="lbl">
                        {qty} × {money(unit, cur)}
                      </span>
                      <span className="val">{money(total, cur)}</span>
                    </div>
                    <div className="total">
                      <span className="lbl">Total</span>
                      <span className="val">{money(total, cur)}</span>
                    </div>
                  </div>
                  <button type="button" className="crew-toggle" aria-pressed={crew} onClick={() => setCrew((c) => !c)}>
                    <span className="ic">6</span>
                    <span className="ct">
                      <span className="tt">Split with Tuchange</span>
                      <span className="td">Each person pays their own share from their phone.</span>
                    </span>
                    <span className={'switch' + (crew ? ' on' : '')} aria-hidden />
                  </button>
                  <div className={'crew-detail' + (crew ? ' on' : '')}>
                    <div className="split-line">
                      <span>Your share now</span>
                      <span className="share">{money(Math.round(total / 6), cur)}</span>
                    </div>
                    <div className="split-line">
                      <span>5 invites sent on WhatsApp</span>
                      <span>15 min hold</span>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      Each friend installs ZoraPass and pays their share. Passes issue when the sixth lands.
                    </div>
                  </div>

                  <button type="button" className="pay" onClick={pay}>
                    <span>GET PASSES</span>
                    <span className="pay-amt">{money(total, cur)}</span>
                  </button>
                  <div className="methods">
                    <span>M-PESA</span>
                    <span>TIGO PESA</span>
                    <span>AIRTEL MONEY</span>
                    <span>VISA</span>
                    <span>MASTERCARD</span>
                  </div>
                </div>
              ) : (
                <div className="claim on">
                  <img className="claim-stamp" src="/brand/stamps/svg/zp-stamp-zorapass-dar-signal.svg" alt="" aria-hidden="true" />
                  <h3>YOU&apos;RE IN.</h3>
                  <p className="code">{orderRef.current}</p>
                  <p>
                    Your pass is{' '}
                    <span className="waiting">waiting for you in the ZoraPass app.</span> Claiming takes thirty seconds and
                    unlocks faster entry, resale and split payments.
                  </p>
                  <div className="stores">
                    <span className="store">CLAIM ON APP STORE</span>
                    <span className="store">CLAIM ON GOOGLE PLAY</span>
                  </div>
                  <button type="button" className="web" onClick={() => setOpen(false)}>
                    or use a basic web pass →
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
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
.zora-sf .poster.cover{aspect-ratio:4/5;width:100%}
.zora-sf .poster.no-cover{display:flex;align-items:flex-end;padding:20px;font-family:var(--disp);font-size:24px;line-height:1.05;text-transform:uppercase;color:var(--yl)}
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
.zora-sf .event{background:var(--zp-color-white);border:1px solid var(--line);border-radius:var(--zp-radius-lg);overflow:hidden;display:flex;flex-direction:column;transition:border-color .18s var(--zp-motion-easing-standard)}
.zora-sf .event:hover{border-color:var(--bk)}
.zora-sf .event:hover .poster-img{transform:scale(1.02)}
@media(prefers-reduced-motion:reduce){.zora-sf .event:hover .poster-img{transform:none}}
.zora-sf .event-cover{position:relative;display:block}
.zora-sf .chip{position:absolute;left:12px;top:12px;z-index:2;font-family:var(--mono);font-weight:500;font-size:12px;letter-spacing:.12em;text-transform:uppercase;border-radius:var(--zp-radius-pill);padding:6px 12px;line-height:1.2}
.zora-sf .event-body{padding:16px 20px 20px;display:flex;flex-direction:column;gap:6px;flex:1}
.zora-sf .meta{font-family:var(--mono);font-size:13px;letter-spacing:.08em}
.zora-sf .meta.kind{font-size:12px;letter-spacing:.12em;color:var(--mut)}
.zora-sf .event .name{font-weight:700;font-size:20px;letter-spacing:-.02em;line-height:1.15}
.zora-sf .event .name:hover{text-decoration:underline}
.zora-sf .venue{font-size:14px;color:var(--mut)}
.zora-sf .countdown{font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--zp-color-ink-600)}
.zora-sf .price{font-family:var(--mono);font-weight:600;font-size:16px;margin-top:auto;padding-top:8px}
.zora-sf .price small{font-size:13px;font-weight:400;color:var(--mut)}
.zora-sf .get{margin-top:12px;width:100%;height:48px;border:none;border-radius:var(--zp-radius-lg);background:var(--bk);color:var(--yl);display:flex;align-items:center;justify-content:space-between;padding:0 20px;font-family:var(--disp);font-size:20px;line-height:1;cursor:pointer;transition:background .12s}
.zora-sf .get:hover{background:var(--zp-color-ink-600)}
.zora-sf .get:active{transform:translateY(2px)}
.zora-sf .details{align-self:center;font-weight:700;font-size:14px;min-height:44px;display:inline-flex;align-items:center;padding:0 8px}
.zora-sf .details:hover{text-decoration:underline}

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

/* app-claim checkout sheet — dark surface, so the primary flips to yellow */
.zora-sf .sheet{position:fixed;inset:0;background:var(--zp-overlay,rgba(17,17,17,.6));display:none;align-items:flex-end;justify-content:center;z-index:90}
.zora-sf .sheet.on{display:flex}
@media(min-width:680px){.zora-sf .sheet{align-items:center}}
.zora-sf .checkout{background:var(--bk);color:var(--bone);width:100%;max-width:460px;border-radius:16px 16px 0 0;max-height:94vh;overflow-y:auto}
@media(min-width:680px){.zora-sf .checkout{border-radius:16px}}
.zora-sf .checkout :focus-visible{outline-color:var(--yl)}
.zora-sf .co-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px 12px 24px;border-bottom:1px solid var(--zp-color-line-dark);position:sticky;top:0;background:var(--bk)}
.zora-sf .co-head .secure{font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--zp-color-ink-300)}
.zora-sf .co-head .secure b{color:var(--bone);font-weight:500}
.zora-sf .co-head .x{background:none;border:none;color:var(--bone);font-size:24px;cursor:pointer;line-height:1;width:44px;height:44px}
.zora-sf .co-body{padding:24px}
.zora-sf .co-welcome{font-size:14px;color:var(--zp-color-ink-300);border:1px solid var(--zp-color-line-dark);border-radius:12px;padding:12px 16px;margin-bottom:24px}
.zora-sf .co-event{font-weight:700;font-size:20px;letter-spacing:-.02em}
.zora-sf .co-when{font-family:var(--mono);font-size:13px;color:var(--zp-color-ink-300);letter-spacing:.08em;margin-top:6px}
.zora-sf .qty{display:flex;align-items:center;justify-content:space-between;margin:24px 0 8px}
.zora-sf .qty .lab{font-size:16px;font-weight:700}
.zora-sf .qty .ctrl{display:flex;align-items:center;gap:12px}
.zora-sf .qty button{width:48px;height:48px;border-radius:12px;border:2px solid var(--zp-color-line-dark);background:none;color:var(--bone);font-size:20px;cursor:pointer;line-height:1}
.zora-sf .qty button:hover{border-color:var(--bone)}
.zora-sf .qty .n{font-family:var(--mono);font-size:20px;min-width:28px;text-align:center}
.zora-sf .honest{border-top:1px solid var(--zp-color-line-dark);margin-top:20px;padding-top:16px}
.zora-sf .honest .line{display:flex;justify-content:space-between;font-family:var(--mono);font-size:14px;padding:6px 0}
.zora-sf .honest .line .lbl{color:var(--zp-color-ink-300)}
.zora-sf .honest .total{display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid var(--zp-color-line-dark);margin-top:10px;padding-top:16px}
.zora-sf .honest .total .lbl{font-size:16px;font-weight:700}
.zora-sf .honest .total .val{font-family:var(--mono);font-size:24px;font-weight:600}
.zora-sf .crew-toggle{width:100%;text-align:left;font:inherit;color:inherit;display:flex;align-items:center;gap:14px;background:var(--zp-color-night);border:1px solid var(--zp-color-line-dark);border-radius:16px;padding:16px;margin-top:24px;cursor:pointer}
.zora-sf .crew-toggle .ic{width:40px;height:40px;border-radius:12px;background:var(--zp-color-mtaa-green);color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:var(--mono);font-size:16px}
.zora-sf .crew-toggle .ct{flex:1;display:flex;flex-direction:column}
.zora-sf .crew-toggle .tt{font-size:16px;font-weight:700}
.zora-sf .crew-toggle .td{font-size:14px;color:var(--zp-color-ink-300);margin-top:2px}
.zora-sf .switch{width:44px;height:26px;border-radius:99px;background:var(--zp-color-ink-600);position:relative;transition:background .12s;flex-shrink:0}
.zora-sf .switch.on{background:var(--yl)}
.zora-sf .switch::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:var(--bone);transition:transform .12s}
.zora-sf .switch.on::after{transform:translateX(18px);background:var(--bk)}
.zora-sf .crew-detail{display:none;margin-top:12px;font-family:var(--mono);font-size:13px;color:var(--zp-color-ink-300);line-height:1.8;border:1px dashed var(--zp-color-line-dark);border-radius:12px;padding:16px}
.zora-sf .crew-detail.on{display:block}
.zora-sf .crew-detail .share{color:var(--bone)}
.zora-sf .crew-detail .split-line{display:flex;justify-content:space-between;gap:12px}
.zora-sf .pay{width:100%;height:56px;background:var(--yl);color:var(--bk);border:none;font-family:var(--disp);font-size:20px;line-height:1;padding:0 24px;border-radius:16px;cursor:pointer;margin-top:24px;display:flex;align-items:center;justify-content:space-between;gap:12px;transition:background .12s}
.zora-sf .pay .pay-amt{font-family:var(--mono);font-weight:600;font-size:16px}
.zora-sf .pay:hover{background:var(--zp-color-yellow-press)}
.zora-sf .pay:active{transform:translateY(2px)}
.zora-sf .methods{display:flex;justify-content:center;gap:8px 16px;margin-top:16px;font-family:var(--mono);font-size:12px;letter-spacing:.08em;color:var(--zp-color-ink-300);flex-wrap:wrap}
.zora-sf .claim{display:none;padding:40px 24px;text-align:center}
.zora-sf .claim.on{display:block}
.zora-sf .claim-stamp{width:96px;height:96px;transform:rotate(-10deg);margin:0 auto 20px;display:block;animation:slam .18s var(--zp-motion-easing-standard) both}
@keyframes slam{from{opacity:0;transform:scale(1.3) rotate(-20deg)}to{opacity:1;transform:scale(1) rotate(-10deg)}}
@media(prefers-reduced-motion:reduce){.zora-sf .claim-stamp{animation:none}}
.zora-sf .claim h3{font-family:var(--disp);font-weight:400;font-size:32px;line-height:1}
.zora-sf .claim .code{font-family:var(--mono);font-size:16px;color:var(--yl);letter-spacing:.12em;margin-top:12px}
.zora-sf .claim p{font-size:16px;color:var(--zp-color-ink-300);line-height:1.5;margin-top:16px;max-width:34ch;margin-left:auto;margin-right:auto}
.zora-sf .claim .waiting{font-weight:700;color:var(--bone)}
.zora-sf .claim .stores{display:flex;gap:10px;justify-content:center;margin-top:24px;flex-wrap:wrap}
.zora-sf .claim .store{font-family:var(--mono);font-size:12px;letter-spacing:.08em;border:2px solid var(--zp-color-line-dark);color:var(--bone);padding:12px 16px;border-radius:12px}
.zora-sf .claim .web{font-size:14px;color:var(--zp-color-ink-300);margin-top:20px;text-decoration:underline;cursor:pointer;background:none;border:none;min-height:44px;padding:0 8px}
`;
