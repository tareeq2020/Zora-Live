'use client';

import { useState } from 'react';

/* App-only fulfillment variant (the OFFSHORE flagship + every non-seated drop):
   there is no web checkout — the pass is claimed in the Zora app. Mirrors the
   toast the legacy tenant page showed. Seated events render a seat-selection
   link instead (see EventPage), never this button. */
export function GetTicketButton() {
  const [toast, setToast] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setToast(true);
          window.setTimeout(() => setToast(false), 2600);
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
    </>
  );
}
