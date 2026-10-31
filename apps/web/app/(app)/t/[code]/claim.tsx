'use client';

import { useState } from 'react';
import styles from './pass.module.css';

/* The interactive half of the /t/:code landing. Ported from the legacy tenant
   checkout's step-2 claim flow (thebrunchcity.html .claim): a pass is a live
   object waiting in the ZoraPass app, so the primary action is claiming it in-app
   (deep link zora://t/<code>, the same scheme the ticket QR encodes — see
   apps/api/src/vendor/ticket.js), with a "basic web pass" fallback that reveals
   the server-rendered pass image for anyone without the app installed.

   A multi-ticket order arrives as several codes (XBR-346): the web-pass fallback
   reveals EVERY pass, each with its own scannable QR, not just the first.

   BS119: ZoraPass confirmation/pass surface — black ground, YOU'RE IN. in Bungee,
   the ZORAPASS stamp at −10°, yellow OPEN MY PASS, tear line + white QR card with
   the pass ID as readable mono text under it (03_COMPONENTS §6). */
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
      <img
        className={styles.stamp}
        src="/brand/stamps/svg/zp-stamp-zorapass-dar-signal.svg"
        alt=""
        aria-hidden="true"
      />
      <h1 className={styles.title}>YOU&apos;RE IN.</h1>
      <p className={styles.lead}>
        {many ? 'Your passes are waiting in the ZoraPass app.' : 'Your pass is waiting in the ZoraPass app.'}
      </p>

      <dl className={styles.rows}>
        <dt>{many ? 'PASSES' : 'PASS'}</dt>
        <dd>{many ? `${list.length} · ${list.join(', ')}` : primary}</dd>
      </dl>

      <p className={styles.body}>
        Claiming takes thirty seconds and unlocks faster entry, resale, and crew split.
      </p>

      <a className={styles.open} href={deepLink} onClick={(e) => { e.preventDefault(); openInApp(); }}>
        OPEN MY PASS<span aria-hidden="true">→</span>
      </a>

      <div className={styles.stores}>
        <button type="button" className={styles.store} onClick={openInApp}>Claim on App Store</button>
        <button type="button" className={styles.store} onClick={openInApp}>Claim on Google Play</button>
      </div>

      {!webPass ? (
        <button type="button" className={styles.web} onClick={() => setWebPass(true)}>
          {many ? `Or use ${list.length} basic web passes` : 'Or use a basic web pass'}
        </button>
      ) : (
        <div>
          <p className={styles.hint}>Turn your brightness up</p>
          {/* One server-rendered pass per ticket in the order — each carries its
              own scannable QR. The web fallback for goers without the app. */}
          {list.map((c, i) => (
            <div className={styles.pass} key={c}>
              {many ? <p className={styles.passLabel}>Pass {i + 1} of {list.length}</p> : null}
              <div className={styles.qr}>
                <img
                  className={styles.passImg}
                  src={`/api/tickets/${encodeURIComponent(c)}.svg`}
                  alt={`ZoraPass web pass ${c}`}
                />
              </div>
              <p className={styles.passId}>{c}</p>
              <a className={styles.download} href={`/api/tickets/${encodeURIComponent(c)}.png`} download>
                Download pass image
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
