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
type Channel = 'sms' | 'email' | 'both';
type Delivery = 'delivered' | 'pending' | 'failed';
type CompRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  contact: string;
  channel: Channel;
  eventName: string;
  tier: string;
  qty: number;
  delivery: Delivery;
  issuedAt: string;
};

const fmt = (n: number) => n.toLocaleString('en-US');
const channelLabel = (c: Channel): string => (c === 'both' ? 'SMS + email' : c === 'email' ? 'email' : 'SMS');
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

  const issue = useCallback(async (input: { name: string; phone: string; email: string; eventId: string; tier: string; qty: number }) => {
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

  // BS105: fix a comp's details and re-send (name/phone/email). Returns the
  // updated row (with the fresh delivery result).
  const edit = useCallback(async (id: string, input: { name: string; phone: string; email: string }) => {
    const res = await fetch(`/api/org/comps/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as CompRow & { message?: string };
    if (!res.ok) throw new Error(data?.message || 'Could not update that comp.');
    setRows((prev) => (prev ?? []).map((r) => (r.id === id ? (data as CompRow) : r)));
    return data as CompRow;
  }, []);

  return { rows, loading, error, load, issue, resend, edit };
}

export default function CompsClient() {
  const { rows, loading, error, load, issue, resend, edit } = useComps();
  const [resending, setResending] = useState<string | null>(null);

  const [events, setEvents] = useState<EventMeta[]>([]);
  const [eventId, setEventId] = useState('');
  const [tier, setTier] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [qty, setQty] = useState('1');
  const [issuing, setIssuing] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // BS105: edit-and-resend an existing comp.
  const [editId, setEditId] = useState<string | null>(null);
  const [edName, setEdName] = useState('');
  const [edPhone, setEdPhone] = useState('');
  const [edEmail, setEdEmail] = useState('');
  const [edBusy, setEdBusy] = useState(false);

  const onResend = async (r: CompRow) => {
    if (resending) return;
    setResending(r.id);
    try {
      const delivery = await resend(r.id);
      setMsg({ kind: delivery === 'delivered' ? 'ok' : 'err', text: delivery === 'delivered' ? `Re-sent to ${r.name}.` : `Re-send to ${r.name} did not go through — check the contact details.` });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Could not re-send.' });
    } finally {
      setResending(null);
    }
  };

  function openEdit(r: CompRow) {
    setEditId(r.id);
    setEdName(r.name);
    setEdPhone(r.phone ?? '');
    setEdEmail(r.email ?? '');
    setMsg(null);
  }
  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId || edBusy) return;
    if (!edPhone.trim() && !edEmail.trim()) { setMsg({ kind: 'err', text: 'Enter a phone, an email, or both.' }); return; }
    setEdBusy(true);
    try {
      const row = await edit(editId, { name: edName.trim(), phone: edPhone.trim(), email: edEmail.trim() });
      setMsg({ kind: row.delivery === 'delivered' ? 'ok' : 'err', text: row.delivery === 'delivered' ? `Updated and re-sent to ${row.name}.` : `Saved, but the re-send to ${row.name} didn't go through.` });
      setEditId(null);
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Could not update.' });
    } finally {
      setEdBusy(false);
    }
  }

  useEffect(() => {
    fetch('/api/org/events', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setEvents(Array.isArray(d) ? (d as EventMeta[]) : []))
      .catch(() => setEvents([]));
  }, []);

  const selectedEvent = eventId ? events.find((e) => e.id === eventId) : null;
  const tierOptions = selectedEvent?.tiers ?? [];
  const parsedQty = Math.max(1, Math.min(50, Number(qty) || 0));
  const canIssue = !!name.trim() && (!!phone.trim() || !!email.trim()) && !!selectedEvent && !!tier && parsedQty >= 1 && !issuing;

  async function onIssue(e: React.FormEvent) {
    e.preventDefault();
    if (!canIssue || !selectedEvent) return;
    setIssuing(true);
    setMsg(null);
    try {
      const row = await issue({ name: name.trim(), phone: phone.trim(), email: email.trim(), eventId: selectedEvent.id, tier, qty: parsedQty });
      const via = channelLabel(row.channel);
      setMsg(
        row.delivery === 'delivered'
          ? { kind: 'ok', text: `Issued ${parsedQty} comp${parsedQty === 1 ? '' : 's'} to ${name.trim()} — sent by ${via}.` }
          : { kind: 'err', text: `Issued ${parsedQty} comp${parsedQty === 1 ? '' : 's'}, but the ${via} didn't go through. Fix the details with Edit and re-send.` },
      );
      setName('');
      setPhone('');
      setEmail('');
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
      { key: 'channel', header: 'Channel', render: (r) => <span className="org-cred">{channelLabel(r.channel)}</span> },
      { key: 'delivery', header: 'Delivery', render: (r) => <StatusPill tone={toneForStatus(r.delivery === 'delivered' ? 'paid' : r.delivery)} label={r.delivery} /> },
      { key: 'issued', header: 'Issued', render: (r) => <span className="org-muted">{fmtWhen(r.issuedAt)}</span> },
      {
        key: 'act',
        header: '',
        render: (r) => (
          <span style={{ display: 'inline-flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="cr-btn" disabled={edBusy || resending === r.id} onClick={() => openEdit(r)}>Edit</button>
            <button type="button" className="cr-btn" disabled={resending === r.id || edBusy} onClick={() => onResend(r)}>
              {resending === r.id ? 'Re-sending…' : 'Re-send'}
            </button>
          </span>
        ),
      },
    ],
    [resending, edBusy],
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
            Issue complimentary passes to guests, press and partners — delivered by SMS, email, or both,
            and tracked here until they land. Got a detail wrong? Edit and re-send. Comps draw from the
            event&apos;s real capacity.
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
                <label htmlFor="comp-phone">Phone <span className="org-muted">(optional)</span></label>
                <input id="comp-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" autoComplete="off" />
              </div>
              <div className="org-field">
                <label htmlFor="comp-email">Email <span className="org-muted">(optional)</span></label>
                <input id="comp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" autoComplete="off" />
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

        {/* ②a edit-and-resend (BS105) — fix a wrong number/email and re-send */}
        {editId ? (
          <section className="cr-panel">
            <div className="cr-panel-head"><h2 className="cr-section-h">Fix &amp; re-send</h2></div>
            <p className="org-sub" style={{ marginTop: -4 }}>
              Correct the contact details and we&apos;ll re-send the same tickets. The seats and codes don&apos;t change.
            </p>
            <form onSubmit={saveEdit}>
              <div className="org-form-row">
                <div className="org-field">
                  <label htmlFor="ed-name">Recipient name</label>
                  <input id="ed-name" value={edName} onChange={(e) => setEdName(e.target.value)} autoComplete="off" />
                </div>
                <div className="org-field">
                  <label htmlFor="ed-phone">Phone <span className="org-muted">(optional)</span></label>
                  <input id="ed-phone" type="tel" value={edPhone} onChange={(e) => setEdPhone(e.target.value)} placeholder="0712 345 678" autoComplete="off" />
                </div>
                <div className="org-field">
                  <label htmlFor="ed-email">Email <span className="org-muted">(optional)</span></label>
                  <input id="ed-email" type="email" value={edEmail} onChange={(e) => setEdEmail(e.target.value)} placeholder="name@email.com" autoComplete="off" />
                </div>
              </div>
              <div className="org-actions" style={{ display: 'inline-flex', gap: 8 }}>
                <button className="org-btn" type="submit" disabled={edBusy || (!edPhone.trim() && !edEmail.trim())}>{edBusy ? 'SAVING…' : 'SAVE & RE-SEND'}</button>
                <button className="cr-btn" type="button" onClick={() => setEditId(null)} disabled={edBusy}>Cancel</button>
              </div>
            </form>
          </section>
        ) : null}

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
