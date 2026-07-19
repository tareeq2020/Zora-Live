'use client';

/* PR-F5 — the tenant STOREFRONT INDEX (the /@handle front door), a faithful
   React port of the multi-event storefront layout that used to live as the
   static public/thebrunchcity.html. Distinct from the single-event leaf
   (tenant.html at /@handle/events/:id): this is the organizer's own event
   INDEX. Content is data-driven (organizer + their events resolved from the
   API); the design tokens are overridden by the published storefront theme.

   Client component: it owns the Zora checkout sheet (qty / honest no-fee
   pricing / crew split / app-claim step) and the per-event countdowns, exactly
   as the original page did — just expressed as React state instead of imperative
   DOM. The server page (page.tsx) fetches and passes everything in as props. */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

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
const FONTS: Record<string, { display: string; body: string }> = {
  editorial: { display: "'Fraunces',serif", body: "'Archivo',system-ui,sans-serif" },
  grotesque: { display: "'Archivo',system-ui,sans-serif", body: "'Archivo',system-ui,sans-serif" },
  monoforward: { display: "'IBM Plex Mono',monospace", body: "'Archivo',system-ui,sans-serif" },
};

const fmt = (n: number) => n.toLocaleString('en-US');
const pad = (n: number) => String(n).padStart(2, '0');

// Darken a hex color (matches the storefront's `shade()` for the accent-deep hover).
function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  const f = amt < 0 ? 0 : 255,
    p = Math.abs(amt);
  r = Math.round((f - r) * p + r);
  g = Math.round((f - g) * p + g);
  b = Math.round((f - b) * p + b);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

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
        setLabel('HAPPENING NOW');
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

