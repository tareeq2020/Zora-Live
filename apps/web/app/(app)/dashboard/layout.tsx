'use client';

/* BS60 — dashboard layout. Some /dashboard/* pages render their own sidebar
   (the home page, storefront studio, onboarding) and the pre-auth pages
   (login, signup) have none by design. The rest — sales, withdrawals, the event
   editor — had NO sidebar, so navigating into them dropped the nav. This layout
   wraps exactly those pages in the shared <DashboardShell> so the sidebar is
   present on every inner page, without touching the pages that already have one. */

import { usePathname } from 'next/navigation';
import { DashboardShell } from './DashboardShell';

// Prefixes that already own a sidebar, or are intentionally chrome-less.
const OWN_CHROME = [
  '/dashboard/login',
  '/dashboard/signup',
  '/dashboard/onboarding',
  '/dashboard/storefront', // studio renders its own rail
  '/dashboard/overview', // BS69 Lane A — renders its own Control-Room v2 <CrShell>
  // BS71/BS73 — these surfaces render their own Control-Room v2 <CrShell>
  // (sidebar + folded-in hamburger drawer), so the legacy <DashboardShell> must
  // NOT wrap them or the page would get two sidebars.
  '/dashboard/sales',
  '/dashboard/payouts',
  '/dashboard/comps',
  '/dashboard/help', // BS77 — renders its own Control-Room v2 <CrShell>
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  // The home page (exact /dashboard) has its own rail; inner pages do not.
  const ownChrome = pathname === '/dashboard' || OWN_CHROME.some((p) => pathname.startsWith(p));
  if (ownChrome) return <>{children}</>;
  return <DashboardShell>{children}</DashboardShell>;
}
