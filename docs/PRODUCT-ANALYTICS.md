# Product Analytics

Zora uses PostHog for product-behavior analytics only. Financial and operational
analytics remain canonical in the Zora database and existing admin/organizer
analytics APIs.

## Boundary

PostHog is for questions like:

- Which product surfaces are being used?
- Where do buyers or organizers start checkout or payment flows?
- Which organizer mobile workflows are active?
- Which scan and door-staff actions happen in the mobile app?

PostHog is not the source of truth for:

- Revenue
- Payout balances
- Settlement state
- Ticket validity
- Order/payment reconciliation
- Operational audit history

## Privacy Rules

Never send PII, payment secrets, ticket secrets, or credential material to
PostHog. The shared sanitizer in `packages/core/src/product-analytics.ts` drops
properties with keys matching:

- email
- phone / msisdn
- name
- password / secret / token / cookie
- QR / code / signature
- ticket / credential
- payment / card / mno / payer / holder

Only explicitly allowlisted scalar properties pass through.

## Allowed Properties

- `surface`
- `role`
- `route`
- `screen`
- `eventId`
- `eventName`
- `organizerHandle`
- `tierId`
- `tierName`
- `city`
- `status`
- `outcome`
- `method`
- `currency`
- `count`
- `quantity`
- `amount`
- `hasSeatMap`
- `isSeated`
- `source`
- `errorType`
- `eventCount`
- `scannerRole`
- `canSell`

Use `amount` only for buyer product-funnel events where the amount is already
visible to the buyer during checkout. Do not use PostHog amounts as reporting
totals; use DB analytics for financial reporting.

## Event Taxonomy

### Web

- `web_page_viewed`
- `web_event_cta_clicked`
- `web_checkout_opened`
- `web_checkout_started`
- `web_payment_started`
- `web_seatmap_opened`
- `web_seatmap_selection_changed`
- `web_seatmap_checkout_started`

### Mobile Organizer

- `mobile_screen_viewed`
- `mobile_organizer_login_succeeded`
- `mobile_organizer_login_failed`
- `mobile_organizer_dashboard_loaded`
- `mobile_organizer_event_switched`
- `mobile_organizer_event_update_published`
- `mobile_organizer_payout_requested`
- `mobile_organizer_scan_audit_loaded`
- `mobile_organizer_scanner_created`
- `mobile_organizer_scanner_rotated`
- `mobile_organizer_scanner_revoked`

### Mobile Staff

- `mobile_staff_code_redeemed`
- `mobile_staff_scan_completed`

### Mobile Attendee

- `mobile_attendee_checkout_started`
- `mobile_attendee_payment_started`
- `mobile_attendee_payment_confirmed`
- `mobile_attendee_split_created`
- `mobile_attendee_split_host_payment_started`
- `mobile_attendee_ticket_wallet_loaded`
- `mobile_attendee_ticket_viewed`
- `mobile_attendee_otp_requested`
- `mobile_attendee_otp_verified`

## Runtime Configuration

Web:

- `NEXT_PUBLIC_POSTHOG_KEY`
- `NEXT_PUBLIC_POSTHOG_HOST`

Expo mobile:

- `EXPO_PUBLIC_POSTHOG_KEY`
- `EXPO_PUBLIC_POSTHOG_HOST`

If a key is not configured, tracking is a no-op.
