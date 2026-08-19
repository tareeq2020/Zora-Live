'use client';

/* MarketingChrome — decides which shared marketing chrome wraps a route.

   Most F2+ marketing pages (about, help, commission, brand, discover) carry
   their OWN <nav>/<footer> inside their page.tsx: each was a self-contained
   static HTML file with a divergent nav (about/help/commission use a .nav-cta
   pill, discover embeds city/currency/search controls, brand's nav is
   scroll-reactive) and its own inline <style>. Reproducing them faithfully means
   the page owns its chrome, so for those routes we render ONLY the shared
   floating <ThemeToggle> (which zora-theme.js appended to every page).

   Routes whose design matches the shared <SiteNav>/<SiteFooter> (the home page,
   F4) fall through to the default branch and get the shared chrome. */

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { SiteNav } from '../components/site-nav';
import { SiteFooter } from '../components/site-footer';
import { ThemeToggle } from '../components/theme-toggle';

// Routes that render their own <nav>/<footer> and therefore opt out of the
// shared SiteNav/SiteFooter.
const OWN_CHROME = new Set(['/about', '/help', '/commission', '/brand', '/discover']);
// Consumer-plane surfaces are FIXED-DARK (DESIGN.md) — they scope their own dark
// tokens and must not read the light/dark theme. The floating toggle must not be
// offered there, or flipping it leaks the global light body behind the dark
// content (BS74 #5). /discover pins itself dark in DiscoverApp as well.
const FIXED_DARK = new Set(['/discover']);

export function MarketingChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const showToggle = !FIXED_DARK.has(pathname);
  if (OWN_CHROME.has(pathname)) {
    return (
      <>
        {children}
        {showToggle && <ThemeToggle />}
      </>
    );
  }
  return (
    <>
      <SiteNav />
      {children}
      <SiteFooter />
      {showToggle && <ThemeToggle />}
    </>
  );
}
