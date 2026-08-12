'use client';

/* BS60 — the shared organizer sidebar. The dashboard HOME (dashboard-client),
   storefront studio and onboarding render their OWN rail; the inner pages (sales,
   withdrawals, event editor) did not, so navigating into them "lost" the sidebar.
   This shell wraps those pages with the same rail so it is present everywhere.

   Self-contained: it carries its own theme vars + rail CSS (ported verbatim from
   the home page's proven, responsive layout) scoped under `.dash-shell`, so it
   never depends on — or collides with — the wrapped page's own scoped styles.
   Active link is derived from the current path. */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV: { href: string; label: string; accent?: boolean }[] = [
  { href: '/dashboard', label: 'Home' },
  { href: '/dashboard/sales', label: 'Sales' },
  { href: '/dashboard/payouts', label: 'Withdrawals' },
  { href: '/dashboard/storefront/studio', label: 'Storefront' },
  { href: '/dashboard/events/new', label: '+ New drop', accent: true },
  // BS61: help/support, present on every organizer page. Points at the support
  // centre (WhatsApp / phone / email / Instagram). Never marks active — it lives
  // outside /dashboard, so the prefix match below can't false-positive.
  { href: '/help', label: 'Help & Support' },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  // Longest-prefix match so /dashboard/sales highlights Sales, not Home.
  const active = NAV.reduce((best, n) => {
    if (n.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(n.href)) {
      return !best || n.href.length > best.length ? n.href : best;
    }
    return best;
  }, '' as string);

  return (
    <div className="dash-shell">
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div className="shell">
        <aside className="rail">
          <p className="brand">
            z<span className="o">o</span>ra dashboard<small>THE ORGANIZER SIDE</small>
          </p>
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={'nav-item' + (active === n.href ? ' on' : '')}
              style={n.accent ? { color: 'var(--blue)', fontWeight: 500 } : undefined}
            >
              <span className="dot" />
              {n.label}
            </Link>
          ))}
          <p className="foot">
            <a href="/dashboard/onboarding">GET STARTED</a> &middot; <a href="/">ZORA.COM</a>
          </p>
        </aside>
        <div className="dash-main">{children}</div>
      </div>
    </div>
  );
}

const STYLE = `
.dash-shell{--black:#0A0A0B;--ink:#101012;--ink2:#16161A;--hair:#222226;--bone:#F4F1EA;--mut:#8A877E;
  --blue:#3D5AFE;--orange:#FF5A1F;--teal:#2FA9A0;--amber:#F0C674;
  --sans:'Space Grotesk',system-ui,sans-serif;background:var(--black);color:var(--bone);min-height:100vh}
.dash-shell .shell{display:grid;grid-template-columns:220px 1fr;min-height:100vh}
@media(max-width:820px){.dash-shell .shell{grid-template-columns:1fr}}
.dash-shell .rail{border-right:1px solid var(--hair);padding:26px 0;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;background:var(--black)}
@media(max-width:820px){.dash-shell .rail{position:static;height:auto;flex-direction:row;align-items:center;overflow-x:auto;border-right:none;border-bottom:1px solid var(--hair);padding:14px 16px;gap:6px}}
.dash-shell .rail .brand{padding:0 24px 26px;font-weight:600;font-size:19px;letter-spacing:-.02em;white-space:nowrap;color:var(--bone)}
.dash-shell .rail .brand .o{color:var(--blue)}
.dash-shell .rail .brand small{display:block;font-size:9px;letter-spacing:.22em;color:var(--mut);margin-top:6px;font-weight:500}
@media(max-width:820px){.dash-shell .rail .brand{padding:0 12px 0 0}.dash-shell .rail .brand small{display:none}}
.dash-shell .nav-item{display:flex;align-items:center;gap:12px;padding:11px 24px;font-size:13.5px;color:var(--mut);cursor:pointer;border:none;background:none;width:100%;text-align:left;font-family:var(--sans);letter-spacing:.02em;text-decoration:none}
@media(max-width:820px){.dash-shell .nav-item{width:auto;padding:8px 12px;white-space:nowrap}}
.dash-shell .nav-item:hover{color:var(--bone)}
.dash-shell .nav-item.on{color:var(--blue);background:rgba(61,90,254,.14);font-weight:500}
.dash-shell .nav-item .dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}
.dash-shell .rail .foot{margin-top:auto;padding:22px 24px 0;font-size:10px;letter-spacing:.12em;color:var(--mut)}
@media(max-width:820px){.dash-shell .rail .foot{display:none}}
.dash-shell .rail .foot a{color:var(--mut);text-decoration:none}
.dash-shell .rail .foot a:hover{color:var(--bone)}
.dash-shell .dash-main{min-width:0}
`;
