'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  sanitizeProductAnalyticsProperties,
  type ProductAnalyticsEvent,
  type ProductAnalyticsProperties,
} from '@zora/core/product-analytics';

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || '';
const HOST = (process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/+$/, '');
const ID_KEY = 'zora.ph.anon';

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
