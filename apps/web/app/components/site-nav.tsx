/* SiteNav — the marketing-plane top navigation. Ported from the <nav> in
   public/index.html, then reweighted for the F4 OFFSHORE-led home per
   FRONTEND-PLAN §2: lead with events (discover) + drops, demote about/pricing/
   help/organizers, and resolve "organizers" to the dashboard login (not the
   removed on-page #organizers anchor). Links now point at the clean React routes.
   The legacy <a class="wordmark">…</a> is replaced by <Wordmark> (the real-logo
   <img> zora-theme.js swapped in at runtime). Styling (nav / .nav-in / .nav-links
   / .kbtn) comes from the home page's CSS; zora-tokens.css styles .wordmark. */

import { Wordmark } from './wordmark';

export function SiteNav() {
  return (
    <nav>
      <div className="wrap nav-in">
        <Wordmark href="/" />
        <div className="nav-links">
          <a href="/discover">events</a>
          <a href="/events/offshore">drops</a>
          <a href="/about">about</a>
          <a href="/commission">pricing</a>
          <a href="/help">help</a>
          <a href="/dashboard/login">organizers</a>
          <a href="/discover" className="kbtn">FIND EVENTS</a>
        </div>
      </div>
    </nav>
  );
}
