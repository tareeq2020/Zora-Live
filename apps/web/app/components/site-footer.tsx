/* SiteFooter — the marketing-plane footer, ported verbatim from the <footer>
   in public/index.html. The legacy wordmark anchor is replaced by <Wordmark>.
   Links are kept pointing at the still-static *.html pages (and /admin) so they
   resolve against today's static site; each conversion PR repoints its own link
   and the mislinked "ORGANIZERS → /admin" is fixed in F6/F7 per the plan.
   Styling (.foot / .cols / .legal) comes from the marketing page CSS (F2+). */

import { Wordmark } from './wordmark';

export function SiteFooter() {
  return (
    <footer>
      <div className="wrap foot">
        <div>
          <Wordmark href="/" />
          <p className="legal" style={{ marginTop: 14 }}>
            DAR ES SALAAM / NAIROBI / LAGOS / LONDON
          </p>
        </div>
        <div className="cols">
          <div>
            EXPLORE
            <a href="#platform">platform</a>
            <a href="drop-001.html">drop 001</a>
            <a href="#manifesto">manifesto</a>
          </div>
          <div>
            ORGANIZERS
            <a href="signup.html">get started</a>
            <a href="dashboard.html">dashboard</a>
            <a href="thebrunchcity.html">live storefront</a>
            <a href="/admin">admin</a>
          </div>
          <div>
            CONTACT
            <a href="mailto:board@zora.app" id="foot-mail">
              board@zora.app
            </a>
            <a href="/admin">admin</a>
          </div>
        </div>
        <p className="legal">&copy; 2026 ZORA. THE TICKET IS THE PRODUCT.</p>
      </div>
    </footer>
  );
}
