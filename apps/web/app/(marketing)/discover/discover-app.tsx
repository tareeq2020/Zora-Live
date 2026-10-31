'use client';

/* DiscoverApp — the marketplace body of /discover.

   BS119: on the ZoraPass design system (docs/ZoraPass-Design-System-Handoff,
   mockups Main / StorefrontMobile). Fixed light: bone ground, board-black ink,
   signal-yellow accent; Bungee only for short display lines and the primary
   button label (never below 20px); IBM Plex Mono for dates, prices and labels.
   Flat — no gradients, shadows, blur or ambient effects.

   It is a LISTING: search, the city menu, the category chips, the
   /api/events-backed grids, the featured card, the pass sheet and the organizer
   band all keep working, with loading skeletons, empty states and a real error
   state with a retry. Chips only ever carry a status from 04_UI_COPY that is
   actually true (the platform-featured event is a ZORA PICK). */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RevealImg } from '../../components/reveal-img';
import { ZBot } from '../../components/zbot';
import { Placements } from '../../components/placements';
import { CITIES } from '../../lib/cities';

// BS47: KULTUR is invite/earn-only with no app to redeem it in yet — the banner
// promises something the platform can't deliver on right now. Flagged off
// rather than removed so it's a one-line flip once the app ships.
const SHOW_KULTUR = false;

const CATS = ['All', 'This Weekend', 'Concerts', 'Festivals', 'Nightlife', 'Daytime', 'Arts'];
// Display labels are sentence case (04_UI_COPY rule 2); the filter keys stay as-is.
const CAT_LABEL: Record<string, string> = { 'This Weekend': 'This weekend' };

type Ev = {
  id: string; t: string; art: string; cat: string; city: string; venue: string;
  date: string; time: string; price: number; wknd: boolean; mega: boolean;
  seated: boolean; splittable: boolean; cover?: string;
  organizer?: string; subdomain?: string; url?: string;
};

// BS101: "This Weekend" is a TIME-RELATIVE filter, so it must be computed from the
// event's real date against TODAY — never a stored `weekend` flag (which every
// event carried, so far-off events showed under it forever). An event counts as
// "this weekend" when its ISO start date falls on the upcoming Saturday or Sunday
// (or the current one, when today is already the weekend). No date → not this
// weekend (we can't claim a date we don't have). Local-date math so the day never
// slips across a timezone boundary.
export function isThisWeekend(iso: string | null | undefined, now: Date = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return false;
  const ev = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(ev.getTime())) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = today.getDay(); // 0=Sun .. 6=Sat
  const sat = new Date(today);
  if (day === 0) sat.setDate(today.getDate() - 1); // Sun → this weekend's Saturday was yesterday
  else if (day === 6) sat.setDate(today.getDate()); // Sat → today
  else sat.setDate(today.getDate() + (6 - day)); // weekday → the coming Saturday
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  return ev.getTime() >= sat.getTime() && ev.getTime() <= sun.getTime();
}

/** ISO YYYY-MM-DD → short display label ("Sun 30 Aug"); '' when not parseable. */
function isoToLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEvent(e: any): Ev {
  // BS22 flags splittable tables on the event's web catalogue; the marketplace
  // surfaces that as a card badge so a group can spot a splittable table early.
  const tiers: any[] = Array.isArray(e?.webCheckout?.tiers) ? e.webCheckout.tiers : []; // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    id: e.id, t: e.name, art: e.tagline || e.organizer || '', cat: e.category || 'Festivals',
    // Display prefers the organizer's label; falls back to the structured date.
    city: e.city, venue: e.venue, date: e.dateLabel || isoToLabel(e.date) || '', time: e.time || '',
    price: e.priceFrom != null ? e.priceFrom : e.price || 0,
    // BS101: computed from the real date, not the stored flag.
    wknd: isThisWeekend(e.date), mega: !!e.mega, seated: !!e.seated,
    splittable: tiers.some((t) => t && t.split && !t.disabled),
    cover: e.cover || '',
    organizer: e.organizer, subdomain: e.subdomain, url: e.url,
  };
}

const fmt = (n: number) => n.toLocaleString('en-US');
// 04_UI_COPY money: `TSh 25,000` — symbol first; other currency codes pass through.
const curLabel = (c: string) => (c === 'TZS' ? 'TSh' : c);

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

