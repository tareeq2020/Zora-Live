'use client';

/* DiscoverApp — the entire interactive body of public/discover.html: the
   location/currency menu, category chips, the two synced search inputs, the
   /api/events-backed grids (top/bottom split), the dynamic featured card, the
   KULTUR banner with its deterministic faux-QR, the ticket sheet, and the toast.
   Ported from the page's inline <script> to React state. The support widget and
   admin-mapped media come from the shared <ZBot> and <Placements>. Internal
   links are repointed to clean routes; still-static targets keep .html. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wordmark } from '../../components/wordmark';
import { RevealImg } from '../../components/reveal-img';
import { ZBot } from '../../components/zbot';
import { Placements } from '../../components/placements';

type City = { id: string; city: string; country: string; cur: string };
const CITIES: City[] = [
  { id: 'dar', city: 'Dar es Salaam', country: 'Tanzania', cur: 'TZS' },
  { id: 'zanzibar', city: 'Zanzibar', country: 'Tanzania', cur: 'TZS' },
  { id: 'nairobi', city: 'Nairobi', country: 'Kenya', cur: 'KES' },
  { id: 'accra', city: 'Accra', country: 'Ghana', cur: 'GHS' },
  { id: 'lagos', city: 'Lagos', country: 'Nigeria', cur: 'NGN' },
];

const PAL: Record<string, [string, string]> = {
  Nightlife: ['#3D2A8F', '#0A0A0B'],
  Concerts: ['#1E4FD8', '#0A0A0B'],
  Festivals: ['#B23A17', '#0A0A0B'],
  Daytime: ['#C46A28', '#171012'],
  Arts: ['#0F6E56', '#0A0A0B'],
};

const CATS = ['All', 'This Weekend', 'Concerts', 'Festivals', 'Nightlife', 'Daytime', 'Arts'];

type Ev = {
  id: string; t: string; art: string; cat: string; city: string; venue: string;
  date: string; time: string; price: number; wknd: boolean; mega: boolean;
  seated: boolean; organizer?: string; subdomain?: string; url?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEvent(e: any): Ev {
  return {
    id: e.id, t: e.name, art: e.tagline || e.organizer || '', cat: e.category || 'Festivals',
    city: e.city, venue: e.venue, date: e.dateLabel || e.date || '', time: e.time || '',
    price: e.priceFrom != null ? e.priceFrom : e.price || 0,
    wknd: !!e.weekend, mega: !!e.mega, seated: !!e.seated,
    organizer: e.organizer, subdomain: e.subdomain, url: e.url,
  };
}

const fmt = (n: number) => n.toLocaleString('en-US');

/* Faux QR (deterministic modules) — identical algorithm/seed to discover.html, so
   the SVG is byte-stable. Computed once at module load. */
const QR_SVG = (() => {
  const N = 21;
  const cell = 114 / N;
  let rects = '';
  const block = (x: number, y: number, s: number) => {
    rects += `<rect x="${x * cell}" y="${y * cell}" width="${s * cell}" height="${s * cell}" fill="#0A0A0B"/>`;
  };
  ([[0, 0], [N - 7, 0], [0, N - 7]] as [number, number][]).forEach(([fx, fy]) => {
    rects += `<rect x="${fx * cell}" y="${fy * cell}" width="${7 * cell}" height="${7 * cell}" fill="#0A0A0B"/>`;
    rects += `<rect x="${(fx + 1) * cell}" y="${(fy + 1) * cell}" width="${5 * cell}" height="${5 * cell}" fill="#fff"/>`;
    rects += `<rect x="${(fx + 2) * cell}" y="${(fy + 2) * cell}" width="${3 * cell}" height="${3 * cell}" fill="#0A0A0B"/>`;
  });
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const inFinder = (x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7);
      if (inFinder) continue;
      if (rnd() > 0.55) block(x, y, 1);
    }
  return `<svg viewBox="0 0 114 114" width="100%" height="100%">${rects}</svg>`;
})();

