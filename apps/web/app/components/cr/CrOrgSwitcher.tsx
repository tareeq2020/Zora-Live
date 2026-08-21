'use client';

/* CrOrgSwitcher (BS93 / auth Phase 2, T3 / E6) — the acting-org switcher.

   A slim top-bar control shown ONLY when the signed-in user belongs to more than
   one organizer (memberships.length > 1). A single-membership user — and every
   legacy/admin session, which carries no memberships[] — never sees it; the
   component renders null and adds nothing to the bar. It reads /api/me for the
   memberships + the current acting org, and on select POSTs /api/me/acting-org
   then does a full navigation so every org-scoped read re-runs against the new
   acting org.

   A11y: a real <button> menu with aria-haspopup/aria-expanded, aria-current="true"
   on the acting org, Escape + click-outside to close, focus returns to the trigger.
   Respects prefers-reduced-motion (no transition is used). */

import { useCallback, useEffect, useRef, useState } from 'react';

type Membership = { organizerId: string; organizerHandle: string; role: string };
type Me = { memberships?: Membership[]; actingOrganizerId?: string | null };

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  finance: 'Finance',
  door: 'Door',
  viewer: 'Viewer',
};

const STYLES = `
.cr-orgsw{position:relative;font-family:var(--cr-sans)}
.cr-orgsw-btn{display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:6px 12px;
  background:var(--cr-card);color:var(--cr-ink);border:1px solid var(--cr-hair);border-radius:8px;
  font-size:13px;font-weight:500;cursor:pointer;max-width:240px}
.cr-orgsw-btn:hover{border-color:var(--cr-blue)}
.cr-orgsw-btn:focus-visible{outline:2px solid var(--cr-focus);outline-offset:2px}
.cr-orgsw-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cr-orgsw-caret{flex:0 0 auto;color:var(--cr-mut)}
.cr-orgsw-menu{position:absolute;top:calc(100% + 6px);right:0;min-width:240px;z-index:60;
  background:var(--cr-card);border:1px solid var(--cr-hair);border-radius:10px;box-shadow:var(--cr-shadow);
  padding:6px;list-style:none;margin:0}
.cr-orgsw-item{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;
  padding:9px 10px;min-height:44px;background:transparent;border:0;border-radius:7px;cursor:pointer;
  color:var(--cr-ink);font-size:13px;text-align:left}
.cr-orgsw-item:hover{background:var(--cr-card2)}
.cr-orgsw-item:focus-visible{outline:2px solid var(--cr-focus);outline-offset:-2px}
.cr-orgsw-item[aria-current="true"]{background:var(--cr-wash-blue);color:var(--cr-on-wash-blue);font-weight:600}
.cr-orgsw-h{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cr-orgsw-role{flex:0 0 auto;font-family:var(--cr-mono);font-size:10px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--cr-mut)}
.cr-orgsw-item[aria-current="true"] .cr-orgsw-role{color:var(--cr-on-wash-blue)}
@media (max-width:520px){.cr-orgsw-btn{max-width:150px}}
`;

export function CrOrgSwitcher() {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((me: Me | null) => {
        if (!alive || !me) return;
        setMemberships(Array.isArray(me.memberships) ? me.memberships : []);
        setActingId(me.actingOrganizerId ?? null);
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

  async function pick(m: Membership) {
    if (busy) return;
    if (m.organizerId === actingId) {
      close();
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/me/acting-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ organizerId: m.organizerId }),
      });
      if (r.ok) {
        // Full navigation so every org-scoped read re-runs with the new acting org.
        window.location.reload();
        return;
      }
    } catch {
      /* fall through to re-enable */
    }
    setBusy(false);
    close();
  }

  // Only render when the user belongs to more than one organizer.
  if (memberships.length <= 1) return null;

  const acting = memberships.find((m) => m.organizerId === actingId) ?? memberships[0];

  return (
    <div className="cr-orgsw" ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <button
        type="button"
        ref={btnRef}
        className="cr-orgsw-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Acting organizer: ${acting?.organizerHandle ?? ''}. Switch organizer`}
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
      >
        <span className="cr-orgsw-name">@{acting?.organizerHandle}</span>
        <svg className="cr-orgsw-caret" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <ul className="cr-orgsw-menu" role="menu" aria-label="Switch organizer">
          {memberships.map((m) => {
            const current = m.organizerId === actingId;
            return (
              <li key={m.organizerId} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  aria-current={current ? 'true' : undefined}
                  className="cr-orgsw-item"
                  onClick={() => pick(m)}
                  disabled={busy}
                >
                  <span className="cr-orgsw-h">@{m.organizerHandle}</span>
                  <span className="cr-orgsw-role">{ROLE_LABEL[m.role] ?? m.role}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
