'use client';

/* PR-BS36 — AdminShell: the React replacement for the legacy /admin/dashboard
   console (one `MARKUP` HTML string + a `SCRIPT` string executed through
   `new Function`, all hand-wired DOM that TypeScript could not see into).

   What changed
     · LEFT SIDEBAR instead of the top tab bar, with the roadmap's full section
       list so the information architecture is fixed before the other lanes land.
     · Every panel is a typed React component fetching the SAME /api/* endpoints
       through the shared primitives in ./admin-kit — no API changes at all.
     · Responsive by construction: the rail becomes a hamburger drawer below
       900px; AdminTable turns into stacked cards below 620px.
   What did NOT change
     · The route stays /admin/dashboard (the middleware rewrites an authenticated
       admin here; an anon gets /admin/login). Session handling is identical: a
       401 from any call sends the staffer to /admin so the gate re-runs, and
       LOG OUT still POSTs /api/logout then goes to /admin.

   Section state lives in the URL hash (#organizers), so a section survives a
   refresh and can be linked to — without adding routes or touching middleware. */

import { useCallback, useEffect, useState } from 'react';
import { ADMIN_STYLE } from './admin-style';
import { ToastProvider, adminApi, errText, useToast } from './admin-kit';
import { OverviewSection } from './sections/overview-section';
import { OrganizersSection } from './sections/organizers-section';
import { VerificationSection } from './sections/verification-section';
import { EventsSection } from './sections/events-section';
import { ScannerUsersSection } from './sections/scanner-users-section';
import { PaymentsSection } from './sections/payments-section';
import { MediaSection } from './sections/media-section';
import { AccessSection } from './sections/access-section';
import { BroadcastsSection, OrdersSection, PayoutsSection } from './sections/placeholders';

type SectionKey =
  | 'overview'
  | 'organizers'
  | 'verification'
  | 'events'
  | 'orders'
  | 'payouts'
  | 'scanner'
  | 'broadcasts'
  | 'payments'
  | 'media'
  | 'access';

const SECTIONS: { key: SectionKey; label: string; soon?: boolean }[] = [
  { key: 'overview', label: 'OVERVIEW' },
  { key: 'organizers', label: 'ORGANIZERS' },
  { key: 'verification', label: 'VERIFICATION' },
  { key: 'events', label: 'EVENTS' },
  { key: 'orders', label: 'ORDERS & CARTS', soon: true },
  { key: 'payouts', label: 'PAYOUTS', soon: true },
  { key: 'scanner', label: 'SCANNER USERS' },
  { key: 'broadcasts', label: 'BROADCASTS', soon: true },
  { key: 'payments', label: 'PAYMENTS ROUTING' },
  { key: 'media', label: 'MEDIA' },
  { key: 'access', label: 'ACCESS' },
];

const KEYS = new Set<string>(SECTIONS.map((s) => s.key));
const isSection = (v: string): v is SectionKey => KEYS.has(v);

type Impersonating = { id?: string; name?: string; handle?: string } | null;

function ImpersonationBanner() {
  const toast = useToast();
  const [imp, setImp] = useState<Impersonating>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stale = false;
    adminApi<{ impersonating: Impersonating }>('/api/impersonation')
      .then((r) => {
        if (!stale) setImp(r.impersonating || null);
      })
      .catch(() => {
        /* the banner is informational — never block the console on it */
      });
    return () => {
      stale = true;
    };
  }, []);

  if (!imp) return null;

  async function exit() {
    setBusy(true);
    try {
      await adminApi('/api/impersonate/exit', { method: 'POST' });
      setImp(null);
      toast('Back to your own admin session');
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="imp-banner" role="status">
      <div>
        <p className="ib-t">Acting on behalf of {imp.name || imp.handle}</p>
        <p className="ib-d">EVERY ACTION IS LOGGED · {imp.handle ? imp.handle + '.zora.com' : 'ORGANIZER SESSION'}</p>
      </div>
      <button type="button" className="btn small ghost" onClick={exit} disabled={busy}>
        EXIT
      </button>
    </div>
  );
}

function ShellBody() {
  const toast = useToast();
  const [section, setSection] = useState<SectionKey>('overview');
  const [drawer, setDrawer] = useState(false);

  // Hash <-> section. Read on mount and on back/forward.
  useEffect(() => {
    const sync = () => {
      const h = window.location.hash.replace(/^#/, '');
      if (isSection(h)) setSection(h);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const go = useCallback((next: string) => {
    if (!isSection(next)) return;
    setSection(next);
    setDrawer(false);
    if (window.location.hash !== '#' + next) window.history.replaceState(null, '', '#' + next);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  // Escape closes the mobile drawer (no hover-only / trap-only affordances).
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  async function logout() {
    try {
      await adminApi('/api/logout', { method: 'POST' });
    } catch (ex) {
      toast(errText(ex), true);
    }
    window.location.href = '/admin';
  }

  const active = SECTIONS.find((s) => s.key === section);

  return (
    <div className={'admin-shell' + (drawer ? ' drawer-open' : '')}>
      <ImpersonationBanner />
      <div className="layout">
        <nav className="rail" aria-label="Admin sections">
          <div className="rail-head">
            <span className="wordmark">
              z<span className="o">o</span>ra
            </span>
            <small>INTERNAL STAFF CONSOLE</small>
          </div>
          <div className="nav">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={'nav-item' + (s.key === section ? ' on' : '')}
                aria-current={s.key === section ? 'page' : undefined}
                onClick={() => go(s.key)}
              >
                <span className="dot" aria-hidden="true" />
                {s.label}
                {s.soon ? <span className="soon">SOON</span> : null}
              </button>
            ))}
          </div>
          <div className="rail-foot">
            <a href="/" target="_blank" rel="noopener noreferrer">
              VIEW SITE
            </a>
            <a href="/events/offshore" target="_blank" rel="noopener noreferrer">
              DROP 001
            </a>
            <button type="button" onClick={logout}>
              LOG OUT
            </button>
          </div>
        </nav>

        {drawer ? <div className="scrim" onClick={() => setDrawer(false)} aria-hidden="true" /> : null}

        <div className="content">
          <div className="topbar">
            <button type="button" className="burger" aria-label="Open the section menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
              <i />
              <i />
              <i />
            </button>
            <span className="tb-t">{active?.label}</span>
          </div>

          <main>
            {section === 'overview' ? <OverviewSection onGo={go} /> : null}
            {section === 'organizers' ? <OrganizersSection /> : null}
            {section === 'verification' ? <VerificationSection /> : null}
            {section === 'events' ? <EventsSection /> : null}
            {section === 'orders' ? <OrdersSection /> : null}
            {section === 'payouts' ? <PayoutsSection /> : null}
            {section === 'scanner' ? <ScannerUsersSection /> : null}
            {section === 'broadcasts' ? <BroadcastsSection /> : null}
            {section === 'payments' ? <PaymentsSection /> : null}
            {section === 'media' ? <MediaSection /> : null}
            {section === 'access' ? <AccessSection /> : null}
          </main>
        </div>
      </div>
    </div>
  );
}

export default function AdminShell() {
  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: ADMIN_STYLE }} />
      <ToastProvider>
        <ShellBody />
      </ToastProvider>
    </>
  );
}
