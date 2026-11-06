'use client';

/* BS160: the organizer's outcome vocabulary on the web. Labels come from the
   API (@zora/core organizerOutcome); here we only pick a pill tone and draw
   the funnel strip + outcome breakdown on the Sales page. */

import { useEffect, useState } from 'react';
import { StatusPill, type PillTone } from '@/app/components/cr';
import './sales-outcomes.css';

export type Outcome = { outcome: string; outcomeLabel: string; outcomeDetail: string | null };

export function toneForOutcome(o: string): PillTone {
  switch (o) {
    case 'paid':
    case 'paid_after_retry':
    case 'recovered':
    case 'comp':
    case 'door_sale':
      return 'paid';
    case 'in_progress':
      return 'pending';
    case 'refunded':
    case 'underpaid':
    case 'paid_unseatable':
      return 'refund';
    case 'abandoned':
      return 'neutral';
    default:
      return 'failed';
  }
}

export function OutcomeChip({ outcome, label }: { outcome: string; label: string }) {
  return (
    <span className="of-pill">
      <StatusPill tone={toneForOutcome(outcome)} label={label} />
    </span>
  );
}

type Stage = { stage: string; count: number; fromPrev: number | null; dropPct: number | null };
type OutcomeCount = { outcome: string; label: string; count: number; details: { detail: string; label: string; count: number }[] };
type Funnel = { window: { days: number; from: string }; stages: Stage[]; outcomes: OutcomeCount[] };

const STAGE_LABELS: Record<string, string> = {
  event_views: 'Event views',
  checkout_opened: 'Checkout opened',
  carts_created: 'Carts',
  payment_started: 'Payment started',
  paid: 'Paid',
  passes_delivered: 'Passes delivered',
  checked_in: 'Checked in',
};
const RANGES = [7, 30, 90] as const;
const fmt = (n: number) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US') : '—');

/** Funnel strip + outcome breakdown. Clicking an outcome filters the orders
    list (onPick); clicking it again clears it. */
export function SalesFunnel({
  eventId, outcome, onPick,
}: { eventId: string; outcome: string; onPick: (outcome: string, from: string | null) => void }) {
  const [days, setDays] = useState<number>(7);
  const [data, setData] = useState<Funnel | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setState('loading');
    const p = new URLSearchParams({ days: String(days) });
    if (eventId) p.set('event', eventId);
    fetch(`/api/org/funnel?${p}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Funnel) => { if (live) { setData(d); setState('ok'); } })
      .catch(() => { if (live) { setData(null); setState('error'); } });
    return () => { live = false; };
  }, [days, eventId, tick]);

  const shown = (data?.outcomes ?? []).filter((o) => o.count > 0);
  const fromDay = data ? data.window.from.slice(0, 10) : null;

  return (
    <section className="cr-panel of-funnel" aria-labelledby="of-funnel-h">
      <div className="cr-panel-head of-head">
        <h2 className="cr-section-h" id="of-funnel-h">Funnel</h2>
        <div className="org-seg" role="group" aria-label="Funnel range">
          {RANGES.map((d) => (
            <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)} aria-pressed={days === d}>
              {d}D
            </button>
          ))}
        </div>
      </div>

      {state === 'error' ? (
        <div className="cr-error" role="alert">
          <strong>Couldn&apos;t load the funnel</strong>
          <div style={{ marginTop: 8 }}>
            <button className="cr-linkbtn" onClick={() => setTick((t) => t + 1)}>RETRY</button>
          </div>
        </div>
      ) : (
        <>
          <ol className="of-stages" aria-busy={state === 'loading'}>
            {(data?.stages ?? Object.keys(STAGE_LABELS).map((stage) => ({ stage, count: NaN, fromPrev: null, dropPct: null }))).map((s) => (
              <li key={s.stage} className="of-stage">
                <span className="of-stage-k">{STAGE_LABELS[s.stage] ?? s.stage}</span>
                <span className="of-stage-v">{state === 'loading' ? '…' : fmt(s.count)}</span>
                <span className="of-stage-d">{s.dropPct != null && state === 'ok' ? `−${s.dropPct}%` : ' '}</span>
              </li>
            ))}
          </ol>

          <h3 className="of-sub">What happened to each cart</h3>
          {state === 'ok' && !shown.length ? (
            <p className="org-muted">No carts in the last {days} days.</p>
          ) : (
            <ul className="of-outcomes">
              {shown.map((o) => (
                <li key={o.outcome}>
                  <button
                    className={'of-outcome' + (outcome === o.outcome ? ' on' : '')}
                    aria-pressed={outcome === o.outcome}
                    onClick={() => onPick(outcome === o.outcome ? '' : o.outcome, outcome === o.outcome ? null : fromDay)}
                  >
                    <span className="of-outcome-l">{o.label}</span>
                    <span className="of-outcome-n">{fmt(o.count)}</span>
                  </button>
                  {o.details.length ? (
                    <ul className="of-details">
                      {o.details.map((d) => (
                        <li key={d.detail}>
                          <span>{d.label.replace(/^[^:]*:\s*/, '')}</span>
                          <span className="of-outcome-n">{fmt(d.count)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {outcome ? (
            <p className="org-muted of-note">
              Orders below show this outcome only, from the start of this range.{' '}
              <button className="cr-linkbtn" onClick={() => onPick('', null)}>SHOW ALL</button>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
