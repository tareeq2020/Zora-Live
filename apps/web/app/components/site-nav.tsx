/* SiteNav — the marketing-plane top navigation, ported verbatim from the
   <nav> in public/index.html. The legacy <a class="wordmark">z<span…>o</span>ra</a>
   is replaced by <Wordmark>, which reproduces the real-logo <img> that
   zora-theme.js swapped in at runtime. Links point at the still-static *.html
   pages; each conversion PR repoints its own link to the clean React route.
   Styling (nav / .nav-in / .nav-links / .kbtn) is provided by the marketing
   page's own CSS once pages convert (F2+); zora-tokens.css styles .wordmark. */

import { Wordmark } from './wordmark';

export function SiteNav() {
  return (
    <nav>
      <div className="wrap nav-in">
        <Wordmark href="/" />
        <div className="nav-links">
          <a href="discover.html">events</a>
          <a href="about.html">about</a>
          <a href="commission.html">pricing</a>
          <a href="help.html">help</a>
          <a href="#organizers">organizers</a>
          <a href="discover.html" className="kbtn">FIND EVENTS</a>
        </div>
      </div>
    </nav>
  );
}
