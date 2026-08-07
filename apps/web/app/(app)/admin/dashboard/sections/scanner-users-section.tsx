'use client';

/* PR-BS36 — SCANNER USERS section. This is the legacy "AGENTS" panel: the
   check-in agents who log into the scanner app. Same endpoints:
     GET    /api/agents
     POST   /api/agents { name, contact, event }
     POST   /api/agents/:id/rotate
     DELETE /api/agents/:id
   The admin-controlled hierarchy copy is preserved verbatim — access codes are
   generated, rotated and revoked ONLY from here; organizers can never issue
   them. The scanner-session / role-scope work (#1) extends this section later. */

import { useState, type FormEvent } from 'react';
import { AdminCard, AdminTable, adminApi, errText, useAdminResource, useJsonLoader, useToast, type AdminColumn } from '../admin-kit';

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

/** A role bullet: plain text, or [emphasised, rest] where the first word is the
 *  security-relevant one (rendered in the warn colour, as the legacy panel did). */
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
    // "Cannot" keeps the legacy orange emphasis — it is the security-relevant word.
    items: ['Full control of their events', 'Their analytics & CRM', ['Cannot', ' issue agent codes'], 'No platform-wide access'],
  },
  {
    title: 'Scanning Agent 🔒',
    tag: 'CHECK-IN APP ONLY',
    master: false,
    items: ['Camera / QR verification', 'Locked out of everything else', 'No revenue, no private data', 'Temporary code, auto-expires'],
  },
];

export function ScannerUsersSection() {
  const toast = useToast();
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

  const cols: AdminColumn<Agent>[] = [
    {
      key: 'agent',
      label: 'AGENT',
      render: (a) => (
        <div>
          <b>{a.name}</b>
          <br />
          <span className="mono" style={{ color: 'var(--mut)' }}>
            {a.contact}
          </span>
        </div>
      ),
    },
    { key: 'via', label: 'VIA', render: (a) => <span className="mono">{String(a.via || '').toUpperCase()}</span> },
    { key: 'event', label: 'EVENT', render: (a) => <span className="mono">{a.event}</span> },
    { key: 'code', label: 'CHECK-IN CODE', render: (a) => <span className="agentcode">{a.code}</span> },
    {
      key: 'expires',
      label: 'EXPIRES',
      render: (a) => (
        <span className="mono" style={{ color: 'var(--mut)' }}>
          {a.expiresAt ? new Date(a.expiresAt).toLocaleDateString() : '—'}
        </span>
      ),
    },
    {
      key: 'act',
      label: '',
      actions: true,
      render: (a) => (
        <div className="row-actions">
          <button type="button" className="btn small ghost" onClick={() => rotate(a.id)}>
            NEW CODE
          </button>
          <button type="button" className="btn danger small" onClick={() => revoke(a.id)}>
            REVOKE
          </button>
        </div>
      ),
    },
  ];

  const rows = res.data ? res.data.slice().reverse() : null;

  return (
    <>
      <div className="sec-h">
        <h2>Scanner users</h2>
        <p className="hint">
          Register ticket-scanning agents. Each gets a temporary code to log into the Zora Check-In App only — no
          dashboards, no revenue, no private data. Access codes are generated, rotated and revoked <b>only from here</b>{' '}
          (backend-controlled) — event organizers can never create or distribute them.
        </p>
      </div>

      <div className="stack">
        <div className="roles">
          {ROLES.map((r) => (
            <div className={'role' + (r.master ? ' master' : '')} key={r.title}>
              <p className="rt">{r.title}</p>
              <p className="rtag">{r.tag}</p>
              <ul>
                {r.items.map((i) =>
                  typeof i === 'string' ? (
                    <li key={i}>{i}</li>
                  ) : (
                    <li key={i[0] + i[1]}>
                      <span>
                        <b style={{ color: 'var(--orange)' }}>{i[0]}</b>
                        {i[1]}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>

        <AdminCard title="REGISTER A SCANNING AGENT" subtitle="This admin panel is the single source of agent codes — never issued by organizers.">
          <form onSubmit={create}>
            <div className="grid3">
              <div className="field">
                <label htmlFor="ag-name">AGENT NAME</label>
                <input id="ag-name" required placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="ag-contact">PHONE OR EMAIL</label>
                <input
                  id="ag-contact"
                  required
                  placeholder="+255 7XX… or name@mail.com"
                  value={form.contact}
                  onChange={(e) => setForm({ ...form, contact: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="ag-event">ASSIGN TO EVENT</label>
                <input
                  id="ag-event"
                  placeholder="OFFSHORE / All events"
                  value={form.event}
                  onChange={(e) => setForm({ ...form, event: e.target.value })}
                />
              </div>
            </div>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'GENERATING…' : 'GENERATE ACCESS CODE'}
            </button>
          </form>
        </AdminCard>

        <AdminCard title="REGISTERED AGENTS" flush>
          <AdminTable
            columns={cols}
            rows={rows}
            rowKey={(a) => a.id}
            resource={res}
            empty="No agents yet — register one above and hand them the code."
            emptySub="Codes auto-expire, so rotate before a door shift rather than reusing an old one."
          />
        </AdminCard>
      </div>
    </>
  );
}
