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
    <div style={{ margin: '18px 0 8px', fontFamily: "'Archivo',system-ui,sans-serif" }}>
      {data.refundPending.length ? (
        <div style={{ background: '#FBEAE1', border: '1px solid #f0c3ad', borderRadius: 14, padding: 16, marginBottom: 14 }}>
          <p style={{ fontWeight: 700, fontSize: 14, color: '#D85A30', display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>⚠ Needs a manual refund</p>
          <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: '#8a5a44', letterSpacing: '.03em', margin: '5px 0 0', lineHeight: 1.6 }}>
            These tables took money but didn't fill before the hold ran out. Refund each guest within 24 hours — the seats stay held out of sale until you do (money is never resold out from under a guest).
          </p>
          {data.refundPending.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', background: '#fff', border: '1px solid #f0c3ad', borderRadius: 10, marginTop: 11 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Table · {s.hostName || 'host'}</div>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: '#8a877e', marginTop: 2 }}>
                  {s.paidCount}/{s.capacityN} PAID · {fmt(s.collected)} TZS COLLECTED
                </div>
              </div>
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9.5, letterSpacing: '.08em', color: '#D85A30', border: '1px solid #f0c3ad', borderRadius: 8, padding: '6px 10px' }}>REFUND BY HAND</span>
            </div>
          ))}
        </div>
      ) : null}

      {data.forming.length ? (
        <div style={{ background: '#FBF9F4', border: '1px solid #DDD8CB', borderRadius: 14, padding: 16 }}>
          <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, letterSpacing: '.24em', color: '#8A877E', margin: '0 0 10px' }}>▸ SPLITS IN PROGRESS</p>
          {data.forming.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#fff', border: '1px solid #DDD8CB', borderRadius: 10, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Table · {s.hostName || 'host'}</div>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: '#8a877e', marginTop: 2 }}>{s.paidCount}/{s.capacityN} PAID</div>
              </div>
              <div style={{ width: 64, height: 6, borderRadius: 4, background: '#DDD8CB', overflow: 'hidden', flex: '0 0 auto' }}>
                <div style={{ height: '100%', width: `${Math.round((s.paidCount / s.capacityN) * 100)}%`, background: '#3D5AFE' }} />
              </div>
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, letterSpacing: '.1em', padding: '4px 9px', borderRadius: 20, background: '#E8EBFE', color: '#3D5AFE' }}>FORMING</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
