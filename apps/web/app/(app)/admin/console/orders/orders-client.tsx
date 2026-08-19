'use client';

/* PR-BS72 · Lane C — super-admin ORDERS & CARTS, on the Control-Room v2 lib.

   Restyles the BS45 orders view onto the CR primitives. Hierarchy (plan "Orders
   & Carts"): ① a filterable table of EVERY state (pending / paid / failed /
   expired) → ② a row → drawer (line items · buyer · payment attempt · issued
   credentials) → ③ search by phone / email / id.

   WIRED (not stubbed): reads the SAME real endpoint the legacy section uses —
   GET /api/admin/orders (shipped BS45; keyset-paged, recent window by default).
   A split (table_share) order has no order_item, so the API returns `seats` and
   the drawer renders those instead of a blank cart (the OV8 trap). */

import { useCallback, useState } from 'react';
import { CrDrawer, DataTable, StatusPill, toneForStatus, type Column } from '@/app/components/cr';
import { adminApi, useAdminResource } from '../../dashboard/admin-kit';
import { AdminConsoleShell } from '../console-shell';

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

const money = (n: number | null, cur: string) => (n == null ? '—' : `${Number(n).toLocaleString('en-US')} ${cur || ''}`.trim());
const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function AdminOrdersClient() {
  const [status, setStatus] = useState('');
  const [event, setEvent] = useState('');
  const [q, setQ] = useState(''); // input
  const [query, setQuery] = useState(''); // committed (on submit) — avoids a fetch per keystroke
  const [open, setOpen] = useState<Order | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (event) qs.set('event', event);
    if (query.trim()) qs.set('q', query.trim());
    qs.set('limit', '25');
    return adminApi<Payload>(`/api/admin/orders?${qs.toString()}`);
  }, [status, event, query]);

  const res = useAdminResource<Payload>(load);
  const orders = res.data?.orders ?? [];
  const filters = res.data?.filters;

  const cols: Column<Order>[] = [
    {
      key: 'who',
      header: 'Buyer',
      primary: true,
      render: (o) => (
        <span>
          {o.buyer?.phone || o.buyer?.email || 'Unknown'}
          {o.buyer?.masked ? (
            <>
              <br />
              <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 11, color: 'var(--cr-mut)' }}>contact hidden (never paid)</span>
            </>
          ) : null}
        </span>
      ),
    },
    { key: 'event', header: 'Event', render: (o) => o.eventName || o.eventId || '—' },
    {
      key: 'status',
      header: 'Status',
      render: (o) => <StatusPill tone={toneForStatus(o.status)} label={o.status + (o.type === 'table_share' ? ' · split' : '')} />,
    },
    { key: 'at', header: 'When', render: (o) => when(o.createdAt) },
    { key: 'total', header: `Total`, numeric: true, render: (o) => money(o.total, o.currency) },
    {
      key: 'act',
      header: '',
      render: (o) => (
        <button type="button" className="cr-btn" onClick={() => setOpen(o)}>
          Open cart
        </button>
      ),
    },
  ];

  return (
    <AdminConsoleShell title="Orders & carts">
      <div className="cr-stack">
        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Every order &amp; cart
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(q);
              }}
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
            >
              <select className="cr-select cr-auto" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {(filters?.statuses ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select className="cr-select cr-auto" aria-label="Filter by event" value={event} onChange={(e) => setEvent(e.target.value)}>
                <option value="">All events</option>
                {(filters?.events ?? []).map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name || ev.id}
                  </option>
                ))}
              </select>
              <input
                className="cr-input cr-auto"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Phone, email or id"
                aria-label="Search orders"
                style={{ minWidth: 180 }}
              />
              <button type="submit" className="cr-btn">
                Search
              </button>
            </form>
          </div>

          <DataTable
            columns={cols}
            rows={orders}
            rowKey={(o) => o.id}
            loading={res.status === 'loading' && !res.loaded}
            error={res.status === 'error' ? res.error : null}
            onRetry={res.reload}
            caption="Orders and carts"
            emptyTitle="No orders match that"
            emptyBody={<span>Widen the filters, or search the number the caller gave you.</span>}
          />

          {res.data?.nextCursor ? (
            <p style={{ marginTop: 12, fontSize: 12, color: 'var(--cr-ink2)' }}>
              Showing the {orders.length} most recent matches — narrow the filters to reach older ones.
            </p>
          ) : null}
        </section>
      </div>

      {open ? <CartDrawer order={open} onClose={() => setOpen(null)} /> : null}
    </AdminConsoleShell>
  );
}

