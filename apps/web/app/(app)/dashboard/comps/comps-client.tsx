'use client';

/* BS71 · Lane B — Comps (organizer console). Issue complimentary passes and track
   their delivery: ① issue form (name · phone/email · event+tier · qty) → ② issued
   list → ③ delivery status (SMS/email) with delivered/failed pills + a re-send.

   BS104: wired to the REAL backend (the mock seam is gone). A comp is a $0 order
   that draws down real capacity and delivers by SMS or email:
     GET  /api/org/comps            → CompRow[]
     POST /api/org/comps            ← { name, contact, eventId, tier, qty }
     POST /api/org/comps/:id/resend → re-deliver
   The channel is chosen from the contact (email if it has "@", else SMS). */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CrShell, DataTable, StatusPill, toneForStatus, type Column } from '@/app/components/cr';
import { ORG_NAV } from '../components/org-nav';
import '../components/org-surfaces.css';

const ORG_BRAND = { name: (<>z<span className="cr-o">o</span>ra</>), sublabel: 'Organizer' };

type EventMeta = { id: string; name: string; tiers?: { tierId?: string; name: string }[] };
type Channel = 'sms' | 'email';
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
// BS104: real /api/org/comps reads + writes. Nothing is faked — the row returned
// by POST carries the server's actual delivery result.
function useComps() {
  const [rows, setRows] = useState<CompRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/org/comps', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as CompRow[];
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setError('Could not load your comps.');
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const issue = useCallback(async (input: { name: string; contact: string; eventId: string; tier: string; qty: number }) => {
    const res = await fetch('/api/org/comps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as CompRow & { message?: string };
    if (!res.ok) throw new Error(data?.message || 'Could not issue those comps.');
    setRows((prev) => [data as CompRow, ...(prev ?? [])]);
    return data as CompRow;
  }, []);

  const resend = useCallback(async (id: string): Promise<Delivery> => {
    const res = await fetch(`/api/org/comps/${encodeURIComponent(id)}/resend`, { method: 'POST', cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as { delivery?: Delivery; message?: string };
    if (!res.ok) throw new Error(data?.message || 'Could not re-send that comp.');
    const delivery = data.delivery ?? 'failed';
    setRows((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, delivery } : r)));
    return delivery;
  }, []);

  return { rows, loading, error, load, issue, resend };
}

export default function CompsClient() {
  const { rows, loading, error, load, issue, resend } = useComps();
  const [resending, setResending] = useState<string | null>(null);

  const onResend = async (r: CompRow) => {
    if (resending) return;
    setResending(r.id);
    try {
      const delivery = await resend(r.id);
      setMsg({ kind: delivery === 'delivered' ? 'ok' : 'err', text: delivery === 'delivered' ? `Re-sent to ${r.name}.` : `Re-send to ${r.name} did not go through.` });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Could not re-send.' });
    } finally {
      setResending(null);
    }
  };

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
      const row = await issue({ name: name.trim(), contact: contact.trim(), eventId: selectedEvent.id, tier, qty: parsedQty });
      setMsg(
        row.delivery === 'delivered'
          ? { kind: 'ok', text: `Issued ${parsedQty} comp${parsedQty === 1 ? '' : 's'} to ${name.trim()} — sent by ${row.channel === 'email' ? 'email' : 'SMS'}.` }
          : { kind: 'err', text: `Issued ${parsedQty} comp${parsedQty === 1 ? '' : 's'}, but the ${row.channel === 'email' ? 'email' : 'SMS'} didn't go through. Use Re-send once the details are fixed.` },
      );
      setName('');
      setContact('');
      setQty('1');
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Could not issue those comps. Try again.' });
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
      {
        key: 'act',
        header: '',
        render: (r) => (
          <button type="button" className="cr-btn" disabled={resending === r.id} onClick={() => onResend(r)}>
            {resending === r.id ? 'Re-sending…' : 'Re-send'}
          </button>
        ),
      },
    ],
    [resending],
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
            Issue complimentary passes to guests, press and partners — delivered by SMS or email,
            and tracked here until they land. Comps draw from the event&apos;s real capacity.
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
