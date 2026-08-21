'use client';

/* PR-BS89 · Control-Room console — SCANNER USERS, ported from the legacy
   dashboard/sections/scanner-users-section.tsx onto the CR primitives.

   Re-skin, NOT new logic. This is the check-in AGENTS panel, same endpoints:
     GET    /api/agents
     POST   /api/agents { name, contact, event }
     POST   /api/agents/:id/rotate
     DELETE /api/agents/:id
   The admin-controlled hierarchy copy is preserved: access codes are generated,
   rotated and revoked ONLY from here — organizers can never issue them. */

import { useState, type FormEvent } from 'react';
import { DataTable, type Column } from '@/app/components/cr';
import { adminApi, errText, useAdminResource, useJsonLoader } from '../../dashboard/admin-kit';
import { AdminConsoleShell } from '../console-shell';
import { ConsoleToastProvider, CrField, CrSectionHead, crDangerBtn, crPrimaryBtn, useConsoleToast } from '../console-kit';

type Agent = {
  id: string;
  name: string;
  contact: string;
  via: string;
  event: string;
  code: string;
  status?: string;
  expiresAt: string;
};

type RoleItem = string | readonly [string, string];
const ROLES: { title: string; tag: string; master: boolean; items: RoleItem[] }[] = [
  {
    title: 'Master Admin',
    tag: 'FULL PLATFORM CONTROL',
    master: true,
    items: ['Edit every event & setting', 'Financial control & payouts', 'User & role management', 'Media approval'],
  },
  {
    title: 'Event Organizer',
    tag: 'OWN EVENTS ONLY',
    master: false,
    items: ['Full control of their events', 'Their analytics & CRM', ['Cannot', ' issue agent codes'], 'No platform-wide access'],
  },
  {
    title: 'Scanning Agent 🔒',
    tag: 'CHECK-IN APP ONLY',
    master: false,
    items: ['Camera / QR verification', 'Locked out of everything else', 'No revenue, no private data', 'Temporary code, auto-expires'],
  },
];

export default function AdminScannerClient() {
  return (
    <ConsoleToastProvider>
      <ScannerInner />
    </ConsoleToastProvider>
  );
}

