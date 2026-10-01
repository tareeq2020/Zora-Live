export type ProductAnalyticsEvent =
  | 'web_page_viewed'
  | 'web_event_cta_clicked'
  | 'web_checkout_opened'
  | 'web_checkout_started'
  | 'web_payment_started'
  | 'web_seatmap_opened'
  | 'web_seatmap_selection_changed'
  | 'web_seatmap_checkout_started'
  | 'mobile_screen_viewed'
  | 'mobile_organizer_login_succeeded'
  | 'mobile_organizer_login_failed'
  | 'mobile_staff_code_redeemed'
  | 'mobile_staff_scan_completed'
  | 'mobile_attendee_checkout_started'
  | 'mobile_attendee_payment_started';

type Primitive = string | number | boolean | null;
export type ProductAnalyticsProperties = Record<string, Primitive | Primitive[] | undefined>;

const BLOCKED_KEY = /(email|phone|msisdn|name|password|secret|token|cookie|qr|code|signature|ticket|credential|payment|card|mno|payer|holder)/i;
const ALLOWED_SCALAR = /^(surface|role|route|screen|eventId|eventName|organizerHandle|tierId|tierName|city|status|outcome|method|currency|count|quantity|amount|hasSeatMap|isSeated|source|errorType)$/;

export function sanitizeProductAnalyticsProperties(input: ProductAnalyticsProperties = {}): ProductAnalyticsProperties {
  const out: ProductAnalyticsProperties = {};
  for (const [key, value] of Object.entries(input)) {
    if (BLOCKED_KEY.test(key) || !ALLOWED_SCALAR.test(key)) continue;
    if (value == null) {
      out[key] = value ?? null;
    } else if (Array.isArray(value)) {
      out[key] = value.filter((v) => ['string', 'number', 'boolean'].includes(typeof v)).slice(0, 20) as Primitive[];
    } else if (['string', 'number', 'boolean'].includes(typeof value)) {
      out[key] = value;
    }
  }
  return out;
}
