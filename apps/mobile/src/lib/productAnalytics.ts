import * as SecureStore from 'expo-secure-store';

type ProductAnalyticsEvent =
  | 'mobile_screen_viewed'
  | 'mobile_organizer_login_succeeded'
  | 'mobile_organizer_login_failed'
  | 'mobile_staff_code_redeemed'
  | 'mobile_staff_scan_completed'
  | 'mobile_attendee_checkout_started'
  | 'mobile_attendee_payment_started';

type Primitive = string | number | boolean | null;
type ProductAnalyticsProperties = Record<string, Primitive | Primitive[] | undefined>;

const KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY || '';
const HOST = (process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/+$/, '');
const ID_KEY = 'zora.ph.anon';
const BLOCKED_KEY = /(email|phone|msisdn|name|password|secret|token|cookie|qr|code|signature|ticket|credential|payment|card|mno|payer|holder)/i;
const ALLOWED_SCALAR = /^(surface|role|route|screen|eventId|eventName|organizerHandle|tierId|tierName|city|status|outcome|method|currency|count|quantity|amount|hasSeatMap|isSeated|source|errorType)$/;

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

async function distinctId() {
  const existing = await SecureStore.getItemAsync(ID_KEY);
  if (existing) return existing;
  const next = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  await SecureStore.setItemAsync(ID_KEY, next);
  return next;
}

export async function trackProductEvent(event: ProductAnalyticsEvent, properties: ProductAnalyticsProperties = {}) {
  if (!KEY) return;
  const safe = sanitizeProductAnalyticsProperties({
    ...properties,
    surface: properties.surface || 'mobile',
  });
  try {
    await fetch(`${HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: KEY,
        distinct_id: await distinctId(),
        event,
        properties: safe,
      }),
    });
  } catch {
    /* analytics must never block app flows */
  }
}
