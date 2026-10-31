'use client';

import { useEffect, useState } from 'react';
import CheckoutFlow, { type CheckoutTier } from '../../../components/checkout-flow';
import { trackProductEvent } from '../../../components/product-analytics';
import styles from './event-page.module.css';

/* The single-event pass CTA. Two fulfillment paths, chosen by the event data —
   the SAME split the storefront sheet uses (storefront-client.tsx):
     • web-sellable  (webCheckout.tiers present) → open the real <CheckoutFlow>,
       the exact transaction the storefront runs (cart → pay → scannable QR).
     • app-only      (no tiers, e.g. a pure app drop) → the legacy "claim in the
       ZoraPass app" toast. Seated events never reach here (EventPage renders a
       seat-selection link instead).
   The button is the ZoraPass primary: black block, yellow Bungee label, arrow. */
export function GetTicketButton({
  eventName,
  eventId,
  when,
  tiers,
  accent,
  organizerHandle,
  artwork,
  dateLabel,
  time,
  venue,
  city,
}: {
  eventName: string;
  eventId?: string;
  when?: string;
  tiers?: CheckoutTier[];
  /** Organizer brand accent — passed through to the checkout only. The CTA itself
      is always the ZoraPass primary button; organizer colour never re-skins
      product chrome (handoff DD4). */
  accent?: string;
  /** BS122: checkout v2 summary column + flag lookup (all optional). */
  organizerHandle?: string;
  artwork?: string;
  dateLabel?: string;
  time?: string;
  venue?: string;
  city?: string;
}) {
  const webTiers = (tiers || []).filter((t) => t.tierId && !t.disabled);
  const webSellable = webTiers.length > 0;
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(false);

  // BS120: a storefront card opened in a new tab links here with ?buy=1 — open
  // the checkout straight away so the buyer lands where a plain click would
  // have taken them. Ignored for app-claim events (nothing to open).
  useEffect(() => {
    if (!webSellable) return;
    try {
      if (new URLSearchParams(window.location.search).get('buy') === '1') {
        trackProductEvent('web_event_cta_clicked', { eventId, eventName, source: 'buy_param' });
        setOpen(true);
      }
    } catch {
      /* no-op */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <button
        type="button"
        className={styles.primary}
        onClick={() => {
          if (webSellable) {
            trackProductEvent('web_event_cta_clicked', { eventId, eventName, source: 'event_page' });
            setOpen(true);
          } else {
            setToast(true);
            window.setTimeout(() => setToast(false), 2600);
          }
        }}
      >
        GET PASSES
        <span className={styles.arrow} aria-hidden="true">
          →
        </span>
      </button>

      {webSellable ? (
        <CheckoutFlow
          open={open}
          onClose={() => setOpen(false)}
          eventName={eventName}
          eventId={eventId}
          when={when}
          tiers={webTiers}
          accent={accent}
          organizerHandle={organizerHandle}
          artwork={artwork}
          dateLabel={dateLabel}
          time={time}
          venue={venue}
          city={city}
        />
      ) : (
        <div
          role="status"
          aria-live="polite"
          className={styles.toast}
          style={{
            transform: `translateX(-50%) translateY(${toast ? 0 : 20}px)`,
            opacity: toast ? 1 : 0,
          }}
        >
          Your pass is in the ZoraPass app. Download it to claim.
        </div>
      )}
    </>
  );
}
