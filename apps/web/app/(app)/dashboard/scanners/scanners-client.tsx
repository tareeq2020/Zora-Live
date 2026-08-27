'use client';

/* BS106 (#183) — Door staff. An owner/admin creates + manages their own scanning
   staff, each pinned to one of THEIR events, reusing the whole existing scan
   pipeline. The door person opens /scan on their phone and enters the code.
     GET  /api/org/scanners            → ScannerRow[]
     POST /api/org/scanners            ← { name, contact, eventId, role }
     PUT  /api/org/scanners/:id        ← { role?, eventId? }
     POST /api/org/scanners/:id/rotate → new code (kills their session)
     POST /api/org/scanners/:id/revoke → deactivate
   Event list comes from /api/org/events (owned events only). */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CrShell, DataTable, StatusPill, type Column, type PillTone } from '@/app/components/cr';
import { ORG_NAV } from '../components/org-nav';
import '../components/org-surfaces.css';

const ORG_BRAND = { name: (<>z<span className="cr-o">o</span>ra</>), sublabel: 'Organizer' };

type EventMeta = { id: string; name: string };
type Role = 'agent' | 'supervisor';
type ScannerRow = {
  id: string;
  name: string;
  contact: string;
  role: Role;
  event: string;        // display label ('All events' or event id)
  eventScope: string | null;
  code: string;
  status: 'active' | 'revoked';
  lastSeenAt: string | null;
};

