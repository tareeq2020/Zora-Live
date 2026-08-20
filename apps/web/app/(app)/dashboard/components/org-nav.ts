/* BS71 · Lane B — the single source of truth for the organizer console nav.
   Shared by every ported control-room surface (Home/Overview, Sales, Payouts,
   Comps, Storefront) so the sidebar reads identically everywhere and the
   longest-prefix active match in <OrgShell> highlights the right item. */

import type { CrNavItem } from '@/app/components/cr';

export const ORG_NAV: CrNavItem[] = [
  { href: '/dashboard/overview', label: 'Home' },
  { href: '/dashboard/sales', label: 'Sales' },
  { href: '/dashboard/events', label: 'Events' },
  { href: '/dashboard/payouts', label: 'Payouts' },
  { href: '/dashboard/comps', label: 'Comps' },
  { href: '/dashboard/storefront/studio', label: 'Storefront' },
  { href: '/dashboard/help', label: 'Help & Support' },
];

export const ORG_BRAND = { name: 'zora', sublabel: 'Organizer' } as const;
