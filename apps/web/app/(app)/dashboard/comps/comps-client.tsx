'use client';

/* BS71 · Lane B — Comps ★NEW (organizer console). Issue complimentary passes and
   track their delivery. Per the plan's per-surface spec: ① issue form
   (name · phone/email · event+tier · qty) → ② issued list → ③ delivery status
   (email/SMS/WhatsApp) with delivered/pending/failed pills.

   ┌──────────────────────── SEAM (comps backend) ────────────────────────┐
   │ There is NO comps endpoint yet. The issue form + list run on a typed  │
   │ seam (`useComps()`), which today keeps state in-memory and simulates  │
   │ delivery. To go live, replace the seam body with:                     │
   │   GET  /api/org/comps            → CompRow[]                           │
   │   POST /api/org/comps            ← { name, contact, eventId, tier, qty }│
   │ keeping the CompRow shape so the JSX below is untouched.              │
   │ TODO(comps-backend): build those endpoints (str8up harvest).          │
   └───────────────────────────────────────────────────────────────────────┘
   The event/tier dropdowns DO read the real org endpoint (/api/org/events). */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CrShell, DataTable, StatusPill, toneForStatus, type Column } from '@/app/components/cr';
import { ORG_NAV } from '../components/org-nav';
import '../components/org-surfaces.css';

const ORG_BRAND = { name: (<>z<span className="cr-o">o</span>ra</>), sublabel: 'Organizer' };

type EventMeta = { id: string; name: string; tiers?: { tierId?: string; name: string }[] };
type Channel = 'sms' | 'email' | 'whatsapp';
type Delivery = 'delivered' | 'pending' | 'failed';
type CompRow = {
  id: string;
  name: string;
  contact: string;
  channel: Channel;
  eventName: string;
  tier: string;
  qty: number;
  delivery: Delivery;
  issuedAt: string;
};

const fmt = (n: number) => n.toLocaleString('en-US');
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}
function channelFor(contact: string): Channel {
  return contact.includes('@') ? 'email' : 'sms';
}

// ── SEAM: swap this hook for real /api/org/comps reads + writes ──────────────
function useComps() {
  const [rows, setRows] = useState<CompRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // TODO(comps-backend): const res = await fetch('/api/org/comps', { cache: 'no-store' });
    await new Promise((r) => setTimeout(r, 250));
    setRows((prev) => prev ?? []); // fresh org → empty list (the common first-run state)
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const issue = useCallback(async (input: { name: string; contact: string; eventName: string; tier: string; qty: number }) => {
    // TODO(comps-backend): POST /api/org/comps; optimistic insert until then.
    const row: CompRow = {
      id: 'comp_' + Math.random().toString(36).slice(2, 9),
      name: input.name,
      contact: input.contact,
      channel: channelFor(input.contact),
      eventName: input.eventName,
      tier: input.tier,
      qty: input.qty,
      delivery: 'pending',
      issuedAt: new Date().toISOString(),
    };
    setRows((prev) => [row, ...(prev ?? [])]);
    // Simulate the async delivery result the real gateway would report.
    setTimeout(() => {
      setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? { ...r, delivery: 'delivered' } : r)));
    }, 1400);
    return row;
  }, []);

  return { rows, loading, error, load, issue };
}

