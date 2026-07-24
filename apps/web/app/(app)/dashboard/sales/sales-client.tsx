'use client';

/* PR-MT5 — the organizer sales / tickets-sold view (client).

   Idiomatic React (mirrors the storefront-client pattern): this component owns
   its data and interactivity. It reads two org-scoped endpoints via the
   same-origin /api/* proxy (session cookie forwarded automatically) and never
   invents backend — the response shapes below are defined locally straight from
   the MT-dashboard API contract:

     GET /api/org/summary
        -> { totals:{revenue,sold,orders,currency}, events:[…] }
     GET /api/org/orders?eventId=&limit=
        -> [{ orderId,eventId,eventName,tier,qty,amount,currency,status,
               buyerMasked:{phone,email}, credentials:[publicRef], createdAt }]

   The summary drives the revenue/sold/orders header + the per-event revenue
   summary + the filter options. Selecting an event drives the ?eventId= query
   on the orders fetch; a "load more" bumps the ?limit=. Revenue is NOT
   recomputed here — the server is the source of truth (only `paid` orders are
   revenue-bearing there); the client only ever DISPLAYS server numbers and, for
   the shown subset, counts how many rows are paid.

   Visual language matches the organizer dashboard control room (mono labels,
   card grid, ptable, blue accent) so /dashboard/sales feels native to
   /dashboard. Styles are scoped under `.zora-sales` so nothing leaks. */

import { useCallback, useEffect, useState } from 'react';
import SplitsWorklist from './splits-worklist';
import Link from 'next/link';

// ── Response types (local, from the API contract — do NOT invent backend) ──
type Totals = { revenue: number; sold: number; orders: number; currency: string };
type SummaryEvent = {
  id: string;
  name: string;
  status: string;
  sold: number;
  capacity: number;
  revenue: number;
  currency: string;
};
type Summary = { totals: Totals; events: SummaryEvent[] };

type OrderRow = {
  orderId: string;
  eventId: string;
  eventName: string;
  tier: string;
  qty: number;
  amount: number;
  currency: string;
  status: string;
  buyerMasked: { phone?: string; email?: string };
  credentials: string[];
  createdAt: string;
};

const PAGE_SIZE = 50;
const MAX_LIMIT = 500;

const fmt = (n: number) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US') : '—');
const money = (n: number, cur?: string) => `${fmt(n)}${cur ? ' ' + cur : ''}`;

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso || '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// Only `paid` is revenue-bearing (server contract). Everything else is
// non-revenue; classify for a status tone but always show the raw label.
type Tone = 'paid' | 'pending' | 'failed';
function statusTone(status: string): Tone {
  const s = (status || '').toLowerCase();
  if (s === 'paid') return 'paid';
  if (['failed', 'cancelled', 'canceled', 'refunded', 'void', 'expired'].includes(s)) return 'failed';
  return 'pending'; // pending, payment_short, paid_unseatable, unknown → treat as not-yet-clean
}

