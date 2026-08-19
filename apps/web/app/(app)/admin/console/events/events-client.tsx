'use client';

/* PR-BS72 · Lane C — super-admin EVENTS-MANAGER (#6).

   Replaces the legacy single-drop `DropPanel` (which only ever edited THE ONE
   flagship drop via /api/settings) with a list of EVERY event on the platform:
   name · owner · status · sold, plus a per-event ENABLE / DISABLE toggle
   (archive / unarchive). Disabling an event is the admin side of the suspension
   story — an archived event is hidden from every public read (discover, tenant,
   storefront), the same cascade the org-suspension backend performs at the org
   level (see the plan's Engineering review #6 + T7).

   Hierarchy (plan "Admin Events-manager"): ① the event list → ② per-row
   enable/disable → ③ filters (org · status).

   ┌─────────────────────────── SEAM (Lane D) ───────────────────────────┐
   │ Both the LIST and the TOGGLE are Lane D (PR-BS70):                     │
   │   · list   GET  /api/admin/events            → mock below (swap the    │
   │            useMockEvents() hook for a real fetch; keep AdminEvent).    │
   │   · toggle POST /api/admin/events/:id/enabled {enabled} → wired at the │
   │            call site (setEnabled) behind a TODO(Lane D); until the     │
   │            endpoint merges it fails soft (optimistic revert + banner). │
   └──────────────────────────────────────────────────────────────────────┘ */

import { useMemo, useState } from 'react';
import { DataTable, StatusPill, toneForStatus, type Column } from '@/app/components/cr';
import { AdminConsoleShell } from '../console-shell';

// ── Contract the real endpoint should satisfy (Lane D fills it) ──────────────
type AdminEvent = {
  id: string;
  name: string;
  owner: string;
  ownerHandle: string;
  city: string;
  status: string; // published | draft | ...
  enabled: boolean; // false = archived / disabled (hidden from public reads)
  sold: number;
  capacity: number;
};

const fmt = (n: number) => n.toLocaleString('en-US');

// ── SEAM: swap this hook for a fetch of GET /api/admin/events (Lane D) ───────
function useMockEvents(): AdminEvent[] {
  return useMemo(
    () => [
      { id: 'e_apr', name: 'Apricot Crush', owner: 'The Brunch City', ownerHandle: 'thebrunchcity', city: 'Dar es Salaam', status: 'published', enabled: true, sold: 168, capacity: 300 },
      { id: 'e_wkd', name: 'Sunset Yacht Weekendar', owner: 'The Weekendar', ownerHandle: 'weekendar', city: 'Zanzibar', status: 'published', enabled: true, sold: 92, capacity: 120 },
      { id: 'e_neon', name: 'Neon Nights', owner: 'Neon Nights TZ', ownerHandle: 'neonnights', city: 'Arusha', status: 'published', enabled: false, sold: 40, capacity: 500 },
      { id: 'e_sun', name: 'Sundown Sessions', owner: 'Sundown Sessions', ownerHandle: 'sundown', city: 'Dar es Salaam', status: 'published', enabled: true, sold: 46, capacity: 200 },
      { id: 'e_nye', name: 'NYE Rooftop', owner: 'Coastline Co.', ownerHandle: 'coastline', city: 'Dar es Salaam', status: 'draft', enabled: true, sold: 0, capacity: 400 },
    ],
    [],
  );
}

/* TODO(Lane D): wire to POST /api/admin/events/:id/enabled {enabled}. Until that
   endpoint merges this resolves to a thrown error so the UI's optimistic update
   reverts and the banner shows — no silent no-op. */
async function setEnabledEndpoint(id: string, enabled: boolean): Promise<void> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(id)}/enabled`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (res.status === 401 && typeof window !== 'undefined') window.location.href = '/admin';
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data?.error || 'Request failed');
  }
}

export default function AdminEventsClient() {
  const seed = useMockEvents();
  const [events, setEvents] = useState<AdminEvent[]>(seed);
  const [org, setOrg] = useState('');
  const [status, setStatus] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const owners = useMemo(() => Array.from(new Set(seed.map((e) => e.owner))).sort(), [seed]);

  const rows = useMemo(
    () =>
      events.filter((e) => {
        if (org && e.owner !== org) return false;
        if (status === 'enabled' && !e.enabled) return false;
        if (status === 'disabled' && e.enabled) return false;
        if (status === 'draft' && e.status !== 'draft') return false;
        return true;
      }),
    [events, org, status],
  );

  async function toggle(ev: AdminEvent) {
    const next = !ev.enabled;
    setPendingId(ev.id);
    setBanner(null);
    // optimistic
    setEvents((list) => list.map((e) => (e.id === ev.id ? { ...e, enabled: next } : e)));
    try {
      await setEnabledEndpoint(ev.id, next); // TODO(Lane D): live once PR-BS70 merges
    } catch (e) {
      // revert on failure (endpoint not merged yet, or a real error)
      setEvents((list) => list.map((x) => (x.id === ev.id ? { ...x, enabled: ev.enabled } : x)));
      setBanner(
        `Couldn't ${next ? 'enable' : 'disable'} "${ev.name}" — the events-manager endpoint isn't live yet (Lane D / PR-BS70).`,
      );
    } finally {
      setPendingId(null);
    }
  }

  const cols: Column<AdminEvent>[] = [
    { key: 'name', header: 'Event', primary: true, render: (e) => e.name },
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
    { key: 'city', header: 'City', render: (e) => e.city },
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
        <button
          type="button"
          className="cr-btn"
          disabled={pendingId === e.id}
          aria-busy={pendingId === e.id}
          onClick={() => toggle(e)}
          style={{ minWidth: 92, justifyContent: 'center' }}
        >
          {pendingId === e.id ? '…' : e.enabled ? 'Disable' : 'Enable'}
        </button>
      ),
    },
  ];

  const selectStyle: React.CSSProperties = {
    height: 34,
    borderRadius: 9,
    border: '1px solid var(--cr-hair)',
    background: 'var(--cr-card)',
    color: 'var(--cr-ink)',
    fontFamily: 'var(--cr-sans)',
    fontSize: 12,
    padding: '0 10px',
  };

  return (
    <AdminConsoleShell title="Events-manager">
      <div className="cr-stack">
        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Every event
            </h2>
            {/* ③ filters (org · status) */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select aria-label="Filter by organizer" value={org} onChange={(e) => setOrg(e.target.value)} style={selectStyle}>
                <option value="">All organizers</option>
                {owners.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
                <option value="">All statuses</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
                <option value="draft">Draft</option>
              </select>
            </div>
          </div>

          {banner ? (
            <div className="cr-error" role="alert" style={{ marginBottom: 14 }}>
              <strong>Action failed</strong>
              <span>{banner}</span>
            </div>
          ) : null}

          <DataTable
            columns={cols}
            rows={rows}
            rowKey={(e) => e.id}
            caption="Every event on the platform"
            emptyTitle={org || status ? 'No events match those filters' : 'No events on the platform'}
            emptyBody={
              <span>{org || status ? 'Widen the filters to see more.' : 'Events appear here as organizers publish them.'}</span>
            }
          />
        </section>
      </div>
    </AdminConsoleShell>
  );
}
