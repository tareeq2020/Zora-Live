/* CrNavIcon (BS81) — the control-room icon set. Inline stroke SVGs (no icon
   library; this repo ships none), currentColor so they follow the nav item's
   active/idle colour, sized 18px. Referenced by key from CrNavItem.icon so the
   nav data files (org-nav.ts, admin console NAV) stay plain .ts, not JSX. */

import type { SVGProps } from 'react';

// Each entry is the inner markup of a 24x24 stroke icon.
const PATHS: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9.5V20h4v-5h6v5h4V9.5" />,
  sales: <path d="M4 19V5M20 19H4M8 19v-5M12 19V9M16 19v-8" />,
  events: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </>
  ),
  payouts: (
    <>
      <path d="M3.5 8a2 2 0 0 1 2-2h11l1.5 2H3.5zM3.5 8v10a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2H3.5z" />
      <path d="M16.5 14h1.5" />
    </>
  ),
  comps: (
    <>
      <path d="M4 11.5V20h16v-8.5M2.5 7.5h19v4h-19zM12 7.5V20" />
      <path d="M12 7.5S9.5 3.5 7.5 5s4.5 2.5 4.5 2.5m0 0s2.5-4 4.5-2.5S12 7.5 12 7.5" />
    </>
  ),
  storefront: (
    <>
      <path d="M4 9.5V20h16V9.5" />
      <path d="M2.5 9.5 4 4.5h16l1.5 5a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0Z" />
      <path d="M9.5 20v-5h5v5" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.8-2.5 2-2.5 3.8M12 17h.01" />
    </>
  ),
  // ── admin ──
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
    </>
  ),
  'events-manager': (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3M8.5 15l2.2 2.2 4.3-4.3" />
    </>
  ),
  orders: (
    <>
      <path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.78L20 8H6" />
      <circle cx="9.5" cy="19" r="1.2" />
      <circle cx="17" cy="19" r="1.2" />
    </>
  ),
  broadcasts: (
    <>
      <path d="M3 10v4a1 1 0 0 0 1 1h2l5 4V5L6 9H4a1 1 0 0 0-1 1Z" />
      <path d="M15 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </>
  ),
  organizers: (
    <>
      <path d="M15.5 20v-1.5a3.5 3.5 0 0 0-3.5-3.5H6.5A3.5 3.5 0 0 0 3 18.5V20" />
      <circle cx="9.25" cy="8" r="3.5" />
      <path d="M17 4.2a3.5 3.5 0 0 1 0 6.8M21 20v-1.5a3.5 3.5 0 0 0-2.6-3.4" />
    </>
  ),
  verification: (
    <>
      <path d="M12 3 20 6v5.5c0 4.7-3.3 7.7-8 8.5-4.7-.8-8-3.8-8-8.5V6l8-3Z" />
      <path d="M8.75 12l2.2 2.2 4.3-4.3" />
    </>
  ),
  scanner: (
    <>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3" />
      <path d="M4 12h16" />
    </>
  ),
  payments: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </>
  ),
  media: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M4 16l4-4 3.5 3.5L15 12l5 5" />
      <circle cx="9" cy="9.5" r="1.4" />
    </>
  ),
  access: (
    <>
      <circle cx="15.5" cy="8.5" r="3.5" />
      <path d="M13 11 4 20v0h3v-2h2v-2h2l2-2" />
    </>
  ),
};

export function CrNavIcon({ name, ...rest }: { name: string } & SVGProps<SVGSVGElement>) {
  const inner = PATHS[name];
  if (!inner) return <span className="cr-dot" aria-hidden="true" />;
  return (
    <svg
      className="cr-nav-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {inner}
    </svg>
  );
}
