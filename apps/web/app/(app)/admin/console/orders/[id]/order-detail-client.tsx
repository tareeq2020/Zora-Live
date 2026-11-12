'use client';

/* BS153 — one cart, inside out. Reads GET /api/admin/orders/:id:
     header (status, value, buyer, event, organizer, created)
     → stage bar across the funnel → every step on a vertical timeline with the
     time since the previous step → attempts with gateway refs and errors in full
     → items / seats, passes, notifications, check-ins, refunds, callbacks.
   Steps for orders from before the log existed are rebuilt from the tables and
   marked "derived". The old drawer had no order actions; this page replaces it.

   BS157: the header leads with the cart OUTCOME and one line on why (with a
   link to the cart that recovered it), and each attempt has a collapsible
   "What x-bridge sent": its stored callback bodies and last status body. */

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { DataTable, StatusPill, toneForStatus, type Column } from '@/app/components/cr';
import { AdminError, AdminSkeleton, adminApi, useAdminResource } from '../../admin-kit';
import { AdminConsoleShell } from '../../console-shell';
import { ORDER_STAGES, STAGE_LABEL, gap, money, whenFull, outcomeText, outcomeTone } from '../order-format';
import { FAILURE_WORDS, PushPanel, type PushPreview } from './push-panel';
import { GatewayCheckPanel } from './gateway-check-panel';

type Attempt = {
  transactionId: string;
  method: string | null;
  status: string;
  amount: number | null;
  collectedAmount: number | null;
  currency: string | null;
  orderReference: string | null;
  billPayNumber: string | null;
  error: string | null;
  errorAt: string | null;
  failureReason?: string | null;
  gatewayStatus?: Record<string, unknown> | null;
  gatewayStatusAt?: string | null;
  scheduleN: number | null;
  createdAt: string;
  updatedAt: string | null;
};
type Entry = {
  at: string;
  step: string;
  label: string;
  detail: Record<string, unknown>;
  source: 'logged' | 'derived';
  transactionId: string | null;
  sincePrevMs: number | null;
};
type Pass = {
  publicRef: string | null;
  state: string;
  tierId: string | null;
  seatLabel: string | null;
  issuedAt: string | null;
  scannedAt: string | null;
  scannedBy: string | null;
  confirmedAt: string | null;
};
type Detail = {
  id: string;
  type: string;
  status: string;
  channel: string | null;
  eventId: string;
  eventName: string | null;
  organizerName: string | null;
  organizerHandle: string | null;
  buyer: { name: string | null; phone: string | null; email: string | null };
  piiRedacted: boolean;
  lines: { tier: string; qty: number; unitPrice: number; amount: number; currency: string }[];
  split: {
    tier: string | null;
    capacity: number;
    status: string;
    paidCount: number;
    seats: { shareIndex: number; amount: number; state: string; isHost: boolean; isThisOrder: boolean }[];
  } | null;
  cartValue: number;
  targetValue: number;
  currency: string;
  refundedAmount: number;
  refundedAt: string | null;
  createdAt: string;
  notifiedAt: string | null;
  stageReached: string;
  attempts: Attempt[];
  passes: Pass[];
  callbacks: { transactionId: string | null; provider: string | null; receivedAt: string; applied: boolean; payload?: Record<string, unknown> | null }[];
  outcome?: string;
  outcomeDetail?: string | null;
  outcomeReason?: string | null;
  outcomeExplanation?: string;
  recoveredBy?: string | null;
  holds: { state: string; quantity: number; expiresAt: string | null }[];
  timeline: Entry[];
  durations: Record<string, number | null>;
  /** BS158: can an admin send a payment prompt now, and for how much. */
  push?: PushPreview | null;
};

const FAIL_STEPS = new Set(['gateway_rejected', 'failed', 'short', 'expired', 'admin_push_refused']);
const DURATION_LABEL: Record<string, string> = {
  cartToPayRequest: 'Cart → pay',
  payRequestToGateway: 'Pay → gateway',
  gatewayToPaid: 'Gateway → paid',
  paidToNotified: 'Paid → notified',
  cartToPaid: 'Cart → paid',
  paidToCheckIn: 'Paid → door',
};

