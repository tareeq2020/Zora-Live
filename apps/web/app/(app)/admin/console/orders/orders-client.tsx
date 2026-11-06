'use client';

/* Super-admin ORDERS & CARTS (BS72 on the CR lib; BS153 funnel + detail page).

   ① A funnel strip: views → checkout opened → carts → payment started → gateway
     accepted → paid → passes delivered → checked in, with the drop between each
     (GET /api/admin/funnel). Pre-cart stages are aggregate counts, never people.
   ② Every order in every state (GET /api/admin/orders): the Payment column shows
     the REAL latest attempt (method · status · short error), and a chip says how
     far the cart got. Each row opens /admin/console/orders/<id>, the full detail.

   BS153 fixed the "no attempt" bug: the API returns `attempts[]` /
   `latestAttempt`, the old client read a singular `attempt` that never existed.

   BS157: each row leads with its cart OUTCOME (paid after retry, recovered in
   another cart, system error, buyer didn't complete…), raw status small beneath.
   The funnel's "why carts didn't pay" counts outcomes; each count filters the list. */

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { DataTable, StatusPill, toneForStatus, type Column } from '@/app/components/cr';
import { adminApi, useAdminResource } from '../admin-kit';
import { AdminConsoleShell } from '../console-shell';
import { STAGE_LABEL, attemptLine, money, stageTone, when, OUTCOME_ORDER, outcomeText, outcomeTone } from './order-format';

type Attempt = { method: string | null; status: string; error: string | null; at: string };
type Order = {
  id: string;
  status: string;
  type: string | null;
  createdAt: string;
  currency: string;
  targetValue: number;
  cartValue: number;
  eventId: string | null;
  eventName: string | null;
  organizerName: string | null;
  buyer: { name: string | null; phone: string | null; email: string | null } | null;
  piiRedacted: boolean;
  stageReached: string;
  latestAttempt: Attempt | null;
  outcome?: string;
  outcomeDetail?: string | null;
  recoveredBy?: string | null;
};
type Filters = {
  statuses: string[];
  outcomes?: { id: string; label: string }[];
  events: { id: string; name: string | null; organizerHandle: string | null }[];
  organizers: { handle: string; name: string }[];
};
type Payload = { orders: Order[]; nextCursor?: string | null };
type Stage = { stage: string; count: number; fromPrev: number | null; dropPct: number | null };
type Funnel = {
  window: { days: number };
  stages: Stage[];
  unique: { eventVisitors: number; checkoutVisitors: number };
  /** BS157; absent on an API from before it. */
  outcomes?: Record<string, number>;
  outcomeDetails?: Record<string, Record<string, number>>;
  dropoff: {
    topGatewayErrors: { error: string; attempts: number }[];
    expiredNoAttempt: number;
    openNoAttempt: number;
    attemptsTimedOut: number;
    failedAfterPush: number;
    gatewayRejected: number;
    shortPayments: number;
  };
};

const FUNNEL_LABEL: Record<string, string> = {
  event_views: 'Event views',
  checkout_opened: 'Checkout opened',
  carts_created: 'Carts',
  payment_started: 'Payment started',
  gateway_accepted: 'Gateway accepted',
  paid: 'Paid',
  passes_delivered: 'Passes delivered',
  checked_in: 'Checked in',
};

/** Outcomes whose sub-reasons are worth a line in the funnel. */
const SUB_REASON_OUTCOMES = new Set(['buyer_didnt_complete', 'system_error', 'recovered']);
/** "cancelled by buyer", "network/provider problem (not the buyer)", … */
function detailText(outcome: string, detail: string): string {
  if (outcome === 'recovered') return outcomeText(detail).toLowerCase();
  const full = outcomeText(outcome, detail);
  const i = full.indexOf(': ');
  return i >= 0 ? full.slice(i + 2) : detail.replace(/_/g, ' ');
}

const loadFilters = () => adminApi<Filters>('/api/admin/orders/filters');

