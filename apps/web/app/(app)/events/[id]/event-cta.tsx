'use client';

import { useState } from 'react';
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
}: {
  eventName: string;
  eventId?: string;
  when?: string;
  tiers?: CheckoutTier[];
  /** Organizer brand accent — passed through to the checkout only. The CTA itself
      is always the ZoraPass primary button; organizer colour never re-skins
      product chrome (handoff DD4). */
  accent?: string;
}) {
  const webTiers = (tiers || []).filter((t) => t.tierId && !t.disabled);
  const webSellable = webTiers.length > 0;
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(false);

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
