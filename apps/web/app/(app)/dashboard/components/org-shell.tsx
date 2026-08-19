'use client';

/* BS71 · Lane B — the organizer-console shell.

   Consumes the read-only Control-Room v2 library (Lane A · BS69): the same
   `--cr-*` tokens, `.cr-*` classes, <CrThemeProvider> and <CrThemeToggle>. It
   deliberately re-implements the shell MARKUP (rather than wrapping <CrShell>)
   for one reason: to add the ≤900px focus-trapped hamburger drawer that Lane A
   flagged as TODO(Lane B/T4) inside CrShell — which is a HARD-GUARD read-only
   file. Everything else is byte-for-byte the CrShell structure so the two stay
   visually identical. The drawer behaviour (trap + Esc + scrim + restore-focus)
   is the deliverable here; above 900px this renders exactly as CrShell does.

   Orchestrator note: once reconciled, this drawer should be folded back INTO
   CrShell so the admin console (Lane C) inherits it — see the PR body. */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import '@/app/components/cr/cr-tokens.css';
import './org-shell.css';
import { CrThemeProvider, CrThemeToggle, type CrNavItem } from '@/app/components/cr';

export type OrgShellProps = {
  nav: CrNavItem[];
  brand?: { name: React.ReactNode; sublabel?: string };
  topbarTitle?: React.ReactNode;
  topbarExtra?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
};

const DEFAULT_BRAND = {
  name: (
    <>
      z<span className="cr-o">o</span>ra
    </>
  ),
  sublabel: 'Organizer',
};

function activeHref(nav: CrNavItem[], pathname: string): string {
  return nav.reduce((best, n) => {
    const hit = n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(n.href + '/');
    if (hit) return !best || n.href.length > best.length ? n.href : best;
    return best;
  }, '' as string);
}

const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

export function OrgShell({ nav, brand = DEFAULT_BRAND, topbarTitle, topbarExtra, footer, children }: OrgShellProps) {
  const pathname = usePathname() || '';
  const active = activeHref(nav, pathname);

  const [open, setOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const hamburgerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // Focus-trap + Esc while the drawer is open (App-UI a11y, DESIGN Pass 6).
  useEffect(() => {
    if (!open) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    // Move focus into the drawer.
    const focusables = () => Array.from(sidebar.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    const first = focusables()[0];
    first?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const el = document.activeElement as HTMLElement | null;
      if (e.shiftKey && el === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && el === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Restore focus to the trigger when the drawer closes.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) hamburgerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // Close the drawer on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <CrThemeProvider>
      <div className="cr-root org-shell" data-drawer={open ? 'open' : 'closed'}>
        <div className="cr-shell">
          <div
            className="org-scrim"
            aria-hidden="true"
            onClick={close}
          />
          <aside
            className="cr-sidebar"
            ref={sidebarRef}
            id="org-drawer"
            role={open ? 'dialog' : undefined}
            aria-modal={open ? true : undefined}
            aria-label="Primary navigation"
          >
            <button type="button" className="org-drawer-close" onClick={close} aria-label="Close menu">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
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
                  onClick={close}
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
              <span className="cr-topbar-lead">
                <button
                  type="button"
                  className="org-hamburger"
                  ref={hamburgerRef}
                  aria-label="Open menu"
                  aria-expanded={open}
                  aria-controls="org-drawer"
                  onClick={() => setOpen(true)}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M3 6h18M3 12h18M3 18h18" />
                  </svg>
                </button>
                <span className="cr-topbar-title">{topbarTitle}</span>
              </span>
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