export default function StorefrontClient(props: StorefrontProps) {
  const { handle, brandName, subdomain, eyebrow, lede, aboutHeading, aboutBody, events, theme, canManage } = props;
  const accent = theme.accent || '#C46A28';
  const accentDeep = shade(accent, -0.3);
  const font = (theme.typography && FONTS[theme.typography]) || FONTS.editorial;

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

  const rootStyle = {
    ['--accent' as string]: accent,
    ['--accent-deep' as string]: accentDeep,
    ['--secondary' as string]: theme.secondary || '#1D6E56',
    ['--paper' as string]: theme.bg || '#F7F1E7',
    ['--card' as string]: theme.card || '#FFFDF8',
    ['--display' as string]: font.display,
    ['--body' as string]: font.body,
  } as React.CSSProperties;

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400..500&family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div className="zora-sf" style={rootStyle}>
        {/* ── client-branded nav ── */}
        <nav>
          <div className="wrap nav-in">
            <a className="logo" href="#top">
              <span
                className="mark"
                style={theme.logoUrl ? { background: `url(${theme.logoUrl}) center/cover no-repeat` } : undefined}
              />
              <span>{brandName}</span>
            </a>
            <div className="nav-actions">
              {canManage ? (
                <Link className="nav-manage" href="/dashboard">
                  MANAGE
                </Link>
              ) : null}
              <a className="nav-cta" href="#events">
                GET PASSES
              </a>
            </div>
          </div>
        </nav>

        {/* ── hero ── */}
        <header id="top">
          <div className="wrap">
            {theme.bannerUrl ? (
              <div className="banner" style={{ backgroundImage: `url(${theme.bannerUrl})` }} />
            ) : null}
            <p className="eyebrow">{eyebrow}</p>
            <h1>{brandName}</h1>
            <p className="lede">{lede}</p>
          </div>
        </header>

        {/* ── events ── */}
        <section id="events">
          <div className="wrap">
            <p className="sec-h">
              UPCOMING — {events.length} EVENT{events.length === 1 ? '' : 'S'}
            </p>
            {events.length === 0 ? (
              <p className="empty">No upcoming events right now — check back soon.</p>
            ) : (
              events.map((ev) => {
                const evCur = CUR[ev.city || ''] || 'TZS';
                return (
                  <div className="event" key={ev.id}>
                    <div className="event-top">
                      <div>
                        <p className="name">{ev.name}</p>
                        <p className="meta">
                          <b>
                            {(ev.dateLabel || 'TBA').toUpperCase()}
                            {ev.time ? ` · ${ev.time}` : ''}
                          </b>
                          <br />
                          {(ev.venue || 'VENUE TBA').toUpperCase()}
                          <br />
                          {(ev.category || 'EVENT').toUpperCase()}
                          {ev.seated ? ' · SEATED' : ' · GENERAL ADMISSION'}
                        </p>
                        <Countdown ev={ev} />
                      </div>
                      <div className="right">
                        <p className="from">FROM</p>
                        <p className="price">
                          {fmt(ev.priceFrom || 0)}
                          <span style={{ fontSize: 15 }}> {evCur}</span>
                        </p>
                      </div>
                    </div>
                    <div className="event-bar">
                      <Link className="details" href={`/@${handle}/events/${encodeURIComponent(ev.id)}`}>
                        VIEW DETAILS →
                      </Link>
                      <button className="get" onClick={() => openCheckout(ev)}>
                        GET PASSES
                      </button>
                    </div>
                  </div>
                );
              })
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
            <div className="runs">
              RUNS ON{' '}
              <span className="zmark">
                z<span className="o">o</span>ra
              </span>{' '}
              — NO FEES AT CHECKOUT, EVER
            </div>
            <p className="legal">
              © {new Date().getFullYear()} {brandName} · {subdomain}
            </p>
          </div>
        </footer>

        {/* ═══ ZORA CHECKOUT SHEET ═══ */}
        <div className={'sheet' + (open ? ' on' : '')} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          {active ? (
            <div className="checkout">
              <div className="co-head">
                <span className="secure">
                  SECURE CHECKOUT · <b>ZORA</b>
                </span>
                <button className="x" aria-label="Close" onClick={() => setOpen(false)}>
                  ×
                </button>
              </div>

              {!paid ? (
                <div className="co-body">
                  <div className="co-welcome">The price is the price — nothing is added on the next screen.</div>
                  <p className="co-event">{active.name}</p>
                  <p className="co-when">
                    {active.dateLabel || 'TBA'}
                    {active.time ? ` · ${active.time}` : ''} · {active.venue || 'TBA'}
                  </p>

                  <div className="qty">
                    <span className="lab">Passes</span>
                    <div className="ctrl">
                      <button aria-label="Fewer" onClick={() => setQty((q) => Math.max(1, q - 1))}>
                        −
                      </button>
                      <span className="n">{qty}</span>
                      <button aria-label="More" onClick={() => setQty((q) => Math.min(10, q + 1))}>
                        +
                      </button>
                    </div>
                  </div>

                  <div className="honest">
                    <div className="line">
                      <span className="lbl">
                        {qty} × {fmt(unit)} {cur}
                      </span>
                      <span className="val">
                        {fmt(total)} {cur}
                      </span>
                    </div>
                    <div className="line fees">
                      <span className="lbl">Service fees</span>
                      <span className="val">0 {cur}</span>
                    </div>
                    <div className="total">
                      <span className="lbl">Total</span>
                      <span className="val">
                        {fmt(total)} {cur}
                      </span>
                    </div>
                  </div>
                  <p className="nofees">
                    The price is the price. <b>Nothing is added on the next screen.</b>
                  </p>

                  <div className="crew-toggle" onClick={() => setCrew((c) => !c)}>
                    <span className="ic">6</span>
                    <div className="ct">
                      <p className="tt">Split with your crew</p>
                      <p className="td">Everyone pays their own share. Card or mobile money.</p>
                    </div>
                    <span className={'switch' + (crew ? ' on' : '')} />
                  </div>
                  <div className={'crew-detail' + (crew ? ' on' : '')}>
                    <div className="split-line">
                      <span>Your share now</span>
                      <span className="share">
                        {fmt(Math.round(total / 6))} {cur}
                      </span>
                    </div>
                    <div className="split-line">
                      <span>5 invites sent on WhatsApp</span>
                      <span>15 min hold</span>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      Each friend installs Zora and pays their share. Passes issue when the sixth lands.
                    </div>
                  </div>

                  <button className="pay" onClick={pay}>
                    PAY {fmt(total)} {cur}
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
                  <div className="tick">✓</div>
                  <h3>Paid. You&apos;re on the list.</h3>
                  <p className="code">{orderRef.current}</p>
                  <p>
                    Your pass is a live object — and it&apos;s{' '}
                    <span className="waiting">waiting for you in the Zora app.</span> Claiming takes thirty seconds and
                    unlocks faster entry, resale, and crew split.
                  </p>
                  <div className="stores">
                    <span className="store">CLAIM ON APP STORE</span>
                    <span className="store">CLAIM ON GOOGLE PLAY</span>
                  </div>
                  <button className="web" onClick={() => setOpen(false)}>
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

const STYLE = `
.zora-sf{--z-black:#0A0A0B;--z-bone:#F4F1EA;--z-blue:#3D5AFE;--z-hair:#222226;--z-mut:#8A877E;--ink:#241C14;--mut:#8B8175;--hair:#E7DECE;--mono:'IBM Plex Mono',monospace;background:var(--paper);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased;min-height:100vh}
.zora-sf *{margin:0;padding:0;box-sizing:border-box}
.zora-sf a{color:inherit;text-decoration:none}
.zora-sf ::selection{background-color:var(--accent);color:#fff}
.zora-sf .wrap{max-width:1000px;margin:0 auto;padding:0 24px}

.zora-sf nav{border-bottom:1px solid var(--hair);position:sticky;top:0;background:rgba(247,241,231,.9);backdrop-filter:blur(10px);z-index:40}
.zora-sf .nav-in{display:flex;align-items:center;justify-content:space-between;height:70px}
.zora-sf .logo{display:flex;align-items:center;gap:11px;font-family:var(--display);font-weight:600;font-size:22px;letter-spacing:-.01em}
.zora-sf .logo .mark{width:26px;height:26px;border-radius:50%;background-color:var(--accent);flex-shrink:0}
.zora-sf .nav-actions{display:flex;align-items:center;gap:14px}
.zora-sf .nav-manage{font-family:var(--mono);font-size:12px;letter-spacing:.08em;color:var(--ink);border:1px solid var(--hair);padding:10px 18px;border-radius:99px;transition:border-color .2s}
.zora-sf .nav-manage:hover{border-color:var(--ink)}
.zora-sf .nav-cta{font-family:var(--mono);font-size:12px;letter-spacing:.08em;background-color:var(--accent);color:#fff;padding:11px 20px;border-radius:99px;transition:background .2s}
.zora-sf .nav-cta:hover{background-color:var(--accent-deep)}

.zora-sf header{padding:90px 0 70px;border-bottom:1px solid var(--hair)}
.zora-sf .banner{height:230px;background-size:cover;background-position:center;border-radius:16px;margin-bottom:34px}
.zora-sf .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.28em;color:var(--secondary);margin-bottom:22px}
.zora-sf h1{font-family:var(--display);font-weight:600;font-size:clamp(40px,7vw,78px);line-height:1.02;letter-spacing:-.02em;max-width:16ch}
.zora-sf h1 em{font-style:italic;color:var(--accent)}
.zora-sf .lede{font-size:clamp(16px,2vw,19px);color:var(--mut);max-width:52ch;margin-top:26px;line-height:1.65}

.zora-sf section{padding:70px 0}
.zora-sf .sec-h{font-family:var(--mono);font-size:12px;letter-spacing:.22em;color:var(--mut);margin-bottom:30px}
.zora-sf .empty{color:var(--mut);font-family:var(--mono);font-size:13px;letter-spacing:.04em}
.zora-sf .event{background:var(--card);border:1px solid var(--hair);border-radius:16px;overflow:hidden;margin-bottom:22px}
.zora-sf .event-top{padding:30px 32px;display:grid;grid-template-columns:1fr auto;gap:20px;align-items:start}
@media(max-width:680px){.zora-sf .event-top{grid-template-columns:1fr}}
.zora-sf .event .name{font-family:var(--display);font-weight:600;font-size:clamp(24px,3.5vw,34px);letter-spacing:-.01em;line-height:1.05}
.zora-sf .event .meta{font-family:var(--mono);font-size:12px;letter-spacing:.06em;color:var(--mut);margin-top:12px;line-height:1.9}
.zora-sf .event .meta b{color:var(--ink);font-weight:500}
.zora-sf .event .right{text-align:right}
@media(max-width:680px){.zora-sf .event .right{text-align:left}}
.zora-sf .event .from{font-family:var(--mono);font-size:12px;color:var(--mut);letter-spacing:.06em}
.zora-sf .event .price{font-family:var(--display);font-weight:600;font-size:30px;margin-top:4px}
.zora-sf .countdown{font-family:var(--mono);font-size:12px;letter-spacing:.1em;color:var(--accent);margin-top:14px}
.zora-sf .event-bar{border-top:1px solid var(--hair);padding:18px 32px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.zora-sf .details{font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--mut);transition:color .2s}
.zora-sf .details:hover{color:var(--ink)}
.zora-sf .get{font-family:var(--mono);font-size:12px;letter-spacing:.12em;background-color:var(--accent);color:#fff;border:none;padding:14px 30px;border-radius:99px;cursor:pointer;transition:background .2s}
.zora-sf .get:hover{background-color:var(--accent-deep)}

.zora-sf .about{background:var(--card);border-top:1px solid var(--hair);border-bottom:1px solid var(--hair)}
.zora-sf .about .wrap{padding:64px 24px}
.zora-sf .about h2{font-family:var(--display);font-weight:500;font-size:clamp(24px,3.5vw,36px);letter-spacing:-.01em;max-width:22ch}
.zora-sf .about p{color:var(--mut);max-width:56ch;margin-top:18px}

.zora-sf footer{padding:50px 0}
.zora-sf .foot{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}
.zora-sf .runs{display:flex;align-items:center;gap:10px;font-family:var(--mono);font-size:12px;letter-spacing:.1em;color:var(--mut)}
.zora-sf .runs .zmark{font-family:var(--body);font-weight:600;letter-spacing:-.02em;color:var(--ink)}
.zora-sf .runs .zmark .o{color:var(--z-blue)}
.zora-sf .foot .legal{font-family:var(--mono);font-size:11px;color:var(--mut);letter-spacing:.06em}

.zora-sf .sheet{position:fixed;inset:0;background:rgba(10,10,11,.55);backdrop-filter:blur(4px);display:none;align-items:flex-end;justify-content:center;z-index:90}
.zora-sf .sheet.on{display:flex}
@media(min-width:680px){.zora-sf .sheet{align-items:center}}
.zora-sf .checkout{background:var(--z-black);color:var(--z-bone);width:100%;max-width:460px;border-radius:20px 20px 0 0;max-height:94vh;overflow-y:auto}
@media(min-width:680px){.zora-sf .checkout{border-radius:18px}}
.zora-sf .co-head{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--z-hair);position:sticky;top:0;background:var(--z-black)}
.zora-sf .co-head .secure{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;color:var(--z-mut)}
.zora-sf .co-head .secure b{color:var(--z-bone);font-weight:500}
.zora-sf .co-head .x{background:none;border:none;color:var(--z-mut);font-size:22px;cursor:pointer;line-height:1;padding:0}
.zora-sf .co-body{padding:24px}
.zora-sf .co-welcome{font-family:var(--mono);font-size:11px;letter-spacing:.06em;color:var(--z-blue);border:1px solid var(--z-blue);border-radius:8px;padding:11px 14px;margin-bottom:22px}
.zora-sf .co-event{font-weight:600;font-size:19px;letter-spacing:-.01em}
.zora-sf .co-when{font-family:var(--mono);font-size:11.5px;color:var(--z-mut);letter-spacing:.06em;margin-top:6px}
.zora-sf .qty{display:flex;align-items:center;justify-content:space-between;margin:26px 0 8px}
.zora-sf .qty .lab{font-size:14px}
.zora-sf .qty .ctrl{display:flex;align-items:center;gap:18px}
.zora-sf .qty button{width:36px;height:36px;border-radius:50%;border:1px solid var(--z-hair);background:none;color:var(--z-bone);font-size:20px;cursor:pointer;line-height:1}
.zora-sf .qty button:hover{border-color:var(--z-bone)}
.zora-sf .qty .n{font-family:var(--mono);font-size:20px;min-width:24px;text-align:center}
.zora-sf .honest{border-top:1px solid var(--z-hair);margin-top:20px;padding-top:20px}
.zora-sf .honest .line{display:flex;justify-content:space-between;font-family:var(--mono);font-size:13.5px;padding:6px 0}
.zora-sf .honest .line .lbl{color:var(--z-mut)}
.zora-sf .honest .fees .val{color:var(--z-blue)}
.zora-sf .honest .total{display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid var(--z-hair);margin-top:10px;padding-top:16px}
.zora-sf .honest .total .lbl{font-size:15px}
.zora-sf .honest .total .val{font-family:var(--mono);font-size:26px;font-weight:500}
.zora-sf .nofees{font-family:var(--mono);font-size:11px;letter-spacing:.06em;color:var(--z-mut);text-align:center;margin-top:14px}
.zora-sf .nofees b{color:var(--z-bone);font-weight:500}
.zora-sf .crew-toggle{display:flex;align-items:center;gap:14px;background:#141416;border:1px solid var(--z-hair);border-radius:12px;padding:16px 18px;margin-top:22px;cursor:pointer}
.zora-sf .crew-toggle .ic{width:38px;height:38px;border-radius:10px;background:rgba(61,90,254,.14);color:var(--z-blue);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:var(--mono);font-size:15px}
.zora-sf .crew-toggle .ct{flex:1}
.zora-sf .crew-toggle .ct .tt{font-size:14px;font-weight:500}
.zora-sf .crew-toggle .ct .td{font-family:var(--mono);font-size:11px;color:var(--z-mut);letter-spacing:.04em;margin-top:3px}
.zora-sf .switch{width:44px;height:26px;border-radius:99px;background:var(--z-hair);position:relative;transition:background .2s;flex-shrink:0}
.zora-sf .switch.on{background:var(--z-blue)}
.zora-sf .switch::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:var(--z-bone);transition:transform .2s}
.zora-sf .switch.on::after{transform:translateX(18px)}
.zora-sf .crew-detail{display:none;margin-top:14px;font-family:var(--mono);font-size:12px;color:var(--z-mut);line-height:1.9;border:1px dashed var(--z-hair);border-radius:10px;padding:16px 18px}
.zora-sf .crew-detail.on{display:block}
.zora-sf .crew-detail .share{color:var(--z-bone)}
.zora-sf .crew-detail .split-line{display:flex;justify-content:space-between}
.zora-sf .pay{width:100%;background:var(--z-blue);color:var(--z-bone);border:none;font-family:var(--mono);font-size:13px;font-weight:500;letter-spacing:.14em;padding:17px;border-radius:12px;cursor:pointer;margin-top:22px;transition:background .2s}
.zora-sf .pay:hover{background:var(--z-bone);color:var(--z-black)}
.zora-sf .methods{display:flex;justify-content:center;gap:16px;margin-top:18px;font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--z-mut);flex-wrap:wrap}
.zora-sf .claim{display:none;padding:40px 28px;text-align:center}
.zora-sf .claim.on{display:block}
.zora-sf .claim .tick{width:54px;height:54px;border-radius:50%;border:2px solid var(--z-blue);color:var(--z-blue);display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 22px}
.zora-sf .claim h3{font-size:22px;font-weight:600;letter-spacing:-.01em}
.zora-sf .claim .code{font-family:var(--mono);font-size:15px;color:var(--z-blue);letter-spacing:.14em;margin-top:10px}
.zora-sf .claim p{font-family:var(--mono);font-size:12px;color:var(--z-mut);letter-spacing:.04em;line-height:1.8;margin-top:18px;max-width:34ch;margin-left:auto;margin-right:auto}
.zora-sf .claim .waiting{font-weight:500;color:var(--z-bone)}
.zora-sf .claim .stores{display:flex;gap:10px;justify-content:center;margin-top:24px;flex-wrap:wrap}
.zora-sf .claim .store{font-family:var(--mono);font-size:11px;letter-spacing:.06em;border:1px solid var(--z-hair);color:var(--z-bone);padding:13px 20px;border-radius:10px}
.zora-sf .claim .web{font-family:var(--mono);font-size:11px;color:var(--z-mut);letter-spacing:.06em;margin-top:20px;text-decoration:underline;cursor:pointer;background:none;border:none}
`;