export default function SalesClient() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);

  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState(false);

  const [eventId, setEventId] = useState<string>(''); // '' = all events
  const [limit, setLimit] = useState<number>(PAGE_SIZE);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(false);
    try {
      const res = await fetch('/api/org/summary', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSummary((await res.json()) as Summary);
    } catch {
      setSummaryError(true);
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const loadOrders = useCallback(async (evId: string, lim: number) => {
    setOrdersLoading(true);
    setOrdersError(false);
    try {
      const params = new URLSearchParams();
      if (evId) params.set('eventId', evId);
      params.set('limit', String(lim));
      const res = await fetch(`/api/org/orders?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as OrderRow[];
      setOrders(Array.isArray(data) ? data : []);
    } catch {
      setOrdersError(true);
      setOrders(null);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadOrders(eventId, limit);
  }, [loadOrders, eventId, limit]);

  // Changing the event filter resets the page window back to the first page.
  function onFilter(evId: string) {
    setEventId(evId);
    setLimit(PAGE_SIZE);
  }

  const totals = summary?.totals;
  const events = summary?.events ?? [];
  const selectedEvent = eventId ? events.find((e) => e.id === eventId) : null;

  // The orders API returns a flat array (no cursor); if it filled the requested
  // limit there may be more, so "load more" bumps the limit and re-fetches.
  const hasMore = !!orders && orders.length >= limit && limit < MAX_LIMIT;
  const shownPaid = orders ? orders.filter((o) => statusTone(o.status) === 'paid').length : 0;

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />

      <div className="zora-sales">
        <main>
          <p className="crumb">
            <Link href="/dashboard">DASHBOARD</Link> / SALES
          </p>
          <h1>Sales</h1>
          <p className="sub">
            Every order and the passes it issued, from your side of the counter. Revenue counts
            paid orders only — the same honest number your buyers see.
          </p>

          {/* BS12 — splits in progress + the manual-refund worklist (renders when present) */}
          <SplitsWorklist />

          {/* ── Revenue / sold / orders header (from /api/org/summary) ── */}
          {summaryLoading ? (
            <div className="cards" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div className="card skeleton" key={i}>
                  <p className="k">&nbsp;</p>
                  <p className="v">&nbsp;</p>
                </div>
              ))}
            </div>
          ) : summaryError ? (
            <div className="state error">
              <p>Could not load your sales summary.</p>
              <button className="btn ghost" onClick={loadSummary}>
                RETRY
              </button>
            </div>
          ) : totals ? (
            <div className="cards">
              <div className="card">
                <p className="k">{selectedEvent ? 'EVENT REVENUE' : 'NET REVENUE'}</p>
                <p className="v blue">
                  {money(selectedEvent ? selectedEvent.revenue : totals.revenue, selectedEvent ? selectedEvent.currency : totals.currency)}
                </p>
                <p className="d">Paid orders only</p>
              </div>
              <div className="card">
                <p className="k">PASSES SOLD</p>
                <p className="v">
                  {fmt(selectedEvent ? selectedEvent.sold : totals.sold)}
                  {selectedEvent ? <small>/{fmt(selectedEvent.capacity)}</small> : null}
                </p>
                <p className="d">{selectedEvent ? selectedEvent.name : 'Across all your events'}</p>
              </div>
              <div className="card">
                <p className="k">ORDERS</p>
                <p className="v">{fmt(totals.orders)}</p>
                <p className="d">All statuses · total placed</p>
              </div>
            </div>
          ) : null}

          {/* ── Per-event revenue summary (from /api/org/summary) ── */}
          {!summaryLoading && !summaryError && events.length > 0 ? (
            <div className="box" style={{ marginBottom: 22 }}>
              <p className="bh">REVENUE BY EVENT</p>
              <div className="table-scroll">
                <table className="ledger">
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <b>{e.name}</b>{' '}
                          <span className="note">
                            {e.status?.toUpperCase()} · {fmt(e.sold)}/{fmt(e.capacity)} sold
                          </span>
                        </td>
                        <td>{money(e.revenue, e.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* ── Per-event filter (drives ?eventId=) ── */}
          {!summaryLoading && !summaryError && events.length > 0 ? (
            <div className="chips" role="tablist" aria-label="Filter orders by event">
              <button
                className={'chip' + (eventId === '' ? ' on' : '')}
                onClick={() => onFilter('')}
                aria-pressed={eventId === ''}
              >
                ALL EVENTS
              </button>
              {events.map((e) => (
                <button
                  key={e.id}
                  className={'chip' + (eventId === e.id ? ' on' : '')}
                  onClick={() => onFilter(e.id)}
                  aria-pressed={eventId === e.id}
                >
                  {e.name.toUpperCase()}
                </button>
              ))}
            </div>
          ) : null}

          {/* ── Orders / sales table (from /api/org/orders) ── */}
          <div className="box" style={{ padding: '6px 20px 16px' }}>
            <div className="table-scroll">
              <table className="ptable">
                <thead>
                  <tr>
                    <th>ORDER</th>
                    <th>EVENT</th>
                    <th>TIER × QTY</th>
                    <th>AMOUNT</th>
                    <th>STATUS</th>
                    <th>BUYER</th>
                    <th>PASSES ISSUED</th>
                    <th>PLACED</th>
                  </tr>
                </thead>
                <tbody>
                  {ordersLoading && !orders ? (
                    <tr>
                      <td colSpan={8} className="cell-state">
                        Loading orders…
                      </td>
                    </tr>
                  ) : ordersError ? (
                    <tr>
                      <td colSpan={8} className="cell-state">
                        Could not load orders.{' '}
                        <button className="linkbtn" onClick={() => loadOrders(eventId, limit)}>
                          Retry
                        </button>
                      </td>
                    </tr>
                  ) : orders && orders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="cell-state">
                        No sales yet{selectedEvent ? ` for ${selectedEvent.name}` : ''}. Orders appear
                        here the moment a buyer checks out.
                      </td>
                    </tr>
                  ) : (
                    (orders ?? []).map((o) => {
                      const tone = statusTone(o.status);
                      return (
                        <tr key={o.orderId}>
                          <td className="mono">{o.orderId}</td>
                          <td>{o.eventName}</td>
                          <td className="mono">
                            {o.tier} × {fmt(o.qty)}
                          </td>
                          <td className="mono">{money(o.amount, o.currency)}</td>
                          <td>
                            <span className={'seg ' + tone}>{(o.status || '—').toUpperCase()}</span>
                          </td>
                          <td className="mono buyer">
                            {o.buyerMasked?.phone ? <span>{o.buyerMasked.phone}</span> : null}
                            {o.buyerMasked?.email ? <span>{o.buyerMasked.email}</span> : null}
                            {!o.buyerMasked?.phone && !o.buyerMasked?.email ? <span>—</span> : null}
                          </td>
                          <td className="mono">
                            {o.credentials && o.credentials.length > 0 ? (
                              <span className="creds">
                                {o.credentials.map((ref) => (
                                  <span className="cred" key={ref}>
                                    {ref}
                                  </span>
                                ))}
                              </span>
                            ) : (
                              <span className="note">none</span>
                            )}
                          </td>
                          <td className="mono note">{fmtWhen(o.createdAt)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {orders && orders.length > 0 ? (
              <div className="table-foot">
                <span className="mono note">
                  SHOWING {fmt(orders.length)} ORDER{orders.length === 1 ? '' : 'S'} · {fmt(shownPaid)}{' '}
                  PAID
                </span>
                {hasMore ? (
                  <button
                    className="btn ghost"
                    onClick={() => setLimit((l) => Math.min(l + PAGE_SIZE, MAX_LIMIT))}
                    disabled={ordersLoading}
                  >
                    {ordersLoading ? 'LOADING…' : 'LOAD MORE'}
                  </button>
                ) : orders.length >= MAX_LIMIT ? (
                  <span className="mono note">MAX {fmt(MAX_LIMIT)} SHOWN — FILTER BY EVENT TO NARROW</span>
                ) : null}
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </>
  );
}

// Scoped control-room palette — the same token vocabulary as the organizer
// dashboard (dashboard/page.tsx) so /dashboard/sales reads as one surface.
const STYLE = `
.zora-sales{--paper:#F4F1EA;--card:#FBF9F4;--ink:#0A0A0B;--hair:#DDD8CB;--mut:#8A877E;--blue:#3D5AFE;--bluewash:#E8EBFE;--amber:#854F0B;--amberwash:#FAEEDA;--red:#8f2a1b;--redwash:#FBEAE7;--sans:'Archivo',system-ui,sans-serif;--mono:'IBM Plex Mono',monospace;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased;min-height:100vh}
.zora-sales *{margin:0;padding:0;box-sizing:border-box}
.zora-sales a{color:inherit;text-decoration:none}
.zora-sales a:hover{color:var(--blue)}
.zora-sales .mono{font-family:var(--mono)}
.zora-sales ::selection{background:var(--blue);color:#fff}
.zora-sales main{padding:34px 40px 80px;max-width:1100px;margin:0 auto}
@media(max-width:820px){.zora-sales main{padding:24px 18px 60px}}
.zora-sales .crumb{font-family:var(--mono);font-size:10.5px;letter-spacing:.3em;color:var(--mut);margin-bottom:8px}
.zora-sales h1{font-size:26px;font-weight:600;letter-spacing:-.02em;margin-bottom:4px}
.zora-sales .sub{color:var(--mut);font-size:13.5px;margin-bottom:30px;max-width:640px}
.zora-sales .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:22px}
.zora-sales .card{background:var(--card);border:1px solid var(--hair);border-radius:10px;padding:18px 20px}
.zora-sales .card .k{font-family:var(--mono);font-size:10px;letter-spacing:.22em;color:var(--mut)}
.zora-sales .card .v{font-family:var(--mono);font-size:26px;font-weight:500;margin-top:8px;letter-spacing:-.01em}
.zora-sales .card .v small{font-size:13px;color:var(--mut)}
.zora-sales .card .v.blue{color:var(--blue)}
.zora-sales .card .d{font-size:12px;color:var(--mut);margin-top:6px}
.zora-sales .card.skeleton .v,.zora-sales .card.skeleton .k{background:var(--hair);border-radius:5px;color:transparent;animation:pulse 1.6s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.zora-sales .box{background:var(--card);border:1px solid var(--hair);border-radius:10px;padding:22px 24px}
.zora-sales .box .bh{font-family:var(--mono);font-size:10px;letter-spacing:.25em;color:var(--mut);margin-bottom:16px}
.zora-sales .ledger{width:100%;border-collapse:collapse}
.zora-sales .ledger td{padding:12px 4px;border-bottom:1px solid var(--hair);font-size:13.5px}
.zora-sales .ledger tr:last-child td{border-bottom:none}
.zora-sales .ledger td:last-child{text-align:right;font-family:var(--mono);font-size:14px;white-space:nowrap}
.zora-sales .ledger .note{color:var(--mut);font-size:11.5px;font-family:var(--mono);letter-spacing:.04em}
.zora-sales .chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.zora-sales .chip{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;padding:8px 16px;border-radius:99px;border:1px solid var(--hair);background:none;color:var(--mut);cursor:pointer}
.zora-sales .chip:hover{color:var(--ink);border-color:var(--mut)}
.zora-sales .chip.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.zora-sales .ptable{width:100%;border-collapse:collapse;font-size:13px}
.zora-sales .ptable th{font-family:var(--mono);font-size:9.5px;letter-spacing:.22em;color:var(--mut);text-align:left;padding:12px 8px;border-bottom:1px solid var(--hair);white-space:nowrap}
.zora-sales .ptable td{padding:13px 8px;border-bottom:1px solid var(--hair);vertical-align:top}
.zora-sales .ptable td.mono{font-size:12px}
.zora-sales .ptable tr:last-child td{border-bottom:none}
.zora-sales .cell-state{text-align:center;color:var(--mut);font-size:13px;padding:34px 8px}
.zora-sales .buyer{display:flex;flex-direction:column;gap:3px;color:var(--mut)}
.zora-sales .creds{display:flex;flex-direction:column;gap:4px}
.zora-sales .cred{display:inline-block;font-family:var(--mono);font-size:11px;letter-spacing:.04em;background:var(--paper);border:1px solid var(--hair);color:var(--ink);padding:3px 8px;border-radius:6px;width:max-content}
.zora-sales .note{color:var(--mut);font-size:11.5px}
.zora-sales .seg{font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;padding:4px 10px;border-radius:99px;white-space:nowrap;display:inline-block}
.zora-sales .seg.paid{background:var(--bluewash);color:var(--blue)}
.zora-sales .seg.pending{background:var(--amberwash);color:var(--amber)}
.zora-sales .seg.failed{background:var(--redwash);color:var(--red)}
.zora-sales .table-scroll{overflow-x:auto}
.zora-sales .table-foot{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;padding:16px 4px 4px}
.zora-sales .state{background:var(--card);border:1px solid var(--hair);border-radius:10px;padding:26px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:22px}
.zora-sales .state.error{color:var(--mut);font-size:13.5px}
.zora-sales .btn{background:var(--ink);color:var(--paper);border:none;font-family:var(--mono);font-size:11.5px;font-weight:500;letter-spacing:.16em;padding:11px 22px;border-radius:8px;cursor:pointer;transition:background .2s}
.zora-sales .btn:hover{background:var(--blue)}
.zora-sales .btn:disabled{opacity:.5;cursor:default}
.zora-sales .btn.ghost{background:none;border:1px solid var(--hair);color:var(--ink)}
.zora-sales .btn.ghost:hover{border-color:var(--blue);color:var(--blue);background:none}
.zora-sales .linkbtn{background:none;border:none;color:var(--blue);font-family:var(--mono);font-size:12px;cursor:pointer;text-decoration:underline;padding:0}
`;