/** One line of plain text from a step's detail. */
function detailText(d: Record<string, unknown>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(d || {})) {
    if (v == null || v === '' || v === false) continue;
    if (k === 'lines' && Array.isArray(v)) {
      out.push(v.map((l: any) => `${l.qty} × ${l.tier}${l.unitPrice != null ? ` @ ${Number(l.unitPrice).toLocaleString('en-US')}` : ''}`).join(', '));
      continue;
    }
    if (k === 'error') continue; // shown on its own line
    if (typeof v === 'object') continue;
    out.push(`${k} ${typeof v === 'number' ? v.toLocaleString('en-US') : String(v)}`);
  }
  return out.join(' · ');
}

export default function OrderDetailClient({ id }: { id: string }) {
  const load = useCallback(() => adminApi<Detail>(`/api/admin/orders/${encodeURIComponent(id)}`), [id]);
  const res = useAdminResource<Detail>(load);
  const [copied, setCopied] = useState(false);
  const o = res.data;

  const crumb = (
    <Link href="/admin/console/orders" className="od-crumb">
      ← ORDERS
    </Link>
  );

  if (!o) {
    return (
      <AdminConsoleShell title="Order" breadcrumb={crumb}>
        {res.status === 'error' ? <AdminError message={res.error} onRetry={res.reload} /> : <AdminSkeleton rows={6} />}
      </AdminConsoleShell>
    );
  }

  const reached = ORDER_STAGES.indexOf(o.stageReached);
  const ended = ['failed', 'expired', 'payment_short', 'cancelled', 'refunded', 'installment_defaulted'].includes(o.status);
  const notifications = o.timeline.filter((e) => e.step === 'buyer_notified');
  const refunds = o.timeline.filter((e) => e.step === 'refunded');
  const checkins = o.passes.filter((p) => p.scannedAt);

  const attemptCols: Column<Attempt>[] = [
    {
      key: 'tx',
      header: 'Attempt',
      primary: true,
      render: (a) => (
        <span className="od-mono">
          {a.transactionId}
          {a.scheduleN != null ? ` · installment ${a.scheduleN}` : ''}
        </span>
      ),
    },
    { key: 'm', header: 'Method', render: (a) => a.method || '—' },
    { key: 'st', header: 'Status', render: (a) => <StatusPill tone={a.error ? 'failed' : toneForStatus(a.status === 'successful' ? 'paid' : a.status)} label={a.error ? `${a.status} · refused` : a.status} /> },
    { key: 'amt', header: 'Amount', numeric: true, render: (a) => money(a.amount, a.currency || o.currency) },
    { key: 'got', header: 'Collected', numeric: true, render: (a) => (a.collectedAmount == null ? '—' : money(a.collectedAmount, a.currency || o.currency)) },
    {
      key: 'ref',
      header: 'Gateway refs',
      render: (a) => (
        <span className="od-mono od-wrap">
          {[a.orderReference && `ref ${a.orderReference}`, a.billPayNumber && `control # ${a.billPayNumber}`].filter(Boolean).join(' · ') || '—'}
        </span>
      ),
    },
    {
      key: 'err',
      header: 'Error',
      render: (a) =>
        a.error ? (
          <span className="od-err od-wrap">{a.error}</span>
        ) : a.failureReason ? (
          <span className="od-wrap">{FAILURE_WORDS[a.failureReason] ?? a.failureReason}</span>
        ) : (
          '—'
        ),
    },
    { key: 'at', header: 'Started · updated', render: (a) => <span className="od-mono">{whenFull(a.createdAt)} · {whenFull(a.errorAt ?? a.updatedAt)}</span> },
  ];

  return (
    <AdminConsoleShell title="Order" breadcrumb={crumb}>
      <div className="cr-stack od">
        {/* ── header ── */}
        <section className="cr-panel">
          <div className="od-head">
            <div className="od-head-main">
              <div className="od-kicker">{(o.type === 'table_share' ? 'SPLIT SEAT' : o.type === 'comp' ? 'COMP' : 'CART').toString()} · {o.channel || 'online'}</div>
              <h1 className="od-title">{o.eventName || o.eventId}</h1>
              <div className="od-id">
                <span>{o.id}</span>
                <button
                  type="button"
                  className="cr-linkbtn"
                  onClick={() => {
                    navigator.clipboard?.writeText(o.id).then(() => setCopied(true), () => {});
                  }}
                >
                  {copied ? 'COPIED' : 'COPY ID'}
                </button>
              </div>
            </div>
            <div className="od-head-side">
              {o.outcome ? (
                <span className={`od-out od-out-${outcomeTone(o.outcome)}`}>{outcomeText(o.outcome, o.outcomeDetail)}</span>
              ) : null}
              <StatusPill tone={toneForStatus(o.status)} label={o.status} />
              <div className="od-value">{money(o.targetValue || o.cartValue, o.currency)}</div>
            </div>
          </div>
          {o.outcomeExplanation ? (
            <p className="od-why">
              {o.outcomeExplanation}
              {o.recoveredBy ? (
                <>
                  {' '}
                  <Link href={`/admin/console/orders/${o.recoveredBy}`} className="od-why-link">
                    Open the cart that paid →
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          <dl className="od-facts">
            <div>
              <dt>Buyer</dt>
              <dd>
                {o.buyer.name || '—'}
                <span className="od-mono">{[o.buyer.phone, o.buyer.email].filter(Boolean).join(' · ') || '—'}</span>
                {o.piiRedacted ? <span className="od-note">Contact hidden: this cart never paid and is past the privacy window.</span> : null}
              </dd>
            </div>
            <div>
              <dt>Organizer</dt>
              <dd>{o.organizerName || o.organizerHandle || '—'}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd className="od-mono">{whenFull(o.createdAt)}</dd>
            </div>
            <div>
              <dt>Notified</dt>
              <dd className="od-mono">{whenFull(o.notifiedAt)}</dd>
            </div>
          </dl>
        </section>

        {/* ── BS158: admin payment prompt ── */}
        <PushPanel o={o} onDetail={res.set} />

        {/* ── BS164: ask x-bridge about every attempt ── */}
        <GatewayCheckPanel<Detail> orderId={o.id} onDetail={res.set} />

        {/* ── stage bar ── */}
        <section className="cr-panel" aria-label="Stage reached">
          <h2 className="cr-section-h">Stage reached</h2>
          <ol className="od-bar">
            {ORDER_STAGES.map((s, i) => {
              const state = i <= reached ? 'done' : i === reached + 1 && ended ? 'drop' : 'todo';
              return (
                <li key={s} className={`od-bar-s is-${state}`} aria-current={i === reached ? 'step' : undefined}>
                  <span className="od-bar-n">{String(i + 1).padStart(2, '0')}</span>
                  <span className="od-bar-l">{STAGE_LABEL[s] ?? s}</span>
                  {state === 'drop' ? <span className="od-bar-x">stopped here</span> : null}
                </li>
              );
            })}
          </ol>
          <div className="od-durs">
            {Object.entries(o.durations)
              .filter(([, v]) => v != null)
              .map(([k, v]) => (
                <span key={k}>
                  {DURATION_LABEL[k] ?? k} <b>{gap(v)}</b>
                </span>
              ))}
          </div>
        </section>

        <div className="od-cols">
          {/* ── timeline ── */}
          <section className="cr-panel" aria-label="Timeline">
            <h2 className="cr-section-h">Every step</h2>
            {o.timeline.length === 0 ? (
              <p className="od-note">No steps recorded.</p>
            ) : (
              <ol className="od-tl">
                {o.timeline.map((e, i) => (
                  <li key={i} className={`od-tl-i${FAIL_STEPS.has(e.step) ? ' is-bad' : ''}${e.step === 'paid' ? ' is-key' : ''}`}>
                    <div className="od-tl-t">
                      <span className="od-mono">{whenFull(e.at)}</span>
                      {e.sincePrevMs != null ? <span className="od-tl-gap">+{gap(e.sincePrevMs)}</span> : null}
                    </div>
                    <div className="od-tl-b">
                      <span className="od-tl-l">
                        {e.label}
                        {e.source === 'derived' ? <span className="od-tag">derived</span> : null}
                      </span>
                      {detailText(e.detail) ? <span className="od-tl-d">{detailText(e.detail)}</span> : null}
                      {e.detail?.error ? <span className="od-err od-wrap">{String(e.detail.error)}</span> : null}
                      {e.transactionId ? <span className="od-tl-tx">{e.transactionId}</span> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* ── cart ── */}
          <section className="cr-panel" aria-label="Cart">
            <h2 className="cr-section-h">{o.split ? 'Table seats' : 'Items'}</h2>
            {o.split ? (
              <>
                <p className="od-note">
                  {o.split.tier || 'Table'} · {o.split.paidCount}/{o.split.capacity} paid · table {o.split.status}
                </p>
                <ul className="od-rows">
                  {o.split.seats.map((s) => (
                    <li key={s.shareIndex}>
                      <span>
                        Seat {s.shareIndex + 1}
                        {s.isHost ? ' · host' : ''}
                        {s.isThisOrder ? ' · this order' : ''}
                      </span>
                      <span className="od-mono">
                        {money(s.amount, o.currency)} · {s.state}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : o.lines.length ? (
              <ul className="od-rows">
                {o.lines.map((l, i) => (
                  <li key={i}>
                    <span>
                      {l.qty} × {l.tier}
                    </span>
                    <span className="od-mono">{money(l.amount, l.currency)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="od-note">No line items on this order.</p>
            )}
            {o.holds.length ? (
              <>
                <h3 className="od-sub">Inventory holds</h3>
                <ul className="od-rows">
                  {o.holds.map((h, i) => (
                    <li key={i}>
                      <span>
                        {h.quantity} · {h.state}
                      </span>
                      <span className="od-mono">expires {whenFull(h.expiresAt)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <h3 className="od-sub">Passes issued ({o.passes.length})</h3>
            {o.passes.length ? (
              <ul className="od-rows">
                {o.passes.map((p, i) => (
                  <li key={i}>
                    <span className="od-mono">
                      {p.publicRef || '—'}
                      {p.seatLabel ? ` · ${p.seatLabel}` : ''}
                    </span>
                    <span className="od-mono">{p.state}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="od-note">None.</p>
            )}

            <h3 className="od-sub">Notifications</h3>
            {notifications.length ? (
              <ul className="od-rows">
                {notifications.map((n, i) => (
                  <li key={i}>
                    <span>{detailText(n.detail) || 'sent'}</span>
                    <span className="od-mono">{whenFull(n.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="od-note">None.</p>
            )}

            <h3 className="od-sub">Check-ins</h3>
            {checkins.length ? (
              <ul className="od-rows">
                {checkins.map((p, i) => (
                  <li key={i}>
                    <span className="od-mono">
                      {p.publicRef} {p.scannedBy ? `· ${p.scannedBy}` : ''}
                    </span>
                    <span className="od-mono">{whenFull(p.scannedAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="od-note">None.</p>
            )}

            <h3 className="od-sub">Refunds</h3>
            {o.refundedAmount > 0 || refunds.length ? (
              <ul className="od-rows">
                <li>
                  <span>Refunded</span>
                  <span className="od-mono">
                    {money(o.refundedAmount, o.currency)} · {whenFull(o.refundedAt ?? refunds[refunds.length - 1]?.at)}
                  </span>
                </li>
              </ul>
            ) : (
              <p className="od-note">None.</p>
            )}

            {o.callbacks.length ? (
              <>
                <h3 className="od-sub">Gateway callbacks</h3>
                <ul className="od-rows">
                  {o.callbacks.map((c, i) => (
                    <li key={i}>
                      <span className="od-mono od-wrap">{c.transactionId}</span>
                      <span className="od-mono">
                        {whenFull(c.receivedAt)}
                        {c.applied ? '' : ' · not applied'}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        </div>

        {/* ── attempts ── */}
        <section className="cr-panel" aria-label="Payment attempts">
          <h2 className="cr-section-h">Payment attempts ({o.attempts.length})</h2>
          <DataTable
            columns={attemptCols}
            rows={o.attempts}
            rowKey={(a) => a.transactionId}
            caption="Payment attempts"
            emptyTitle="No payment started"
            emptyBody={<span>The buyer made a cart but never asked to pay.</span>}
          />
          {o.attempts.map((a) => {
            const hooks = o.callbacks.filter((c) => c.transactionId === a.transactionId && c.payload);
            const empty = !hooks.length && !a.gatewayStatus;
            return (
              <details key={a.transactionId} className="od-sent">
                <summary>
                  What x-bridge sent · <span className="od-mono od-wrap">{a.transactionId}</span>
                  {a.failureReason ? <span className="od-sent-r"> · reason {a.failureReason}</span> : null}
                </summary>
                {empty ? (
                  <p className="od-note">Nothing stored for this attempt (bodies are kept from BS157 on).</p>
                ) : null}
                {hooks.map((c, i) => (
                  <div key={i} className="od-sent-b">
                    <h3 className="od-sub">Callback · {whenFull(c.receivedAt)}</h3>
                    <pre className="od-pre">{JSON.stringify(c.payload, null, 2)}</pre>
                  </div>
                ))}
                {a.gatewayStatus ? (
                  <div className="od-sent-b">
                    <h3 className="od-sub">Last status read · {whenFull(a.gatewayStatusAt)}</h3>
                    <pre className="od-pre">{JSON.stringify(a.gatewayStatus, null, 2)}</pre>
                  </div>
                ) : null}
              </details>
            );
          })}
        </section>
      </div>
      <style dangerouslySetInnerHTML={{ __html: DETAIL_CSS }} />
    </AdminConsoleShell>
  );
}

/* Page-level styles (shared CR primitives are BS154's): flat, bone/black, data
   in mono, one yellow accent. Works down to 390px. */
const DETAIL_CSS = `
.od { min-width: 0; }
.od-crumb { display: inline-flex; align-items: center; min-height: 44px; font: 600 12px/1 var(--cr-mono); letter-spacing: .08em; color: var(--cr-ink2); text-decoration: none; }
.od-crumb:hover { color: var(--cr-ink); }
.od-mono { font-family: var(--cr-mono); font-size: 12px; }
.od-wrap { overflow-wrap: anywhere; word-break: break-word; }
.od-note { font-size: 12px; color: var(--cr-ink2); margin: 4px 0; display: block; }
.od-err { color: var(--cr-red); font: 500 12px/1.4 var(--cr-mono); display: block; }
.od-head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.od-head-main { min-width: 0; flex: 1 1 260px; }
.od-head-side { display: grid; justify-items: end; gap: 8px; }
.od-kicker { font: 600 12px/1 var(--cr-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--cr-mut); }
.od-title { font: 700 22px/1.15 var(--cr-sans); margin: 6px 0; color: var(--cr-ink); overflow-wrap: anywhere; }
.od-id { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font: 500 12px/1.3 var(--cr-mono); color: var(--cr-ink2); overflow-wrap: anywhere; }
.od-id span { min-width: 0; overflow-wrap: anywhere; }
.od-value { font: 600 24px/1 var(--cr-mono); color: var(--cr-ink); }
.od-out { font: 600 12px/1.25 var(--cr-mono); letter-spacing: .06em; text-transform: uppercase; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--cr-hair); color: var(--cr-ink2); max-width: 100%; overflow-wrap: anywhere; text-align: right; }
.od-out-good { background: var(--cr-ink); color: var(--cr-paper); border-color: var(--cr-ink); }
.od-out-mid { border-color: var(--cr-ink); color: var(--cr-ink); }
.od-out-alert { border-color: var(--cr-red); color: var(--cr-red); }
.od-why { margin: 12px 0 0; font-size: 14px; line-height: 1.45; color: var(--cr-ink); overflow-wrap: anywhere; }
.od-why-link { display: inline-flex; align-items: center; min-height: 44px; font: 600 12px/1 var(--cr-mono); letter-spacing: .06em; color: var(--cr-ink); }
.od-sent { border-top: 1px solid var(--cr-hair); margin-top: 8px; }
.od-sent summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; flex-wrap: wrap; gap: 4px; font: 600 12px/1.3 var(--cr-mono); letter-spacing: .04em; color: var(--cr-ink); }
.od-sent-r { color: var(--cr-ink2); font-weight: 500; }
.od-sent-b { margin-bottom: 10px; }
.od-pre { margin: 0; padding: 10px; background: var(--cr-card2); border: 1px solid var(--cr-hair); border-radius: 8px; font: 500 12px/1.45 var(--cr-mono); color: var(--cr-ink); white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; max-height: 360px; overflow-y: auto; }
.od-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; margin: 16px 0 0; border-top: 1px solid var(--cr-hair); }
.od-facts > div { padding: 10px 12px 0 0; min-width: 0; }
.od-facts dt { font: 600 12px/1 var(--cr-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--cr-mut); margin-bottom: 6px; }
.od-facts dd { margin: 0; display: grid; gap: 2px; font-size: 14px; overflow-wrap: anywhere; }
.od-bar { list-style: none; margin: 10px 0 0; padding: 0; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 4px; }
.od-bar-s { padding: 10px 8px 8px; border-top: 4px solid var(--cr-hair); display: grid; gap: 4px; min-width: 0; }
.od-bar-s.is-done { border-top-color: var(--cr-ink); }
.od-bar-s.is-done[aria-current="step"] { border-top-color: var(--cr-blue); }
.od-bar-s.is-drop { border-top-color: var(--cr-red); }
.od-bar-n { font: 600 12px/1 var(--cr-mono); color: var(--cr-mut); }
.od-bar-l { font: 600 12px/1.2 var(--cr-sans); color: var(--cr-ink); }
.od-bar-s.is-todo .od-bar-l { color: var(--cr-mut); }
.od-bar-x { font: 600 12px/1 var(--cr-mono); text-transform: uppercase; letter-spacing: .06em; color: var(--cr-red); }
.od-durs { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 12px; font: 500 12px/1.4 var(--cr-mono); color: var(--cr-ink2); }
.od-durs b { color: var(--cr-ink); }
.od-cols { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.od-tl { list-style: none; margin: 8px 0 0; padding: 0; }
.od-tl-i { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 12px; padding: 10px 0 10px; border-top: 1px solid var(--cr-hair); position: relative; }
.od-tl-i:first-child { border-top: 0; }
.od-tl-t { display: grid; gap: 2px; align-content: start; color: var(--cr-ink2); }
.od-tl-gap { font: 600 12px/1 var(--cr-mono); color: var(--cr-mut); }
.od-tl-b { display: grid; gap: 3px; min-width: 0; padding-left: 12px; border-left: 2px solid var(--cr-ink); }
.od-tl-i.is-bad .od-tl-b { border-left-color: var(--cr-red); }
.od-tl-i.is-key .od-tl-b { border-left-color: var(--cr-blue); }
.od-tl-l { font: 600 14px/1.25 var(--cr-sans); color: var(--cr-ink); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.od-tl-d { font: 500 12px/1.4 var(--cr-mono); color: var(--cr-ink2); overflow-wrap: anywhere; }
.od-tl-tx { font: 500 12px/1.3 var(--cr-mono); color: var(--cr-mut); overflow-wrap: anywhere; }
.od-tag { font: 600 12px/1 var(--cr-mono); letter-spacing: .1em; text-transform: uppercase; padding: 3px 5px; border: 1px solid var(--cr-hair); border-radius: 4px; color: var(--cr-mut); }
.od-sub { font: 600 12px/1 var(--cr-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--cr-mut); margin: 18px 0 6px; }
.od-rows { list-style: none; margin: 0; padding: 0; }
.od-rows li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--cr-hair); font-size: 13px; min-width: 0; }
.od-rows li > span { min-width: 0; overflow-wrap: anywhere; }
.od-rows li > span:last-child { text-align: right; }
@media (max-width: 900px) {
  .od-cols { grid-template-columns: minmax(0, 1fr); }
  .od-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .od-bar { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 520px) {
  .od-facts { grid-template-columns: minmax(0, 1fr); }
  .od-head-side { justify-items: start; }
  .od-out { text-align: left; }
  .od-bar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .od-tl-i { grid-template-columns: minmax(0, 1fr); gap: 6px; }
  .od-tl-t { grid-auto-flow: column; justify-content: start; gap: 8px; align-items: baseline; }
  .od-rows li { flex-direction: column; gap: 2px; }
  .od-rows li > span:last-child { text-align: left; }
}
`;
