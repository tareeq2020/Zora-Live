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
import { DataTable, StatusPill, type Column, type PillTone } from '@/app/components/cr';
import { adminApi, errText, money, useAdminResource, useJsonLoader } from '../../dashboard/admin-kit';
import { AdminConsoleShell } from '../console-shell';
import { ConsoleToastProvider, CrSectionHead, crDangerBtn, useConsoleToast } from '../console-kit';

type Organizer = {
  id: string;
  name: string;
  email: string;
  handle: string;
  events: number;
  revenue: number;
  status: 'active' | 'suspended' | string;
  commissionRate?: number;
};

const statusTone = (s: string): PillTone => (s === 'active' ? 'live' : s === 'suspended' ? 'failed' : 'neutral');

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
      key: 'act',
      header: '',
      render: (o) => (
        <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
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
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Accounts
            </h2>
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
    </AdminConsoleShell>
  );
}
