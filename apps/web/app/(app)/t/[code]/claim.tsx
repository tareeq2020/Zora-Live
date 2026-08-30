'use client';

import { useState } from 'react';
import styles from './pass.module.css';

/* The interactive half of the /t/:code landing. Ported from the legacy tenant
   checkout's step-2 claim flow (thebrunchcity.html .claim): a pass is a live
   object waiting in the Zora app, so the primary action is claiming it in-app
   (deep link zora://t/<code>, the same scheme the ticket QR encodes — see
   apps/api/src/vendor/ticket.js), with a "basic web pass" fallback that reveals
   the server-rendered pass image for anyone without the app installed.

   A multi-ticket order arrives as several codes (XBR-346): the web-pass fallback
   reveals EVERY pass, each with its own scannable QR, not just the first. */
export function PassClaim({ codes }: { codes: string[] }) {
  const [webPass, setWebPass] = useState(false);
  const list = codes.length ? codes : [];
  const primary = list[0];
  const many = list.length > 1;
  const deepLink = primary ? `zora://t/${encodeURIComponent(primary)}` : '#';
  const openInApp = () => {
    // Attempt the app deep link; if the app isn't installed the scheme simply
    // does nothing and the goer can fall back to the basic web pass below.
    if (primary) window.location.href = deepLink;
  };

  return (
    <div className={styles.card}>
      <div className={styles.tick} aria-hidden="true">&#10003;</div>
      <h1 className={styles.title}>{many ? 'Your passes are ready.' : 'Your pass is ready.'}</h1>
      <p className={styles.code}>{many ? `${list.length} PASSES · ${list.join(', ')}` : `PASS ${primary}`}</p>
      <p className={styles.body}>
        {many ? 'Your passes are live objects — and they’re' : 'Your pass is a live object — and it’s'}{' '}
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
          {many ? `or use ${list.length} basic web passes →` : 'or use a basic web pass →'}
        </button>
      ) : (
        <div>
          {/* One server-rendered pass per ticket in the order — each carries its
              own scannable QR. The web fallback for goers without the app. */}
          {list.map((c, i) => (
            <div className={styles.pass} key={c}>
              {many ? <p className={styles.passLabel}>Pass {i + 1} of {list.length} · {c}</p> : null}
              <img
                className={styles.passImg}
                src={`/api/tickets/${encodeURIComponent(c)}.svg`}
                alt={`Zora web pass ${c}`}
              />
              <a className={styles.download} href={`/api/tickets/${encodeURIComponent(c)}.png`} download>
                download pass image &darr;
              </a>
            </div>
          ))}
          <p className={styles.passNote}>
            {many ? 'These are basic web passes — one per ticket. ' : 'This is a basic web pass. '}
            {many ? 'They get you in, but claiming' : 'It gets you in, but claiming'} in the app unlocks the
            live pass, faster entry, resale, and crew split.
          </p>
        </div>
      )}
    </div>
  );
}
