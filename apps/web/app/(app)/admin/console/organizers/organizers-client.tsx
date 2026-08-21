'use client';

/* PR-BS89 · Control-Room console — ORGANIZERS, ported from the legacy
   dashboard/sections/organizers-section.tsx onto the CR primitives.

   Re-skin, NOT new logic. Same endpoints as the legacy panel:
     GET  /api/organizers
     PUT  /api/organizers/:id/commission   (fraction, 0–50%)
     PUT  /api/organizers/:id/status       (active | suspended)
     POST /api/organizers/:id/impersonate  (then hand off to /dashboard)
   Every destructive / privileged action keeps its confirm, the commission input
   keeps the 0–50% client guard (the API enforces it too), and the store column
   keeps the zorapass.com/{handle} convention (BS83). Suspend/unsuspend pairs
   with the org suspension cascade. */

import { useState } from 'react';
import { DataTable, StatusPill, CrDrawer, type Column, type PillTone } from '@/app/components/cr';
import { adminApi, errText, money, useAdminResource, useJsonLoader } from '../../dashboard/admin-kit';
import { AdminConsoleShell } from '../console-shell';
import { ConsoleToastProvider, CrField, CrSectionHead, crDangerBtn, crPrimaryBtn, useConsoleToast } from '../console-kit';

type Organizer = {
  id: string;
  name: string;
  email: string;
  handle: string;
  events: number;
  revenue: number;
  status: 'active' | 'suspended' | string;
  commissionRate?: number;
  // BS96 (Phase 4, A/B) — the identity behind the org + its REAL verification state.
  owner?: string | null;
  memberCount?: number;
  kycStatus?: string | null;
};

const statusTone = (s: string): PillTone => (s === 'active' ? 'live' : s === 'suspended' ? 'failed' : 'neutral');

// BS96 — the real organizer.kyc_status, rendered honestly (null = not yet reviewed).
const KYC_LABEL: Record<string, string> = {
  approved: 'Verified', rejected: 'Rejected', pending: 'In review', unverified: 'Unverified',
};
const kycTone = (s: string | null | undefined): PillTone =>
  s === 'approved' ? 'paid' : s === 'rejected' ? 'failed' : s === 'pending' ? 'pending' : 'neutral';
const kycLabel = (s: string | null | undefined): string => (s ? (KYC_LABEL[s] ?? s) : 'Not verified');

export default function AdminOrganizersClient() {
  return (
    <ConsoleToastProvider>
      <OrganizersInner />
    </ConsoleToastProvider>
  );
}

