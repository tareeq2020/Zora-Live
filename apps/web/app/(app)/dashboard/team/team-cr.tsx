'use client';

/* BS94 · auth Phase 3 — the organizer TEAM surface, on the Control-Room v2
   component library. A DataTable of members (email · role pill · joined) plus a
   pending-invites group (amber pill), an "Invite teammate" action in a CrDrawer,
   and per-row change-role / remove (confirm). Owner/admin only — non-owner/admin
   sessions see a read-only notice (the API also enforces this: GET /api/org/members
   is owner/admin-only).

   Endpoints:
     GET    /api/org/me                     → { memberRole, userId, name }
     GET    /api/org/members                → { members[], invites[] }
     POST   /api/org/members/invite         ← { email, role }
     PUT    /api/org/members/:userId        ← { role }
     DELETE /api/org/members/:userId
   Nothing is decided in the browser — the guard on every write is server-side; the
   sole-owner refusal is surfaced inline from the API's message. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CrShell, CrDrawer, DataTable, StatusPill, type Column, type PillTone } from '@/app/components/cr';
import { ORG_NAV } from '../components/org-nav';
import '../components/org-surfaces.css';

const ORG_BRAND = { name: (<>z<span className="cr-o">o</span>ra</>), sublabel: 'Organizer' };

type Member = { userId: string; email: string | null; role: string; joinedAt: string | null };
type Invite = { id: string; email: string; role: string; expiresAt: string | null; createdAt: string | null };
type MembersView = { members: Member[]; invites: Invite[] };

const INVITE_ROLES = ['admin', 'finance', 'door', 'viewer'] as const;
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
function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function TeamCr() {
  const [view, setView] = useState<MembersView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [restricted, setRestricted] = useState(false);

  const [myRole, setMyRole] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const [drawer, setDrawer] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('viewer');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteOk, setInviteOk] = useState<string | null>(null);

  const [rowError, setRowError] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  const canManage = myRole === 'owner' || myRole === 'admin';

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch('/api/org/me', { cache: 'no-store' });
      if (res.ok) {
        const d = (await res.json()) as { memberRole?: string | null; userId?: string | null };
        setMyRole(d.memberRole ?? null);
        setMyUserId(d.userId ?? null);
      }
    } catch { /* non-fatal — the members fetch still gates via 403 */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setRestricted(false);
    try {
      const res = await fetch('/api/org/members', { cache: 'no-store' });
      if (res.status === 403) { setRestricted(true); setView(null); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setView((await res.json()) as MembersView);
    } catch {
      setLoadError(true);
      setView(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMe(); load(); }, [loadMe, load]);

  const members = view?.members ?? [];
  const invites = view?.invites ?? [];
  const onlyYou = !loading && !loadError && !restricted && members.length <= 1 && invites.length === 0;

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    if (inviting) return;
    setInviting(true);
    setInviteError(null);
    setInviteOk(null);
    try {
      const res = await fetch('/api/org/members/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) { setInviteError(data?.message || 'That invite could not be sent.'); return; }
      setInviteOk(`Invited ${inviteEmail.trim()} as ${ROLE_LABEL[inviteRole]}. They'll get an email with a link to join.`);
      setInviteEmail('');
      setInviteRole('viewer');
      await load();
    } catch {
      setInviteError('We could not reach Zora just then. Check your connection and try again.');
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(userId: string, role: string) {
    setBusyUser(userId);
    setRowError(null);
    try {
      const res = await fetch(`/api/org/members/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ role }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) { setRowError(data?.message || 'That role change could not be saved.'); return; }
      await load();
    } catch {
      setRowError('We could not reach Zora just then. Nothing was changed.');
    } finally {
      setBusyUser(null);
    }
  }

  async function removeMember(m: Member) {
    const who = m.email || 'this teammate';
    if (!window.confirm(`Remove ${who} from your team? They'll lose access immediately.`)) return;
    setBusyUser(m.userId);
    setRowError(null);
    try {
      const res = await fetch(`/api/org/members/${encodeURIComponent(m.userId)}`, { method: 'DELETE', cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) { setRowError(data?.message || 'That teammate could not be removed.'); return; }
      await load();
    } catch {
      setRowError('We could not reach Zora just then. Nothing was changed.');
    } finally {
      setBusyUser(null);
    }
  }

  const memberCols: Column<Member>[] = useMemo(() => {
    const cols: Column<Member>[] = [
      {
        key: 'email', header: 'Member', primary: true, render: (m) => (
          <span>
            {m.email || '—'}
            {m.userId === myUserId ? <span className="org-muted" style={{ marginLeft: 8 }}>(you)</span> : null}
          </span>
        ),
      },
      {
        key: 'role', header: 'Role', render: (m) => (
          canManage && m.role !== 'owner' ? (
            <select
              className="cr-select"
              aria-label={`Role for ${m.email || 'member'}`}
              value={INVITE_ROLES.includes(m.role as any) ? m.role : 'viewer'}
              disabled={busyUser === m.userId}
              onChange={(e) => changeRole(m.userId, e.target.value)}
            >
              {INVITE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          ) : (
            <StatusPill tone={roleTone(m.role)} label={ROLE_LABEL[m.role] ?? m.role} />
          )
        ),
      },
      { key: 'joinedAt', header: 'Joined', render: (m) => <span className="org-muted">{fmtWhen(m.joinedAt)}</span> },
    ];
    if (canManage) {
      cols.push({
        key: 'actions', header: '', render: (m) => (
          m.role === 'owner'
            ? <span className="org-muted">—</span>
            : <button type="button" className="cr-linkbtn" disabled={busyUser === m.userId} onClick={() => removeMember(m)}>REMOVE</button>
        ),
      });
    }
    return cols;
  }, [canManage, busyUser, myUserId]);

  const inviteCols: Column<Invite>[] = useMemo(() => [
    { key: 'email', header: 'Invited', primary: true, render: (i) => i.email },
    { key: 'role', header: 'Role', render: (i) => <StatusPill tone={roleTone(i.role)} label={ROLE_LABEL[i.role] ?? i.role} /> },
    { key: 'status', header: 'Status', render: () => <StatusPill tone="pending" label="PENDING" /> },
    { key: 'expiresAt', header: 'Expires', render: (i) => <span className="org-muted">{fmtWhen(i.expiresAt)}</span> },
  ], []);

  return (
    <CrShell
      nav={ORG_NAV}
      brand={ORG_BRAND}
      topbarTitle="Team"
      topbarExtra={<span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: 'var(--cr-ink2)' }}>Your people, their access</span>}
      footer={<><a href="/dashboard/onboarding">GET STARTED</a> &middot; <a href="/">ZORAPASS.COM</a></>}
    >
      <div className="cr-stack">
        <div>
          <p className="org-crumb"><Link href="/dashboard/overview">DASHBOARD</Link> / TEAM</p>
          <h1 className="org-h1">Team</h1>
          <p className="org-sub">
            Invite people to help run this organizer and give each the access they need. Every teammate
            logs in with their own email and acts on your organizer per their role — you can change or
            remove access here any time.
          </p>
        </div>

        {canManage && !restricted ? (
          <div className="org-actions">
            <button type="button" className="org-btn" onClick={() => { setDrawer(true); setInviteError(null); setInviteOk(null); }}>
              INVITE TEAMMATE
            </button>
          </div>
        ) : null}

        {rowError ? <p className="org-alert err" role="alert">{rowError}</p> : null}
        {inviteOk && !drawer ? <p className="org-alert ok" role="status">{inviteOk}</p> : null}

        {restricted ? (
          <div className="cr-empty">
            <strong>Team is managed by an owner or admin</strong>
            <span>You have access to this organizer, but only an owner or admin can invite or manage teammates.</span>
          </div>
        ) : onlyYou ? (
          // ── warm "only you" empty state ───────────────────────────────────────
          <div className="org-balance empty">
            <p className="k">It&apos;s just you so far</p>
            <p className="big" style={{ fontSize: 28 }}>Build your team</p>
            <p className="d">
              Add a partner as an admin, a bookkeeper as finance, or door staff to scan tickets — each with
              their own login and only the access they need.
            </p>
            {canManage ? (
              <button type="button" className="org-btn" style={{ marginTop: 18 }} onClick={() => { setDrawer(true); setInviteError(null); setInviteOk(null); }}>
                INVITE YOUR FIRST TEAMMATE
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <section className="cr-panel">
              <div className="cr-panel-head"><h2 className="cr-section-h">Members</h2></div>
              <DataTable
                columns={memberCols}
                rows={members}
                rowKey={(m) => m.userId}
                loading={loading}
                error={loadError ? 'Could not load your team.' : null}
                onRetry={load}
                caption="Team members"
                emptyTitle="No members yet"
                emptyBody={<span>Invite a teammate to get started.</span>}
              />
            </section>

            {invites.length > 0 ? (
              <section className="cr-panel">
                <div className="cr-panel-head"><h2 className="cr-section-h">Pending invites</h2></div>
                <DataTable
                  columns={inviteCols}
                  rows={invites}
                  rowKey={(i) => i.id}
                  caption="Pending invites"
                  emptyTitle="No pending invites"
                />
              </section>
            ) : null}
          </>
        )}
      </div>

      {drawer ? (
        <CrDrawer
          open
          onClose={() => setDrawer(false)}
          ariaLabel="Invite a teammate"
          title="Invite a teammate"
          subtitle="They'll get an email with a link to join your organizer."
        >
          <form onSubmit={submitInvite} style={{ display: 'grid', gap: 14, padding: '4px 2px' }}>
            <div className="org-field">
              <label htmlFor="inv-email">Email</label>
              <input
                id="inv-email"
                type="email"
                autoComplete="off"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@example.com"
                required
                disabled={inviting}
              />
            </div>
            <div className="org-field">
              <label htmlFor="inv-role">Role</label>
              <select id="inv-role" className="cr-select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} disabled={inviting}>
                {INVITE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <p className="org-help">
                Admin manages the organizer · Finance sees sales and requests payouts · Door scans tickets · Viewer reads only.
              </p>
            </div>
            {inviteError ? <p className="org-alert err" role="alert">{inviteError}</p> : null}
            {inviteOk ? <p className="org-alert ok" role="status">{inviteOk}</p> : null}
            <div className="org-actions">
              <button type="submit" className="org-btn" disabled={inviting || !inviteEmail.trim()}>
                {inviting ? 'SENDING…' : 'SEND INVITE'}
              </button>
            </div>
          </form>
        </CrDrawer>
      ) : null}
    </CrShell>
  );
}
