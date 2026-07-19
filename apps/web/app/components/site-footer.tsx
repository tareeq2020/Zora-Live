/* SiteFooter — the marketing-plane footer, ported from the <footer> in
   public/index.html. The legacy wordmark anchor is replaced by <Wordmark>.
   Internal links are repointed to the clean React routes for F4 (the flagship at
   /events/offshore, the dashboard at /dashboard/*); the live storefront keeps its
   still-static tenant page. Styling (.foot / .cols / .legal) comes from the home
   page CSS. */

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
            <a href="/events/offshore">drop 001</a>
            <a href="#manifesto">manifesto</a>
          </div>
          <div>
            ORGANIZERS
            <a href="/dashboard/onboarding">get started</a>
            <a href="/dashboard/login">dashboard</a>
            <a href="/@thebrunchcity">live storefront</a>
            <a href="/dashboard/login">admin</a>
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