const ROLE_LABEL: Record<string, string> = { agent: 'Agent', supervisor: 'Supervisor' };
function roleTone(r: string): PillTone { return r === 'supervisor' ? 'paid' : 'neutral'; }
function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function ScannersClient() {
  const [rows, setRows] = useState<ScannerRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [events, setEvents] = useState<EventMeta[]>([]);

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [eventId, setEventId] = useState('');
  const [role, setRole] = useState<Role>('agent');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/org/scanners', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows((await res.json()) as ScannerRow[]);
    } catch {
      setError(true);
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch('/api/org/events', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setEvents(Array.isArray(d) ? (d as EventMeta[]).map((e) => ({ id: e.id, name: e.name })) : []))
      .catch(() => setEvents([]));
  }, []);

  const eventName = useMemo(() => {
    const m = new Map(events.map((e) => [e.id, e.name]));
    return (scope: string | null) => (scope ? m.get(scope) ?? scope : '—');
  }, [events]);

  const canCreate = !!name.trim() && !!contact.trim() && !!eventId && !creating;

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    setCreating(true);
    setMsg(null);
    try {
      const res = await fetch('/api/org/scanners', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ name: name.trim(), contact: contact.trim(), eventId, role }),
      });
      const data = (await res.json().catch(() => ({}))) as ScannerRow & { message?: string };
      if (!res.ok) { setMsg({ kind: 'err', text: data?.message || 'Could not create that scanner.' }); return; }
      setMsg({ kind: 'ok', text: `Added ${name.trim()} — share code ${data.code} for /scan.` });
      setName(''); setContact(''); setRole('agent');
      await load();
    } catch {
      setMsg({ kind: 'err', text: 'We could not reach Zora just then. Nothing was created.' });
    } finally {
      setCreating(false);
    }
  }

  async function act(r: ScannerRow, action: 'rotate' | 'revoke') {
    if (busyId) return;
    if (action === 'revoke' && !window.confirm(`Revoke ${r.name}? Their code stops working immediately.`)) return;
    setBusyId(r.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/org/scanners/${encodeURIComponent(r.id)}/${action}`, { method: 'POST', cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as ScannerRow & { message?: string };
      if (!res.ok) { setMsg({ kind: 'err', text: data?.message || 'That action failed.' }); return; }
      setMsg({ kind: 'ok', text: action === 'rotate' ? `New code for ${r.name}: ${data.code}.` : `Revoked ${r.name}.` });
      await load();
    } catch {
      setMsg({ kind: 'err', text: 'That action could not be completed.' });
    } finally {
      setBusyId(null);
    }
  }

  const cols: Column<ScannerRow>[] = useMemo(() => [
    { key: 'name', header: 'Door person', primary: true, render: (r) => <span><b>{r.name}</b> <span className="org-muted">{r.contact}</span></span> },
    { key: 'event', header: 'Event', render: (r) => eventName(r.eventScope) },
    { key: 'role', header: 'Role', render: (r) => <StatusPill tone={roleTone(r.role)} label={ROLE_LABEL[r.role] ?? r.role} /> },
    { key: 'code', header: 'Code', render: (r) => (r.status === 'active' ? <span className="cr-num" style={{ letterSpacing: '.14em' }}>{r.code}</span> : <span className="org-muted">revoked</span>) },
    { key: 'seen', header: 'Last seen', render: (r) => <span className="org-muted">{fmtWhen(r.lastSeenAt)}</span> },
    {
      key: 'act', header: '',
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 8, justifyContent: 'flex-end' }}>
          {r.status === 'active' ? (
            <>
              <button type="button" className="cr-btn" disabled={busyId === r.id} onClick={() => act(r, 'rotate')}>New code</button>
              <button type="button" className="cr-btn" disabled={busyId === r.id} onClick={() => act(r, 'revoke')}>Revoke</button>
            </>
          ) : <span className="org-muted" style={{ fontSize: 12 }}>—</span>}
        </span>
      ),
    },
  ], [busyId, eventName]);

  return (
    <CrShell
      nav={ORG_NAV}
      brand={ORG_BRAND}
      topbarTitle="Door"
      topbarExtra={<span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: 'var(--cr-ink2)' }}>Scanning staff</span>}
      footer={<><a href="/dashboard/onboarding">GET STARTED</a> &middot; <a href="/">ZORAPASS.COM</a></>}
    >
      <div className="cr-stack">
        <div>
          <p className="org-crumb"><Link href="/dashboard/overview">DASHBOARD</Link> / DOOR</p>
          <h1 className="org-h1">Door staff</h1>
          <p className="org-sub">
            Add the people who scan tickets at your event. Each gets a 6-digit code — they open{' '}
            <span className="cr-num">zorapass.com/scan</span> on their phone, enter the code, and can admit that
            event&apos;s tickets. Rotate a code to sign someone out; revoke to remove them.
          </p>
        </div>

        {/* ① add */}
        <section className="cr-panel">
          <div className="cr-panel-head"><h2 className="cr-section-h">Add a scanner</h2></div>
          <form onSubmit={onCreate}>
            <div className="org-form-row">
              <div className="org-field">
                <label htmlFor="sc-name">Name</label>
                <input id="sc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Juma at Gate A" autoComplete="off" />
              </div>
              <div className="org-field">
                <label htmlFor="sc-contact">Phone or email</label>
                <input id="sc-contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="0712 345 678" autoComplete="off" />
              </div>
              <div className="org-field">
                <label htmlFor="sc-event">Event</label>
                <select id="sc-event" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                  <option value="">Select an event</option>
                  {events.map((ev) => (<option key={ev.id} value={ev.id}>{ev.name}</option>))}
                </select>
              </div>
              <div className="org-field">
                <label htmlFor="sc-role">Role</label>
                <select id="sc-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  <option value="agent">Agent (scans)</option>
                  <option value="supervisor">Supervisor (scans + confirms tables/splits)</option>
                </select>
              </div>
            </div>
            <div className="org-actions">
              <button className="org-btn" type="submit" disabled={!canCreate}>{creating ? 'ADDING…' : 'ADD SCANNER'}</button>
            </div>
            {msg ? <p className={'org-alert ' + (msg.kind === 'ok' ? 'ok' : 'err')} role={msg.kind === 'ok' ? 'status' : 'alert'}>{msg.text}</p> : null}
          </form>
        </section>

        {/* ② list */}
        <section className="cr-panel">
          <div className="cr-panel-head"><h2 className="cr-section-h">Your scanners</h2></div>
          <DataTable
            columns={cols}
            rows={rows ?? []}
            rowKey={(r) => r.id}
            loading={loading}
            error={error ? 'Could not load your scanners.' : null}
            onRetry={load}
            caption="Door staff"
            emptyTitle="No scanners yet"
            emptyBody={<span>Add a door person above and hand them the code to sign into /scan.</span>}
          />
        </section>
      </div>
    </CrShell>
  );
}
