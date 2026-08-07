'use client';

/* DiscoverApp — the marketplace body of /discover.

   BS37 (cluster D, #8): re-skinned onto the CONSUMER plane of DESIGN.md — the
   same dark cinematic language as the apex home (BS27 coming-soon.tsx): #08080A
   canvas, Space Grotesk display / Inter body / IBM Plex Mono for money+meta, the
   Zora orb mark, shimmer gradient text, an ember particle field, cursor glow,
   film grain and a vignette, all sitting BEHIND the content and all silenced by
   `prefers-reduced-motion`.

   It is still a LISTING, not a teaser: search, the city menu, the category chips,
   the /api/events-backed grids, the featured card, the ticket sheet, the KULTUR
   banner and the organizer CTA all keep working. What changed is the skin, the
   card anatomy (cover-forward + FROM price in mono + a SPLITTABLE badge) and the
   state coverage — loading skeletons, an empty state, and a real error state with
   a retry (the old code swallowed a failed fetch into "no events").

   DESIGN.md rules honoured: the aura gradient appears ONLY on the primary CTAs
   (organizer launch + the sheet's buy button) and the logo orb — never as
   decoration; money/dates/labels are IBM Plex Mono at >= 11.5px; touch targets
   are >= 44px and nothing is hover-only. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { RevealImg } from '../../components/reveal-img';
import { ZBot } from '../../components/zbot';
import { Placements } from '../../components/placements';
import { CITIES } from '../../lib/cities';

// BS47: KULTUR is invite/earn-only with no app to redeem it in yet — the banner
// promises something the platform can't deliver on right now. Flagged off
// rather than removed so it's a one-line flip once the app ships.
const SHOW_KULTUR = false;

/* Cover fallback tints — deep, desaturated, category-coded. Deliberately NOT the
   aura gradient (rule 1: aura = primary action or the logo O only). */
const PAL: Record<string, [string, string]> = {
  Nightlife: ['#2B1B5E', '#0A0B10'],
  Concerts: ['#123067', '#0A0B10'],
  Festivals: ['#4A1B3E', '#0A0B10'],
  Daytime: ['#5A3312', '#0A0B10'],
  Arts: ['#0C5245', '#0A0B10'],
};

const CATS = ['All', 'This Weekend', 'Concerts', 'Festivals', 'Nightlife', 'Daytime', 'Arts'];
const SPARKS = ['#f7922f', '#ec3f7e', '#c41ee0', '#a855f7'];

type Ev = {
  id: string; t: string; art: string; cat: string; city: string; venue: string;
  date: string; time: string; price: number; wknd: boolean; mega: boolean;
  seated: boolean; splittable: boolean; cover?: string;
  organizer?: string; subdomain?: string; url?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEvent(e: any): Ev {
  // BS22 flags splittable tables on the event's web catalogue; the marketplace
  // surfaces that as a card badge so a group can spot a splittable table early.
  const tiers: any[] = Array.isArray(e?.webCheckout?.tiers) ? e.webCheckout.tiers : []; // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    id: e.id, t: e.name, art: e.tagline || e.organizer || '', cat: e.category || 'Festivals',
    city: e.city, venue: e.venue, date: e.dateLabel || e.date || '', time: e.time || '',
    price: e.priceFrom != null ? e.priceFrom : e.price || 0,
    wknd: !!e.weekend, mega: !!e.mega, seated: !!e.seated,
    splittable: tiers.some((t) => t && t.split && !t.disabled),
    cover: e.cover || '',
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

const prefersReduced = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ── ambient layers (all decorative, all behind the content) ───────────────── */

/* Canvas ember field, ported from the home. Fixed behind the page, half the
   home's density (this is a content surface, not a takeover). Under
   reduced-motion it paints ONE frame and never animates. */
type Particle = { x: number; y: number; r: number; vy: number; vx: number; life: number; maxLife: number; color: string; glow: number };
function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduce = prefersReduced();

    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    const particles: Particle[] = [];
    const MAX = 46;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const spawn = (n: number) => {
      for (let i = 0; i < n; i++) {
        particles.push({
          x: Math.random() * w,
          y: h + Math.random() * 40,
          r: Math.random() * 1.6 + 0.4,
          vy: -(Math.random() * 0.34 + 0.1),
          vx: (Math.random() - 0.5) * 0.18,
          life: 0,
          maxLife: Math.random() * 620 + 380,
          color: SPARKS[(Math.random() * SPARKS.length) | 0],
          glow: Math.random() * 0.4 + 0.2,
        });
      }
    };
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;
        p.x += p.vx;
        p.y += p.vy;
        p.vx += (Math.random() - 0.5) * 0.01;
        if (p.life >= p.maxLife || p.y < -30) {
          particles.splice(i, 1);
          continue;
        }
        const alpha = Math.sin((p.life / p.maxLife) * Math.PI) * p.glow;
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = p.r * 4;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      if (particles.length < MAX) spawn(MAX - particles.length);
      if (!reduce) raf = requestAnimationFrame(tick);
    };

    resize();
    spawn(MAX);
    if (reduce) {
      // one static frame: mid-life so the embers are visible, then stop
      particles.forEach((p) => (p.life = Math.floor(p.maxLife / 2)));
    }
    tick();
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return <canvas ref={canvasRef} aria-hidden className="zd-canvas" />;
}