/* The drawer IS the feature: the whole attempted cart in one place. BS73 — now
   built on the shared <CrDrawer> primitive (focus-trap + Esc + scrim + restore-
   focus) instead of a hand-rolled modal; the body is unchanged. */
function CartDrawer({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const isSplit = o.type === 'table_share' || (o.seats?.length ?? 0) > 0;
  const line: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--cr-hair)' };
  return (
    <CrDrawer open onClose={onClose} ariaLabel="Order detail" title={o.eventName || o.eventId || 'Order'} subtitle={o.id}>
      <>
        <div style={{ marginTop: 2, display: 'grid', gap: 2 }}>
          <div style={line}>
            <span style={{ color: 'var(--cr-ink2)' }}>Status</span>
            <StatusPill tone={toneForStatus(o.status)} label={o.status} />
          </div>
          <div style={line}>
            <span style={{ color: 'var(--cr-ink2)' }}>Placed</span>
            <b style={{ fontFamily: 'var(--cr-mono)' }}>{when(o.createdAt)}</b>
          </div>
          <div style={line}>
            <span style={{ color: 'var(--cr-ink2)' }}>Total</span>
            <b style={{ fontFamily: 'var(--cr-mono)' }}>{money(o.total, o.currency)}</b>
          </div>
          <div style={line}>
            <span style={{ color: 'var(--cr-ink2)' }}>Buyer</span>
            <b style={{ textAlign: 'right' }}>
              {o.buyer?.masked
                ? 'Hidden — never paid'
                : `${o.buyer?.phone || '—'}${o.buyer?.email ? ` · ${o.buyer.email}` : ''}`}
            </b>
          </div>
          <div style={line}>
            <span style={{ color: 'var(--cr-ink2)' }}>Payment</span>
            <b style={{ fontFamily: 'var(--cr-mono)', textAlign: 'right' }}>
              {o.attempt?.method || 'no attempt'}
              {o.attempt?.fspId ? ` · ${o.attempt.fspId}` : ''}
              {o.attempt?.reference ? ` · ${o.attempt.reference}` : ''}
            </b>
          </div>
        </div>

        <h4 style={{ margin: '18px 0 6px', fontFamily: 'var(--cr-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--cr-mut)' }}>
          {isSplit ? 'TABLE SEATS' : 'ITEMS'}
        </h4>
        {isSplit ? (
          (o.seats ?? []).length === 0 ? (
            <p style={{ color: 'var(--cr-ink2)', fontSize: 13 }}>No seats on this table yet.</p>
          ) : (
            <div>
              {(o.seats ?? []).map((s) => (
                <div key={s.shareIndex} style={line}>
                  <span>
                    Seat {s.shareIndex + 1}
                    {s.payerName ? ` · ${s.payerName}` : ''}
                  </span>
                  <span style={{ fontFamily: 'var(--cr-mono)', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                    {money(s.amount, o.currency)}
                    <StatusPill tone={toneForStatus(s.state)} label={s.state} />
                  </span>
                </div>
              ))}
            </div>
          )
        ) : o.lines.length === 0 ? (
          <p style={{ color: 'var(--cr-ink2)', fontSize: 13 }}>No line items on this order.</p>
        ) : (
          <div>
            {o.lines.map((l, i) => (
              <div key={i} style={line}>
                <span>
                  {l.quantity} × {l.tierName || 'Ticket'}
                </span>
                <span style={{ fontFamily: 'var(--cr-mono)' }}>{money(l.unitPrice * l.quantity, o.currency)}</span>
              </div>
            ))}
          </div>
        )}

        {(o.credentials?.length ?? 0) > 0 ? (
          <>
            <h4 style={{ margin: '18px 0 6px', fontFamily: 'var(--cr-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--cr-mut)' }}>
              PASSES ISSUED
            </h4>
            <div>
              {(o.credentials ?? []).map((c, i) => (
                <div key={i} style={line}>
                  <span style={{ fontFamily: 'var(--cr-mono)' }}>{c.publicRef || '—'}</span>
                  <StatusPill tone={toneForStatus(c.state === 'issued' ? 'paid' : c.state)} label={c.state} />
                </div>
              ))}
            </div>
          </>
        ) : null}
      </>
    </CrDrawer>
  );
}
