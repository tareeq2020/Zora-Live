'use client';

/* BS160: the organizer order page. Header (event, amount, buyer as on Sales,
   outcome + one line) and a short timeline. Data: GET /api/org/orders/:id,
   which never carries transaction ids, gateway errors or admin actions. */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CrShell, StatusPill, toneForStatus } from '@/app/components/cr';
import { ORG_NAV } from '../../components/org-nav';
import '../../components/org-surfaces.css';
import { OutcomeChip } from '../outcomes';

const ORG_BRAND = { name: (<>z<span className="cr-o">o</span>ra</>), sublabel: 'Organizer' };

type Detail = {
  orderId: string; eventId: string; eventName: string | null; tier: string; qty: number; amount: number; currency: string;
  status: string; buyer: { phone?: string | null; email?: string | null }; credentials: string[]; createdAt: string;
  outcome: string; outcomeLabel: string; outcomeDetail: string | null; stageReached: string;
  outcomeExplanation: string; timeline: { at: string; step: string; label: string }[];
};

const fmt = (n: number) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US') : '—');
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso || '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function OrderDetail({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Detail | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch(`/api/org/orders/${encodeURIComponent(orderId)}`, { cache: 'no-store' });
      if (res.status === 404) { setState('missing'); return; }
      if (!res.ok) throw new Error(String(res.status));
      setOrder((await res.json()) as Detail);
      setState('ok');
    } catch {
      setState('error');
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  return (
    <CrShell
      nav={ORG_NAV}
      brand={ORG_BRAND}
      topbarTitle="Order"
      footer={<><a href="/dashboard/onboarding">GET STARTED</a> &middot; <a href="/">ZORAPASS.COM</a></>}
    >
      <div className="cr-stack">
        <div>
          <p className="org-crumb">
            <Link href="/dashboard/overview">DASHBOARD</Link> / <Link href="/dashboard/sales">SALES</Link> / ORDER
          </p>
          <h1 className="org-h1">Order {orderId.slice(0, 8)}</h1>
          <p className="org-sub">What happened to this cart, from the buyer&apos;s side, so you know when to follow up.</p>
        </div>

        {state === 'loading' ? (
          <div className="cr-cards" aria-busy="true">
            <span className="cr-skel" style={{ height: 120, borderRadius: 16 }} />
            <span className="cr-skel" style={{ height: 200, borderRadius: 16 }} />
          </div>
        ) : state === 'missing' ? (
          <div className="cr-empty">
            <strong>Order not found</strong>
            <span>It may belong to another organizer, or the link is wrong.</span>
            <Link className="org-btn ghost" href="/dashboard/sales">BACK TO SALES</Link>
          </div>
        ) : state === 'error' || !order ? (
          <div className="cr-error" role="alert">
            <strong>Couldn&apos;t load this order</strong>
            <div style={{ marginTop: 8 }}>
              <button className="cr-linkbtn" onClick={load}>RETRY</button>
            </div>
          </div>
        ) : (
          <>
            <section className="cr-panel" aria-label="Order">
              <div className="of-detail-head">
                <div className="of-kv">
                  <p className="k">Event</p>
                  <p className="v">{order.eventName ?? order.eventId}</p>
                </div>
                <div className="of-kv">
                  <p className="k">Amount</p>
                  <p className="v mono">{fmt(order.amount)} {order.currency}</p>
                  <p className="org-muted">{order.tier ? `${order.tier} × ${fmt(order.qty)}` : '—'}</p>
                </div>
                <div className="of-kv">
                  <p className="k">Buyer</p>
                  <p className="v mono">{order.buyer?.phone || '—'}</p>
                  {order.buyer?.email ? <p className="org-muted">{order.buyer.email}</p> : null}
                </div>
                <div className="of-kv">
                  <p className="k">Status</p>
                  <p className="v"><StatusPill tone={toneForStatus(order.status)} label={order.status || '—'} /></p>
                  <p className="org-muted">Placed {fmtWhen(order.createdAt)}</p>
                </div>
              </div>
              <div className="of-explain">
                <OutcomeChip outcome={order.outcome} label={order.outcomeLabel} />
                <p style={{ margin: '12px 0 0' }}>{order.outcomeExplanation}</p>
              </div>
              {order.credentials?.length ? (
                <p className="org-muted" style={{ marginTop: 12 }}>
                  Passes:{' '}
                  {order.credentials.map((ref) => <span className="org-cred" key={ref} style={{ marginRight: 6 }}>{ref}</span>)}
                </p>
              ) : null}
            </section>

            <section className="cr-panel" aria-labelledby="of-tl-h">
              <div className="cr-panel-head"><h2 className="cr-section-h" id="of-tl-h">Timeline</h2></div>
              {order.timeline.length ? (
                <ol className="of-timeline">
                  {order.timeline.map((e, i) => (
                    <li key={`${e.step}-${i}`} data-step={e.step}>
                      <span className="of-tl-label">{e.label}</span>
                      <span className="of-tl-at">{fmtWhen(e.at)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="org-muted">No steps recorded yet.</p>
              )}
            </section>
          </>
        )}
      </div>
    </CrShell>
  );
}
