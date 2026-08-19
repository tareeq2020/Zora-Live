'use client';

/* BS71 · Lane B — the organizer SALES view, ported onto the Control-Room v2
   component library (Lane A · BS69). Replaces the imperative dark-only
   `sales-client.tsx` scoped-`<style>` surface with idiomatic CR primitives
   (<CrShell>, KPIRow/KPITile, DataTable→cards, StatusPill) so it is fully
   light/dark theme-aware and responsive (table→cards + drawer) for free.

   DATA IS UNCHANGED — this is a re-skin/port, not a data change. It reads the
   SAME real, org-scoped endpoints the legacy surface did:
     GET /api/org/summary            → header KPIs + per-event ledger + filters
     GET /api/org/orders?…&cursor=   → the paginated orders table
     GET /api/org/events             → tier options for the filter
     POST /api/org/orders/:id/resend · /api/org/events/:id/resend-all
   The legacy `sales-client.tsx` is kept in-tree (strangler-fig) for parity /
   rollback until this passes its parity check. */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CrShell,
  KPIRow,
  KPITile,
  DataTable,
  StatusPill,
  toneForStatus,
  type Column,
} from '@/app/components/cr';
import { ORG_NAV } from '../components/org-nav';
import '../components/org-surfaces.css';

const ORG_BRAND = { name: (<>z<span className="cr-o">o</span>ra</>), sublabel: 'Organizer' };
import SplitsWorklist from './splits-worklist';

// ── Response types (local, from the API contract — do NOT invent backend) ──
type Totals = {
  revenue: number; netRevenue?: number; commissionRate?: number; sold: number; orders: number; currency: string;
  archivedRevenue?: number; archivedNetRevenue?: number; archivedSold?: number; archivedOrders?: number;
};
type SummaryEvent = { id: string; name: string; status: string; sold: number; capacity: number; revenue: number; netRevenue?: number; currency: string };
type Summary = { totals: Totals; events: SummaryEvent[] };
type OrderRow = {
  orderId: string; eventId: string; eventName: string; tier: string; qty: number; amount: number; currency: string;
  status: string; buyer: { phone?: string; email?: string }; credentials: string[]; createdAt: string;
};
type EventMeta = { id: string; name: string; tiers?: { tierId?: string; name: string }[] };

const PAGE_SIZE = 50;
const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
];

