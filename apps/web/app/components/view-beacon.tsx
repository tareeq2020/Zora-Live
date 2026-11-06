'use client';

/* BS123: storefront analytics beacon. Counts one view of a storefront or event
   page into first-party daily aggregates (POST /api/v/track → always 204).
   Sends only: page kind, organizer handle, event id, a random per-browser id
   (hashed with a daily salt on the server), and the first-touch source of this
   visit (referrer host / utm_source). No names, numbers or emails. A missing or
   older API (404) is silently ignored. */

import { useEffect } from 'react';

const ID_KEY = 'zora.ph.anon';
const TOUCH_KEY = 'zora.touch';

function anonId(): string {
  try {
    const got = localStorage.getItem(ID_KEY);
    if (got) return got;
    const next = crypto.randomUUID();
    localStorage.setItem(ID_KEY, next);
    return next;
  } catch {
    return '';
  }
}

function firstTouch(): { referrer: string | null; utm: string | null } {
  try {
    const saved = sessionStorage.getItem(TOUCH_KEY);
    if (saved) return JSON.parse(saved);
    const utm = new URLSearchParams(window.location.search).get('utm_source');
    let referrer: string | null = null;
    try { referrer = document.referrer ? new URL(document.referrer).origin : null; } catch { referrer = null; }
    const touch = { referrer, utm: utm ? utm.slice(0, 100) : null };
    sessionStorage.setItem(TOUCH_KEY, JSON.stringify(touch));
    return touch;
  } catch {
    return { referrer: null, utm: null };
  }
}

/** Send one aggregate beacon. Never throws; a missing org/event is a no-op. */
export function sendBeacon(kind: 'storefront' | 'event' | 'checkout', org?: string | null, event?: string | null): void {
  try {
    if (!org) return;
    if (kind !== 'storefront' && !event) return;
    const id = anonId();
    if (!id) return;
    const body = JSON.stringify({ kind, org, event: event ?? null, anonId: id, ...firstTouch() });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/v/track', new Blob([body], { type: 'application/json' }))) return;
    } catch { /* fall through */ }
    fetch('/api/v/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* analytics never breaks checkout */ }
}

/** BS153: the checkout sheet opened — counted per day/org/event, like a view. */
export function sendCheckoutBeacon(org?: string | null, event?: string | null): void {
  sendBeacon('checkout', org, event);
}

export default function ViewBeacon({ kind, org, event }: { kind: 'storefront' | 'event'; org?: string | null; event?: string | null }) {
  useEffect(() => {
    sendBeacon(kind, org, event);
  }, [kind, org, event]);
  return null;
}