/* Cursor-following aura glow — pointer devices only, and never under
   reduced-motion. */
function CursorGlow() {
  const mx = useMotionValue(-800);
  const my = useMotionValue(-800);
  const x = useSpring(mx, { stiffness: 55, damping: 22, mass: 0.7 });
  const y = useSpring(my, { stiffness: 55, damping: 22, mass: 0.7 });
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (prefersReduced()) return;
    if (!window.matchMedia?.('(pointer: fine)').matches) return;
    setOn(true);
    const move = (e: PointerEvent) => {
      mx.set(e.clientX);
      my.set(e.clientY);
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [mx, my]);

  if (!on) return null;
  return (
    <motion.div aria-hidden className="zd-cursor" style={{ x, y }}>
      <div className="zd-cursor-in" />
    </motion.div>
  );
}

function Grain() {
  const noise =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
  return <div aria-hidden className="zd-grain" style={{ backgroundImage: noise }} />;
}

/* The wordmark: ZORA with the orb as the O (the one decorative-looking place the
   aura is allowed — it IS the logo). */
function OrbWordmark({ href = '/', size = 20 }: { href?: string; size?: number }) {
  return (
    <a className="zd-brand" href={href} aria-label="Zora — home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="zd-orb zora-aura" src="/zora-orb.png" alt="" width={size} height={size} style={{ width: size, height: size }} draggable={false} />
      <span className="zd-brand-t">ZORA</span>
    </a>
  );
}

function MagIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

/* ── the page ──────────────────────────────────────────────────────────────── */

type Status = 'loading' | 'ready' | 'error';

