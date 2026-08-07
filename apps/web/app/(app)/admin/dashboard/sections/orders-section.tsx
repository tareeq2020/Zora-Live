'use client';

/* PR-BS45 (#3) — ORDERS & CARTS. Replaces the BS36 placeholder.

   Support gets asked about the order someone TRIED to make, and every other
   order read in the product is paid-only, so those calls were unanswerable.
   This view is the opposite: every state (pending, failed, expired, short-paid)
   with its line items, buyer, payment attempt and any credentials issued.

   Two traps this screen exists to avoid, both proven in db/test/admin-orders.e2e.sh:
     · a split (`table_share`) order has NO order_item, so an item-only query
       renders a BLANK cart for exactly the orders support asks about (OV8). The
       API returns `seats` for those, and the drawer shows them.
     · reading every state is unbounded, so the API pages by keyset and applies a
       recent window by default (PERF-1) — this UI never asks for "everything". */

import { useCallback, useState } from 'react';
import { AdminCard, AdminTable, adminApi, useAdminResource } from '../admin-kit';

type Line = { tierName: string | null; quantity: number; unitPrice: number };
type Seat = { shareIndex: number; state: string; amount: number; payerName: string | null };
type Cred = { publicRef: string | null; state: string };
type Order = {
  id: string;
  status: string;
  type: string | null;
  createdAt: string;
  currency: string;
  total: number | null;
  eventId: string | null;
  eventName: string | null;
  organizerHandle: string | null;
  buyer: { phone: string | null; email: string | null; masked?: boolean } | null;
  attempt: { method: string | null; fspId: string | null; reference: string | null } | null;
  lines: Line[];
  seats?: Seat[];
  credentials?: Cred[];
};
type Filters = { statuses?: string[]; events?: { id: string; name: string }[] };
type Payload = { orders: Order[]; nextCursor?: string | null; filters?: Filters };

const money = (n: number | null, cur: string) =>
  n == null ? '—' : `${Number(n).toLocaleString('en-US')} ${cur || ''}`.trim();
const when = (iso: string) =>
  new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// `paid` is the only revenue-bearing state; everything else is a story, not money.
const tone = (s: string) => (s === 'paid' ? 'approved' : s === 'pending' || s.startsWith('paid_') ? 'warn' : 'rejected');

