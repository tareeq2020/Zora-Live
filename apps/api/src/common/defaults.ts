/* Canonical defaults + seed data — copied verbatim from the legacy server.js so
   GET fallbacks and first-run seeding are byte-identical. Single source of truth
   (DRY): services import these instead of re-declaring. */

export const DEFAULT_SETTINGS = {
  dropTitle:     'DROP 001',
  dropName:      'OFFSHORE',
  status:        'countdown',
  dropAt:        '2026-07-30T20:00:00+03:00',
  eventDateLabel:'SAT 15 AUG 2026',
  coordinates:   "06°45'S / 039°16'E",
  port:          'DAR ES SALAAM',
  venue:         'Undisclosed shore. Revealed 48 hours before boarding.',
  capacityLabel: 'VESSEL 200 / SHORE 3,000',
  tagline:       'Culture, exported.',
  zoraTagline:   'The ticket is the product.',
  appNote:       'The app is the only door.',
  contactEmail:  'support@zorapass.com',
  instagram:     '',
  // BS87: global USD→TZS rate, controlled by Zora admin (PUT /settings). Organizers
  // price tiers in USD; the API charges TZS = round(usd * usdRate). One place to
  // re-rate the whole platform.
  usdRate:       2700,
};

export const DEFAULT_TIERS = [
  { id: 'v1', event: 'vessel', order: 1, name: 'BOARDING PASS',        detail: '200 souls. Sunset departure, midnight return to shore.', priceLabel: 'NOT FOR SALE', splitNote: 'Earned. Top crews, top referrers, verified attendance.', status: 'locked' },
  { id: 's1', event: 'shore',  order: 1, name: 'WAVE 01',              detail: 'First 1,000 shore passes.',                              priceLabel: '65,000 TZS',  splitNote: 'One number. No fees at checkout.',                      status: 'open'   },
  { id: 's2', event: 'shore',  order: 2, name: 'WAVE 02',              detail: 'Next 1,200 shore passes.',                               priceLabel: '85,000 TZS',  splitNote: 'Unlocks when Wave 01 closes.',                          status: 'locked' },
  { id: 's3', event: 'shore',  order: 3, name: 'WAVE 03',              detail: 'Final 800 shore passes.',                                priceLabel: '105,000 TZS', splitNote: 'Unlocks when Wave 02 closes.',                          status: 'locked' },
  { id: 's4', event: 'shore',  order: 4, name: 'CABANA — CREW OF 6',   detail: '40 cabanas on the sand. Table service all night.',       priceLabel: '900,000 TZS', splitNote: 'Crew split in-app: 150,000 TZS each.',                  status: 'open'   },
];

/* Reserved handles that can never be claimed as an organizer handle — they
   collide with reserved subdomains or top-level app routes. Canonical backend
   copy of the front-end signup TAKEN set (apps/web/public/signup.html). PR-F-AUTH
   extends it with the path-prefix app routes: dashboard, events, discover, drops, t.

   BS41 (#4): now that organizers can claim their own handle at self-signup, this
   list is the SERVER-SIDE authority and had to become a true superset of
   apps/web/middleware.ts's RESERVED_TOP. Middleware rewrites a bare `/<handle>`
   to that organizer's storefront ONLY when the first segment is not in
   RESERVED_TOP — so any handle in RESERVED_TOP but missing here could be
   registered and would then be permanently unreachable at its own front door.
   The entries below the blank line are exactly that reconciliation; keep the two
   lists in step when a new top-level route lands. */
export const RESERVED_HANDLES = [
  'zora', 'admin', 'www', 'app', 'port', 'api', 'help', 'offshore',
  'dashboard', 'events', 'discover', 'drops', 't',

  // ← mirrors apps/web/middleware.ts RESERVED_TOP (BS41)
  'about', 'brand', 'commission', 'join', 'split', 'storefront', 'login', 'signup',
  'studio', 'seatmap', 'create-event', '_next', 'assets', 'tickets', 'account',
  'favicon', 'placeholder',
  // Front doors we have not built yet but must not hand away: mail/DNS-sensitive
  // labels and the obvious impersonation risks.
  'mail', 'smtp', 'ftp', 'ns', 'cdn', 'static', 'support', 'billing', 'security',
  'status', 'blog', 'docs', 'legal', 'privacy', 'terms', 'pay', 'checkout', 'scan',
  'scanner', 'me', 'my', 'new', 'settings', 'signin', 'signout', 'logout', 'register',
];