export function DiscoverApp() {
  const [events, setEvents] = useState<Ev[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [errCause, setErrCause] = useState('');
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
  const gridSecRef = useRef<HTMLElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const query = searchText.toLowerCase().trim();
  const curCity = () => CITIES.find((c) => c.id === activeCity)!;
  // Price in the EVENT's own currency, never the currency of whatever city the
  // browser happens to be filtered to — we do not convert, so labelling a Dar
  // price "NGN" would be a lie (DESIGN.md rule 5).
  const money = (e: Ev) => (CITIES.find((c) => c.id === e.city)?.cur || curCity().cur) + ' ' + fmt(e.price);
  const cityLabel = (e: Ev) => CITIES.find((c) => c.id === e.city)?.city || curCity().city;

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    setToastShow(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastShow(false), 2600);
  }, []);

  /* Load the marketplace. A failed (or non-200) fetch is a real ERROR state now —
     it used to fall through to an empty grid, which lied about the city. */
  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const r = await fetch('/api/events');
      if (!r.ok) throw new Error(`the events service replied ${r.status}`);
      const data = await r.json();
      if (!Array.isArray(data)) throw new Error('the events service sent an unexpected response');
      setEvents(data.map(mapEvent));
      setErrCause('');
      setStatus('ready');
      return true;
    } catch (e) {
      setErrCause(e instanceof Error ? e.message : 'the request failed');
      setStatus('error');
      return false;
    }
  }, []);

  // Boot: load the events, resolve the city, then a "located you" success toast.
  useEffect(() => {
    let cancelled = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const ok = await load();
      if (cancelled) return;
      setCityResolved(true);
      if (ok) t = setTimeout(() => toast('Located you in Dar es Salaam — switch anytime'), 900);
    })();
    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
    };
  }, [load, toast]);

  // Close the location menu on outside click / Escape.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (locRef.current && !locRef.current.contains(e.target as Node)) setLocOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setLocOpen(false);
      setSheet({ open: false, idx: null, href: null });
    };
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
    };
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
    const c = CITIES.find((x) => x.id === id)!;
    const n = events.filter((e) => e.city === id).length;
    if (status === 'ready') toast(n ? `${n} event${n === 1 ? '' : 's'} live in ${c.city}` : `Nothing live in ${c.city} yet`);
  };

  // ── derived list ──
  const indexed = events.map((e, i) => ({ e, i }));
  let list = indexed.filter(({ e }) => e.city === activeCity);
  if (activeCat === 'This Weekend') list = list.filter(({ e }) => e.wknd);
  else if (activeCat !== 'All') list = list.filter(({ e }) => e.cat === activeCat);
  if (query) list = list.filter(({ e }) => (e.t + ' ' + e.art + ' ' + e.venue).toLowerCase().includes(query));

  const cityCount = events.filter((e) => e.city === activeCity).length;
  // Split into two grids only when there's enough to fill the first one (3 across
  // on desktop); a 4-event city reads better as one full row than as 2 + 2.
  const top = list.length <= 6 ? list : list.slice(0, Math.ceil(list.length / 2));
  const bottom = list.slice(top.length);
  const filtered = activeCat !== 'All' || !!query;

  /* ── featured ──
     Scoped to the CITY on screen: a Dar headliner on top of a Lagos listing read
     as a bug (and, priced in the viewer's currency, as a wrong price). No event
     in this city -> no featured card. */
  const feat = useMemo(() => {
    const here = events.map((e, i) => ({ e, i })).filter(({ e }) => e.city === activeCity);
    if (!here.length) return null;
    const mega = here.find(({ e }) => e.mega);
    const pick = mega || here[here.length - 1];
    return { idx: pick.i, badge: mega ? 'MEGA EVENT' : 'JUST DROPPED', e: pick.e };
  }, [events, activeCity]);

  // Every card is a REAL link (middle-click / keyboard / SEO) to the event or its
  // white-label storefront; the click is intercepted to open the ticket sheet.
  const hrefFor = (e: Ev) => e.url || `/events/${encodeURIComponent(e.id)}`;
  const openTicket = (i: number) => setSheet({ open: true, idx: i, href: hrefFor(events[i]) });
  const closeTicket = () => setSheet({ open: false, idx: null, href: null });

  const clearFilters = () => {
    setActiveCat('All');
    setSearchText('');
  };

  const Card = ({ e, i }: { e: Ev; i: number }) => {
    const pal = PAL[e.cat] || ['#1D2033', '#0A0B10'];
    return (
      <a
        className="zd-card"
        href={hrefFor(e)}
        data-event-card
        onClick={(ev) => { ev.preventDefault(); openTicket(i); }}
      >
        <div className="zd-cover" style={{ ['--a' as string]: pal[0], ['--b' as string]: pal[1] }}>
          {e.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="zd-cover-img" src={e.cover} alt="" loading="lazy" />
          ) : (
            <span className="zd-cover-word">{e.t}</span>
          )}
          <span className="zd-cat">{e.cat.toUpperCase()}</span>
          <span className="zd-badges">
            {e.wknd ? <span className="zd-badge zd-badge-wknd">THIS WEEKEND</span> : null}
            {e.splittable ? <span className="zd-badge zd-badge-split">SPLITTABLE</span> : null}
          </span>
        </div>
        <div className="zd-card-body">
          <h3 className="zd-card-t">{e.t}</h3>
          {e.art ? <p className="zd-card-art">{e.art}</p> : null}
          <p className="zd-card-meta">
            <span className="zd-when">{e.date}{e.time ? ` · ${e.time}` : ''}</span>
            <span className="zd-where">{e.venue}</span>
          </p>
          <div className="zd-card-foot">
            <span className="zd-price">
              <small>FROM</small>
              <b>{money(e)}</b>
            </span>
            <span className="zd-get">GET TICKET</span>
          </div>
        </div>
      </a>
    );
  };

  const Skeletons = ({ n = 6 }: { n?: number }) => (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div className="zd-skel" key={i} aria-hidden>
          <div className="zd-skel-cover" />
          <div className="zd-skel-body">
            <span className="zd-skel-line zd-skel-w80" />
            <span className="zd-skel-line zd-skel-w50" />
            <span className="zd-skel-line zd-skel-w65" />
            <span className="zd-skel-line zd-skel-w40" />
          </div>
        </div>
      ))}
    </>
  );

  const sheetEv = sheet.idx != null ? events[sheet.idx] : null;
  const sheetPal = sheetEv ? PAL[sheetEv.cat] || ['#1D2033', '#0A0B10'] : ['#1D2033', '#0A0B10'];

  return (
    <>
      {/* ambient layers — decorative, behind everything, reduced-motion aware */}
      <div aria-hidden className="zd-bg" />
      <div aria-hidden className="zd-layer zd-layer-1" />
      <div aria-hidden className="zd-layer zd-layer-2" />
      <div aria-hidden className="zd-layer zd-layer-3" />
      <ParticleField />
      <CursorGlow />
      <Grain />
      <div aria-hidden className="zd-vignette" />

      <nav className="zd-nav">
        <div className="zd-wrap zd-nav-in">
          <OrbWordmark href="/" />

          <div className="zd-loc" ref={locRef}>
            <button
              className="zd-loc-btn"
              id="loc-btn"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={locOpen}
              onClick={() => setLocOpen((v) => !v)}
            >
              <span className="zd-pin" />
              {!cityResolved ? <span className="zd-detecting" id="loc-detecting">locating you…</span> : null}
              {cityResolved ? <span className="zd-city" id="loc-city">{curCity().city}</span> : null}
              <span className="zd-chev">&#9662;</span>
            </button>
            <div className={'zd-loc-menu' + (locOpen ? ' on' : '')} id="loc-menu" role="listbox">
              <p className="zd-lm-h">SHOWING EVENTS IN</p>
              <div id="loc-list">
                {CITIES.map((c) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={c.id === activeCity}
                    className={'zd-loc-opt' + (c.id === activeCity ? ' on' : '')}
                    data-c={c.id}
                    key={c.id}
                    onClick={() => setCity(c.id)}
                  >
                    <span>{c.city}</span>
                    <span className="zd-co">{c.country}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="zd-navsearch">
            <MagIcon className="zd-mag" />
            <input
              id="nav-search"
              placeholder="Search events, artists, venues"
              aria-label="Search events, artists, venues"
              autoComplete="off"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>

          <div className="zd-nav-right">
            <a href="/help" className="zd-link">help</a>
            <a href="/dashboard/onboarding" className="zd-ghost-btn">FOR ORGANIZERS</a>
          </div>
        </div>
      </nav>

      <header className="zd-hero">
        <div className="zd-wrap zd-hero-in">
          <span className="zd-now">
            <span className="zd-live-dot" />
            {status === 'loading' ? (
              <>finding what&rsquo;s live near you…</>
            ) : status === 'error' ? (
              <>couldn&rsquo;t reach the events service</>
            ) : (
              <>
                <b id="hero-count">{cityCount}</b> event{cityCount === 1 ? '' : 's'} live in{' '}
                <b id="hero-city">{cityResolved ? curCity().city : 'your city'}</b>
              </>
            )}
          </span>

          <h1 className="zd-h1">
            find your <span className="shimmer-text">night</span>.
          </h1>
          <p className="zd-subline">
            Every event worth being at, near you — concerts, festivals, nightlife and daytime. One honest
            price: <b>Zora adds no booking fee</b>; your mobile-money or card provider may charge a small fee at payment.
          </p>

          <div className="zd-herosearch">
            <div className="zd-box">
              <MagIcon className="zd-mag" />
              <input
                id="hero-search"
                placeholder="Try “Offshore”, an artist, or a venue"
                aria-label="Search events, artists, venues"
                autoComplete="off"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
              {searchText ? (
                <button className="zd-clear" type="button" aria-label="Clear search" onClick={() => setSearchText('')}>
                  &times;
                </button>
              ) : null}
            </div>
            <button
              className="zd-go"
              id="hero-go"
              type="button"
              disabled={!query}
              title={query ? 'Jump to the results' : 'Type something to search'}
              onClick={() =>
                gridSecRef.current?.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'start' })
              }
            >
              SEARCH
            </button>
          </div>
        </div>
      </header>

      {/* featured — only once the list actually loaded */}
      {status === 'ready' && feat ? (
        <section className="zd-featured">
          <div className="zd-wrap">
            <a
              className="zd-feat"
              id="feat-card"
              href={hrefFor(feat.e)}
              onClick={(ev) => { ev.preventDefault(); openTicket(feat.idx); }}
            >
              <div className="zd-feat-media" id="feat-media" style={{ ['--a' as string]: (PAL[feat.e.cat] || ['#123067', '#0A0B10'])[0] }}>
                <RevealImg id="feat-img" src={feat.e.cover || '/assets/event-01.jpg'} data-slot="discover-featured" alt="" />
              </div>
              <div className="zd-feat-body">
                <span className="zd-feat-badge" id="feat-badge">{feat.badge}</span>
                <h2 className="zd-feat-title" id="feat-title">{feat.e.t}</h2>
                {feat.e.art ? <p className="zd-feat-art" id="feat-art">{feat.e.art}</p> : null}
                <p className="zd-feat-meta" id="feat-meta">
                  {feat.e.date}{feat.e.time ? ` · ${feat.e.time}` : ''} — {feat.e.venue}
                </p>
                <div className="zd-feat-row">
                  <span className="zd-feat-price" id="feat-price">FROM {money(feat.e)}</span>
                  <span className="zd-feat-get">GET TICKET</span>
                </div>
              </div>
            </a>
          </div>
        </section>
      ) : null}

      <div className="zd-filters">
        <div className="zd-wrap zd-filters-in" id="chips" role="group" aria-label="Filter by category">
          {CATS.map((c) => (
            <button
              className={'zd-chip' + (activeCat === c ? ' on' : '')}
              data-cat={c}
              key={c}
              type="button"
              aria-pressed={activeCat === c}
              disabled={status === 'loading'}
              onClick={() => setActiveCat(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <section className="zd-sec" ref={gridSecRef}>
        <div className="zd-wrap">
          <div className="zd-sec-head">
            <h2 id="grid-title">Upcoming in {curCity().city}</h2>
            <span className="zd-count" id="grid-count">
              {status === 'ready' ? `${list.length} event${list.length === 1 ? '' : 's'}` : status === 'loading' ? 'LOADING…' : 'UNAVAILABLE'}
            </span>
          </div>

          <div className="zd-grid" id="grid-top">
            {status === 'loading' ? <Skeletons n={6} /> : null}

            {status === 'error' ? (
              <div className="zd-state zd-state-err">
                <p className="zd-state-h">We couldn&rsquo;t load events right now.</p>
                <p className="zd-state-p">The listing service didn&rsquo;t answer — {errCause}. Nothing is wrong with your ticket or your money.</p>
                <button className="zd-state-btn" type="button" onClick={() => load()}>TRY AGAIN</button>
              </div>
            ) : null}

            {status === 'ready' && cityCount === 0 ? (
              <div className="zd-state">
                <p className="zd-state-h">No events in {curCity().city} yet — try another city.</p>
                <p className="zd-state-p">We&rsquo;re onboarding organizers city by city. Here&rsquo;s where the lights are on:</p>
                <div className="zd-state-cities">
                  {CITIES.filter((c) => c.id !== activeCity).map((c) => (
                    <button className="zd-state-btn zd-ghost" type="button" key={c.id} onClick={() => setCity(c.id)}>
                      {c.city.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {status === 'ready' && cityCount > 0 && list.length === 0 ? (
              <div className="zd-state">
                <p className="zd-state-h">
                  {query ? <>Nothing matches “{searchText.trim()}” in {curCity().city}.</> : <>Nothing in {activeCat} in {curCity().city} right now.</>}
                </p>
                <p className="zd-state-p">
                  {cityCount} other event{cityCount === 1 ? '' : 's'} {cityCount === 1 ? 'is' : 'are'} live here.
                </p>
                <button className="zd-state-btn" type="button" onClick={clearFilters}>SHOW EVERYTHING</button>
              </div>
            ) : null}

            {status === 'ready' ? top.map(({ e, i }) => <Card e={e} i={i} key={e.id || i} />) : null}
          </div>

          {SHOW_KULTUR ? (
            <div className="zd-kultur" id="kultur">
              <div className="zd-kultur-bg" />
              <div className="zd-kultur-in">
                <div>
                  <p className="zd-tagpre">THE ACTIVATION DIVISION — INVITE &amp; EARN ONLY</p>
                  <p className="zd-big">KULTUR<span className="zd-div">BY ZORA · NOT ON SALE ANYWHERE ELSE</span></p>
                  <p className="zd-flag"><b>OFFSHORE.</b> One coast, one long daytime session off Dar. You don&apos;t buy your way on — you earn it, in the app.</p>
                  <div className="zd-cta-row">
                    <button className="zd-k-btn" id="k-download" type="button" onClick={() => toast('Get the Zora app to enter KULTUR — invite & earn only')}>GET THE APP TO ENTER</button>
                    <a className="zd-k-btn zd-ghost" href="/drop-001.html">SEE THE FLAGSHIP &rarr;</a>
                  </div>
                </div>
                {/* The QR resolves to the /t/:code scan landing (F8) rather than a bare
                    app-download: that landing offers the app deep link AND a web-pass
                    fallback, so a scan works whether or not the app is installed. */}
                <a className="zd-qr-card" href="/t/OFFSHORE" aria-label="Open your OFFSHORE pass">
                  <div className="zd-qr" id="qr" dangerouslySetInnerHTML={{ __html: QR_SVG }} />
                  <p className="zd-qlabel">SCAN TO OPEN<br />YOUR OFFSHORE PASS</p>
                </a>
              </div>
            </div>
          ) : null}

          {status === 'ready' && bottom.length ? (
            <>
              <div className="zd-sec-head zd-sec-head-2">
                <h2>{filtered ? 'More matches' : 'More this month'}</h2>
                <span className="zd-count" id="grid-count2">{bottom.length} more</span>
              </div>
              <div className="zd-grid" id="grid-bottom">
                {bottom.map(({ e, i }) => <Card e={e} i={i} key={e.id || i} />)}
              </div>
            </>
          ) : null}
        </div>
      </section>

      <section className="zd-sec" id="app">
        <div className="zd-wrap">
          <div className="zd-organize">
            <p className="zd-pre">FOR ORGANIZERS</p>
            <h2>Take control of your event.</h2>
            <p className="zd-org-p">
              Launch a custom Zora subdomain in two minutes — your own storefront, your data, built-in
              marketing, and one honest price your crowd will love. Zora adds no booking fee on top of it.
            </p>
            <a className="zd-aura-btn" href="/dashboard/onboarding">
              <span className="zd-gwrap">
                <svg viewBox="0 0 48 48" aria-hidden><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" /><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" /></svg>
              </span>
              Launch your storefront — sign up with Google
            </a>
            <p className="zd-fine">Two clicks in. Your storefront is live before you finish signing up.</p>
          </div>
        </div>
      </section>

      <footer className="zd-footer">
        <div className="zd-wrap zd-foot">
          <OrbWordmark href="/" size={18} />
          <div className="zd-cols">
            <a href="/">brand</a>
            <a href="/drop-001.html">kultur</a>
            <a href="/dashboard/onboarding">organizers</a>
            <a href="/help">help</a>
          </div>
          <p className="zd-legal">© 2026 ZORA · FIND YOUR NIGHT</p>
        </div>
      </footer>

      {/* ── ticket sheet ── */}
      <div
        className={'zd-sheet' + (sheet.open ? ' on' : '')}
        id="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={sheetEv ? sheetEv.t : 'Event'}
        onClick={(e) => { if (e.target === e.currentTarget) closeTicket(); }}
      >
        <div className="zd-tk">
          <div className="zd-tk-cover" id="tk-cover" style={{ ['--a' as string]: sheetPal[0], ['--b' as string]: sheetPal[1] }}>
            {sheetEv?.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="zd-tk-img" src={sheetEv.cover} alt="" />
            ) : null}
            <button className="zd-x" id="tk-x" type="button" aria-label="Close" onClick={closeTicket}>&times;</button>
            <p className="zd-tt" id="tk-title">{sheetEv ? sheetEv.t : 'Event'}</p>
          </div>
          <div className="zd-tk-body">
            <p className="zd-tk-meta" id="tk-meta">
              {sheetEv ? (
                <>{sheetEv.art ? <>{sheetEv.art}<br /></> : null}{sheetEv.date}{sheetEv.time ? ` · ${sheetEv.time}` : ''}<br />{sheetEv.venue} · {cityLabel(sheetEv)}</>
              ) : null}
            </p>
            {sheetEv?.splittable ? <p className="zd-tk-split">SPLITTABLE TABLE — SHARE THE BILL WITH YOUR CREW</p> : null}
            <div className="zd-honest">
              <span className="zd-l">{sheetEv?.seated ? 'From — 1 seat' : 'From — 1 ticket'}</span>
              <span className="zd-p" id="tk-price">{sheetEv ? money(sheetEv) : "—"}</span>
            </div>
            <p className="zd-nofee">
              <b>Zora adds no booking fee.</b> Your mobile-money or card provider may charge a small fee at payment.
            </p>
            <button
              className="zd-tk-pay"
              id="tk-pay"
              type="button"
              onClick={() => { if (sheet.href) location.href = sheet.href; }}
            >
              {sheetEv && sheetEv.organizer ? 'GET TICKETS AT ' + sheetEv.organizer.toUpperCase() + ' STORE' : 'GET TICKET'}
            </button>
            <div className="zd-methods"><span>M-PESA</span><span>TIGO PESA</span><span>AIRTEL</span><span>VISA</span><span>MASTERCARD</span></div>
          </div>
        </div>
      </div>

      <p className={'zd-toast' + (toastShow ? ' show' : '')} id="toast" role="status" aria-live="polite">{toastMsg}</p>

      <ZBot />
      <Placements />
    </>
  );
}