export default function AdminOrdersClient({ initialOutcome = '' }: { initialOutcome?: string }) {
  const [status, setStatus] = useState('');
  const [outcome, setOutcome] = useState(OUTCOME_ORDER.includes(initialOutcome) ? initialOutcome : '');
  // Set when an outcome is picked from the funnel, so the list uses its window.
  const [listDays, setListDays] = useState<number | null>(null);
  const [event, setEvent] = useState('');
  const [org, setOrg] = useState('');
  const [days, setDays] = useState(7);
  const [q, setQ] = useState(''); // input
  const [query, setQuery] = useState(''); // committed on submit — no fetch per keystroke

  const filters = useAdminResource<Filters>(loadFilters);

  const loadOrders = useCallback(() => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (outcome) qs.set('outcome', outcome);
    if (listDays) qs.set('days', String(listDays));
    if (event) qs.set('event', event);
    if (org) qs.set('organizer', org);
    if (query.trim()) qs.set('q', query.trim());
    qs.set('limit', '50');
    return adminApi<Payload>(`/api/admin/orders?${qs.toString()}`);
  }, [status, outcome, listDays, event, org, query]);
  const res = useAdminResource<Payload>(loadOrders);

  const loadFunnel = useCallback(() => {
    const qs = new URLSearchParams({ days: String(days) });
    if (org) qs.set('org', org);
    if (event) qs.set('event', event);
    return adminApi<Funnel>(`/api/admin/funnel?${qs.toString()}`);
  }, [days, org, event]);
  const funnel = useAdminResource<Funnel>(loadFunnel);

  const orders = res.data?.orders ?? [];
  const events = useMemo(
    () => (filters.data?.events ?? []).filter((e) => !org || String(e.organizerHandle ?? '').toLowerCase() === org.toLowerCase()),
    [filters.data, org],
  );

  const cols: Column<Order>[] = [
    {
      key: 'who',
      header: 'Buyer',
      primary: true,
      render: (o) => (
        <Link href={`/admin/console/orders/${o.id}`} className="ord-link">
          {o.buyer?.phone?.startsWith('comp:') ? `${o.buyer?.name || 'Guest'} · comp` : o.buyer?.phone || o.buyer?.email || 'Unknown'}
          {o.piiRedacted ? <span className="ord-sub">contact hidden (never paid)</span> : null}
        </Link>
      ),
    },
    { key: 'event', header: 'Event', render: (o) => o.eventName || o.eventId || '—' },
    {
      key: 'status',
      header: 'Outcome',
      render: (o) =>
        o.outcome ? (
          <span className="ord-out">
            <span className={`ord-chip ord-chip-${outcomeTone(o.outcome)}`}>{outcomeText(o.outcome, o.outcomeDetail)}</span>
            <span className="ord-raw">
              {o.status}
              {o.type === 'table_share' ? ' · split' : ''}
            </span>
          </span>
        ) : (
          <StatusPill tone={toneForStatus(o.status)} label={o.status + (o.type === 'table_share' ? ' · split' : '')} />
        ),
    },
    {
      key: 'stage',
      header: 'Stage',
      render: (o) => <span className={`ord-chip ord-chip-${stageTone(o.stageReached)}`}>{STAGE_LABEL[o.stageReached] ?? o.stageReached}</span>,
    },
    {
      key: 'pay',
      header: 'Payment',
      render: (o) => (
        <span className={`ord-pay${o.latestAttempt?.error ? ' ord-pay-err' : ''}`} title={o.latestAttempt?.error ?? undefined}>
          {attemptLine(o.latestAttempt)}
        </span>
      ),
    },
    { key: 'at', header: 'When', render: (o) => <span className="ord-mono">{when(o.createdAt)}</span> },
    { key: 'total', header: 'Total', numeric: true, render: (o) => money(o.targetValue || o.cartValue, o.currency) },
    {
      key: 'act',
      header: '',
      render: (o) => (
        <Link href={`/admin/console/orders/${o.id}`} className="cr-btn">
          Open
        </Link>
      ),
    },
  ];

  const f = funnel.data;
  return (
    <AdminConsoleShell title="Orders & carts">
      <div className="cr-stack">
        <section className="cr-panel" aria-label="Cart funnel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Funnel
            </h2>
            <div className="ord-controls">
              <div className="ord-range" role="group" aria-label="Funnel window">
                {[7, 30, 90].map((d) => (
                  <button key={d} type="button" className={`ord-range-b${days === d ? ' is-on' : ''}`} aria-pressed={days === d} onClick={() => setDays(d)}>
                    {d}D
                  </button>
                ))}
              </div>
              <select className="cr-select cr-auto" aria-label="Filter by organizer" value={org} onChange={(e) => { setOrg(e.target.value); setEvent(''); }}>
                <option value="">All organizers</option>
                {(filters.data?.organizers ?? []).map((o) => (
                  <option key={o.handle} value={o.handle}>
                    {o.name || o.handle}
                  </option>
                ))}
              </select>
              <select className="cr-select cr-auto" aria-label="Filter by event" value={event} onChange={(e) => setEvent(e.target.value)}>
                <option value="">All events</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name || ev.id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {funnel.status === 'error' ? (
            <p className="ord-note">Couldn&apos;t load the funnel: {funnel.error}</p>
          ) : !f ? (
            <div className="ord-funnel" aria-busy="true">
              {Object.keys(FUNNEL_LABEL).map((k) => (
                <div key={k} className="ord-stage">
                  <span className="cr-skel" style={{ height: 40, display: 'block' }} />
                </div>
              ))}
            </div>
          ) : (
            <>
              <ol className="ord-funnel">
                {f.stages.map((s, i) => (
                  <li key={s.stage} className={`ord-stage${i < 2 ? ' is-agg' : ''}`}>
                    <span className="ord-stage-k">{FUNNEL_LABEL[s.stage] ?? s.stage}</span>
                    <span className="ord-stage-v">{s.count.toLocaleString('en-US')}</span>
                    <span className="ord-stage-d">
                      {s.dropPct == null ? (i === 0 ? `${f.unique.eventVisitors.toLocaleString('en-US')} unique` : '—') : `−${s.dropPct}%`}
                    </span>
                  </li>
                ))}
              </ol>
              {f.outcomes ? (
                <div className="ord-why" role="group" aria-label="What happened to each cart">
                  <span className="ord-why-h">Why carts didn&apos;t pay · what happened to each cart · {f.window.days}d</span>
                  {OUTCOME_ORDER.map((k) => {
                    const n = f.outcomes?.[k] ?? 0;
                    const on = outcome === k;
                    const subs = Object.entries(f.outcomeDetails?.[k] ?? {}).filter(([, v]) => v > 0);
                    return (
                      <button
                        key={k}
                        type="button"
                        className={`ord-why-b ord-why-${outcomeTone(k)}${on ? ' is-on' : ''}${n === 0 ? ' is-zero' : ''}`}
                        aria-pressed={on}
                        onClick={() => {
                          setOutcome(on ? '' : k);
                          setListDays(on ? null : f.window.days);
                          if (!on) document.getElementById('ord-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                      >
                        <span>
                          <b>{n.toLocaleString('en-US')}</b> {outcomeText(k)}
                        </span>
                        {SUB_REASON_OUTCOMES.has(k) && subs.length ? (
                          <span className="ord-why-sub">
                            {subs.map(([d, v]) => `${v} ${detailText(k, d)}`).join(' · ')}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="ord-why">
                  <span className="ord-why-h">Why carts didn&apos;t pay · {f.window.days}d</span>
                  <span>
                    <b>{f.dropoff.expiredNoAttempt}</b> expired, no payment
                  </span>
                  <span>
                    <b>{f.dropoff.openNoAttempt}</b> open, no payment
                  </span>
                  <span>
                    <b>{f.dropoff.gatewayRejected}</b> refused by gateway
                  </span>
                  <span>
                    <b>{f.dropoff.attemptsTimedOut}</b> timed out
                  </span>
                  <span>
                    <b>{f.dropoff.failedAfterPush}</b> failed after push
                  </span>
                  <span>
                    <b>{f.dropoff.shortPayments}</b> short
                  </span>
                </div>
              )}
              {f.dropoff.topGatewayErrors.length ? (
                <ul className="ord-errors" aria-label="Top gateway errors">
                  {f.dropoff.topGatewayErrors.map((e) => (
                    <li key={e.error}>
                      <b>{e.attempts}×</b> <span>{e.error}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </section>

        <section className="cr-panel" id="ord-list">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Every order &amp; cart
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(q);
              }}
              className="ord-controls"
            >
              <select
                className="cr-select cr-auto"
                aria-label="Filter by outcome"
                value={outcome}
                onChange={(e) => {
                  setOutcome(e.target.value);
                  setListDays(null);
                }}
              >
                <option value="">All outcomes</option>
                {(filters.data?.outcomes ?? OUTCOME_ORDER.map((id) => ({ id, label: outcomeText(id) }))).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
              <select className="cr-select cr-auto" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {(filters.data?.statuses ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                className="cr-input cr-auto"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Phone, email or id"
                aria-label="Search orders"
                style={{ minWidth: 160 }}
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

          {outcome ? (
            <p className="ord-note">
              Showing {outcomeText(outcome).toLowerCase()} carts{listDays ? ` from the last ${listDays} days` : ''}.{' '}
              <button
                type="button"
                className="cr-linkbtn ord-clear"
                onClick={() => {
                  setOutcome('');
                  setListDays(null);
                }}
              >
                Show every outcome
              </button>
            </p>
          ) : null}
          {res.data?.nextCursor ? (
            <p className="ord-note">Showing the {orders.length} most recent matches. Narrow the filters to reach older ones.</p>
          ) : null}
        </section>
      </div>

      <style dangerouslySetInnerHTML={{ __html: ORDERS_CSS }} />
    </AdminConsoleShell>
  );
}

/* Page-level styles only (shared CR primitives are BS154's). Flat, bone/black,
   data in mono, one yellow accent. */
const ORDERS_CSS = `
.ord-controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; min-width: 0; max-width: 100%; }
.ord-controls > * { max-width: 100%; }
@media (max-width: 520px) { .ord-controls select { width: 100%; } }
.ord-range { display: inline-flex; border: 1px solid var(--cr-hair); border-radius: 8px; overflow: hidden; }
.ord-range-b { font: 600 12px/1 var(--cr-mono); letter-spacing: .06em; padding: 0 14px; min-height: 44px; min-width: 52px; background: transparent; color: var(--cr-ink2); border: 0; cursor: pointer; }
.ord-range-b + .ord-range-b { border-left: 1px solid var(--cr-hair); }
.ord-range-b.is-on { background: var(--cr-ink); color: var(--cr-paper); }
.ord-funnel { list-style: none; margin: 14px 0 0; padding: 0; display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); border: 1px solid var(--cr-hair); border-radius: 10px; overflow: hidden; }
.ord-stage { padding: 12px 12px 10px; display: grid; gap: 4px; border-left: 1px solid var(--cr-hair); min-width: 0; }
.ord-stage:first-child { border-left: 0; }
.ord-stage.is-agg { background: var(--cr-card2); }
.ord-stage-k { font: 600 12px/1.2 var(--cr-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--cr-mut); }
.ord-stage-v { font: 600 22px/1.1 var(--cr-mono); color: var(--cr-ink); }
.ord-stage-d { font: 500 12px/1 var(--cr-mono); color: var(--cr-ink2); }
.ord-stage:nth-child(6) .ord-stage-v { box-shadow: inset 0 -4px 0 var(--cr-blue); justify-self: start; }
.ord-why { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 12px; font: 500 12px/1.4 var(--cr-mono); color: var(--cr-ink2); }
.ord-why b { color: var(--cr-ink); }
.ord-why-h { width: 100%; font: 600 12px/1 var(--cr-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--cr-mut); }
.ord-errors { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 4px; }
.ord-errors li { font: 500 12px/1.4 var(--cr-mono); color: var(--cr-ink2); overflow-wrap: anywhere; }
.ord-errors b { color: var(--cr-red); }
.ord-link { color: inherit; text-decoration: none; font-weight: 600; display: inline-flex; flex-direction: column; justify-content: center; min-height: 44px; }
.ord-link:hover { text-decoration: underline; }
.ord-sub { display: block; font: 400 12px/1.3 var(--cr-mono); color: var(--cr-mut); }
.ord-mono { font-family: var(--cr-mono); font-size: 12px; }
.ord-pay { font: 500 12px/1.35 var(--cr-mono); color: var(--cr-ink2); overflow-wrap: anywhere; }
.ord-pay-err { color: var(--cr-red); }
.ord-chip { display: inline-block; font: 600 12px/1 var(--cr-mono); letter-spacing: .06em; text-transform: uppercase; padding: 5px 7px; border-radius: 6px; border: 1px solid var(--cr-hair); color: var(--cr-ink2); white-space: nowrap; }
.ord-chip-good { background: var(--cr-ink); color: var(--cr-paper); border-color: var(--cr-ink); }
.ord-chip-mid { border-color: var(--cr-ink); color: var(--cr-ink); }
.ord-note { margin-top: 12px; font-size: 12px; color: var(--cr-ink2); }
.ord-out { display: inline-grid; gap: 4px; justify-items: start; min-width: 0; max-width: 100%; }
.ord-out .ord-chip { white-space: normal; line-height: 1.25; max-width: 100%; overflow-wrap: anywhere; }
.ord-raw { font: 500 12px/1.2 var(--cr-mono); color: var(--cr-mut); }
.ord-chip-alert { border-color: var(--cr-red); color: var(--cr-red); }
.ord-why-b { display: inline-grid; gap: 2px; font: 500 12px/1.3 var(--cr-mono); color: var(--cr-ink2); background: transparent; border: 1px solid var(--cr-hair); border-radius: 8px; padding: 6px 10px; min-height: 44px; cursor: pointer; text-align: left; max-width: 100%; overflow-wrap: anywhere; }
.ord-why-b b { color: var(--cr-ink); margin-right: 4px; }
.ord-why-b:hover { border-color: var(--cr-ink); }
.ord-why-b.ord-why-alert b { color: var(--cr-red); }
.ord-why-b.is-zero { color: var(--cr-mut); }
.ord-why-b.is-on { background: var(--cr-sel-bg); color: var(--cr-sel-fg); border-color: var(--cr-sel-bg); }
.ord-why-b.is-on b { color: var(--cr-sel-fg); }
.ord-why-sub { font: 500 12px/1.3 var(--cr-mono); color: inherit; opacity: .85; }
.ord-clear { min-height: 44px; }
@media (max-width: 900px) {
  .ord-funnel { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ord-stage { border-left: 0; border-top: 1px solid var(--cr-hair); }
  .ord-stage:nth-child(odd) { border-right: 1px solid var(--cr-hair); }
  .ord-stage:nth-child(-n+2) { border-top: 0; }
}
`;
