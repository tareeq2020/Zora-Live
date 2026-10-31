'use client';

/* BS136 (F7 / DD5) — organizer "Installments" (OrgInstallOrders mockup).

   GET  /api/org/installments?event=&status=    → KPIs, filter counts, plan rows
   POST /api/org/installments/:orderId/remind   → one SMS/email nudge (1 / day / order)

   Buyer = a display name only (the API never sends a phone or email here).
   Statuses are words in mono with a square marker — never a chip or colour
   alone (DD5): ON TRACK · DUE SOON · OVERDUE · PAID IN FULL · RELEASED.
   An API without the endpoint (404) shows a plain "not available yet" note. */

import { useCallback, useEffect, useState } from 'react';
import { CrShell } from '@/app/components/cr';
import { ORG_NAV } from '../components/org-nav';

const ORG_BRAND = { name: 'ZoraPass', sublabel: 'Organizer' };

type Status = 'on_track' | 'due_week' | 'overdue' | 'paid' | 'released';
type Row = {
  orderId: string; ref: string; eventId: string; eventName: string; buyer: string; passes: string;
  paidCount: number; count: number; paid: number; total: number; currency: string;
  nextDue: string | null; graceEnds: string | null; status: Status; refundStatus: string; remindedToday: boolean;
};
type Payload = {
  enabled: boolean;
  events: { id: string; name: string }[];
  kpis: { collected: number; toCollect: number; openPlans: number; dueThisWeek: number; overdue: number; graceDays: number | null; currency: string };
  counts: Record<'all' | Status, number>;
  rows: Row[];
};

const FILTERS: { id: 'all' | Status; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'on_track', label: 'On track' },
  { id: 'due_week', label: 'Due this week' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'paid', label: 'Paid in full' },
  { id: 'released', label: 'Released' },
];
const STATUS: Record<Status, { label: string; cls: string }> = {
  on_track: { label: 'ON TRACK', cls: 'ok' },
  due_week: { label: 'DUE SOON', cls: 'soon' },
  overdue: { label: 'OVERDUE', cls: 'late' },
  paid: { label: 'PAID IN FULL', cls: 'done' },
  released: { label: 'RELEASED', cls: 'rel' },
};

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const dmon = (d: string) => { const t = new Date(d + 'T00:00:00Z'); return `${t.getUTCDate()} ${MON[t.getUTCMonth()]}`; };
const monoDate = (d: string) => { const t = new Date(d + 'T00:00:00Z'); return `${DOW[t.getUTCDay()]} ${dmon(d)}`; };
const cur = (c: string) => (c === 'TZS' ? 'TSh' : c);
const money = (n: number, c = 'TZS') => `${cur(c)} ${Math.round(n).toLocaleString('en-US')}`;
const compact = (n: number, c = 'TZS') => (n >= 1_000_000 ? `${cur(c)} ${(n / 1_000_000).toFixed(2)}M` : money(n, c));

