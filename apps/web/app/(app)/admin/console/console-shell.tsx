'use client';

/* PR-BS72 · Lane C — the super-admin Control-Room shell.

   One wrapper around the shared <CrShell> (Lane A · BS69) that fixes the
   super-admin information architecture: brand, the full section nav, and the
   footer. Every Lane C surface (Overview · Events-manager · Orders & carts ·
   Broadcasts) renders inside it so the shell, theme toggle and no-FOUC boot are
   identical across the console.

   Additive / strangler-fig: the legacy imperative console at /admin/dashboard is
   left in place. The four surfaces Lane C rebuilds live here at /admin/console/*;
   the sections other lanes still own deep-link back into the legacy console by
   hash so the sidebar IA is complete from day one. Active nav is longest-prefix
   on the path (CrShell), so a legacy hash link never lights up on a console
   route.

   HARD GUARD: consumes @/app/components/cr READ-ONLY. */

import { CrShell, type CrNavItem } from '@/app/components/cr';

const NAV: CrNavItem[] = [
  // Lane C — rebuilt on the CR lib.
  { href: '/admin/console/overview', label: 'Overview', icon: 'overview' },
  { href: '/admin/console/events', label: 'Events-manager', icon: 'events-manager' },
  { href: '/admin/console/orders', label: 'Orders & carts', icon: 'orders' },
  { href: '/admin/console/broadcasts', label: 'Broadcasts', icon: 'broadcasts' },
  // Sections other lanes own — deep-link into the legacy console for now.
  { href: '/admin/dashboard#organizers', label: 'Organizers', icon: 'organizers' },
  { href: '/admin/console/verification', label: 'Verification', icon: 'verification' },
  { href: '/admin/dashboard#payouts', label: 'Payouts', icon: 'payouts' },
  { href: '/admin/dashboard#scanner', label: 'Scanner users', icon: 'scanner' },
  { href: '/admin/dashboard#payments', label: 'Payments routing', icon: 'payments' },
  { href: '/admin/dashboard#media', label: 'Media', icon: 'media' },
  { href: '/admin/dashboard#access', label: 'Access', icon: 'access' },
];

export type AdminConsoleShellProps = {
  /** Top-bar title + the current section label. */
  title: string;
  /** Optional breadcrumb / drill-in trail, shown left of the theme toggle. */
  breadcrumb?: React.ReactNode;
  children: React.ReactNode;
};

export function AdminConsoleShell({ title, breadcrumb, children }: AdminConsoleShellProps) {
  return (
    <CrShell
      nav={NAV}
      brand={{
        name: (
          <>
            z<span className="cr-o">o</span>ra
          </>
        ),
        sublabel: 'Super-Admin',
      }}
      topbarTitle={title}
      topbarExtra={
        breadcrumb ?? (
          <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: 'var(--cr-ink2)' }}>Internal staff</span>
        )
      }
      footer={
        <>
          <a href="/admin/dashboard">LEGACY CONSOLE</a> &middot;{' '}
          <a href="/" target="_blank" rel="noopener noreferrer">
            VIEW SITE
          </a>
        </>
      }
    >
      {children}
    </CrShell>
  );
}
