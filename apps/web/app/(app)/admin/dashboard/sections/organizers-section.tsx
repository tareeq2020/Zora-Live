'use client';

/* PR-BS36 — ORGANIZERS section. Same endpoints as the legacy panel:
     GET  /api/organizers
     PUT  /api/organizers/:id/commission   (BS31 — fraction, 0–50%)
     PUT  /api/organizers/:id/status       (active | suspended)
     POST /api/organizers/:id/impersonate  (then hand off to /dashboard)
   Every destructive / privileged action keeps its confirm, and the commission
   input keeps the same 0–50% client guard the legacy SCRIPT had (the API
   enforces it too). Revenue + commission render in IBM Plex Mono (DESIGN.md
   rules 2 / 4b — money is never in the smallest, lowest-contrast text). */

import { useState } from 'react';
import { AdminCard, AdminTable, adminApi, errText, money, useAdminResource, useJsonLoader, useToast, type AdminColumn } from '../admin-kit';

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

export function OrganizersSection() {
  const toast = useToast();
  const loader = useJsonLoader<Organizer[]>('/api/organizers');
  const res = useAdminResource(loader);
  // Per-row commission draft (percent, as typed). Absent = show the stored rate.
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
      await adminApi(`/api/organizers/${o.id}/commission`, {
        method: 'PUT',
        body: JSON.stringify({ commissionRate: pct / 100 }),
      });
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

  const cols: AdminColumn<Organizer>[] = [
    {
      key: 'org',
      label: 'ORGANIZER',
      render: (o) => (
        <div>
          <b>{o.name}</b>
          <br />
          <span className="mono" style={{ color: 'var(--mut)' }}>
            {o.email}
          </span>
        </div>
      ),
    },
    { key: 'handle', label: 'SUBDOMAIN', render: (o) => <span className="mono">{o.handle}.zora.com</span> },
    { key: 'events', label: 'EVENTS', render: (o) => <span className="mono">{o.events}</span> },
    { key: 'revenue', label: 'REVENUE', render: (o) => <span className="mono">{money(o.revenue)}</span> },
    {
      key: 'commission',
      label: 'COMMISSION',
      render: (o) => (
        <span className="mono" style={{ whiteSpace: 'nowrap', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <input
            aria-label={`Commission percent for ${o.name}`}
            type="number"
            min={0}
            max={50}
            step={0.5}
            value={commValue(o)}
            disabled={busy === o.id}
            onChange={(e) => setComm((c) => ({ ...c, [o.id]: e.target.value }))}
            style={{ width: 74, display: 'inline-block', padding: '8px 9px', minHeight: 44 }}
          />
          %
          <button type="button" className="btn small ghost" disabled={busy === o.id} onClick={() => saveCommission(o)}>
            SAVE
          </button>
        </span>
      ),
    },
    { key: 'status', label: 'STATUS', render: (o) => <span className={'pill ' + o.status}>{String(o.status).toUpperCase()}</span> },
    {
      key: 'act',
      label: '',
      actions: true,
      render: (o) => (
        <div className="row-actions">
          {o.status === 'active' ? (
            <>
              <button type="button" className="btn small" disabled={busy === o.id} onClick={() => impersonate(o)}>
                ACT ON BEHALF
              </button>
              <button type="button" className="btn danger small" disabled={busy === o.id} onClick={() => setStatus(o, 'suspended')}>
                SUSPEND
              </button>
            </>
          ) : (
            <button type="button" className="btn small ghost" disabled={busy === o.id} onClick={() => setStatus(o, 'active')}>
              UNLOCK
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="sec-h">
        <h2>Organizers</h2>
        <p className="hint">
          Every registered organizer account. Set the Zora commission, suspend or unlock access, or act on their behalf
          for support. Every admin action is logged to the audit trail on Overview.
        </p>
      </div>
      <AdminCard title="ACCOUNTS" flush>
        <AdminTable
          columns={cols}
          rows={res.data}
          rowKey={(o) => o.id}
          resource={res}
          empty="No organizers on the platform yet."
          emptySub="Accounts appear here as soon as the first organizer is created."
        />
      </AdminCard>
    </>
  );
}
