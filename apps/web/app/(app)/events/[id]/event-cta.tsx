'use client';

import { useState } from 'react';
import CheckoutFlow, { type CheckoutTier } from '../../../components/checkout-flow';

/* The single-event ticket CTA. Two fulfillment paths, chosen by the event data —
   the SAME split the storefront sheet uses (storefront-client.tsx):
     • web-sellable  (webCheckout.tiers present) → open the real <CheckoutFlow>,
       the exact transaction the storefront runs (cart → pay → scannable QR).
     • app-only      (no tiers, e.g. a pure app drop) → the legacy "claim in the
       Zora app" toast. Seated events never reach here (EventPage renders a
       seat-selection link instead). */
export function GetTicketButton({
  eventName,
  when,
  tiers,
}: {
  eventName: string;
  when?: string;
  tiers?: CheckoutTier[];
}) {
  const webTiers = (tiers || []).filter((t) => t.tierId);
  const webSellable = webTiers.length > 0;
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (webSellable) {
            setOpen(true);
          } else {
            setToast(true);
            window.setTimeout(() => setToast(false), 2600);
          }
        }}
        style={{
          border: 'none',
          cursor: 'pointer',
          color: '#fff',
          fontWeight: 700,
          fontSize: 15,
          letterSpacing: '.02em',
          padding: '15px 26px',
          borderRadius: 12,
          background: 'linear-gradient(90deg,#D53AD8,#FF4D7D,#FF9145)',
        }}
      >
        GET TICKET
      </button>

      {webSellable ? (
        <CheckoutFlow
          open={open}
          onClose={() => setOpen(false)}
          eventName={eventName}
          when={when}
          tiers={webTiers}
        />
      ) : (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 28,
            transform: `translateX(-50%) translateY(${toast ? 0 : 20}px)`,
            background: 'var(--c-text)',
            color: 'var(--c-bg)',
            fontWeight: 600,
            fontSize: 14,
            padding: '13px 20px',
            borderRadius: 12,
            opacity: toast ? 1 : 0,
            transition: '.28s',
            pointerEvents: 'none',
          }}
        >
          Your pass is waiting in the Zora app — download to claim
        </div>
      )}
    </>
  );
}
