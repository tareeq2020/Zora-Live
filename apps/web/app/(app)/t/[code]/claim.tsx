'use client';

import { useState } from 'react';
import styles from './pass.module.css';

/* The interactive half of the /t/:code landing. Ported from the legacy tenant
   checkout's step-2 claim flow (thebrunchcity.html .claim): a pass is a live
   object waiting in the Zora app, so the primary action is claiming it in-app
   (deep link zora://t/<code>, the same scheme the ticket QR encodes — see
   apps/api/src/vendor/ticket.js), with a "basic web pass" fallback that reveals
   the server-rendered pass image for anyone without the app installed. */
export function PassClaim({ code }: { code: string }) {
  const [webPass, setWebPass] = useState(false);
  const deepLink = `zora://t/${encodeURIComponent(code)}`;
  const openInApp = () => {
    // Attempt the app deep link; if the app isn't installed the scheme simply
    // does nothing and the goer can fall back to the basic web pass below.
    window.location.href = deepLink;
  };

  return (
    <div className={styles.card}>
      <div className={styles.tick} aria-hidden="true">&#10003;</div>
      <h1 className={styles.title}>Your pass is ready.</h1>
      <p className={styles.code}>PASS {code}</p>
      <p className={styles.body}>
        Your pass is a live object — and it&apos;s{' '}
        <span className={styles.waiting}>waiting for you in the Zora app.</span>{' '}
        Claiming takes thirty seconds and unlocks faster entry, resale, and crew split.
      </p>

      <a className={styles.open} href={deepLink} onClick={(e) => { e.preventDefault(); openInApp(); }}>
        Open in the Zora app
      </a>

      <div className={styles.stores}>
        <button type="button" className={styles.store} onClick={openInApp}>CLAIM ON APP STORE</button>
        <button type="button" className={styles.store} onClick={openInApp}>CLAIM ON GOOGLE PLAY</button>
      </div>

      {!webPass ? (
        <button type="button" className={styles.web} onClick={() => setWebPass(true)}>
          or use a basic web pass &rarr;
        </button>
      ) : (
        <div className={styles.pass}>
          {/* The server-rendered pass from the ticket API — the web fallback for
              goers without the app. Screenshots don't scan; the app pass is live. */}
          <img
            className={styles.passImg}
            src={`/api/tickets/${encodeURIComponent(code)}.svg`}
            alt={`Zora web pass ${code}`}
          />
          <p className={styles.passNote}>
            This is a basic web pass. It gets you in, but claiming in the app unlocks the
            live pass, faster entry, resale, and crew split.
          </p>
          <a className={styles.download} href={`/api/tickets/${encodeURIComponent(code)}.png`} download>
            download pass image &darr;
          </a>
        </div>
      )}
    </div>
  );
}