export default function CompsClient() {
  const { rows, loading, error, load, issue } = useComps();

  const [events, setEvents] = useState<EventMeta[]>([]);
  const [eventId, setEventId] = useState('');
  const [tier, setTier] = useState('');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [qty, setQty] = useState('1');
  const [issuing, setIssuing] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/org/events', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setEvents(Array.isArray(d) ? (d as EventMeta[]) : []))
      .catch(() => setEvents([]));
  }, []);

  const selectedEvent = eventId ? events.find((e) => e.id === eventId) : null;
  const tierOptions = selectedEvent?.tiers ?? [];
  const parsedQty = Math.max(1, Math.min(50, Number(qty) || 0));
  const canIssue = !!name.trim() && !!contact.trim() && !!selectedEvent && !!tier && parsedQty >= 1 && !issuing;

  async function onIssue(e: React.FormEvent) {
    e.preventDefault();
    if (!canIssue || !selectedEvent) return;
    setIssuing(true);
    setMsg(null);
    try {
      const tierName = tierOptions.find((t) => (t.tierId ?? t.name) === tier)?.name ?? tier;
      await issue({ name: name.trim(), contact: contact.trim(), eventName: selectedEvent.name, tier: tierName, qty: parsedQty });
      setMsg({ kind: 'ok', text: `Issued ${parsedQty} comp${parsedQty === 1 ? '' : 's'} to ${name.trim()}.` });
      setName('');
      setContact('');
      setQty('1');
    } catch {
      setMsg({ kind: 'err', text: 'Could not issue those comps. Try again.' });
    } finally {
      setIssuing(false);
    }
  }

  const cols: Column<CompRow>[] = useMemo(
    () => [
      { key: 'name', header: 'Recipient', primary: true, render: (r) => <span><b>{r.name}</b> <span className="org-muted">{r.contact}</span></span> },
      { key: 'event', header: 'Event', render: (r) => r.eventName },
      { key: 'tier', header: 'Tier × Qty', render: (r) => `${r.tier} × ${fmt(r.qty)}` },
      { key: 'channel', header: 'Channel', render: (r) => <span className="org-cred">{r.channel.toUpperCase()}</span> },
      { key: 'delivery', header: 'Delivery', render: (r) => <StatusPill tone={toneForStatus(r.delivery === 'delivered' ? 'paid' : r.delivery)} label={r.delivery} /> },
      { key: 'issued', header: 'Issued', render: (r) => <span className="org-muted">{fmtWhen(r.issuedAt)}</span> },
    ],
    [],
  );

  return (
    <CrShell
      nav={ORG_NAV}
      brand={ORG_BRAND}
      topbarTitle="Comps"
      topbarExtra={<span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: 'var(--cr-ink2)' }}>Complimentary passes</span>}
      footer={<><a href="/dashboard/onboarding">GET STARTED</a> &middot; <a href="/">ZORAPASS.COM</a></>}
    >
      <div className="cr-stack">
        <div>
          <p className="org-crumb"><Link href="/dashboard/overview">DASHBOARD</Link> / COMPS</p>
          <h1 className="org-h1">Comps</h1>
          <p className="org-sub">
            Issue complimentary passes to guests, press and partners — delivered by SMS, WhatsApp or
            email, and tracked here until they land.
          </p>
        </div>

        {/* ① issue form */}
        <section className="cr-panel">
          <div className="cr-panel-head"><h2 className="cr-section-h">Issue a comp</h2></div>
          <form onSubmit={onIssue}>
            <div className="org-form-row">
              <div className="org-field">
                <label htmlFor="comp-name">Recipient name</label>
                <input id="comp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Amina K." autoComplete="off" />
              </div>
              <div className="org-field">
                <label htmlFor="comp-contact">Phone or email</label>
                <input id="comp-contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="0712 345 678 / name@email.com" autoComplete="off" />
              </div>
              <div className="org-field">
                <label htmlFor="comp-event">Event</label>
                <select id="comp-event" value={eventId} onChange={(e) => { setEventId(e.target.value); setTier(''); }}>
                  <option value="">Select an event</option>
                  {events.map((ev) => (<option key={ev.id} value={ev.id}>{ev.name}</option>))}
                </select>
              </div>
              <div className="org-field">
                <label htmlFor="comp-tier">Tier</label>
                <select id="comp-tier" value={tier} onChange={(e) => setTier(e.target.value)} disabled={!selectedEvent}>
                  <option value="">{selectedEvent ? 'Select a tier' : 'Pick an event first'}</option>
                  {tierOptions.map((t) => (<option key={t.tierId ?? t.name} value={t.tierId ?? t.name}>{t.name}</option>))}
                </select>
              </div>
              <div className="org-field">
                <label htmlFor="comp-qty">Quantity</label>
                <input id="comp-qty" inputMode="numeric" className="mono" value={qty} onChange={(e) => setQty(e.target.value)} />
                <p className="org-help">Up to 50 per issue.</p>
              </div>
            </div>
            <div className="org-actions">
              <button className="org-btn" type="submit" disabled={!canIssue}>{issuing ? 'ISSUING…' : 'ISSUE COMP'}</button>
            </div>
            {msg ? <p className={'org-alert ' + (msg.kind === 'ok' ? 'ok' : 'err')}>{msg.text}</p> : null}
          </form>
        </section>

        {/* ② issued list + ③ delivery status */}
        <section className="cr-panel">
          <div className="cr-panel-head"><h2 className="cr-section-h">Issued comps</h2></div>
          <DataTable
            columns={cols}
            rows={rows ?? []}
            rowKey={(r) => r.id}
            loading={loading}
            error={error}
            onRetry={load}
            caption="Issued comps"
            emptyTitle="No comps issued"
            emptyBody={<span>Issue a complimentary pass above and it will appear here with its delivery status.</span>}
          />
        </section>
      </div>
    </CrShell>
  );
}
