'use client';

/* HomeApp — the interactive body of the OFFSHORE-led home, ported from the inline
   <script>s in public/index.html and resequenced per FRONTEND-PLAN §2:

     hero → DROP 001 strip (promoted) → app → pillars → gallery → organizers →
     manifesto

   Wiring:
   - DROP strip countdown + meta come from /api/settings (dropAt/port/coords/…),
     exactly as the legacy page. The strip is anchored to the flagship via
     /api/events: the mega event (OFFSHORE) supplies the manifest destination and
     leads the module, so OFFSHORE always fronts the drop + gallery (F3 mega flag).
   - Gallery leads with the live mega event pulled from /api/events, then the
     curated proof-of-life slides.
   - Admin-mapped media + hero video poster come from the shared <Placements>.

   The shared <SiteNav>/<SiteFooter> (rendered by the marketing layout) provide the
   nav/footer chrome, so this body renders none. Internal links point at clean
   routes: the flagship at /events/offshore, discover at /discover, dashboard at
   /dashboard/*. */

import { useEffect, useRef, useState } from 'react';
import { RevealImg } from '../components/reveal-img';
import { Placements } from '../components/placements';

const FLAGSHIP_URL = '/events/offshore';

// Pre-fetch fallback — mirrors the DEFAULTS in public/index.html so the strip
// renders sensibly before /api/settings resolves.
const DEFAULTS = {
  dropTitle: 'THE OFFSHORE',
  dropName: 'DAYTIME YACHT GROOVE',
  status: 'countdown',
  dropAt: '2026-07-10T20:00:00+03:00',
  eventDateLabel: 'SAT 25 JULY 2026',
  coordinates: "06°45'S / 039°16'E",
  port: 'SLIPWAY, DAR',
  capacityLabel: '20 PAX PER YACHT',
  contactEmail: 'board@zora.app',
};

type Settings = typeof DEFAULTS & Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ZEvent = any;

const pad = (n: number) => String(n).padStart(2, '0');

// Curated proof-of-life slides (position 1 is the flagship, enriched from
// /api/events once it loads). Ported from index.html's gallery.
const SLIDES = [
  { a: '#B23A17', label: 'FESTIVAL', slot: 'home-gallery-1', src: '/assets/event-01.jpg', cap: <><b>Offshore</b> — daytime yacht groove</> },
  { a: '#3D2A8F', label: 'NIGHTLIFE', slot: 'home-gallery-2', src: '/assets/event-02.jpg', cap: <><b>Basement 001</b> — after dark</> },
  { a: '#0F6E56', label: 'ARTIST', slot: 'home-gallery-3', src: '/assets/event-05.jpg', cap: <><b>Guest selectors</b> — live sets</> },
  { a: '#1E4FD8', label: 'CROWD', slot: 'home-gallery-4', src: '/assets/event-06.jpg', cap: <><b>Sunset Social</b> — Coco Beach</> },
  { a: '#C46A28', label: 'DAYTIME', slot: null, src: '/assets/event-03.jpg', cap: <><b>Garden Brunch</b> — the city&apos;s daytime</> },
  { a: '#993556', label: 'FESTIVAL', slot: null, src: '/assets/event-04.jpg', cap: <><b>Palmwine Festival</b> — Lagos</> },
];

