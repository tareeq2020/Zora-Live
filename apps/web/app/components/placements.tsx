'use client';

/* Placements — the React home for public/placements.js. That script fetched
   /api/placements and, for every [data-slot] region on the page, swapped in the
   admin-mapped media (setting <img src> + revealing it, or a CSS background),
   plus the hero <video poster>. Marketing pages that have slots (about, discover)
   render <Placements /> once; it runs the same DOM effect after hydration and
   renders nothing. Kept as a DOM-walking effect (not per-slot props) so it maps
   1:1 onto the legacy behaviour and works for any slot markup. */

import { useEffect } from 'react';

type Placement = { url?: string };

export function usePlacements() {
  useEffect(() => {
    let cancelled = false;
    fetch('/api/placements')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { placements?: Record<string, Placement> } | null) => {
        if (!d || cancelled) return;
        const p = d.placements || {};
        document.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) => {
          const slot = el.getAttribute('data-slot') || '';
          const url = p[slot] && p[slot].url;
          if (!url) return;
          if (el.tagName === 'IMG') {
            (el as HTMLImageElement).src = url;
            el.classList.add('loaded');
          } else {
            el.style.backgroundImage = `url(${url})`;
          }
        });
        const hv = document.querySelector<HTMLVideoElement>('.hero video');
        if (hv && p['home-hero'] && p['home-hero'].url) hv.poster = p['home-hero'].url as string;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
}

export function Placements() {
  usePlacements();
  return null;
}
