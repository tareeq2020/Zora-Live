'use client';

/* CrShell — the shared control-room shell (Lane A · BS69).
   One shell for BOTH consoles (org + admin): a left sidebar (brand + nav +
   footer) and a slim sticky top bar (title · extra actions · theme toggle).
   Wraps children in <CrThemeProvider> and the `.cr-root` themed surface, and
   imports the CR token stylesheet so any tree that renders <CrShell> is fully
   themed. Active nav is longest-prefix match on the current path (as today).

   Below 900px the sidebar collapses to a horizontal scroll rail (see
   cr-tokens.css). TODO(Lane B/T4): promote that to a focus-trapped hamburger
   drawer for the 640–900px band. */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import './cr-tokens.css';
import { CrThemeProvider } from './theme';
import { CrThemeToggle } from './ThemeToggle';

export type CrNavItem = { href: string; label: string; accent?: boolean; exact?: boolean };

export type CrShellProps = {
  nav: CrNavItem[];
  brand: { name: React.ReactNode; sublabel?: string };
  topbarTitle?: React.ReactNode;
  /** extra top-bar content placed left of the theme toggle (e.g. store name). */
  topbarExtra?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
};

function activeHref(nav: CrNavItem[], pathname: string): string {
  return nav.reduce((best, n) => {
    const hit = n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(n.href + '/');
    if (hit) return !best || n.href.length > best.length ? n.href : best;
    return best;
  }, '' as string);
}

export function CrShell({ nav, brand, topbarTitle, topbarExtra, footer, children }: CrShellProps) {
  const pathname = usePathname() || '';
  const active = activeHref(nav, pathname);

  return (
    <CrThemeProvider>
      <div className="cr-root">
        <div className="cr-shell">
          <aside className="cr-sidebar">
            <p className="cr-brand">
              {brand.name}
              {brand.sublabel ? <small>{brand.sublabel}</small> : null}
            </p>
            <nav className="cr-nav" aria-label="Primary">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={'cr-nav-item' + (active === n.href ? ' cr-on' : '')}
                  aria-current={active === n.href ? 'page' : undefined}
                  style={n.accent ? { color: 'var(--cr-blue)', fontWeight: 600 } : undefined}
                >
                  <span className="cr-dot" />
                  {n.label}
                </Link>
              ))}
            </nav>
            {footer ? <div className="cr-nav-foot">{footer}</div> : null}
          </aside>

          <div className="cr-main">
            <header className="cr-topbar">
              <span className="cr-topbar-title">{topbarTitle}</span>
              <div className="cr-topbar-actions">
                {topbarExtra}
                <CrThemeToggle />
              </div>
            </header>
            <main className="cr-content">{children}</main>
          </div>
        </div>
      </div>
    </CrThemeProvider>
  );
}
