'use client';

/* BS122 — the checkout entry point every caller imports.

   Picks the checkout by the `zp_checkout_v2` flag:
     • NEXT_PUBLIC_ZP_CHECKOUT_V2=1 → v2 always (QA override).
     • else GET /api/flags?org=&event= → v2 when zp_checkout_v2 === true.
     • any failure (old API without /api/flags, 404, timeout, offline) → v1,
       the current checkout, unchanged.
   v1 (checkout-flow-v1.tsx) stays in place for one release as the fallback. */

import { useEffect, useState } from 'react';
import CheckoutFlowV1 from './checkout-flow-v1';
import CheckoutFlowV2 from './checkout-flow-v2';
import type { CheckoutFlowProps } from './checkout-types';

export type { CheckoutTier, CheckoutFlowProps } from './checkout-types';

const FORCE_V2 = process.env.NEXT_PUBLIC_ZP_CHECKOUT_V2 === '1';
const FLAG_TIMEOUT_MS = 2500;

// One lookup per (org, event) per page load.
const flagCache = new Map<string, Promise<boolean>>();

/** Exported so a page that mounts the checkout lazily (storefront) can warm
    the lookup before the buyer taps. */
export function resolveCheckoutV2(org?: string, event?: string): Promise<boolean> {
  if (FORCE_V2) return Promise.resolve(true);
  const key = `${org || ''}|${event || ''}`;
  const hit = flagCache.get(key);
  if (hit) return hit;
  const qs = new URLSearchParams();
  if (org) qs.set('org', org);
  if (event) qs.set('event', event);
  const lookup = fetch(`/api/flags?${qs.toString()}`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: Record<string, unknown> | null) => d?.zp_checkout_v2 === true)
    .catch(() => false);
  const timeout = new Promise<boolean>((res) => setTimeout(() => res(false), FLAG_TIMEOUT_MS));
  const p = Promise.race([lookup, timeout]);
  flagCache.set(key, p);
  return p;
}

export default function CheckoutFlow(props: CheckoutFlowProps) {
  const [v2, setV2] = useState<boolean | null>(FORCE_V2 ? true : null);

  useEffect(() => {
    if (FORCE_V2) return;
    let live = true;
    resolveCheckoutV2(props.organizerHandle, props.eventId).then((on) => {
      if (live) setV2(on);
    });
    return () => {
      live = false;
    };
  }, [props.organizerHandle, props.eventId]);

  // The flag is fetched on mount, so it is almost always settled before the
  // buyer taps GET PASSES; if not, render nothing for that moment (≤2.5s).
  if (v2 === null) return null;
  return v2 ? <CheckoutFlowV2 {...props} /> : <CheckoutFlowV1 {...props} />;
}
