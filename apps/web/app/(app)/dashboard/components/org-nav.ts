/* BS71 · Lane B — the single source of truth for the organizer console nav.
   Shared by every ported control-room surface (Home/Overview, Sales, Payouts,
   Comps, Storefront) so the sidebar reads identically everywhere and the
   longest-prefix active match in <OrgShell> highlights the right item. */

import type { CrNavItem } from '@/app/components/cr';

export const ORG_NAV: CrNavItem[] = [
  { href: '/dashboard/overview', label: 'Home', icon: 'home' },
  { href: '/dashboard/sales', label: 'Sales', icon: 'sales' },
  { href: '/dashboard/events', label: 'Events', icon: 'events' },
  { href: '/dashboard/payouts', label: 'Payouts', icon: 'payouts' },
  { href: '/dashboard/comps', label: 'Comps', icon: 'comps' },
  { href: '/dashboard/scanners', label: 'Door', icon: 'scanner' },
  { href: '/dashboard/storefront/studio', label: 'Storefront', icon: 'storefront' },
  { href: '/dashboard/team', label: 'Team', icon: 'organizers' },
  { href: '/dashboard/help', label: 'Help & Support', icon: 'help' },
];

export const ORG_BRAND = { name: 'zora', sublabel: 'Organizer' } as const;