/* The ZoraPass wordmark (one word, never "Zora" alone). */
function ZpWordmark({ href = '/', height = 24, variant = 'black' }: { href?: string; height?: number; variant?: 'black' | 'white' }) {
  return (
    <a className="zd-brand" href={href} aria-label="ZoraPass home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/brand/logo/svg/zorapass-wordmark-${variant}.svg`}
        alt="ZoraPass"
        style={{ height, width: 'auto', display: 'block' }}
        draggable={false}
      />
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

  // BS74 #5 / BS119: /discover is a FIXED-LIGHT ZoraPass surface (it scopes its
  // own .zd tokens). Pin the document to light while here — and restore the
  // visitor's choice on leave — so a dark body never leaks behind the bone
  // content. The marketing chrome also hides the theme toggle on this route.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    return () => {
      if (prev === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', prev);
    };
  }, []);

  const locRef = useRef<HTMLDivElement>(null);
  const gridSecRef = useRef<HTMLElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const query = searchText.toLowerCase().trim();
  const curCity = () => CITIES.find((c) => c.id === activeCity)!;
  // Price in the EVENT's own currency, never the currency of whatever city the
  // browser happens to be filtered to — we do not convert, so labelling a Dar
  // price "NGN" would be a lie (DESIGN.md rule 5).
  const money = (e: Ev) => curLabel(CITIES.find((c) => c.id === e.city)?.cur || curCity().cur) + ' ' + fmt(e.price);
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
      if (ok) t = setTimeout(() => toast('Showing Dar es Salaam. Switch city anytime.'), 900);
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
    if (status === 'ready') toast(n ? `${n} event${n === 1 ? '' : 's'} in ${c.city}` : `Nothing in ${c.city} yet`);
  };

  // ── derived list ──
  // BS67 (#5): a non-empty search is a GLOBAL lookup. We start from every event
  // and drop the city filter — otherwise searching for a Lagos headliner while
  // parked in Dar returned nothing (the list was city-scoped BEFORE the query
  // ran). Category still applies, and the city name joins the haystack so a bare
  // "Lagos" works as a query too. An empty query keeps the exact city-scoped
  // behaviour as before.
  const searching = !!query;
  const indexed = events.map((e, i) => ({ e, i }));
  let list = searching ? indexed : indexed.filter(({ e }) => e.city === activeCity);
  if (activeCat === 'This Weekend') list = list.filter(({ e }) => e.wknd);
  else if (activeCat !== 'All') list = list.filter(({ e }) => e.cat === activeCat);
  if (query)
    list = list.filter(({ e }) =>
      (e.t + ' ' + e.art + ' ' + e.venue + ' ' + (CITIES.find((c) => c.id === e.city)?.city || ''))
        .toLowerCase()
        .includes(query),
    );

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
    // Only a true status gets a chip: the platform-featured event is a ZORA PICK.
    return { idx: pick.i, badge: mega ? 'ZORA PICK' : '', e: pick.e };
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

  const Card = ({ e, i }: { e: Ev; i: number }) => (
    <a
      className="zd-card"
      href={hrefFor(e)}
      data-event-card
      onClick={(ev) => { ev.preventDefault(); openTicket(i); }}
    >
      <div className="zd-cover">
        {e.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="zd-cover-img" src={e.cover} alt={e.t} loading="lazy" />
        ) : (
          <span className="zd-cover-word" aria-hidden>{e.t}</span>
        )}
        {e.mega ? <span className="zd-badge zp-chip--zora-pick">ZORA PICK</span> : null}
      </div>
      <div className="zd-card-body">
        <span className="zd-when">{(e.date + (e.time ? ` · ${e.time}` : '')).toUpperCase()}</span>
        <h3 className="zd-card-t">{e.t}</h3>
        <span className="zd-where">{[e.venue, cityLabel(e)].filter(Boolean).join(' · ')}</span>
        <div className="zd-card-foot">
          <span className="zd-price">From {money(e)}</span>
          {e.splittable ? <span className="zd-plan">Split with Tuchange</span> : null}
        </div>
        <span className="zd-get">
          GET PASSES<span aria-hidden="true">→</span>
        </span>
      </div>
    </a>
  );

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

  return (
    <>
      <nav className="zd-nav">
        <div className="zd-wrap zd-nav-in">
          <ZpWordmark href="/" />

          <div className="zd-loc" ref={locRef}>
            <button
              className="zd-loc-btn"
              id="loc-btn"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={locOpen}
              onClick={() => setLocOpen((v) => !v)}
            >
                            {!cityResolved ? <span className="zd-detecting" id="loc-detecting">locating you…</span> : null}
              {cityResolved ? <span className="zd-city" id="loc-city">{curCity().city}</span> : null}
              <span className="zd-chev" aria-hidden>&#9662;</span>
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
            <a href="/help" className="zd-link">Help</a>
            <a href="/dashboard/onboarding" className="zd-ghost-btn">Organizers</a>
          </div>
        </div>
      </nav>

      <header className="zd-hero">
        <div className="zd-wrap zd-hero-in">
          <span className="zd-now">
                        {status === 'loading' ? (
              <>FINDING WHAT&rsquo;S ON…</>
            ) : status === 'error' ? (
              <>EVENTS UNAVAILABLE</>
            ) : (
              <>
                <b id="hero-count">{cityCount}</b> EVENT{cityCount === 1 ? '' : 'S'} IN{' '}
                <b id="hero-city">{cityResolved ? curCity().city.toUpperCase() : 'YOUR CITY'}</b>
              </>
            )}
          </span>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="zd-stamp" src="/brand/stamps/svg/zp-stamp-zorapass-dar-black.svg" alt="" aria-hidden="true" />
          <h1 className="zd-h1">WHAT&rsquo;S ON?</h1>
          <p className="zd-subline">Concerts, festivals, nights out and new experiences.</p>

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
      {status === 'ready' && !searching && feat ? (
        <section className="zd-featured">
          <div className="zd-wrap">
            <a
              className="zd-feat"
              id="feat-card"
              href={hrefFor(feat.e)}
              onClick={(ev) => { ev.preventDefault(); openTicket(feat.idx); }}
            >
              <div className="zd-feat-media" id="feat-media">
                <RevealImg id="feat-img" src={feat.e.cover || '/assets/event-01.jpg'} data-slot="discover-featured" alt={feat.e.t} />
              </div>
              <div className="zd-feat-body">
                {feat.badge ? (
                  <span className="zd-feat-badge zp-chip--zora-pick" id="feat-badge">{feat.badge}</span>
                ) : null}
                <h2 className="zd-feat-title" id="feat-title">{feat.e.t}</h2>
                {feat.e.art ? <p className="zd-feat-art" id="feat-art">{feat.e.art}</p> : null}
                <p className="zd-feat-meta" id="feat-meta">
                  {(feat.e.date + (feat.e.time ? ` · ${feat.e.time}` : '')).toUpperCase()} · {feat.e.venue}
                </p>
                <div className="zd-feat-row">
                  <span className="zd-feat-price" id="feat-price">From {money(feat.e)}</span>
                  <span className="zd-feat-get">
                    GET PASSES<span aria-hidden="true">→</span>
                  </span>
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
              {CAT_LABEL[c] || c}
            </button>
          ))}
        </div>
      </div>

      <section className="zd-sec" ref={gridSecRef}>
        <div className="zd-wrap">
          <div className="zd-sec-head">
            <h2 id="grid-title">{searching ? 'Results across all cities' : `Upcoming in ${curCity().city}`}</h2>
            <span className="zd-count" id="grid-count">
              {status === 'ready' ? `${list.length} EVENT${list.length === 1 ? '' : 'S'} · SORTED BY DATE` : status === 'loading' ? 'LOADING…' : 'UNAVAILABLE'}
            </span>
          </div>

          <div className="zd-grid" id="grid-top">
            {status === 'loading' ? <Skeletons n={6} /> : null}

            {status === 'error' ? (
              <div className="zd-state zd-state-err">
                <p className="zd-state-h">We couldn&rsquo;t load events right now.</p>
                <p className="zd-state-p">The listing service didn&rsquo;t answer ({errCause}). Your passes and payments are not affected.</p>
                <button className="zd-state-btn" type="button" onClick={() => load()}>TRY AGAIN</button>
              </div>
            ) : null}

            {status === 'ready' && !searching && cityCount === 0 ? (
              <div className="zd-state">
                <p className="zd-state-h zd-display">NOTHING HERE YET.</p>
                <p className="zd-state-p">No events in {curCity().city} yet. Try another city:</p>
                <div className="zd-state-cities">
                  {CITIES.filter((c) => c.id !== activeCity).map((c) => (
                    <button className="zd-state-btn zd-ghost" type="button" key={c.id} onClick={() => setCity(c.id)}>
                      {c.city.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {status === 'ready' && !searching && cityCount > 0 && list.length === 0 ? (
              <div className="zd-state">
                <p className="zd-state-h zd-display">NOTHING HERE YET.</p>
                <p className="zd-state-p">
                  Nothing in {CAT_LABEL[activeCat] || activeCat} in {curCity().city} right now. {cityCount} other event{cityCount === 1 ? '' : 's'} {cityCount === 1 ? 'is' : 'are'} on here.
                </p>
                <button className="zd-state-btn" type="button" onClick={clearFilters}>SEE ALL EVENTS</button>
              </div>
            ) : null}

            {status === 'ready' && searching && list.length === 0 ? (
              <div className="zd-state">
                <p className="zd-state-h zd-display">NOTHING HERE YET.</p>
                <p className="zd-state-p">
                  Nothing matches “{searchText.trim()}” in any city{activeCat !== 'All' ? <> in {CAT_LABEL[activeCat] || activeCat}</> : null}. Try a different spelling, or see everything.
                </p>
                <button className="zd-state-btn" type="button" onClick={clearFilters}>SEE ALL EVENTS</button>
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
                  <p className="zd-big">KULTUR<span className="zd-div">BY ZORAPASS · NOT ON SALE ANYWHERE ELSE</span></p>
                  <p className="zd-flag"><b>OFFSHORE.</b> One coast, one long daytime session off Dar. You don&apos;t buy your way on — you earn it, in the app.</p>
                  <div className="zd-cta-row">
                    <button className="zd-k-btn" id="k-download" type="button" onClick={() => toast('Get the ZoraPass app to enter KULTUR. Invite and earn only.')}>GET THE APP TO ENTER</button>
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
            <h2>SELL OUT YOUR NEXT EVENT.</h2>
            <p className="zd-org-p">Sell passes, get paid, check people in.</p>
            <a className="zd-aura-btn" href="/dashboard/onboarding">
              START SELLING<span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
      </section>

      <footer className="zd-footer">
        <div className="zd-wrap zd-foot">
          <p className="zd-foot-line">YOUR PASS TO WHAT&rsquo;S ON.</p>
          <div className="zd-cols">
            <a href="/">Brand</a>
            <a href="/dashboard/onboarding">Organizers</a>
            <a href="/help">Help</a>
          </div>
          <p className="zd-legal">© 2026 ZORAPASS</p>
        </div>
      </footer>

      {/* ── pass sheet ── */}
      <div
        className={'zd-sheet' + (sheet.open ? ' on' : '')}
        id="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={sheetEv ? sheetEv.t : 'Event'}
        onClick={(e) => { if (e.target === e.currentTarget) closeTicket(); }}
      >
        <div className="zd-tk">
          <div className="zd-tk-cover" id="tk-cover">
            {sheetEv?.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="zd-tk-img" src={sheetEv.cover} alt={sheetEv.t} />
            ) : null}
            <button className="zd-x" id="tk-x" type="button" aria-label="Close" onClick={closeTicket}>&times;</button>
            <p className="zd-tt" id="tk-title">{sheetEv ? sheetEv.t : 'Event'}</p>
          </div>
          <div className="zd-tk-body">
            <p className="zd-tk-meta" id="tk-meta">
              {sheetEv ? (
                <>{sheetEv.art ? <><span className="zd-tk-art">{sheetEv.art}</span><br /></> : null}{(sheetEv.date + (sheetEv.time ? ` · ${sheetEv.time}` : '')).toUpperCase()}<br />{sheetEv.venue} · {cityLabel(sheetEv)}</>
              ) : null}
            </p>
            {sheetEv?.splittable ? <p className="zd-tk-split">Split with Tuchange — each person pays their own share from their phone.</p> : null}
            <div className="zd-honest">
              <span className="zd-l">{sheetEv?.seated ? 'FROM · 1 SEAT' : 'FROM · 1 PASS'}</span>
              <span className="zd-p" id="tk-price">{sheetEv ? money(sheetEv) : "—"}</span>
            </div>
            <button
              className="zd-tk-pay"
              id="tk-pay"
              type="button"
              onClick={() => { if (sheet.href) location.href = sheet.href; }}
            >
              GET PASSES<span aria-hidden="true">→</span>
            </button>
            <p className="zd-methods">
              {sheetEv && sheetEv.organizer ? <>Sold by {sheetEv.organizer}. </> : null}Mobile money or card. Fees shown before you pay.
            </p>
          </div>
        </div>
      </div>

      <p className={'zd-toast' + (toastShow ? ' show' : '')} id="toast" role="status" aria-live="polite">{toastMsg}</p>

      <ZBot />
      <Placements />
    </>
  );
}
