'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

type ProductAnalyticsEvent =
  | 'web_page_viewed'
  | 'web_event_cta_clicked'
  | 'web_checkout_opened'
  | 'web_checkout_started'
  | 'web_payment_started'
  | 'web_seatmap_opened'
  | 'web_seatmap_selection_changed'
  | 'web_seatmap_checkout_started';

type Primitive = string | number | boolean | null;
type ProductAnalyticsProperties = Record<string, Primitive | Primitive[] | undefined>;

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || '';
const HOST = (process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/+$/, '');
const ID_KEY = 'zora.ph.anon';
const BLOCKED_KEY = /(email|phone|msisdn|name|password|secret|token|cookie|qr|code|signature|ticket|credential|payment|card|mno|payer|holder)/i;
const ALLOWED_SCALAR = /^(surface|role|route|screen|eventId|eventName|organizerHandle|tierId|tierName|city|status|outcome|method|currency|count|quantity|amount|hasSeatMap|isSeated|source|errorType)$/;

declare global {
  interface Window {
    zoraTrack?: (event: ProductAnalyticsEvent, properties?: ProductAnalyticsProperties) => void;
  }
}

function distinctId() {
  try {
    const existing = localStorage.getItem(ID_KEY);
    if (existing) return existing;
    const next = crypto.randomUUID();
    localStorage.setItem(ID_KEY, next);
    return next;
  } catch {
    return 'anonymous-web';
  }
}

function sanitizeProductAnalyticsProperties(input: ProductAnalyticsProperties = {}): ProductAnalyticsProperties {
  const out: ProductAnalyticsProperties = {};
  for (const [key, value] of Object.entries(input)) {
    if (BLOCKED_KEY.test(key) || !ALLOWED_SCALAR.test(key)) continue;
    if (value == null) out[key] = value ?? null;
    else if (Array.isArray(value)) out[key] = value.filter((v) => ['string', 'number', 'boolean'].includes(typeof v)).slice(0, 20) as Primitive[];
    else if (['string', 'number', 'boolean'].includes(typeof value)) out[key] = value;
  }
  return out;
}

export function trackProductEvent(event: ProductAnalyticsEvent, properties: ProductAnalyticsProperties = {}) {
  if (!KEY || typeof window === 'undefined') return;
  const safe = sanitizeProductAnalyticsProperties({
    ...properties,
    surface: properties.surface || 'web',
  });
  const payload = {
    api_key: KEY,
    distinct_id: distinctId(),
    event,
    properties: safe,
  };
  window.fetch(`${HOST}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

export default function ProductAnalytics() {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    window.zoraTrack = trackProductEvent;
    return () => {
      if (window.zoraTrack === trackProductEvent) delete window.zoraTrack;
    };
  }, []);

  useEffect(() => {
    if (!pathname) return;
    trackProductEvent('web_page_viewed', {
      route: pathname + (search?.toString() ? `?${search.toString()}` : ''),
    });
  }, [pathname, search]);

  return null;
}
