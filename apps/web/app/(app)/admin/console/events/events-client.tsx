'use client';

/* PR-BS72 · Lane C — super-admin EVENTS-MANAGER (#6). BS99: wired to the REAL
   endpoints (the Lane-D mock is gone).

   A list of EVERY event on the platform: name · owner · city · status · sold,
   plus per-row controls:
     · ENABLE / DISABLE  → POST /api/admin/events/:id/enabled { enabled }
       (disable = archive = hidden from every public read — the event-grain side
       of the org-suspension cascade).
     · MEGA pin          → PUT  /api/events/:id/mega { mega }
       (the discover "MEGA EVENT" headliner; server keeps at most one per city).

   Data: GET /api/admin/events (all events incl. drafts/archived, with owner name
   + live sold/capacity). Filters: org · status. */

import { useMemo, useState } from 'react';
import { DataTable, StatusPill, toneForStatus, type Column } from '@/app/components/cr';
import { adminApi, errText, useAdminResource, useJsonLoader } from '../../dashboard/admin-kit';
import { AdminConsoleShell } from '../console-shell';
import { ConsoleToastProvider, crPrimaryBtn, useConsoleToast } from '../console-kit';

type AdminEvent = {
  id: string;
  name: string;
  owner: string;
  ownerHandle: string;
  city: string;
  status: string; // published | draft | archived
  enabled: boolean; // false = archived / disabled (hidden from public reads)
  mega: boolean; // discover headliner pin (one per city)
  sold: number;
  capacity: number;
};

const fmt = (n: number) => (Number(n) || 0).toLocaleString('en-US');

export default function AdminEventsClient() {
  return (
    <ConsoleToastProvider>
      <EventsInner />
    </ConsoleToastProvider>
  );
}

function EventsInner() {
  const toast = useConsoleToast();
  const loader = useJsonLoader<AdminEvent[]>('/api/admin/events');
  const res = useAdminResource(loader);
  const events = res.data || [];

  const [org, setOrg] = useState('');
  const [status, setStatus] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const owners = useMemo(() => Array.from(new Set(events.map((e) => e.owner))).sort(), [events]);

  const rows = useMemo(
    () =>
      events.filter((e) => {
        if (org && e.owner !== org) return false;
        if (status === 'enabled' && !e.enabled) return false;
        if (status === 'disabled' && e.enabled) return false;
        if (status === 'draft' && e.status !== 'draft') return false;
        if (status === 'mega' && !e.mega) return false;
        return true;
      }),
    [events, org, status],
  );

  async function toggleEnabled(ev: AdminEvent) {
    const next = !ev.enabled;
    setPendingId(ev.id);
    try {
      await adminApi(`/api/admin/events/${encodeURIComponent(ev.id)}/enabled`, {
        method: 'POST',
        body: JSON.stringify({ enabled: next }),
      });
      toast(next ? `Enabled "${ev.name}"` : `Disabled "${ev.name}" — hidden from public listings`);
      res.reload();
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setPendingId(null);
    }
  }

  async function toggleMega(ev: AdminEvent) {
    const next = !ev.mega;
    setPendingId(ev.id);
    try {
      // The mega endpoint keeps at most one mega event PER CITY, so pinning one
      // clears any other in the same city — reload to reflect that.
      await adminApi(`/api/events/${encodeURIComponent(ev.id)}/mega`, {
        method: 'PUT',
        body: JSON.stringify({ mega: next }),
      });
      toast(next ? `"${ev.name}" is now the MEGA event in ${ev.city || 'its city'}` : `Unpinned "${ev.name}"`);
      res.reload();
    } catch (e) {
      toast(errText(e), true);
    } finally {
      setPendingId(null);
    }
  }

  const cols: Column<AdminEvent>[] = [
    {
      key: 'name',
      header: 'Event',
      primary: true,
      render: (e) => (
        <span>
          {e.name}
          {e.mega ? <span style={{ marginLeft: 8, fontFamily: 'var(--cr-mono)', fontSize: 10, letterSpacing: '.08em', color: 'var(--cr-blue)' }}>★ MEGA</span> : null}
        </span>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (e) => (
        <span>
          {e.owner}
          <br />
          <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 11, color: 'var(--cr-mut)' }}>@{e.ownerHandle}</span>
        </span>
      ),
    },
    { key: 'city', header: 'City', render: (e) => e.city || '—' },
    {
      key: 'status',
      header: 'Status',
      render: (e) =>
        e.enabled ? (
          <StatusPill tone={toneForStatus(e.status)} label={e.status === 'published' ? 'live' : e.status} />
        ) : (
          <StatusPill tone="failed" label="disabled" />
        ),
    },
    { key: 'sold', header: 'Sold', numeric: true, render: (e) => `${fmt(e.sold)}/${fmt(e.capacity)}` },
    {
      key: 'act',
      header: '',
      render: (e) => (
        <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="cr-btn"
            style={e.mega ? crPrimaryBtn : undefined}
            disabled={pendingId === e.id || !e.enabled}
            onClick={() => toggleMega(e)}
            title={!e.enabled ? 'Enable the event before pinning it as mega' : undefined}
          >
            {e.mega ? 'Unpin mega' : 'Make mega'}
          </button>
          <button type="button" className="cr-btn" disabled={pendingId === e.id} aria-busy={pendingId === e.id} onClick={() => toggleEnabled(e)} style={{ minWidth: 92, justifyContent: 'center' }}>
            {pendingId === e.id ? '…' : e.enabled ? 'Disable' : 'Enable'}
          </button>
        </span>
      ),
    },
  ];

  return (
    <AdminConsoleShell title="Events-manager">
      <div className="cr-stack">
        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Every event
            </h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="cr-btn" onClick={res.reload}>
                Refresh
              </button>
              <select className="cr-select cr-auto" aria-label="Filter by organizer" value={org} onChange={(e) => setOrg(e.target.value)}>
                <option value="">All organizers</option>
                {owners.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <select className="cr-select cr-auto" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
                <option value="draft">Draft</option>
                <option value="mega">Mega</option>
              </select>
            </div>
          </div>

          <DataTable
            columns={cols}
            rows={rows}
            rowKey={(e) => e.id}
            loading={res.status === 'loading' && !res.loaded}
            error={res.status === 'error' ? res.error : null}
            onRetry={res.reload}
            caption="Every event on the platform"
            emptyTitle={org || status ? 'No events match those filters' : 'No events on the platform'}
            emptyBody={<span>{org || status ? 'Widen the filters to see more.' : 'Events appear here as organizers publish them.'}</span>}
          />
        </section>
      </div>
    </AdminConsoleShell>
  );
}