function OrganizersInner() {
  const toast = useConsoleToast();
  const loader = useJsonLoader<Organizer[]>('/api/organizers');
  const res = useAdminResource(loader);
  const [comm, setComm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // BS95 (Phase 3.5, C) — "New organizer" (name · handle · owner email) drawer.
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newHandle, setNewHandle] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [creating, setCreating] = useState(false);

  // Per-row "Assign / transfer owner" drawer (holds the target org).
  const [ownerFor, setOwnerFor] = useState<Organizer | null>(null);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [savingOwner, setSavingOwner] = useState(false);

  async function createOrganizer(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    const handle = newHandle.trim().replace(/^@+/, '').toLowerCase();
    const email = newOwner.trim();
    if (name.length < 2 || handle.length < 3 || !email.includes('@')) {
      toast('Enter a name, handle and a valid owner email', true);
      return;
    }
    setCreating(true);
    try {
      const r = await adminApi<{ owner: string; handle: string }>('/api/admin/organizers', {
        method: 'POST',
        body: JSON.stringify({ name, handle, ownerEmail: email }),
      });
      toast(r.owner === 'invited' ? `Created — owner invite sent to ${email}` : `Created — ${email} is now the owner`);
      setNewOpen(false);
      setNewName('');
      setNewHandle('');
      setNewOwner('');
      res.reload();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setCreating(false);
    }
  }

  function openOwner(o: Organizer) {
    setOwnerFor(o);
    setOwnerEmail('');
  }

  async function transferOwner(e: React.FormEvent) {
    e.preventDefault();
    if (!ownerFor) return;
    const email = ownerEmail.trim();
    if (!email.includes('@')) {
      toast('Enter a valid owner email', true);
      return;
    }
    setSavingOwner(true);
    try {
      const r = await adminApi<{ owner: string }>(`/api/admin/organizers/${ownerFor.id}/owner`, {
        method: 'PUT',
        body: JSON.stringify({ email }),
      });
      toast(
        r.owner === 'invited'
          ? `Owner invite sent to ${email}`
          : r.owner === 'unchanged'
            ? `${email} is already the owner`
            : `Ownership assigned to ${email}`,
      );
      setOwnerFor(null);
      setOwnerEmail('');
      res.reload();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setSavingOwner(false);
    }
  }

  const pctOf = (o: Organizer) => ((Number(o.commissionRate) || 0) * 100).toFixed(1);
  const commValue = (o: Organizer) => (o.id in comm ? comm[o.id] : pctOf(o));

  async function saveCommission(o: Organizer) {
    const pct = Number(commValue(o));
    if (!Number.isFinite(pct) || pct < 0 || pct > 50) {
      toast('Commission must be 0–50%', true);
      return;
    }
    setBusy(o.id);
    try {
      await adminApi(`/api/organizers/${o.id}/commission`, { method: 'PUT', body: JSON.stringify({ commissionRate: pct / 100 }) });
      toast(`Commission saved: ${pct.toFixed(1)}%`);
      setComm((c) => {
        const next = { ...c };
        delete next[o.id];
        return next;
      });
      res.reload();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setBusy(null);
    }
  }

  async function impersonate(o: Organizer) {
    if (!window.confirm('Act on behalf of this organizer? This is logged, and you will view their dashboard until you exit.')) return;
    setBusy(o.id);
    try {
      const r = await adminApi<{ impersonating: { name: string } }>(`/api/organizers/${o.id}/impersonate`, { method: 'POST' });
      toast('Acting as ' + r.impersonating.name);
      window.location.href = '/dashboard';
    } catch (ex) {
      toast(errText(ex), true);
      setBusy(null);
    }
  }

  async function setStatus(o: Organizer, to: 'active' | 'suspended') {
    const verb = to === 'suspended' ? 'Suspend' : 'Unlock';
    if (!window.confirm(`${verb} this organizer account?`)) return;
    setBusy(o.id);
    try {
      await adminApi(`/api/organizers/${o.id}/status`, { method: 'PUT', body: JSON.stringify({ status: to }) });
      toast(verb + 'ed');
      res.reload();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setBusy(null);
    }
  }

  // BS96 (Phase 4, A) — verify/reject ANY organizer (not just self-signups). Routes
  // through the one verification transition so the payout + publish gates unlock.
  async function verify(o: Organizer, decision: 'approve' | 'reject') {
    let reason: string | null = null;
    if (decision === 'reject') {
      const r = window.prompt(`Reject ${o.name}? Optionally add a reason (shown to the organizer).`, '');
      if (r === null) return; // cancelled
      reason = r.trim() || null;
    } else if (!window.confirm(`Verify ${o.name}? This unlocks their payouts and publishing.`)) {
      return;
    }
    setBusy(o.id);
    try {
      await adminApi(`/api/admin/organizers/${o.id}/verification`, {
        method: 'PUT',
        body: JSON.stringify(decision === 'reject' ? { decision, reason } : { decision }),
      });
      toast(decision === 'approve' ? `${o.name} verified` : `${o.name} rejected`);
      res.reload();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setBusy(null);
    }
  }

  const cols: Column<Organizer>[] = [
    {
      key: 'org',
      header: 'Organizer',
      primary: true,
      render: (o) => (
        <span>
          {o.name}
          <br />
          <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 11, color: 'var(--cr-mut)' }}>{o.email}</span>
        </span>
      ),
    },
    { key: 'handle', header: 'Store', render: (o) => <span style={{ fontFamily: 'var(--cr-mono)' }}>zorapass.com/{o.handle}</span> },
    {
      key: 'owner',
      header: 'Owner',
      render: (o) =>
        o.owner ? (
          <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 11 }}>
            {o.owner}
            {o.memberCount && o.memberCount > 1 ? (
              <span style={{ color: 'var(--cr-mut)' }}> +{o.memberCount - 1}</span>
            ) : null}
          </span>
        ) : (
          <span style={{ color: 'var(--cr-mut)', fontSize: 11 }}>— (no user yet)</span>
        ),
    },
    { key: 'events', header: 'Events', numeric: true, render: (o) => String(o.events) },
    { key: 'revenue', header: 'Revenue', numeric: true, render: (o) => money(o.revenue) },
    {
      key: 'commission',
      header: 'Commission',
      render: (o) => (
        <span style={{ whiteSpace: 'nowrap', display: 'inline-flex', gap: 8, alignItems: 'center', fontFamily: 'var(--cr-mono)' }}>
          <input
            aria-label={`Commission percent for ${o.name}`}
            className="cr-input"
            type="number"
            min={0}
            max={50}
            step={0.5}
            value={commValue(o)}
            disabled={busy === o.id}
            onChange={(e) => setComm((c) => ({ ...c, [o.id]: e.target.value }))}
            style={{ width: 78 }}
          />
          %
          <button type="button" className="cr-btn" disabled={busy === o.id} onClick={() => saveCommission(o)}>
            Save
          </button>
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (o) => <StatusPill tone={statusTone(o.status)} label={String(o.status)} /> },
    {
      key: 'verification',
      header: 'Verification',
      render: (o) => <StatusPill tone={kycTone(o.kycStatus)} label={kycLabel(o.kycStatus)} />,
    },
    {
      key: 'act',
      header: '',
      render: (o) => (
        <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
          {o.kycStatus === 'approved' ? (
            <button type="button" className="cr-btn" style={crDangerBtn} disabled={busy === o.id} onClick={() => verify(o, 'reject')}>
              Reject
            </button>
          ) : (
            <>
              <button type="button" className="cr-btn" style={crPrimaryBtn} disabled={busy === o.id} onClick={() => verify(o, 'approve')}>
                Verify
              </button>
              {o.kycStatus !== 'rejected' ? (
                <button type="button" className="cr-btn" style={crDangerBtn} disabled={busy === o.id} onClick={() => verify(o, 'reject')}>
                  Reject
                </button>
              ) : null}
            </>
          )}
          <button type="button" className="cr-btn" disabled={busy === o.id} onClick={() => openOwner(o)}>
            Owner
          </button>
          {o.status === 'active' ? (
            <>
              <button type="button" className="cr-btn" disabled={busy === o.id} onClick={() => impersonate(o)}>
                Act on behalf
              </button>
              <button type="button" className="cr-btn" style={crDangerBtn} disabled={busy === o.id} onClick={() => setStatus(o, 'suspended')}>
                Suspend
              </button>
            </>
          ) : (
            <button type="button" className="cr-btn" disabled={busy === o.id} onClick={() => setStatus(o, 'active')}>
              Unlock
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <AdminConsoleShell title="Organizers">
      <div className="cr-stack">
        <CrSectionHead
          title="Organizers"
          hint="Every registered organizer account. Set the Zora commission, suspend or unlock access, or act on their behalf for support. Every admin action is logged to the audit trail on Overview."
        />
        <section className="cr-panel">
          <div className="cr-panel-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Accounts
            </h2>
            <button type="button" className="cr-btn" style={crPrimaryBtn} onClick={() => setNewOpen(true)}>
              New organizer
            </button>
          </div>
          <DataTable
            columns={cols}
            rows={res.data || []}
            rowKey={(o) => o.id}
            loading={res.status === 'loading' && !res.loaded}
            error={res.status === 'error' ? res.error : null}
            onRetry={res.reload}
            caption="Organizer accounts"
            emptyTitle="No organizers on the platform yet"
            emptyBody={<span>Accounts appear here as soon as the first organizer is created.</span>}
          />
        </section>
      </div>

      {/* BS95 — New organizer (name · handle · owner email). */}
      <CrDrawer
        open={newOpen}
        onClose={() => setNewOpen(false)}
        ariaLabel="Create a new organizer"
        title="New organizer"
        subtitle="Creates a draft (unverified) organizer and ensures it has an owner. If the owner email has no account yet, they get an invite to set a password and take ownership."
      >
        <form onSubmit={createOrganizer} style={{ display: 'grid', gap: 14, padding: '4px 2px' }}>
          <CrField label="Name" htmlFor="new-org-name">
            <input id="new-org-name" className="cr-input" type="text" value={newName} placeholder="The Brunch City" onChange={(e) => setNewName(e.target.value)} disabled={creating} required />
          </CrField>
          <CrField label="Handle" htmlFor="new-org-handle">
            <input id="new-org-handle" className="cr-input" type="text" value={newHandle} placeholder="thebrunchcity" autoComplete="off" onChange={(e) => setNewHandle(e.target.value)} disabled={creating} required />
          </CrField>
          <CrField label="Owner email" htmlFor="new-org-owner">
            <input id="new-org-owner" className="cr-input" type="email" value={newOwner} placeholder="owner@example.com" autoComplete="off" onChange={(e) => setNewOwner(e.target.value)} disabled={creating} required />
          </CrField>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="cr-btn" onClick={() => setNewOpen(false)} disabled={creating}>Cancel</button>
            <button type="submit" className="cr-btn" style={crPrimaryBtn} disabled={creating || !newName.trim() || !newHandle.trim() || !newOwner.trim()}>
              {creating ? 'Creating…' : 'Create organizer'}
            </button>
          </div>
        </form>
      </CrDrawer>

      {/* BS95 — Assign / transfer owner for a single org. */}
      <CrDrawer
        open={!!ownerFor}
        onClose={() => setOwnerFor(null)}
        ariaLabel="Assign or transfer owner"
        title="Assign / transfer owner"
        subtitle={ownerFor ? `Make someone the owner of ${ownerFor.name}. The current owner is demoted to admin (never removed).` : undefined}
      >
        <form onSubmit={transferOwner} style={{ display: 'grid', gap: 14, padding: '4px 2px' }}>
          <CrField label="Owner email" htmlFor="owner-email">
            <input id="owner-email" className="cr-input" type="email" value={ownerEmail} placeholder="owner@example.com" autoComplete="off" onChange={(e) => setOwnerEmail(e.target.value)} disabled={savingOwner} required />
          </CrField>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="cr-btn" onClick={() => setOwnerFor(null)} disabled={savingOwner}>Cancel</button>
            <button type="submit" className="cr-btn" style={crPrimaryBtn} disabled={savingOwner || !ownerEmail.trim()}>
              {savingOwner ? 'Saving…' : 'Assign owner'}
            </button>
          </div>
        </form>
      </CrDrawer>
    </AdminConsoleShell>
  );
}
