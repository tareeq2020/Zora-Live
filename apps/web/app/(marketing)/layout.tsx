import type { ReactNode } from 'react';
import { SiteNav } from '../components/site-nav';
import { SiteFooter } from '../components/site-footer';
import { ThemeToggle } from '../components/theme-toggle';

/* Marketing plane (Plane 1 — consumer marketing + marketplace). Wraps its pages
   in the shared marketing chrome: <SiteNav>, the page, <SiteFooter>, and the
   floating <ThemeToggle> that zora-theme.js used to append. No page routes live
   in this group yet (F1 is foundation only); F2+ add about/brand/commission/
   help/discover here and delete their static twins. */

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      {children}
      <SiteFooter />
      <ThemeToggle />
    </>
  );
}
