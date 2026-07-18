import type { ReactNode } from 'react';

/* App plane (Plane 3 — seller app + tenant/storefront rendering): the bare
   shell, deliberately WITHOUT the marketing <nav>/<footer> chrome. The root
   layout already provides <html>/<body>, the token CSS, the no-flash theme boot
   and <ThemeProvider>, so this group only needs to pass its pages through.
   No page routes live here yet (F1 is foundation); F6/F7 (and tenant work) add
   the seller/dashboard pages under this group. */

export default function AppLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
