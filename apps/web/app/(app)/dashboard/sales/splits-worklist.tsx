'use client';

/* BS12 — organizer splits view: tables still forming + the REFUND WORKLIST
   (refund_pending splits that took money but didn't fill). Read-only ops view;
   the money is kept locked until refunded by hand within 24h (A5/OV3/D8).
   Self-contained (own fetch + inline control-room styles) so it drops into the
   sales page without touching its layout. Renders nothing when there's nothing. */

import { useEffect, useState } from 'react';

const fmt = (n: number) => n.toLocaleString('en-US');
type Item = { id: string; eventId: string; capacityN: number; paidCount: number; collected: number; hostName: string | null; windowExpiresAt: string };

export default function SplitsWorklist() {
  const [data, setData] = useState<{ forming: Item[]; refundPending: Item[] } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/org/splits', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => alive && setData(d))
      .catch(() => alive && setData({ forming: [], refundPending: [] }));
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!data || (!data.forming.length && !data.refundPending.length)) return null;

  return (
    <div style={{ margin: '18px 0 8px', fontFamily: "var(--zp-font-family-sans)" }}>
      {data.refundPending.length ? (
        <div style={{ background: 'var(--cr-card)', border: '1px solid var(--cr-hair)', borderLeft: '4px solid var(--cr-red-fill)', borderRadius: 16, padding: 16, marginBottom: 14 }}>
          <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--cr-red)', display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>⚠ Needs a manual refund</p>
          <p style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: 'var(--cr-ink2)', letterSpacing: '.03em', margin: '5px 0 0', lineHeight: 1.6 }}>
            These tables took money but didn't fill before the hold ran out. Refund each guest within 24 hours — the seats stay held out of sale until you do (money is never resold out from under a guest).
          </p>
          {data.refundPending.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', background: 'var(--cr-card)', border: '1px solid var(--cr-hair)', borderRadius: 12, marginTop: 11 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>Table · {s.hostName || 'host'}</div>
                <div style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: 'var(--cr-mut)', marginTop: 2 }}>
                  {s.paidCount}/{s.capacityN} PAID · {fmt(s.collected)} TZS COLLECTED
                </div>
              </div>
              <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, letterSpacing: '.08em', color: 'var(--cr-on-state)', background: 'var(--cr-red-fill)', borderRadius: 999, padding: '6px 12px' }}>REFUND BY HAND</span>
            </div>
          ))}
        </div>
      ) : null}

      {data.forming.length ? (
        <div style={{ background: 'var(--cr-card)', border: '1px solid var(--cr-hair)', borderRadius: 14, padding: 16 }}>
          <p style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, letterSpacing: '.12em', color: 'var(--cr-mut)', margin: '0 0 10px' }}>▸ SPLITS IN PROGRESS</p>
          {data.forming.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--cr-card)', border: '1px solid var(--cr-hair)', borderRadius: 10, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>Table · {s.hostName || 'host'}</div>
                <div style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: 'var(--cr-mut)', marginTop: 2 }}>{s.paidCount}/{s.capacityN} PAID</div>
              </div>
              <div style={{ width: 64, height: 6, borderRadius: 4, background: 'var(--cr-card2)', overflow: 'hidden', flex: '0 0 auto' }}>
                <div style={{ height: '100%', width: `${Math.round((s.paidCount / s.capacityN) * 100)}%`, background: 'var(--cr-brand)' }} />
              </div>
              <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, letterSpacing: '.1em', padding: '6px 12px', borderRadius: 999, background: '#111111', color: '#FFD21F' }}>FORMING</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
