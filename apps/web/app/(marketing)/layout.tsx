import type { ReactNode } from 'react';
import { MarketingChrome } from './marketing-chrome';

/* Marketing plane (Plane 1 — consumer marketing + marketplace). Wraps its pages
   in the shared marketing chrome via <MarketingChrome>, which renders the shared
   <SiteNav>/<SiteFooter> for routes that match them (home, F4) but omits them for
   routes that carry their own divergent nav/footer (about/help/commission/brand/
   discover, F2). The floating <ThemeToggle> — which zora-theme.js used to append
   to <body> — is always present. */

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <MarketingChrome>{children}</MarketingChrome>;
}
