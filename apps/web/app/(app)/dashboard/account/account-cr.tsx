'use client';

/* BS96 · auth Phase 4 — the user ACCOUNT surface, on the Control-Room v2 library.
   Three things a signed-in person had "nowhere to go" for before:
     · their identity (email · name · phone),
     · the organizers they belong to + their role in each, with a "switch" that
       reuses the Phase-2 acting-org endpoint,
     · a change-password form.

   Endpoints:
     GET  /api/me                 → { email, name, phone, userId, memberships[], actingOrganizerId }
     POST /api/me/acting-org      ← { organizerId }   (switch acting org, Phase-2)
     POST /api/me/password        ← { currentPassword, newPassword }
   Nothing is decided in the browser — the password check + membership authority are
   server-side; this surface only reflects them and surfaces the API's messages. */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CrShell, StatusPill, type PillTone } from '@/app/components/cr';
import { ORG_NAV } from '../components/org-nav';
import '../components/org-surfaces.css';

const ORG_BRAND = { name: (<>z<span className="cr-o">o</span>ra</>), sublabel: 'Organizer' };

type Membership = { organizerId: string; organizerHandle: string; role: string };
type Me = {
  userId?: string | null;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  memberships?: Membership[];
  actingOrganizerId?: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', admin: 'Admin', finance: 'Finance', door: 'Door', viewer: 'Viewer',
};
function roleTone(role: string): PillTone {
  switch (role) {
    case 'owner': return 'live';
    case 'admin': return 'paid';
    case 'finance': return 'neutral';
    case 'door': return 'pending';
    default: return 'draft';
  }
}

export default function AccountCr() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState<string | null>(null);

  const [switching, setSwitching] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
      if (res.ok) setMe((await res.json()) as Me);
    } catch {
      /* non-fatal — the page still renders the password form */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function switchOrg(m: Membership) {
    if (switching) return;
    if (m.organizerId === me?.actingOrganizerId) return;
    setSwitching(m.organizerId);
    try {
      const res = await fetch('/api/me/acting-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ organizerId: m.organizerId }),
      });
      if (res.ok) {
        // Full navigation so every org-scoped read re-runs against the new acting org.
        window.location.href = '/dashboard/overview';
        return;
      }
    } catch {
      /* fall through to re-enable */
    }
    setSwitching(null);
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setPwError(null);
    setPwOk(null);
    if (next.length < 8) { setPwError('Your new password must be at least 8 characters.'); return; }
    if (next !== confirm) { setPwError('The new password and confirmation do not match.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setPwError(data?.message || 'That password could not be changed.');
        return;
      }
      setPwOk('Your password has been changed.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch {
      setPwError('We could not reach Zora just then. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  }

  const memberships = me?.memberships ?? [];
  const identityLabel = me?.email || me?.name || 'Your account';

  return (
    <CrShell
      nav={ORG_NAV}
      brand={ORG_BRAND}
      topbarTitle="Account"
      topbarExtra={<span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: 'var(--cr-ink2)' }}>You &amp; your access</span>}
      footer={<><a href="/dashboard/onboarding">GET STARTED</a> &middot; <a href="/">ZORA.COM</a></>}
    >
      <div className="cr-stack">
        <div>
          <p className="org-crumb"><Link href="/dashboard/overview">DASHBOARD</Link> / ACCOUNT</p>
          <h1 className="org-h1">Account</h1>
          <p className="org-sub">
            Your Zora identity — one login across every organizer you belong to and every ticket you buy.
            Manage the organizers you have access to and change your password here.
          </p>
        </div>

        {/* ── Identity ─────────────────────────────────────────────────────── */}
        <section className="cr-panel">
          <div className="cr-panel-head"><h2 className="cr-section-h">Identity</h2></div>
          <div className="org-kv" style={{ display: 'grid', gap: 12, padding: '4px 2px' }}>
            <Row k="Email" v={me?.email || '—'} loading={loading} />
            <Row k="Name" v={me?.name || '—'} loading={loading} />
            <Row k="Phone" v={me?.phone || '—'} loading={loading} />
          </div>
          {!loading && !me?.userId ? (
            <p className="org-help" style={{ marginTop: 8 }}>
              You&apos;re signed in on a legacy handle. You can still change your password below; your
              account is being upgraded to a full identity.
            </p>
          ) : null}
        </section>

        {/* ── Organizations ────────────────────────────────────────────────── */}
        <section className="cr-panel">
          <div className="cr-panel-head"><h2 className="cr-section-h">Your organizations</h2></div>
          {loading ? (
            <p className="org-muted" style={{ padding: '4px 2px' }}>Loading…</p>
          ) : memberships.length === 0 ? (
            <div className="cr-empty">
              <strong>You don&apos;t belong to an organizer yet</strong>
              <span>When you&apos;re invited to a team or create an organizer, it will appear here.</span>
            </div>
          ) : (
            <ul className="org-orglist" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {memberships.map((m) => {
                const acting = m.organizerId === me?.actingOrganizerId;
                return (
                  <li
                    key={m.organizerId}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      padding: '10px 12px', border: '1px solid var(--cr-hair)', borderRadius: 10,
                      background: acting ? 'var(--cr-wash-blue)' : 'transparent',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ fontFamily: 'var(--cr-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        @{m.organizerHandle}
                      </span>
                      <StatusPill tone={roleTone(m.role)} label={ROLE_LABEL[m.role] ?? m.role} />
                    </span>
                    {acting ? (
                      <span className="org-muted" aria-current="true" style={{ fontSize: 12 }}>Acting now</span>
                    ) : (
                      <button
                        type="button"
                        className="cr-btn"
                        disabled={switching === m.organizerId}
                        onClick={() => switchOrg(m)}
                      >
                        {switching === m.organizerId ? 'Switching…' : 'Switch'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Change password ──────────────────────────────────────────────── */}
        <section className="cr-panel">
          <div className="cr-panel-head"><h2 className="cr-section-h">Change password</h2></div>
          <form onSubmit={submitPassword} style={{ display: 'grid', gap: 14, padding: '4px 2px', maxWidth: 420 }}>
            <div className="org-field">
              <label htmlFor="pw-current">Current password</label>
              <input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} disabled={saving} required />
            </div>
            <div className="org-field">
              <label htmlFor="pw-next">New password</label>
              <input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} disabled={saving} required minLength={8} />
              <p className="org-help">At least 8 characters.</p>
            </div>
            <div className="org-field">
              <label htmlFor="pw-confirm">Confirm new password</label>
              <input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={saving} required minLength={8} />
            </div>
            {pwError ? <p className="org-alert err" role="alert">{pwError}</p> : null}
            {pwOk ? <p className="org-alert ok" role="status">{pwOk}</p> : null}
            <div className="org-actions">
              <button type="submit" className="org-btn" disabled={saving || !current || !next || !confirm}>
                {saving ? 'SAVING…' : 'CHANGE PASSWORD'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </CrShell>
  );
}

function Row({ k, v, loading }: { k: string; v: string; loading: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
      <span className="org-muted" style={{ fontFamily: 'var(--cr-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', minWidth: 72 }}>{k}</span>
      <span style={{ fontSize: 14 }}>{loading ? '…' : v}</span>
    </div>
  );
}