export function OrdersSection() {
  const [status, setStatus] = useState('');
  const [event, setEvent] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Order | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (event) qs.set('event', event);
    if (q.trim()) qs.set('q', q.trim());
    qs.set('limit', '25');
    return adminApi<Payload>(`/api/admin/orders?${qs.toString()}`);
  }, [status, event, q]);

  const res = useAdminResource<Payload>(load);
  const orders = res.data?.orders ?? [];
  const filters = res.data?.filters;

  return (
    <>
      <AdminCard
        title="ORDERS & CARTS"
        subtitle="Every order in every state — including carts that never paid. Recent window by default; search by phone, email or order id."
        actions={
          <>
            <select className="mini" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">All statuses</option>
              {(filters?.statuses ?? []).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select className="mini" value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Event">
              <option value="">All events</option>
              {(filters?.events ?? []).map((e) => (
                <option key={e.id} value={e.id}>{e.name || e.id}</option>
              ))}
            </select>
            <input
              className="mini"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Phone, email or id"
              aria-label="Search orders"
            />
          </>
        }
        flush
      >
        <AdminTable<Order>
          resource={res}
          rows={orders}
          rowKey={(o) => o.id}
          empty="No orders match that."
          emptySub="Widen the filters, or search the number the caller gave you."
          columns={[
            {
              key: 'who',
              label: 'BUYER',
              render: (o) => (
                <>
                  <b>{o.buyer?.phone || o.buyer?.email || 'Unknown'}</b>
                  {o.buyer?.masked ? <div className="sub">contact hidden (never paid)</div> : null}
                </>
              ),
            },
            { key: 'event', label: 'EVENT', render: (o) => o.eventName || o.eventId || '—' },
            {
              key: 'status',
              label: 'STATUS',
              render: (o) => (
                <span className={'pill ' + tone(o.status)}>
                  {o.status}{o.type === 'table_share' ? ' · split' : ''}
                </span>
              ),
            },
            { key: 'total', label: 'TOTAL', render: (o) => <span className="mono">{money(o.total, o.currency)}</span> },
            { key: 'at', label: 'WHEN', render: (o) => <span className="mono">{when(o.createdAt)}</span> },
            {
              key: 'act',
              label: '',
              actions: true,
              render: (o) => (
                <button type="button" className="btn small" onClick={() => setOpen(o)}>
                  Open cart
                </button>
              ),
            },
          ]}
        />
        {res.data?.nextCursor ? (
          <p className="hint" style={{ padding: '12px 16px 0' }}>
            Showing the {orders.length} most recent matches — narrow the filters to reach older ones.
          </p>
        ) : null}
      </AdminCard>

      {open ? <CartDrawer order={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/* The drawer IS the feature: the whole attempted cart in one place. */
function CartDrawer({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const isSplit = o.type === 'table_share' || (o.seats?.length ?? 0) > 0;
  return (
    <div
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Order detail"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-sheet">
        <button type="button" className="drawer-close" aria-label="Close" onClick={onClose}>×</button>
        <h3>{o.eventName || o.eventId || 'Order'}</h3>
        <p className="mono sub">{o.id}</p>

        <div className="kyc-meta">
          <div><span>STATUS</span><b><span className={'pill ' + tone(o.status)}>{o.status}</span></b></div>
          <div><span>PLACED</span><b className="mono">{when(o.createdAt)}</b></div>
          <div><span>TOTAL</span><b className="mono">{money(o.total, o.currency)}</b></div>
          <div>
            <span>BUYER</span>
            <b>
              {o.buyer?.masked
                ? 'Hidden — never paid, past the contact window'
                : `${o.buyer?.phone || '—'}${o.buyer?.email ? ` · ${o.buyer.email}` : ''}`}
            </b>
          </div>
          <div>
            <span>PAYMENT</span>
            <b className="mono">
              {o.attempt?.method || 'no attempt'}
              {o.attempt?.fspId ? ` · ${o.attempt.fspId}` : ''}
              {o.attempt?.reference ? ` · ${o.attempt.reference}` : ''}
            </b>
          </div>
        </div>

        <h4 className="sub" style={{ marginTop: 18 }}>{isSplit ? 'TABLE SEATS' : 'ITEMS'}</h4>
        {isSplit ? (
          (o.seats ?? []).length === 0 ? (
            <p className="sub">No seats on this table yet.</p>
          ) : (
            <ul className="cart-lines">
              {(o.seats ?? []).map((s) => (
                <li key={s.shareIndex}>
                  <span>Seat {s.shareIndex + 1}{s.payerName ? ` · ${s.payerName}` : ''}</span>
                  <span className="mono">
                    {money(s.amount, o.currency)}{' '}
                    <span className={'pill ' + (s.state === 'paid' ? 'approved' : 'warn')}>{s.state}</span>
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : o.lines.length === 0 ? (
          <p className="sub">No line items on this order.</p>
        ) : (
          <ul className="cart-lines">
            {o.lines.map((l, i) => (
              <li key={i}>
                <span>{l.quantity} × {l.tierName || 'Ticket'}</span>
                <span className="mono">{money(l.unitPrice * l.quantity, o.currency)}</span>
              </li>
            ))}
          </ul>
        )}

        {(o.credentials?.length ?? 0) > 0 ? (
          <>
            <h4 className="sub" style={{ marginTop: 18 }}>PASSES ISSUED</h4>
            <ul className="cart-lines">
              {(o.credentials ?? []).map((c, i) => (
                <li key={i}>
                  <span className="mono">{c.publicRef || '—'}</span>
                  <span className={'pill ' + (c.state === 'issued' ? 'approved' : 'warn')}>{c.state}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