export function DiscoverApp() {
  const [events, setEvents] = useState<Ev[]>([]);
  const [activeCity, setActiveCity] = useState('dar');
  const [activeCat, setActiveCat] = useState('All');
  const [searchText, setSearchText] = useState('');
  const [cityResolved, setCityResolved] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; idx: number | null; href: string | null }>({
    open: false, idx: null, href: null,
  });
  const [toastMsg, setToastMsg] = useState('');
  const [toastShow, setToastShow] = useState(false);

  const locRef = useRef<HTMLDivElement>(null);
  const featSecRef = useRef<HTMLElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const query = searchText.toLowerCase().trim();
  const curCity = () => CITIES.find((c) => c.id === activeCity)!;
  const money = (v: number) => curCity().cur + ' ' + fmt(v);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    setToastShow(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastShow(false), 2600);
  }, []);

  // Boot: load our-DB events, resolve city to Dar, then a located toast.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let evs: Ev[] = [];
      try {
        const r = await fetch('/api/events');
        if (r.ok) evs = ((await r.json()) as unknown[]).map(mapEvent);
      } catch {
        evs = [];
      }
      if (cancelled) return;
      setEvents(evs);
      setCityResolved(true);
      const t = setTimeout(() => toast('Located you in Dar es Salaam — switch anytime'), 900);
      return () => clearTimeout(t);
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  // Close the location menu on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (locRef.current && !locRef.current.contains(e.target as Node)) setLocOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  // Lock body scroll while the ticket sheet is open.
  useEffect(() => {
    document.body.style.overflow = sheet.open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [sheet.open]);

  const setCity = (id: string) => {
    setActiveCity(id);
    setCityResolved(true);
    setLocOpen(false);
  };

  // ── derived list (mirrors render()) ──
  const indexed = events.map((e, i) => ({ e, i }));
  let list = indexed.filter(({ e }) => e.city === activeCity);
  if (activeCat === 'This Weekend') list = list.filter(({ e }) => e.wknd);
  else if (activeCat !== 'All') list = list.filter(({ e }) => e.cat === activeCat);
  if (query) list = list.filter(({ e }) => (e.t + ' ' + e.art + ' ' + e.venue).toLowerCase().includes(query));

  const cityCount = events.filter((e) => e.city === activeCity).length;
  const top = list.length <= 3 ? list : list.slice(0, Math.ceil(list.length / 2));
  const bottom = list.slice(top.length);

  // ── featured (mirrors featured()) ──
  const feat = useMemo(() => {
    if (!events.length) return null;
    let idx = events.findIndex((e) => e.mega);
    let badge = 'MEGA EVENT';
    if (idx < 0) {
      idx = events.length - 1;
      badge = 'JUST DROPPED';
    }
    return { idx, badge, e: events[idx] };
  }, [events]);

  const openTicket = (i: number) => setSheet({ open: true, idx: i, href: events[i].url || null });
  const closeTicket = () => setSheet({ open: false, idx: null, href: null });

  const Tile = ({ e, i }: { e: Ev; i: number }) => {
    const pal = PAL[e.cat] || ['#26262B', '#0A0A0B'];
    return (
      <article className="tile" data-i={i} onClick={() => openTicket(i)}>
        <div className="cover" style={{ ['--a' as string]: pal[0], ['--b' as string]: pal[1] }}>
          <span className="cat">{e.cat.toUpperCase()}</span>
          {e.wknd ? <span className="wknd">THIS WEEKEND</span> : null}
          <span className="ct">{e.t}</span>
        </div>
        <div className="info">
          <h3>{e.t}</h3>
          <p className="art">{e.art}</p>
          <p className="meta">
            <span className="ic">&#9679;</span>{e.date} · {e.time}
            <br />
            <span className="ic">&#9678;</span>{e.venue}
          </p>
          <div className="foot">
            <span className="price"><small>FROM</small><b>{money(e.price)}</b></span>
            <button className="get" data-i={i} onClick={(ev) => { ev.stopPropagation(); openTicket(i); }}>Get ticket</button>
          </div>
        </div>
      </article>
    );
  };

  const sheetEv = sheet.idx != null ? events[sheet.idx] : null;
  const sheetPal = sheetEv ? PAL[sheetEv.cat] || ['#3D5AFE', '#101012'] : ['#3D5AFE', '#101012'];

  return (
    <>
      <nav>
        <div className="wrap nav-in">
          <Wordmark href="/" />
          <div className="loc" ref={locRef}>
            <button className="loc-btn" id="loc-btn" onClick={() => setLocOpen((v) => !v)}>
              <span className="pin"></span>
              {!cityResolved ? <span className="detecting" id="loc-detecting">locating you…</span> : null}
              {cityResolved ? (
                <span className="city" id="loc-city">{curCity().city}, {curCity().country}</span>
              ) : null}
              <span className="chev">&#9662;</span>
            </button>
            <div className={'loc-menu' + (locOpen ? ' on' : '')} id="loc-menu">
              <p className="lm-h">SHOWING EVENTS IN</p>
              <div id="loc-list">
                {CITIES.map((c) => (
                  <div
                    className={'loc-opt' + (c.id === activeCity ? ' on' : '')}
                    data-c={c.id}
                    key={c.id}
                    onClick={() => setCity(c.id)}
                  >
                    <span>{c.city}</span>
                    <span className="co">{c.country}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="search">
            <svg className="mag" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            <input
              id="nav-search"
              placeholder="Search events, artists, venues"
              autoComplete="off"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
          <div className="nav-right">
            <a href="/about" className="link">about</a>
            <a href="/commission" className="link">pricing</a>
            <a href="/help" className="link">help</a>
            <a href="/dashboard/onboarding" className="link">organizers</a>
            <a href="#app" className="app-btn">GET THE APP</a>
          </div>
        </div>
      </nav>

      <header className="hero">
        <div className="hero-bg"></div>
        <div className="wrap hero-in">
          <span className="now">
            <span className="live-dot"></span>
            <b id="hero-count">{cityCount}</b>&nbsp;events live near <b id="hero-city">{cityResolved ? curCity().city : 'you'}</b>
          </span>
          <h1>find your <span className="g">night</span>.</h1>
          <p className="subline">Every event worth being at, near you — concerts, festivals, nightlife and daytime. One honest price. Nothing added at checkout.</p>
          <div className="hero-search">
            <div className="box">
              <svg className="mag" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
              <input
                id="hero-search"
                placeholder="Try “Offshore”, an artist, or a venue"
                autoComplete="off"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>
            <button className="go" id="hero-go" onClick={() => featSecRef.current?.scrollIntoView({ behavior: 'smooth' })}>SEARCH</button>
          </div>
        </div>
      </header>

      <section className="featured" ref={featSecRef}>
        <div className="wrap">
          {feat ? (
            <a className="feat-card" id="feat-card" href="#" onClick={(ev) => { ev.preventDefault(); openTicket(feat.idx); }}>
              <div className="feat-media" id="feat-media" style={{ ['--a' as string]: (PAL[feat.e.cat] || ['#1E4FD8', '#0A0A0B'])[0] }}>
                <RevealImg id="feat-img" src="/assets/event-01.jpg" data-slot="discover-featured" alt="" />
              </div>
              <div className="feat-body">
                <span className="feat-badge" id="feat-badge">{feat.badge}</span>
                <h2 className="feat-title" id="feat-title">{feat.e.t}</h2>
                <p className="feat-art" id="feat-art">{feat.e.art}</p>
                <p className="feat-meta" id="feat-meta">{feat.e.date} · {feat.e.time}   —   {feat.e.venue}</p>
                <div className="feat-row">
                  <span className="feat-price" id="feat-price">FROM {money(feat.e.price)}</span>
                  <span className="feat-get">GET TICKET</span>
                </div>
              </div>
            </a>
          ) : null}
        </div>
      </section>

      <div className="filters">
        <div className="wrap filters-in" id="chips">
          {CATS.map((c) => (
            <button className={'chip' + (activeCat === c ? ' on' : '')} data-cat={c} key={c} onClick={() => setActiveCat(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <section>
        <div className="wrap">
          <div className="sec-head">
            <h2 id="grid-title">Upcoming in {curCity().city}</h2>
            <span className="count" id="grid-count">{list.length} event{list.length === 1 ? '' : 's'}</span>
          </div>
          <div className="grid" id="grid-top">
            {top.length ? (
              top.map(({ e, i }) => <Tile e={e} i={i} key={i} />)
            ) : (
              <div className="empty" style={{ gridColumn: '1/-1' }}>No events match here yet. <b>Try another filter or city.</b></div>
            )}
          </div>

          <div className="kultur" style={{ marginTop: 44 }} id="kultur">
            <div className="kultur-bg"></div>
            <div className="kultur-in">
              <div>
                <p className="tagpre">THE ACTIVATION DIVISION — INVITE &amp; EARN ONLY</p>
                <p className="big">KULTUR<span className="div">BY ZORA · NOT ON SALE ANYWHERE ELSE</span></p>
                <p className="flag"><b>OFFSHORE.</b> One coast, one long daytime session off Dar. You don&apos;t buy your way on — you earn it, in the app.</p>
                <div className="cta-row">
                  <button className="k-btn" id="k-download" onClick={() => toast('Get the Zora app to enter KULTUR — invite & earn only')}>GET THE APP TO ENTER</button>
                  <a className="k-btn ghost" href="/drop-001.html">SEE THE FLAGSHIP &rarr;</a>
                </div>
              </div>
              {/* The QR now resolves to the /t/:code scan landing (F8) instead of a
                  bare app-download: that landing offers the app deep link (zora://t/<code>)
                  AND a basic web-pass fallback, so a scan works whether or not the app
                  is installed. Wrapped in an anchor so a tap on desktop follows the same
                  target a phone camera would open. */}
              <a className="qr-card" href="/t/OFFSHORE" aria-label="Open your OFFSHORE pass">
                <div className="qr" id="qr" dangerouslySetInnerHTML={{ __html: QR_SVG }} />
                <p className="qlabel">SCAN TO OPEN<br />YOUR OFFSHORE PASS</p>
              </a>
            </div>
          </div>

          <div className="sec-head" style={{ marginTop: 44, display: bottom.length ? 'flex' : 'none' }}>
            <h2>More this month</h2>
            <span className="count" id="grid-count2">{bottom.length ? bottom.length + ' more' : ''}</span>
          </div>
          <div className="grid" id="grid-bottom">
            {bottom.map(({ e, i }) => <Tile e={e} i={i} key={i} />)}
          </div>
        </div>
      </section>

      <section id="app">
        <div className="wrap">
          <div className="organize">
            <p className="pre">FOR ORGANIZERS</p>
            <h2>Take control of your event.</h2>
            <p>Launch a custom Zora subdomain in two minutes — your own storefront, your data, built-in marketing, and one honest price your crowd will love. No fees passed to them, ever.</p>
            <a className="big-btn" href="/dashboard/onboarding">
              <svg className="g" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" /><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" /></svg>
              Start organizing — sign up with Google
            </a>
            <p className="fine">Two clicks in. Your storefront is live before you finish signing up.</p>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap foot">
          <Wordmark href="/" />
          <div className="cols">
            <a href="/">brand</a>
            <a href="/drop-001.html">kultur</a>
            <a href="/dashboard/onboarding">organizers</a>
            <a href="/admin">admin</a>
          </div>
          <p className="legal">© 2026 ZORA · FIND YOUR NIGHT</p>
        </div>
      </footer>

      <div className={'sheet' + (sheet.open ? ' on' : '')} id="sheet" onClick={(e) => { if (e.target === e.currentTarget) closeTicket(); }}>
        <div className="tk">
          <div className="tk-cover" id="tk-cover" style={{ ['--a' as string]: sheetPal[0], ['--b' as string]: sheetPal[1] }}>
            <button className="x" id="tk-x" aria-label="Close" onClick={closeTicket}>&times;</button>
            <p className="tt" id="tk-title">{sheetEv ? sheetEv.t : 'Event'}</p>
          </div>
          <div className="tk-body">
            <p className="tk-meta" id="tk-meta">
              {sheetEv ? (
                <>{sheetEv.art}<br />{sheetEv.date} · {sheetEv.time}<br />{sheetEv.venue} · {curCity().city}</>
              ) : null}
            </p>
            <div className="honest">
              <span className="l">Total — 1 ticket</span>
              <span className="p" id="tk-price">{sheetEv ? (sheetEv.seated ? 'from ' : '') + money(sheetEv.price) : '—'}</span>
            </div>
            <p className="nofee">The price is the price. <b>No fees on the next screen.</b></p>
            <button
              className="tk-pay"
              id="tk-pay"
              onClick={() => {
                if (sheet.href) location.href = sheet.href;
                else {
                  closeTicket();
                  toast('Your pass is waiting in the Zora app — download to claim');
                }
              }}
            >
              {sheetEv && sheetEv.subdomain ? 'GET TICKET AT ' + sheetEv.subdomain.toUpperCase() : 'GET TICKET'}
            </button>
            <div className="methods"><span>M-PESA</span><span>TIGO PESA</span><span>AIRTEL</span><span>VISA</span><span>MASTERCARD</span></div>
          </div>
        </div>
      </div>

      <p className={'toast' + (toastShow ? ' show' : '')} id="toast">{toastMsg}</p>

      <ZBot />
      <Placements />
    </>
  );
}
