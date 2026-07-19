'use client';

/* Brand page's scroll-reactive nav: the legacy inline <script> toggled the
   `glass` class on <nav id="nav"> once the page scrolled past 40px. Reproduced
   here as a scroll listener. The wordmark is the theme-driven logo image (what
   zora-theme.js swapped .wordmark into at runtime). */

import { useEffect, useState } from 'react';
import { Wordmark } from '../../components/wordmark';

export function BrandNav() {
  const [glass, setGlass] = useState(false);

  useEffect(() => {
    const onScroll = () => setGlass(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav id="nav" className={glass ? 'glass' : undefined}>
      <div className="wrap nav-in">
        <Wordmark href="#top" />
        <div className="nav-links">
          <a href="#events">Events</a>
          <a href="#checkout">Tickets</a>
          <a href="#">Organizers</a>
          <a href="#">About</a>
        </div>
        <div className="nav-right">
          <a className="btn btn-ghost">Sign in</a>
          <a className="btn btn-aura">Get the app</a>
        </div>
      </div>
    </nav>
  );
}