// BS31: the platform's commission taken from an organizer's payout (does NOT change
// the ticket price the buyer pays). Per-organizer, admin-configurable; this is the
// fallback when a record has none.
// BS35: the value + the resolution/rounding rules now live in @zora/core
// (commission.ts) so there is exactly ONE definition of the money math; this is a
// re-export for the API's existing importers.
export { DEFAULT_COMMISSION_RATE } from '@zora/core';

// BS35: organizers moved from the collection_store blob to the relational
// `organizer` table (migration 0009, which also carries the fresh-install seed).
// Nothing reads a DEFAULT_ORGANIZERS fallback any more — OrganizerRepo is the
// single source.

export const SLOTS = [
  { key: 'home-hero',         label: 'Homepage hero background',    def: '/assets/event-01.jpg' },
  { key: 'home-gallery-1',    label: 'Homepage gallery — 1',        def: '/assets/event-01.jpg' },
  { key: 'home-gallery-2',    label: 'Homepage gallery — 2',        def: '/assets/event-02.jpg' },
  { key: 'home-gallery-3',    label: 'Homepage gallery — 3',        def: '/assets/event-05.jpg' },
  { key: 'home-gallery-4',    label: 'Homepage gallery — 4',        def: '/assets/event-06.jpg' },
  { key: 'about-hero',        label: 'About page hero',             def: '/assets/event-02.jpg' },
  { key: 'discover-featured', label: 'Marketplace featured banner', def: '/assets/event-01.jpg' },
];

export const DEFAULT_THEME = {
  handle: 'thebrunchcity', brandName: 'The Brunch City',
  accent: '#C46A28', secondary: '#1D6E56', bg: '#F7F1E7', card: '#FFFDF8',
  typography: 'editorial', logoUrl: '', faviconUrl: '', bannerUrl: '',
};

export const ID_TYPES = ['passport', 'drivers_license', 'national_id'];

export const KYC_REASONS = [
  { code: 'blurry_photo',         label: 'Blurry / unreadable photo',      user: 'The image was too blurry to read. Retake it in good light, holding steady.' },
  { code: 'expired_document',     label: 'Expired document',               user: 'This document has expired. Please upload a current, valid ID.' },
  { code: 'name_mismatch',        label: 'Name mismatch',                  user: 'The name on the ID does not match your account. Upload a matching ID, or update your account name.' },
  { code: 'incomplete_upload',    label: 'Incomplete — a side is missing', user: 'We need every side of the document. Please add the missing image and resubmit.' },
  { code: 'document_unclear',     label: 'Document type unclear',          user: 'We could not clearly read the document. Retake it with all four corners visible.' },
  { code: 'unsupported_document', label: 'Unsupported document',           user: "We could not accept this document. Please use a passport, driver's license, or national ID." },
  { code: 'suspected_fraud',      label: 'Suspected fraud',                user: 'We could not verify this submission. Please contact support@zorapass.com.' },
];

export const TICKET_FIELDS = ['event','dateLabel','venue','tableName','tableNo','seats','guest','ticketId','tier','qr'];

export const ROOT_DOMAIN = process.env.ZORA_ROOT_DOMAIN || 'zorapass.com';

// BS46: the published support contacts. One source of truth now lives in
// @zora/core/contacts (shared with the web surfaces so the email/phone/IG can
// never drift across apps); re-exported here so existing API imports are
// unchanged. Surfaces (help, receipts, KYC rejection copy, ticket emails) read
// these rather than inlining.
export { SUPPORT_EMAIL, SUPPORT_PHONE } from '@zora/core';

// BS47: canonical event-city list. Event.city must be one of these ids — before
// this, the field was freetext and discover's city filter matched on a fixed id
// set, so a value like "Dar Es Salaam" (freetext) silently never matched "dar"
// and hid the event from its own city page. Mirrors
// apps/web/app/lib/cities.ts; keep both in step when a city is added.
export const EVENT_CITIES = [
  { id: 'dar', label: 'Dar es Salaam', country: 'Tanzania' },
  { id: 'zanzibar', label: 'Zanzibar', country: 'Tanzania' },
  { id: 'nairobi', label: 'Nairobi', country: 'Kenya' },
  { id: 'accra', label: 'Accra', country: 'Ghana' },
  { id: 'lagos', label: 'Lagos', country: 'Nigeria' },
] as const;
export const EVENT_CITY_IDS = EVENT_CITIES.map((c) => c.id) as string[];