const fmt = (n: number) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US') : '—');
const money = (n: number, cur?: string) => `${fmt(n)}${cur ? ' ' + cur : ''}`;
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso || '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function SalesCr() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);

  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [eventId, setEventId] = useState('');
  const [tier, setTier] = useState('');
  const [status, setStatus] = useState('all');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [eventsMeta, setEventsMeta] = useState<EventMeta[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

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

  const buildParams = useCallback((cursor: string | null) => {
    const p = new URLSearchParams();
    if (eventId) p.set('eventId', eventId);
    if (tier) p.set('tier', tier);
    if (status && status !== 'all') p.set('status', status);
    if (q) p.set('q', q);
    if (from) p.set('from', new Date(from + 'T00:00:00').toISOString());
    if (to) p.set('to', new Date(to + 'T23:59:59').toISOString());
    p.set('limit', String(PAGE_SIZE));
    if (cursor) p.set('cursor', cursor);
    return p.toString();
  }, [eventId, tier, status, q, from, to]);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersError(false);
    try {
      const res = await fetch(`/api/org/orders?${buildParams(null)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rows: OrderRow[]; nextCursor: string | null };
      setOrders(data.rows ?? []);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      setOrdersError(true);
      setOrders(null);
      setNextCursor(null);
    } finally {
      setOrdersLoading(false);
    }
  }, [buildParams]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/org/orders?${buildParams(nextCursor)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rows: OrderRow[]; nextCursor: string | null };
      setOrders((prev) => [...(prev ?? []), ...(data.rows ?? [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      /* keep what we have; cursor unchanged so the user can retry */
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, buildParams]);

  useEffect(() => {
    loadSummary();
    fetch('/api/org/events', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setEventsMeta(Array.isArray(d) ? (d as EventMeta[]) : []))
      .catch(() => setEventsMeta([]));
  }, [loadSummary]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  function onEvent(evId: string) {
    setEventId(evId);
    setTier('');
  }
  function clearFilters() {
    setEventId(''); setTier(''); setStatus('all'); setQInput(''); setQ(''); setFrom(''); setTo('');
  }

  // Resend a single order's tickets.
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendMsg, setResendMsg] = useState<{ id: string; kind: 'ok' | 'err'; text: string } | null>(null);
  async function resendOne(orderId: string) {
    if (resendingId) return;
    setResendingId(orderId);
    setResendMsg(null);
    try {
      const res = await fetch(`/api/org/orders/${encodeURIComponent(orderId)}/resend`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) throw new Error('Order not found.');
      if (data?.ok === false) throw new Error(data.reason === 'not_paid' ? 'Only paid orders can be resent.' : 'Resend failed.');
      const sms = data?.result?.sms as string | undefined;
      const note = sms === 'dev' ? ' (SMS gateway not live — logged only)' : '';
      setResendMsg({ id: orderId, kind: 'ok', text: `Resent to buyer.${note}` });
    } catch (e) {
      setResendMsg({ id: orderId, kind: 'err', text: (e as Error).message });
    } finally {
      setResendingId(null);
    }
  }

  const [bulkResending, setBulkResending] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  async function resendAll() {
    if (!selectedEvent || bulkResending) return;
    if (!window.confirm(`Resend tickets to every paid buyer of "${selectedEvent.name}"?`)) return;
    setBulkResending(true);
    setBulkMsg(null);
    try {
      const res = await fetch(`/api/org/events/${encodeURIComponent(selectedEvent.id)}/resend-all`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const devNote = d.dev ? ` · ${d.dev} logged only (SMS gateway not live)` : '';
      const capNote = d.capped ? ` · capped at ${d.total} — run again for the rest` : '';
      setBulkMsg({ kind: 'ok', text: `Resent ${d.sent}/${d.total} paid orders${devNote}${capNote}.` });
    } catch (e) {
      setBulkMsg({ kind: 'err', text: `Bulk resend failed — ${(e as Error).message}.` });
    } finally {
      setBulkResending(false);
    }
  }

  const totals = summary?.totals;
  const events = summary?.events ?? [];
  const selectedEvent = eventId ? events.find((e) => e.id === eventId) : null;
  const tierOptions = eventId ? (eventsMeta.find((e) => e.id === eventId)?.tiers ?? []) : [];
  const filtersActive = !!(eventId || tier || (status && status !== 'all') || q || from || to);
  const hasMore = !!nextCursor;
  const shownPaid = orders ? orders.filter((o) => (o.status || '').toLowerCase() === 'paid').length : 0;

  const orderCols: Column<OrderRow>[] = [
    { key: 'orderId', header: 'Order', primary: true, render: (o) => o.orderId },
    { key: 'event', header: 'Event', render: (o) => o.eventName },
    { key: 'tier', header: 'Tier × Qty', render: (o) => `${o.tier} × ${fmt(o.qty)}` },
    { key: 'amount', header: 'Amount', numeric: true, render: (o) => money(o.amount, o.currency) },
    { key: 'status', header: 'Status', render: (o) => <StatusPill tone={toneForStatus(o.status)} label={o.status || '—'} /> },
    {
      key: 'buyer',
      header: 'Buyer',
      render: (o) => (
        <span className="org-stack-xs org-muted">
          {o.buyer?.phone ? <span>{o.buyer.phone}</span> : null}
          {o.buyer?.email ? <span>{o.buyer.email}</span> : null}
          {!o.buyer?.phone && !o.buyer?.email ? <span>—</span> : null}
        </span>
      ),
    },
    {
      key: 'passes',
      header: 'Passes issued',
      render: (o) =>
        o.credentials && o.credentials.length > 0 ? (
          <span className="org-stack-xs">
            {o.credentials.map((ref) => (
              <span className="org-cred" key={ref}>{ref}</span>
            ))}
          </span>
        ) : (
          <span className="org-muted">none</span>
        ),
    },
    { key: 'placed', header: 'Placed', render: (o) => <span className="org-muted">{fmtWhen(o.createdAt)}</span> },
    {
      key: 'actions',
      header: 'Actions',
      render: (o) =>
        (o.status || '').toLowerCase() === 'paid' ? (
          <>
            <button className="cr-linkbtn" onClick={() => resendOne(o.orderId)} disabled={resendingId === o.orderId}>
              {resendingId === o.orderId ? 'RESENDING…' : 'RESEND'}
            </button>
            {resendMsg && resendMsg.id === o.orderId ? (
              <span className="org-muted" style={{ marginLeft: 6, color: resendMsg.kind === 'ok' ? 'var(--cr-green)' : 'var(--cr-red)' }}>
                {resendMsg.text}
              </span>
            ) : null}
          </>
        ) : (
          <span className="org-muted">—</span>
        ),
    },
  ];

  const eventCols: Column<SummaryEvent>[] = [
    {
      key: 'name',
      header: 'Event',
      primary: true,
      render: (e) => (
        <span>
          <b>{e.name}</b> <span className="org-muted">{e.status?.toUpperCase()} · {fmt(e.sold)}/{fmt(e.capacity)} sold</span>
        </span>
      ),
    },
    { key: 'net', header: 'Net earnings', numeric: true, render: (e) => `${money(e.netRevenue ?? e.revenue, e.currency)} net` },
  ];

  return (
    <CrShell
      nav={ORG_NAV}
      brand={ORG_BRAND}
      topbarTitle="Sales"
      topbarExtra={<span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: 'var(--cr-ink2)' }}>Your side of the counter</span>}
      footer={<><a href="/dashboard/onboarding">GET STARTED</a> &middot; <a href="/">ZORA.COM</a></>}
    >
      <div className="cr-stack">
        <div>
          <p className="org-crumb"><Link href="/dashboard/overview">DASHBOARD</Link> / SALES</p>
          <h1 className="org-h1">Sales</h1>
          <p className="org-sub">
            Every order and the passes it issued, from your side of the counter. Revenue counts paid
            orders only — the same honest number your buyers see.
          </p>
        </div>

        <SplitsWorklist />

        {/* ① KPI header — net earnings first (money rule 4b) */}
        {summaryError ? (
          <div className="cr-error" role="alert">
            <strong>Couldn&apos;t load your sales summary</strong>
            <div style={{ marginTop: 8 }}>
              <button className="cr-linkbtn" onClick={loadSummary}>RETRY</button>
            </div>
          </div>
        ) : (
          <KPIRow>
            <KPITile
              label={selectedEvent ? 'Event net earnings' : 'Net earnings'}
              tint="blue"
              loading={summaryLoading}
              value={
                totals
                  ? fmt(selectedEvent ? (selectedEvent.netRevenue ?? selectedEvent.revenue) : (totals.netRevenue ?? totals.revenue))
                  : null
              }
              unit={selectedEvent ? selectedEvent.currency : totals?.currency}
            />
            <KPITile
              label="Passes sold"
              tint="cyan"
              loading={summaryLoading}
              value={totals ? fmt(selectedEvent ? selectedEvent.sold : totals.sold) : null}
            />
            <KPITile
              label="Orders"
              tint="neutral"
              loading={summaryLoading}
              value={totals ? fmt(totals.orders) : null}
            />
          </KPIRow>
        )}

        {totals && !selectedEvent && (totals.archivedRevenue ?? 0) > 0 ? (
          <p className="org-muted" style={{ marginTop: -8 }}>
            Not counted above: {money(totals.archivedNetRevenue ?? totals.archivedRevenue ?? 0, totals.currency)} net
            from {fmt(totals.archivedOrders ?? 0)} order{(totals.archivedOrders ?? 0) === 1 ? '' : 's'} across archived
            events. Still included in your payout balance.
          </p>
        ) : null}

        {/* ② per-event net-earnings ledger */}
        {!summaryLoading && !summaryError && events.length > 0 ? (
          <section className="cr-panel">
            <div className="cr-panel-head"><h2 className="cr-section-h">Net earnings by event</h2></div>
            <table className="org-ledger">
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{eventCols[0].render(e)}</td>
                    <td>{eventCols[1].render(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {/* Event filter chips */}
        {!summaryLoading && !summaryError && events.length > 0 ? (
          <div className="org-chips" role="tablist" aria-label="Filter orders by event">
            <button className={'org-chip' + (eventId === '' ? ' on' : '')} onClick={() => onEvent('')} aria-pressed={eventId === ''}>All events</button>
            {events.map((e) => (
              <button key={e.id} className={'org-chip' + (eventId === e.id ? ' on' : '')} onClick={() => onEvent(e.id)} aria-pressed={eventId === e.id}>
                {e.name}
              </button>
            ))}
          </div>
        ) : null}

        {/* ③ orders table + filters */}
        <section className="cr-panel">
          <div className="cr-panel-head"><h2 className="cr-section-h">Orders</h2></div>
          <div className="org-filters">
            <input
              type="search"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Search phone, email or ticket code"
              aria-label="Search orders"
              className="org-input"
              style={{ flex: '1 1 240px', minWidth: 200 }}
            />
            {eventId ? (
              <select className="org-input" value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Filter by tier">
                <option value="">All tiers</option>
                {tierOptions.map((t) => (
                  <option key={t.tierId ?? t.name} value={t.tierId ?? ''}>{t.name}</option>
                ))}
              </select>
            ) : null}
            <div className="org-seg" role="group" aria-label="Filter by status">
              {STATUS_FILTERS.map((s) => (
                <button key={s.value} className={status === s.value ? 'on' : ''} onClick={() => setStatus(s.value)} aria-pressed={status === s.value}>
                  {s.label}
                </button>
              ))}
            </div>
            <label className="org-date">From <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="org-input" /></label>
            <label className="org-date">To <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="org-input" /></label>
            {filtersActive ? <button className="org-chip" onClick={clearFilters}>Clear</button> : null}
          </div>

          <DataTable
            columns={orderCols}
            rows={orders ?? []}
            rowKey={(o) => o.orderId}
            loading={ordersLoading && !orders}
            error={ordersError ? 'Could not load orders.' : null}
            onRetry={loadOrders}
            caption="Orders"
            emptyTitle={filtersActive ? 'No orders match these filters' : `No sales yet${selectedEvent ? ` for ${selectedEvent.name}` : ''}`}
            emptyBody={
              filtersActive ? (
                <button className="cr-linkbtn" onClick={clearFilters}>CLEAR FILTERS</button>
              ) : (
                <span>Share your storefront — orders appear here the moment a buyer checks out.</span>
              )
            }
          />

          {orders && orders.length > 0 ? (
            <div className="org-table-foot">
              <span className="org-foot-note">SHOWING {fmt(orders.length)} ORDER{orders.length === 1 ? '' : 'S'} · {fmt(shownPaid)} PAID</span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {selectedEvent ? (
                  <button className="org-btn ghost" onClick={resendAll} disabled={bulkResending}>
                    {bulkResending ? 'RESENDING…' : 'RESEND ALL TICKETS'}
                  </button>
                ) : null}
                {hasMore ? (
                  <button className="org-btn ghost" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? 'LOADING…' : 'LOAD MORE'}
                  </button>
                ) : null}
              </span>
            </div>
          ) : null}
          {bulkMsg ? (
            <p className={'org-alert ' + (bulkMsg.kind === 'ok' ? 'ok' : 'err')}>{bulkMsg.text}</p>
          ) : null}
        </section>
      </div>
    </CrShell>
  );
}