function ScannerInner() {
  const toast = useConsoleToast();
  const loader = useJsonLoader<Agent[]>('/api/agents');
  const res = useAdminResource(loader);
  const [form, setForm] = useState({ name: '', contact: '', event: '' });
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const a = await adminApi<Agent>('/api/agents', {
        method: 'POST',
        body: JSON.stringify({ name: form.name.trim(), contact: form.contact.trim(), event: form.event.trim() }),
      });
      toast('Agent added — code ' + a.code);
      setForm({ name: '', contact: '', event: '' });
      res.reload();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setBusy(false);
    }
  }

  async function rotate(id: string) {
    try {
      const a = await adminApi<Agent>(`/api/agents/${id}/rotate`, { method: 'POST' });
      toast('New code ' + a.code);
      res.reload();
    } catch (ex) {
      toast(errText(ex), true);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm('Revoke this agent’s access?')) return;
    try {
      await adminApi(`/api/agents/${id}`, { method: 'DELETE' });
      toast('Agent revoked');
      res.reload();
    } catch (ex) {
      toast(errText(ex), true);
    }
  }

  const cols: Column<Agent>[] = [
    {
      key: 'agent',
      header: 'Agent',
      primary: true,
      render: (a) => (
        <span>
          {a.name}
          <br />
          <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 11, color: 'var(--cr-mut)' }}>{a.contact}</span>
        </span>
      ),
    },
    { key: 'via', header: 'Via', render: (a) => <span style={{ fontFamily: 'var(--cr-mono)' }}>{String(a.via || '').toUpperCase()}</span> },
    { key: 'event', header: 'Event', render: (a) => <span style={{ fontFamily: 'var(--cr-mono)' }}>{a.event}</span> },
    {
      key: 'code',
      header: 'Check-in code',
      render: (a) => (
        <span style={{ fontFamily: 'var(--cr-mono)', fontWeight: 600, letterSpacing: '0.08em', padding: '2px 8px', border: '1px solid var(--cr-hair)', borderRadius: 6, background: 'var(--cr-card2)' }}>
          {a.code}
        </span>
      ),
    },
    {
      key: 'expires',
      header: 'Expires',
      render: (a) => <span style={{ fontFamily: 'var(--cr-mono)', color: 'var(--cr-mut)' }}>{a.expiresAt ? new Date(a.expiresAt).toLocaleDateString() : '—'}</span>,
    },
    {
      key: 'act',
      header: '',
      render: (a) => (
        <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="cr-btn" onClick={() => rotate(a.id)}>
            New code
          </button>
          <button type="button" className="cr-btn" style={crDangerBtn} onClick={() => revoke(a.id)}>
            Revoke
          </button>
        </span>
      ),
    },
  ];

  const rows = res.data ? res.data.slice().reverse() : [];

  return (
    <AdminConsoleShell title="Scanner users">
      <div className="cr-stack">
        <CrSectionHead
          title="Scanner users"
          hint={
            <>
              Register ticket-scanning agents. Each gets a temporary code to log into the Zora Check-In App only — no dashboards, no revenue, no private
              data. Access codes are generated, rotated and revoked <b>only from here</b> (backend-controlled) — event organizers can never create or
              distribute them.
            </>
          }
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          {ROLES.map((r) => (
            <div
              key={r.title}
              style={{
                border: '1px solid ' + (r.master ? 'var(--cr-blue)' : 'var(--cr-hair)'),
                borderRadius: 12,
                padding: 14,
                background: r.master ? 'var(--cr-wash-blue)' : 'var(--cr-card)',
              }}
            >
              <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{r.title}</p>
              <p style={{ margin: '4px 0 10px', fontFamily: 'var(--cr-mono)', fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--cr-mut)' }}>{r.tag}</p>
              <ul style={{ margin: 0, paddingLeft: 16, display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--cr-ink2)' }}>
                {r.items.map((i) =>
                  typeof i === 'string' ? (
                    <li key={i}>{i}</li>
                  ) : (
                    <li key={i[0] + i[1]}>
                      <b style={{ color: 'var(--cr-amber)' }}>{i[0]}</b>
                      {i[1]}
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>

        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Register a scanning agent
            </h2>
            <span style={{ fontSize: 12, color: 'var(--cr-ink2)' }}>This admin panel is the single source of agent codes — never issued by organizers.</span>
          </div>
          <form onSubmit={create}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <CrField label="Agent name" htmlFor="ag-name">
                <input id="ag-name" className="cr-input" required placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </CrField>
              <CrField label="Phone or email" htmlFor="ag-contact">
                <input
                  id="ag-contact"
                  className="cr-input"
                  required
                  placeholder="+255 7XX… or name@mail.com"
                  value={form.contact}
                  onChange={(e) => setForm({ ...form, contact: e.target.value })}
                />
              </CrField>
              <CrField label="Assign to event" htmlFor="ag-event">
                <input id="ag-event" className="cr-input" placeholder="OFFSHORE / All events" value={form.event} onChange={(e) => setForm({ ...form, event: e.target.value })} />
              </CrField>
            </div>
            <button className="cr-btn" style={{ ...crPrimaryBtn, marginTop: 16 }} type="submit" disabled={busy}>
              {busy ? 'Generating…' : 'Generate access code'}
            </button>
          </form>
        </section>

        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Registered agents
            </h2>
          </div>
          <DataTable
            columns={cols}
            rows={rows}
            rowKey={(a) => a.id}
            loading={res.status === 'loading' && !res.loaded}
            error={res.status === 'error' ? res.error : null}
            onRetry={res.reload}
            caption="Registered scanning agents"
            emptyTitle="No agents yet — register one above and hand them the code"
            emptyBody={<span>Codes auto-expire, so rotate before a door shift rather than reusing an old one.</span>}
          />
        </section>
      </div>
    </AdminConsoleShell>
  );
}