export function HomeApp() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [mega, setMega] = useState<ZEvent | null>(null);
  const [clock, setClock] = useState('--:--:--:--');
  const [clockState, setClockState] = useState<'' | 'live' | 'sold'>('');
  const [countLabel, setCountLabel] = useState('BOARDING PASSES DROP IN');
  const [clockUnits, setClockUnits] = useState('DAYS  HRS  MIN  SEC');

  const galleryRef = useRef<HTMLDivElement>(null);

  // Wire the DROP strip meta/countdown to /api/settings, and the DROP + gallery
  // modules to /api/events (mega flag → OFFSHORE leads).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setS({ ...DEFAULTS, ...data });
      })
      .catch(() => {}); // static fallback: keep DEFAULTS
    fetch('/api/events')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((rows: ZEvent[]) => {
        if (cancelled || !Array.isArray(rows)) return;
        const flagship = rows.find((e) => e && e.mega) || null;
        setMega(flagship);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Countdown tick — ported from index.html tick().
  useEffect(() => {
    const tick = () => {
      if (s.status === 'soldout') {
        setCountLabel(s.dropTitle);
        setClock('SOLD OUT');
        setClockState('sold');
        setClockUnits('RESALE AT FACE +10% — IN APP ONLY');
        return;
      }
      const diff = new Date(s.dropAt).getTime() - Date.now();
      if (s.status === 'live' || diff <= 0) {
        setCountLabel(s.dropTitle);
        setClock('BOARDING OPEN');
        setClockState('live');
        setClockUnits('PASSES LIVE IN THE APP');
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor(diff / 3600000) % 24;
      const m = Math.floor(diff / 60000) % 60;
      const sec = Math.floor(diff / 1000) % 60;
      setCountLabel('BOARDING PASSES DROP IN');
      setClock(`${pad(d)}:${pad(h)}:${pad(m)}:${pad(sec)}`);
      setClockState('');
      setClockUnits('DAYS  HRS  MIN  SEC');
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [s]);

  const scrollGallery = (dir: number) => {
    const t = galleryRef.current;
    if (!t) return;
    const step = Math.min(t.clientWidth * 0.8, 360);
    t.scrollBy({ left: dir * step, behavior: 'smooth' });
  };

  // Lead caption: enrich the flagship slide from /api/events once loaded.
  const leadCap = mega ? (
    <><b>{mega.name}</b>{mega.tagline ? ` — ${mega.tagline}` : ''}</>
  ) : (
    SLIDES[0].cap
  );

  return (
    <>
      <header className="hero" id="top">
        <div className="media">
          <RevealImg src="/assets/event-01.jpg" data-slot="home-hero" alt="" />
        </div>
        <video autoPlay muted loop playsInline poster="/assets/event-01.jpg">
          <source src="/assets/hero-crowd.mp4" type="video/mp4" />
        </video>
        <div className="sheen"></div>
        <div className="wrap">
          <h1 id="hero-line">
            the ticket is the product<span className="dot">.</span>
          </h1>
          <p className="sub">
            GLOBAL TICKETING, BUILT IN AFRICA. EVERY EVENT WORTH BEING AT — ONE HONEST
            PRICE, A LIVE PASS IN YOUR POCKET, NOTHING ADDED AT CHECKOUT.
          </p>
          <div className="ctas">
            <a className="btn solid" href={FLAGSHIP_URL}>GET ON THE MANIFEST</a>
            <a className="btn ghost" href="/discover">FIND EVENTS NEAR YOU</a>
          </div>
        </div>
      </header>

      <div className="marquee" aria-hidden="true">
        <span className="marquee-track" id="marquee">
          ZERO FEES AT CHECKOUT &nbsp;/&nbsp; <b>DROPS, NOT LISTINGS</b> &nbsp;/&nbsp; CREW SPLIT, NATIVE &nbsp;/&nbsp; <b>RESALE CAPPED AT FACE +10%</b> &nbsp;/&nbsp;
          ZERO FEES AT CHECKOUT &nbsp;/&nbsp; <b>DROPS, NOT LISTINGS</b> &nbsp;/&nbsp; CREW SPLIT, NATIVE &nbsp;/&nbsp; <b>RESALE CAPPED AT FACE +10%</b> &nbsp;/&nbsp;
        </span>
      </div>

      {/* DROP 001 — OFFSHORE strip (promoted to position 2) */}
      <section className="drops" id="drops">
        <div className="wrap">
          <p className="kicker">THE DROPS — ZORA LIVE</p>
          <div className="k-card">
            <div>
              <span className="k-stamp">
                <small>THE DROP SERIES — 001</small>
                <span id="k-title" dangerouslySetInnerHTML={{ __html: `${s.dropTitle}<br>${s.dropName}` }} />
              </span>
              <p className="k-meta">
                PORT: <b id="k-port">{s.port}</b><br />
                COORDS: <b id="k-coords">{s.coordinates}</b><br />
                DATE: <b id="k-date">{s.eventDateLabel}</b><br />
                CAPACITY: <b id="k-cap">{s.capacityLabel}</b>
              </p>
            </div>
            <div className="k-count">
              <p className="label" id="count-label">{countLabel}</p>
              <p className={'clock' + (clockState ? ' ' + clockState : '')} id="clock">{clock}</p>
              <p className="units" id="clock-units">{clockUnits}</p>
              <a className="btn k" href={FLAGSHIP_URL}>VIEW THE MANIFEST</a>
            </div>
          </div>
        </div>
      </section>

      {/* App section (promoted to position 3 — passes are app-only) */}
      <section id="app">
        <div className="wrap osec">
          <div className="the-o"><span>THE O IS THE DOOR</span></div>
          <div>
            <p className="kicker">THE APP</p>
            <h2>your pass lives here. nowhere else.</h2>
            <p className="lead">No PDFs. No screenshots. A live pass that moves when it&apos;s real and dies when it&apos;s not. Every drop, every split, every entry — through the O.</p>
            <div className="stores">
              <span className="store">APP STORE — SOON</span>
              <span className="store">GOOGLE PLAY — SOON</span>
            </div>
          </div>
        </div>
      </section>

      {/* Platform pillars */}
      <section id="platform">
        <div className="wrap">
          <p className="kicker">THE PLATFORM</p>
          <h2>everything ticketing broke, rebuilt.</h2>
          <div className="pillars">
            <div className="pillar">
              <p className="num mono">01</p>
              <h3>one honest number</h3>
              <p>The price you see is the price you pay. No service fee, no processing fee, no facility charge. The checkout has one line.</p>
            </div>
            <div className="pillar">
              <p className="num mono">02</p>
              <h3>drops, not listings</h3>
              <p>Events land like releases — numbered, dated, counted down. A feed you actually want to open, not a spreadsheet with a search bar.</p>
            </div>
            <div className="pillar">
              <p className="num mono">03</p>
              <h3>crew split</h3>
              <p>Book the table, split the bill inside the app. Card or mobile money — M-Pesa, Tigo Pesa, Airtel Money. Nobody plays banker.</p>
            </div>
            <div className="pillar">
              <p className="num mono">04</p>
              <h3>face value, protected</h3>
              <p>Can&apos;t make it? List your pass in-app, capped at face +10%. The new pass is issued, yours is void. Scalping isn&apos;t policed — it&apos;s impossible.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Gallery — proof-of-life; leads with the live OFFSHORE event (/api/events) */}
      <section id="gallery">
        <div className="wrap">
          <div className="gallery-head">
            <div>
              <p className="kicker">LIVE ON ZORA</p>
              <h2>festivals, nights, and the people in them.</h2>
            </div>
            <div className="gcar-nav">
              <button id="g-prev" aria-label="Previous" onClick={() => scrollGallery(-1)}>&#8249;</button>
              <button id="g-next" aria-label="Next" onClick={() => scrollGallery(1)}>&#8250;</button>
            </div>
          </div>
          <div className="gallery" id="gallery-track" ref={galleryRef}>
            {SLIDES.map((sl, i) => {
              const slide = (
                <div className="ph" style={{ ['--a' as string]: sl.a }} data-label={sl.label}>
                  {sl.slot ? (
                    <RevealImg src={sl.src} data-slot={sl.slot} alt="" />
                  ) : (
                    <RevealImg src={sl.src} alt="" />
                  )}
                </div>
              );
              return (
                <div className="gslide" key={i}>
                  {i === 0 ? (
                    <a href={FLAGSHIP_URL}>{slide}</a>
                  ) : (
                    slide
                  )}
                  <p className="cap">{i === 0 ? leadCap : sl.cap}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Organizers — supply side, below the goer path */}
      <section id="organizers">
        <div className="wrap">
          <p className="kicker">FOR ORGANIZERS — ZORA DASHBOARD</p>
          <h2>run the night. keep the morning after.</h2>
          <p className="lead" style={{ maxWidth: '60ch', color: 'var(--mut)', marginTop: 20 }}>
            Every promoter gets a premium storefront at <span className="mono" style={{ color: 'var(--bone)' }}>yourname.zora.com</span>, a real-time dashboard, a customer database that&apos;s yours to keep, and built-in email to reach it. One flat line, no junk fees passed to your crowd. The audience you bring compounds into an audience you share.
          </p>
          <div className="pillars" style={{ marginTop: 44 }}>
            <div className="pillar">
              <p className="num mono">A</p>
              <h3>your own storefront</h3>
              <p>A branded page at yourname.zora.com. You style the invitation; Zora runs the checkout and the promise underneath it.</p>
            </div>
            <div className="pillar">
              <p className="num mono">B</p>
              <h3>the live dashboard</h3>
              <p>Live revenue, ticket velocity, entry scans by the minute, and the CRM only crew splitting can build — you know who parties together.</p>
            </div>
            <div className="pillar">
              <p className="num mono">C</p>
              <h3>signals, built in</h3>
              <p>Free native email tuned for drops. Pick a segment, pick a template, send. No Mailchimp, no export, no leaving.</p>
            </div>
          </div>
          <div className="ctas" style={{ marginTop: 40 }}>
            <a className="btn solid" href="/dashboard/onboarding">OPEN YOUR DASHBOARD</a>
            <a className="btn k" href="/dashboard/login">SEE A LIVE DEMO</a>
          </div>
        </div>
      </section>

      {/* Manifesto close */}
      <section className="manifesto" id="manifesto">
        <div className="wrap">
          <p className="kicker">MANIFESTO</p>
          <p>we don&apos;t sell tickets. we open doors<span className="hl">.</span></p>
          <p>the fee era is over. the spreadsheet era is over. the scalper era is over<span className="hl">.</span></p>
          <p>built in dar es salaam. dressed for the world<span className="hl">.</span></p>
        </div>
      </section>

      <Placements />
    </>
  );
}