function csvCell(v: string | number): string {
  const s = String(v ?? '');
  // Quote + neutralise spreadsheet formulas (=, +, -, @ at the start).
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export default function InstallmentsClient() {
  const [event, setEvent] = useState('');
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (event) qs.set('event', event);
    if (filter !== 'all') qs.set('status', filter);
    try {
      const r = await fetch(`/api/org/installments?${qs.toString()}`, { cache: 'no-store', credentials: 'same-origin' });
      if (r.status === 404 && !event) { setState('missing'); return; }
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
      setState('ready');
    } catch {
      setState('error');
    }
  }, [event, filter]);
  useEffect(() => { load(); }, [load]);

  async function remind(row: Row) {
    setBusy(row.orderId);
    setNote(null);
    try {
      const r = await fetch(`/api/org/installments/${encodeURIComponent(row.orderId)}/remind`, { method: 'POST', credentials: 'same-origin' });
      const markSent = () => setData((d) => (d ? { ...d, rows: d.rows.map((x) => (x.orderId === row.orderId ? { ...x, remindedToday: true } : x)) } : d));
      if (r.ok) { markSent(); setNote({ kind: 'ok', text: `Reminder sent to ${row.buyer} (${row.ref}).` }); }
      else if (r.status === 429) { markSent(); setNote({ kind: 'err', text: `${row.buyer} already got a reminder today. Try again tomorrow.` }); }
      else setNote({ kind: 'err', text: 'That reminder didn’t send. Try again.' });
    } catch {
      setNote({ kind: 'err', text: 'That reminder didn’t send. Check your connection.' });
    } finally {
      setBusy(null);
    }
  }

  function exportCsv() {
    if (!data) return;
    const head = ['order', 'buyer', 'event', 'passes', 'payments_made', 'payments', 'paid', 'total', 'currency', 'next_due', 'status'];
    const lines = data.rows.map((r) => [r.ref, r.buyer, r.eventName, r.passes, r.paidCount, r.count, r.paid, r.total, r.currency, r.nextDue ?? '', STATUS[r.status].label]);
    const csv = [head, ...lines].map((l) => l.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `installments${event ? '-' + event : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const k = data?.kpis;
  return (
    <CrShell nav={ORG_NAV} brand={ORG_BRAND} topbarTitle="Installments">
      <div className="zp-io">
        <style dangerouslySetInnerHTML={{ __html: STYLE }} />
        <div className="io-head">
          <h1>Installments</h1>
          {data && data.events.length > 1 ? (
            <select className="io-event" value={event} aria-label="Event" onChange={(e) => setEvent(e.target.value)}>
              <option value="">ALL EVENTS</option>
              {data.events.map((e) => <option key={e.id} value={e.id}>{e.name.toUpperCase()}</option>)}
            </select>
          ) : null}
          <button type="button" className="io-ghost" onClick={exportCsv} disabled={!data || !data.rows.length}>Export CSV</button>
        </div>

        {state === 'loading' ? <p className="io-note">Loading…</p> : null}
        {state === 'missing' ? <p className="io-note">Installments aren&apos;t available yet.</p> : null}
        {state === 'error' ? (
          <p className="io-msg err" role="alert">Couldn&apos;t load installments. <button type="button" className="io-link" onClick={load}>Try again</button></p>
        ) : null}
        {state === 'ready' && data && !data.enabled && !data.counts.all ? (
          <p className="io-note">Installments aren&apos;t switched on for your events yet.</p>
        ) : null}

        {state === 'ready' && data && k ? (
          <>
            <div className="io-kpis">
              <div className="io-kpi"><span className="io-kl">COLLECTED SO FAR</span><span className="io-kv">{compact(k.collected, k.currency)}</span><span className="io-kn">Ready to withdraw as it clears</span></div>
              <div className="io-kpi"><span className="io-kl">STILL TO COLLECT</span><span className="io-kv">{compact(k.toCollect, k.currency)}</span><span className="io-kn">Across {k.openPlans} open plan{k.openPlans === 1 ? '' : 's'}</span></div>
              <div className="io-kpi"><span className="io-kl">DUE THIS WEEK</span><span className="io-kv">{k.dueThisWeek}</span><span className="io-kn">Reminders sent automatically</span></div>
              <div className="io-kpi"><span className="io-kl">OVERDUE</span><span className="io-kv">{k.overdue}</span><span className="io-kn">{k.graceDays != null ? `Released after ${k.graceDays} day${k.graceDays === 1 ? '' : 's'} grace` : 'Released after the grace days'}</span></div>
            </div>

            <div className="io-filters" role="group" aria-label="Filter by status">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" aria-pressed={filter === f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
                  {f.label} · {data.counts[f.id] ?? 0}
                </button>
              ))}
            </div>

            {note ? <p className={'io-msg ' + note.kind} role={note.kind === 'err' ? 'alert' : 'status'}>{note.text}</p> : null}

            <section className="io-table-wrap">
              {data.rows.length ? (
                <table className="io-table">
                  <thead>
                    <tr><th>ORDER</th><th>BUYER</th><th>PASSES</th><th>PAID</th><th>NEXT DUE</th><th>STATUS</th><th><span className="io-sr">Action</span></th></tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => {
                      const st = STATUS[r.status];
                      const pct = r.count ? Math.round((r.paidCount / r.count) * 100) : 0;
                      const paidText = r.status === 'released'
                        ? `${r.paidCount} of ${r.count} · ${r.refundStatus === 'recorded' ? 'refunded' : 'refund due'}`
                        : `${r.paidCount} of ${r.count} · ${money(r.paid, r.currency)}`;
                      const due = r.status === 'overdue' && r.nextDue
                        ? `WAS ${dmon(r.nextDue)}${r.graceEnds ? ` · GRACE ENDS ${dmon(r.graceEnds)}` : ''}`
                        : r.nextDue ? monoDate(r.nextDue) : '—';
                      const canRemind = r.status === 'due_week' || r.status === 'overdue';
                      return (
                        <tr key={r.orderId}>
                          <td className="io-mono" data-l="ORDER">{r.ref}</td>
                          <td className="io-who" data-l="BUYER">{r.buyer}</td>
                          <td className="io-mono" data-l="PASSES">{r.passes || '—'}</td>
                          <td data-l="PAID">
                            <div className="io-paid">
                              <span className="io-mono">{paidText}</span>
                              <span className="io-bar" role="progressbar" aria-valuemin={0} aria-valuemax={r.count} aria-valuenow={r.paidCount} aria-label={`${r.paidCount} of ${r.count} payments made`}>
                                <span style={{ width: `${pct}%` }} />
                              </span>
                            </div>
                          </td>
                          <td className="io-mono" data-l="NEXT DUE">{due}</td>
                          <td data-l="STATUS"><span className="io-st"><span className={'io-sq ' + st.cls} aria-hidden="true" />{st.label}</span></td>
                          <td className="io-act">
                            {canRemind ? (
                              <button type="button" className="io-remind" disabled={busy === r.orderId || r.remindedToday} onClick={() => remind(r)}>
                                {r.remindedToday ? 'Reminded today' : busy === r.orderId ? 'Sending…' : 'Send reminder'}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="io-note io-empty">{filter === 'all' ? 'No installment plans yet.' : 'Nothing here right now.'}</p>
              )}
            </section>
            <span className="io-note">Only payments that have cleared count toward your payout balance.</span>
          </>
        ) : null}
      </div>
    </CrShell>
  );
}

const STYLE = `
.zp-io{--io-ink:#111111;--io-paper:#F7F5EE;--io-card:#FFFFFF;--io-line:#D9D6CC;--io-mut:#4A4A4A;
  background:var(--io-paper);color:var(--io-ink);border-radius:16px;padding:32px 40px;display:flex;flex-direction:column;gap:22px;
  font-family:var(--zp-font-sans);box-sizing:border-box;max-width:1200px;margin:0 auto}
.zp-io *{box-sizing:border-box}
.zp-io button{font-family:var(--zp-font-sans);cursor:pointer;color:var(--io-ink)}
.zp-io button:disabled{opacity:.5;cursor:default}
.zp-io button:focus-visible,.zp-io select:focus-visible{outline:3px solid #1597D4;outline-offset:2px}
.zp-io .io-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.zp-io .io-head h1{margin:0;font-size:32px;font-weight:800;letter-spacing:-.02em;flex-grow:1}
.zp-io .io-event{height:40px;padding:0 14px;border-radius:999px;border:2px solid var(--io-ink);background:var(--io-card);color:var(--io-ink);font-family:var(--zp-font-mono);font-size:13px;max-width:280px}
.zp-io .io-ghost{height:40px;padding:0 16px;border-radius:12px;border:2px solid var(--io-ink);background:transparent;font-weight:700}
.zp-io .io-note{font-size:13px;color:var(--io-mut);margin:0}
.zp-io .io-msg{margin:0;padding:10px 14px;border-radius:12px;font-size:14px;background:var(--io-card);border-left:4px solid #0F7B3F}
.zp-io .io-msg.err{border-left-color:#B42318}
.zp-io .io-link{background:none;border:0;padding:0;text-decoration:underline;font-weight:700}
.zp-io .io-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.zp-io .io-kpi{background:var(--io-card);border:1px solid var(--io-line);border-radius:16px;padding:16px 18px;display:flex;flex-direction:column;gap:6px}
.zp-io .io-kl{font-family:var(--zp-font-mono);font-size:11px;letter-spacing:.12em;color:var(--io-mut)}
.zp-io .io-kv{font-family:var(--zp-font-mono);font-size:26px;font-weight:600}
.zp-io .io-kn{font-size:13px;color:#3A3A3A}
.zp-io .io-filters{display:flex;gap:8px;flex-wrap:wrap}
.zp-io .io-filters button{height:40px;padding:0 16px;border-radius:999px;border:2px solid var(--io-ink);background:transparent;font-weight:700;font-size:14px}
.zp-io .io-filters button.on{background:var(--io-ink);color:#FFD21F}
.zp-io .io-table-wrap{background:var(--io-card);border:1px solid var(--io-line);border-radius:16px;padding:6px 20px;overflow-x:auto}
.zp-io .io-table{width:100%;border-collapse:collapse;font-size:15px}
.zp-io .io-table th{padding:12px 8px 12px 0;font-family:var(--zp-font-mono);font-size:11px;letter-spacing:.12em;color:var(--io-mut);text-align:left;font-weight:500}
.zp-io .io-table td{padding:14px 8px 14px 0;border-top:1px solid var(--io-line);vertical-align:middle}
.zp-io .io-mono{font-family:var(--zp-font-mono);font-size:13px}
.zp-io .io-who{font-weight:700}
.zp-io .io-paid{display:flex;flex-direction:column;gap:4px;width:170px}
.zp-io .io-bar{height:8px;background:var(--io-paper);border-radius:999px;overflow:hidden;display:block}
.zp-io .io-bar span{display:block;height:100%;background:var(--io-ink)}
.zp-io .io-st{font-family:var(--zp-font-mono);font-size:12px;letter-spacing:.08em;display:inline-flex;gap:8px;align-items:center;white-space:nowrap}
.zp-io .io-sq{width:10px;height:10px;border-radius:2px;border:2px solid var(--io-ink);background:var(--io-card);flex:none}
.zp-io .io-sq.soon{background:#FFD21F;border-color:#FFD21F}
.zp-io .io-sq.late{background:#B42318;border-color:#B42318}
.zp-io .io-sq.done{background:#0F7B3F;border-color:#0F7B3F}
.zp-io .io-sq.rel{background:var(--io-paper);border-color:#BDBDBD}
.zp-io .io-act{text-align:right}
.zp-io .io-remind{height:36px;padding:0 12px;border-radius:10px;border:2px solid var(--io-ink);background:transparent;font-weight:700;font-size:13px;white-space:nowrap}
.zp-io .io-sr{position:absolute;left:-9999px}
.zp-io .io-empty{padding:20px 0}
@media (max-width:900px){
  .zp-io{padding:20px 16px;border-radius:0}
  .zp-io .io-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .zp-io .io-table thead{display:none}
  .zp-io .io-table tr{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;border-top:1px solid var(--io-line);padding:14px 0}
  .zp-io .io-table td{border:0;padding:0}
  .zp-io .io-table td[data-l]::before{content:attr(data-l);display:block;font-family:var(--zp-font-mono);font-size:10px;letter-spacing:.12em;color:var(--io-mut);margin-bottom:2px}
  .zp-io .io-act{grid-column:1 / -1;text-align:left}
  .zp-io .io-paid{width:100%}
}
`;
