'use client';

/* CrAccountMenu (BS96 / auth Phase 4, C) — the top-bar ACCOUNT menu.

   A slim control in the CrShell topbar-actions slot (beside the theme toggle and
   the org switcher). It reads /api/me for the signed-in identity and renders a
   trigger showing the email (or a graceful label for legacy/admin sessions), and a
   dropdown with:
     · the signed-in email (or handle) as a header,
     · a link to Account (/dashboard/account) — shown only when there is a real
       user identity (userId); legacy/admin sessions get no dead-link,
     · Log out → POST /api/logout, then a full redirect to /dashboard/login.

   Legacy sessions with NO userId still get a working Log out and a graceful label
   (the org handle, or "Account"). Every session can sign out.

   A11y mirrors CrOrgSwitcher: a real <button> menu with aria-haspopup/aria-expanded,
   Escape + click-outside to close, focus returns to the trigger. No transition is
   used, so it respects prefers-reduced-motion by construction. Token-driven only —
   it adds no new primitive styling beyond the --cr-* vars. */

import { useCallback, useEffect, useRef, useState } from 'react';

type Me = {
  userId?: string | null;
  email?: string | null;
  organizerHandle?: string | null;
  isAdmin?: boolean;
};

const STYLES = `
.cr-acct{position:relative;font-family:var(--cr-sans)}
.cr-acct-btn{display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:6px 10px;
  background:var(--cr-card);color:var(--cr-ink);border:1px solid var(--cr-hair);border-radius:8px;
  font-size:13px;font-weight:500;cursor:pointer;max-width:220px}
.cr-acct-btn:hover{border-color:var(--cr-blue)}
.cr-acct-btn:focus-visible{outline:2px solid var(--cr-focus);outline-offset:2px}
.cr-acct-avatar{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;
  width:22px;height:22px;border-radius:50%;background:var(--cr-wash-blue);color:var(--cr-on-wash-blue);
  font-size:11px;font-weight:700;text-transform:uppercase}
.cr-acct-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cr-acct-caret{flex:0 0 auto;color:var(--cr-mut)}
.cr-acct-menu{position:absolute;top:calc(100% + 6px);right:0;min-width:240px;z-index:60;
  background:var(--cr-card);border:1px solid var(--cr-hair);border-radius:10px;box-shadow:var(--cr-shadow);
  padding:6px;list-style:none;margin:0}
.cr-acct-head{padding:9px 10px 8px;border-bottom:1px solid var(--cr-hair);margin-bottom:6px}
.cr-acct-head .k{display:block;font-family:var(--cr-mono);font-size:10px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--cr-mut)}
.cr-acct-head .v{display:block;font-size:13px;color:var(--cr-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cr-acct-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;min-height:44px;
  background:transparent;border:0;border-radius:7px;cursor:pointer;color:var(--cr-ink);font-size:13px;
  text-align:left;text-decoration:none}
.cr-acct-item:hover{background:var(--cr-card2)}
.cr-acct-item:focus-visible{outline:2px solid var(--cr-focus);outline-offset:-2px}
.cr-acct-item.danger{color:var(--cr-red,#c0362c)}
.cr-acct-ico{flex:0 0 auto;color:var(--cr-mut)}
@media (max-width:520px){.cr-acct-btn{max-width:44px;padding:6px}.cr-acct-label{display:none}.cr-acct-caret{display:none}}
`;

function initialOf(me: Me): string {
  const src = me.email || me.organizerHandle || 'A';
  const c = src.trim()[0];
  return (c || 'A').toUpperCase();
}

function labelOf(me: Me): string {
  if (me.email) return me.email;
  if (me.organizerHandle) return `@${me.organizerHandle}`;
  if (me.isAdmin) return 'Admin';
  return 'Account';
}

export function CrAccountMenu() {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Me | null) => {
        if (!alive || !data) return;
        setMe(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // Escape + click-outside close; focus returns to the trigger on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        btnRef.current?.focus();
      }
    }
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, close]);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      /* clear anyway — sign-out should never trap the user */
    }
    // Full navigation so no stale authed UI lingers after the cookie is cleared.
    window.location.href = '/dashboard/login';
  }

  // Render nothing until we know whether anyone is signed in — an anon shell (login/
  // signup pages don't use CrShell, but be defensive) shows no account control.
  if (!me || (!me.userId && !me.organizerHandle && !me.isAdmin)) return null;

  const hasIdentity = !!me.userId; // a real app_user → Account page is meaningful

  return (
    <div className="cr-acct" ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <button
        type="button"
        ref={btnRef}
        className="cr-acct-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${labelOf(me)}. Open account menu`}
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
      >
        <span className="cr-acct-avatar" aria-hidden="true">{initialOf(me)}</span>
        <span className="cr-acct-label">{labelOf(me)}</span>
        <svg className="cr-acct-caret" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <ul className="cr-acct-menu" role="menu" aria-label="Account">
          <li role="none" className="cr-acct-head">
            <span className="k">Signed in as</span>
            <span className="v">{labelOf(me)}</span>
          </li>
          {hasIdentity ? (
            <li role="none">
              <a href="/dashboard/account" role="menuitem" className="cr-acct-item" onClick={close}>
                <svg className="cr-acct-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
                </svg>
                Account
              </a>
            </li>
          ) : null}
          <li role="none">
            <button type="button" role="menuitem" className="cr-acct-item danger" onClick={logout} disabled={busy}>
              <svg className="cr-acct-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
              {busy ? 'Logging out…' : 'Log out'}
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
