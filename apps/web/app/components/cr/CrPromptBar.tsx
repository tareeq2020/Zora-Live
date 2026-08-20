'use client';

/* CrPromptBar — the organizer "Share your drop / Share your store" bar (BS86).

   The slim, always-present, adaptive growth lever that sits above the KPI row on
   the organizer Home. It reads which drop is live and greets the organizer with
   the ONE share action (D1: persistent-but-adaptive, never dismissable). Tapping
   "Share" expands into the share sheet — an inline panel on desktop, a focus-
   trapped CrDrawer bottom-sheet on mobile — carrying a server-rendered, brand-
   matched share card (the same og:image the WhatsApp/link unfurl shows) plus the
   channels: WhatsApp (dominant) · Instagram Stories · Copy link · Download.

   States (Pass 2): loading · no-drops · drafts-only · one-live · multiple-live ·
   expanded/share · success(copy/share) · error. Reads /api/org/me (the handle) +
   /api/org/summary (the drops) — the same reads the Home page already uses.

   Guards: control-room plane only (`--cr-*` tokens); it READS the theme via the
   card route and never touches storefront rendering. Additive. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './cr-tokens.css';
import { CrDrawer } from './CrDrawer';

type SummaryEvent = { id: string; name: string; status: string; sold: number; capacity: number };

type Target = { kind: 'drop'; id: string; name: string; sold: number } | { kind: 'store'; name: string };

const WA_GREEN = '#25D366';

// ── public share URLs (carry zorapass.com/{handle}, the growth payload) ────────
function origin(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}
function storeShareUrl(handle: string) { return `${origin()}/@${handle}`; }
function dropShareUrl(eventId: string) { return `${origin()}/events/${encodeURIComponent(eventId)}`; }

// ── the server-rendered card (the SAME image the unfurl uses) ──────────────────
function cardImg(handle: string, target: Target, format?: 'story') {
  const base = target.kind === 'drop'
    ? `/api/share-card/${encodeURIComponent(handle)}/${encodeURIComponent(target.id)}.png`
    : `/api/share-card/${encodeURIComponent(handle)}.png`;
  return format ? `${base}?format=${format}` : base;
}

function goingLabel(sold: number): string | null {
  // Mirrors the server's D4 threshold + coarse ladder, so the bar and the card agree.
  const ladder = [10, 25, 50, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000];
  if (sold < ladder[0]) return null;
  let b = ladder[0];
  for (const s of ladder) if (sold >= s) b = s;
  return `${b.toLocaleString('en-US')}+ going`;
}

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}

async function triggerDownload(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 4000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

export function CrPromptBar() {
  const [handle, setHandle] = useState<string | null>(null);
  const [events, setEvents] = useState<SummaryEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [expanded, setExpanded] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [toast, setToast] = useState<string>('');
  const [sharedNudge, setSharedNudge] = useState(false);
  const sharedOnce = useRef(false);
  const isMobile = useIsMobile();

  // ── data (the same reads Home already performs) ──────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const [meRes, sumRes] = await Promise.all([
          fetch('/api/org/me', { cache: 'no-store' }),
          fetch('/api/org/summary', { cache: 'no-store' }),
        ]);
        if (!meRes.ok || !sumRes.ok) throw new Error('load');
        const me = await meRes.json();
        const sum = await sumRes.json();
        if (!alive) return;
        setHandle(typeof me.actingHandle === 'string' ? me.actingHandle : null);
        setEvents(Array.isArray(sum.events) ? sum.events : []);
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const live = useMemo(() => (events ?? []).filter((e) => e.status === 'published'), [events]);
  const drafts = useMemo(() => (events ?? []).filter((e) => e.status === 'draft'), [events]);
  const primaryDrop = live[0]; // newest live drop (D3: push the freshest live thing)

  // Default share target = newest live drop, else the store (D3).
  useEffect(() => {
    if (target || !handle) return;
    if (primaryDrop) setTarget({ kind: 'drop', id: primaryDrop.id, name: primaryDrop.name, sold: primaryDrop.sold });
    else if (handle) setTarget({ kind: 'store', name: handle });
  }, [primaryDrop, handle, target]);

  // Post-publish expand (T4/Pass 3): ?share=<eventId>|store, or ?published=1.
  useEffect(() => {
    if (loading || !handle) return;
    const q = new URLSearchParams(window.location.search);
    const share = q.get('share');
    const published = q.get('published');
    if (share === 'store') { setTarget({ kind: 'store', name: handle }); setExpanded(true); }
    else if (share && live.some((e) => e.id === share)) {
      const d = live.find((e) => e.id === share)!;
      setTarget({ kind: 'drop', id: d.id, name: d.name, sold: d.sold });
      setExpanded(true);
    } else if (published && primaryDrop) {
      setExpanded(true);
    }
  }, [loading, handle, live, primaryDrop]);

  // "Shared 🎉" return nudge — fires when the organizer comes back from WhatsApp/IG.
  useEffect(() => {
    const onFocus = () => { if (sharedOnce.current) setSharedNudge(true); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2200);
  }, []);

  const shareUrl = useMemo(() => {
    if (!target) return '';
    return target.kind === 'drop' ? dropShareUrl(target.id) : (handle ? storeShareUrl(handle) : '');
  }, [target, handle]);

  const waText = useMemo(() => {
    if (!target) return '';
    const line = target.kind === 'drop'
      ? `${target.name} is live 🎟️ Grab your passes:`
      : `Live events on Zora — get your passes:`;
    return `${line} ${shareUrl}`;
  }, [target, shareUrl]);

  const markShared = () => { sharedOnce.current = true; };

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Link copied');
    } catch {
      showToast('Copy failed — select the link');
    }
  }, [shareUrl, showToast]);

  const onDownload = useCallback(() => {
    if (!handle || !target) return;
    triggerDownload(cardImg(handle, target), `${handle}-${target.kind === 'drop' ? target.id : 'store'}.png`);
  }, [handle, target]);

  const onInstagram = useCallback(() => {
    if (!handle || !target) return;
    markShared();
    triggerDownload(cardImg(handle, target, 'story'), `${handle}-story.png`);
    showToast('Card saved — open Instagram → Story → add from gallery');
    window.open('https://instagram.com', '_blank', 'noopener');
  }, [handle, target, showToast]);

  // ── render ────────────────────────────────────────────────────────────────────
  const going = target?.kind === 'drop' ? goingLabel(target.sold) : null;

  // Bar lead copy per state.
  let dot: 'live' | 'idle' = 'idle';
  let lead: React.ReactNode = null;
  let primaryAction: React.ReactNode = null;

  if (loading) {
    lead = <span className="cr-pb-skel" aria-hidden />;
  } else if (error) {
    lead = <span className="cr-pb-lead">Couldn’t load your drops — {handle ? <>share your store: <a className="cr-pb-inline" href={`/@${handle}`}>zorapass.com/{handle}</a></> : 'refresh to try again'}.</span>;
  } else if (!handle) {
    lead = <span className="cr-pb-lead">Sign in to share your store.</span>;
  } else if (live.length === 0 && drafts.length === 0) {
    lead = <span className="cr-pb-lead">Your store is live at <a className="cr-pb-inline" href={`/@${handle}`}>zorapass.com/{handle}</a> — publish a drop to share it.</span>;
    primaryAction = <a className="cr-pb-primary" href="/dashboard/events/new">Create your first drop</a>;
  } else if (live.length === 0 && drafts.length > 0) {
    lead = <span className="cr-pb-lead"><strong>{drafts[0].name}</strong> is a draft. Publish it to share it live.</span>;
    primaryAction = <a className="cr-pb-primary" href={`/dashboard/events/${encodeURIComponent(drafts[0].id)}/edit`}>Finish &amp; publish</a>;
  } else {
    dot = 'live';
    lead = (
      <span className="cr-pb-lead">
        <span className="cr-pb-dot" aria-hidden />
        <strong>{primaryDrop.name}</strong> is live — share it
      </span>
    );
    primaryAction = (
      <button type="button" className="cr-pb-primary cr-pb-aura" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
        Share <span aria-hidden>▸</span>
      </button>
    );
  }

  // The share sheet body (used inline on desktop + inside CrDrawer on mobile).
  const sheet = handle && target ? (
    <div className="cr-pb-sheet">
      {/* card preview — the exact server-rendered unfurl image */}
      <div className="cr-pb-preview">
        <img
          className="cr-pb-card"
          src={cardImg(handle, target)}
          alt={`Share card for ${target.kind === 'drop' ? target.name : 'your store'}${going ? ` — ${going}` : ''}`}
          width={1200}
          height={630}
          loading="lazy"
        />
        {going ? <p className="cr-pb-going" aria-live="polite">{going}</p> : null}
      </div>

      <div className="cr-pb-channels">
        {/* switcher: multiple live drops / store (Pass 2 multiple-live) */}
        {(live.length > 1 || live.length >= 1) && (
          <div className="cr-pb-switch" role="group" aria-label="Choose what to share">
            {live.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`cr-pb-chip${target.kind === 'drop' && target.id === d.id ? ' cr-on' : ''}`}
                aria-pressed={target.kind === 'drop' && target.id === d.id}
                onClick={() => setTarget({ kind: 'drop', id: d.id, name: d.name, sold: d.sold })}
              >
                {d.name}
              </button>
            ))}
            <button
              type="button"
              className={`cr-pb-chip${target.kind === 'store' ? ' cr-on' : ''}`}
              aria-pressed={target.kind === 'store'}
              onClick={() => setTarget({ kind: 'store', name: handle })}
            >
              My store
            </button>
          </div>
        )}

        {/* ONE dominant WhatsApp action (Pass 4 — not a symmetric icon grid) */}
        <a
          className="cr-pb-wa"
          href={`https://wa.me/?text=${encodeURIComponent(waText)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={markShared}
          style={{ ['--wa' as string]: WA_GREEN } as React.CSSProperties}
        >
          <WhatsAppMark /> Share to WhatsApp
        </a>

        {/* secondary channels — quiet text-buttons, never equal-weight circles */}
        <div className="cr-pb-secondary">
          <button type="button" className="cr-pb-sbtn" onClick={onInstagram}>Instagram Stories</button>
          <button type="button" className="cr-pb-sbtn" onClick={onCopy}>Copy link</button>
          <button type="button" className="cr-pb-sbtn" onClick={onDownload}>Download image</button>
        </div>

        {sharedNudge ? (
          <p className="cr-pb-nudge" aria-live="polite">Shared 🎉 — nudge again after your first sales.</p>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <section className="cr-promptbar" aria-label="Share your drop">
      <h2 className="cr-pb-h">Share your drop</h2>
      <div className="cr-pb-bar" data-dot={dot}>
        <div className="cr-pb-lead-wrap">{lead}</div>
        {primaryAction}
      </div>

      {/* desktop: inline expanded panel; mobile: CrDrawer bottom-sheet */}
      {expanded && !isMobile ? sheet : null}
      {isMobile ? (
        <CrDrawer open={expanded} onClose={() => setExpanded(false)} title="Share it" ariaLabel="Share your drop">
          {sheet}
        </CrDrawer>
      ) : null}

      {/* copy toast — polite live region */}
      <div className="cr-pb-toast-live" aria-live="polite" role="status">
        {toast ? <span className="cr-pb-toast">{toast}</span> : null}
      </div>
    </section>
  );
}

function WhatsAppMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden focusable="false">
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.87 1.22 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35zM12.05 21.5h-.01a9.5 9.5 0 0 1-4.84-1.32l-.35-.21-3.6.94.96-3.51-.23-.36a9.46 9.46 0 0 1-1.45-5.05c0-5.24 4.27-9.5 9.52-9.5 2.54 0 4.93.99 6.73 2.79a9.44 9.44 0 0 1 2.79 6.72c0 5.24-4.27 9.5-9.51 9.5zm8.1-17.6A11.36 11.36 0 0 0 12.05.5C5.8.5.72 5.58.72 11.82c0 2.08.55 4.11 1.59 5.9L.62 23.5l5.92-1.55a11.34 11.34 0 0 0 5.51 1.4h.01c6.24 0 11.32-5.08 11.32-11.32 0-3.03-1.18-5.87-3.32-8.01z" />
    </svg>
  );
}
