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
  | 'mobile_organizer_dashboard_loaded'
  | 'mobile_organizer_event_switched'
  | 'mobile_organizer_event_update_published'
  | 'mobile_organizer_payout_requested'
  | 'mobile_organizer_scan_audit_loaded'
  | 'mobile_organizer_scanner_created'
  | 'mobile_organizer_scanner_rotated'
  | 'mobile_organizer_scanner_revoked'
  | 'mobile_staff_code_redeemed'
  | 'mobile_staff_scan_completed'
  | 'mobile_attendee_entry_opened'
  | 'mobile_attendee_checkout_started'
  | 'mobile_attendee_payment_started'
  | 'mobile_attendee_payment_confirmed'
  | 'mobile_attendee_split_created'
  | 'mobile_attendee_split_host_payment_started'
  | 'mobile_attendee_ticket_wallet_loaded'
  | 'mobile_attendee_ticket_viewed'
  | 'mobile_attendee_otp_requested'
  | 'mobile_attendee_otp_verified';

type Primitive = string | number | boolean | null;
export type ProductAnalyticsProperties = Record<string, Primitive | Primitive[] | undefined>;

const BLOCKED_KEY = /(email|phone|msisdn|name|password|secret|token|cookie|qr|code|signature|ticket|credential|payment|card|mno|payer|holder)/i;
// Allowlisted keys that would otherwise trip BLOCKED_KEY (`name` matches
// `eventName`/`tierName`). Public catalogue names, never personal names.
const BLOCK_EXEMPT = new Set(['eventName', 'tierName']);
const ALLOWED_SCALAR = /^(surface|role|route|screen|eventId|eventName|organizerHandle|tierId|tierName|city|status|outcome|method|currency|count|quantity|amount|hasSeatMap|isSeated|source|errorType|eventCount|scannerRole|canSell)$/;

export function sanitizeProductAnalyticsProperties(input: ProductAnalyticsProperties = {}): ProductAnalyticsProperties {
  const out: ProductAnalyticsProperties = {};
  for (const [key, value] of Object.entries(input)) {
    // Allowlist first; the blocklist still guards every allowlisted key except
    // the explicit exemptions above.
    if (!ALLOWED_SCALAR.test(key)) continue;
    if (BLOCKED_KEY.test(key) && !BLOCK_EXEMPT.has(key)) continue;
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

// Dynamic path segments carry invite tokens, pass codes and ids. Analytics only
// ever sees the route PATTERN (and never the query string).
const ROUTE_PATTERNS: Array<[RegExp, string]> = [
  [/^\/join\/[^/]+/, '/join/[token]'],
  [/^\/join-team\/[^/]+/, '/join-team/[token]'],
  [/^\/t\/[^/]+/, '/t/[code]'],
  [/^\/split\/[^/]+/, '/split/[id]'],
  [/^\/dashboard\/events\/[^/]+/, '/dashboard/events/[id]'],
  [/^\/events\/[^/]+/, '/events/[id]'],
  [/^\/storefront\/[^/]+\/events\/[^/]+/, '/storefront/[handle]/events/[id]'],
  [/^\/storefront\/[^/]+/, '/storefront/[handle]'],
  [/^\/@[^/]+\/events\/[^/]+/, '/@[handle]/events/[id]'],
  [/^\/@[^/]+/, '/@[handle]'],
];

export function productRoutePattern(path: string): string {
  const pathname = (path || '/').split(/[?#]/)[0] || '/';
  for (const [re, pattern] of ROUTE_PATTERNS) {
    if (re.test(pathname)) return pathname.replace(re, pattern);
  }
  return pathname;
}
