'use client';

/* BS8 — the "who's paid" tracker (host + invitee, read-only; P1 Postgres poll).
   GET /api/splits/:id every 4s. Shows k/N, per-share rows (paid=cyan / pending),
   the window countdown, and the completion + empty states. No gateway calls. */

import { useEffect, useState } from 'react';

const fmt = (n: number) => n.toLocaleString('en-US');

type Share = { index: number; isHost: boolean; state: string; amount: number; payerName: string | null; paidAt: string | null };
type Split = {
  id: string; status: string; capacityN: number; target: number; windowExpiresAt: string;
  eventName: string; paidCount: number; shares: Share[];
};

function countdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'time up';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m} min`;
}

export default function TrackClient({ id }: { id: string }) {
  const [split, setSplit] = useState<Split | null>(null);
  const [err, setErr] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => fetch(`/api/splits/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Split) => alive && setSplit(d))
      .catch(() => alive && setErr(true));
    load();
    const poll = setInterval(load, 4000);
    const clock = setInterval(() => alive && tick((t) => t + 1), 1000 * 30);
    return () => { alive = false; clearInterval(poll); clearInterval(clock); };
  }, [id]);

  return (
    <div className="tk">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="tk-card">
        <div className="wm">Z<span className="o" />RA</div>
        {err ? (
          <div className="tk-mid"><h3>Table not found</h3><p>This tracker link may be wrong. <a href="/discover">Back to discovery</a></p></div>
        ) : !split ? (
          <div className="tk-mid"><div className="spin" /></div>
        ) : (
          <>
            <div className="eyebrow">{split.eventName}</div>
            {split.status === 'complete' ? (
              <h2 className="t">The table's locked. 🎉</h2>
            ) : split.status === 'refund_pending' ? (
              <h2 className="t">Didn't come together</h2>
            ) : split.status === 'expired' ? (
              <h2 className="t">Table released</h2>
            ) : (
              <h2 className="t">{split.paidCount} of {split.capacityN} paid</h2>
            )}

            {split.status === 'forming' ? (
              <div className="prog"><div className="bar"><i style={{ width: `${Math.round((split.paidCount / split.capacityN) * 100)}%` }} /></div>
                <div className="lab"><span>{fmt(split.paidCount * (split.target / split.capacityN) | 0)} in</span><span>{split.capacityN - split.paidCount} to go</span></div></div>
            ) : null}

            <div className="rows">
              {split.shares.map((s) => (
                <div className="row" key={s.index}>
                  <span className="av">{(s.payerName || (s.isHost ? 'H' : String(s.index + 1)))[0].toUpperCase()}</span>
                  <div className="who"><div className="n">{s.payerName || (s.isHost ? 'Host' : `Share ${s.index + 1}`)}{s.isHost ? ' · host' : ''}</div>
                    <div className="p">{fmt(s.amount)} TZS</div></div>
                  <span className={'pill ' + (s.state === 'paid' ? 'paid' : 'pend')}>{s.state === 'paid' ? 'Paid' : s.state === 'unclaimed' ? 'Not sent' : 'Pending'}</span>
                </div>
              ))}
            </div>

            {split.status === 'forming' ? (
              <div className="cd">⏳ Table held — <b>{countdown(split.windowExpiresAt)}</b> left to fill</div>
            ) : split.status === 'complete' ? (
              <a className="btn" href="/account/tickets">See your pass</a>
            ) : split.status === 'refund_pending' ? (
              <p className="note">The table didn't fill in time. Anyone who paid is refunded within <b>24 hours</b> — we'll text you.</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

const CSS = `
.tk{--c-bg:#06070B;--c-surface:#11131E;--c-surface2:#171A28;--c-text:#EDEFF7;--c-text2:#9BA3C4;--c-text3:#5C6488;
  --c-line:rgba(124,160,255,.12);--c-line2:rgba(124,160,255,.22);--c-blue:#4C6FFF;--c-ice:#7CA0FF;--c-cyan:#3FE0FF;--c-indigo:#151A3A;
  --c-aura:linear-gradient(130deg,#D53AD8 0%,#FF4D7D 48%,#FF9145 100%);
  --sans:'Inter',system-ui,sans-serif;--disp:'Space Grotesk',var(--sans);--mono:'IBM Plex Mono',monospace;
  background:var(--c-bg);color:var(--c-text);font-family:var(--sans);min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:32px 18px}
.tk-card{width:100%;max-width:400px;background:var(--c-surface);border:1px solid var(--c-line);border-radius:20px;padding:24px 22px}
.wm{font-family:var(--disp);font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:18px;display:inline-flex;align-items:center;color:var(--c-text2);margin-bottom:8px}
.wm .o{width:.62em;height:.62em;margin:0 .05em;border-radius:50%;background:var(--c-aura);display:inline-block;box-shadow:0 0 10px rgba(255,90,120,.4)}
.eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.24em;color:var(--c-text3);text-transform:uppercase}
.t{font-family:var(--disp);font-weight:600;font-size:24px;letter-spacing:-.01em;margin:8px 0 4px}
.tk-mid{text-align:center;padding:40px 0;color:var(--c-text2)}
.tk-mid h3{font-family:var(--disp);color:var(--c-text);margin-bottom:8px}
.tk-mid a{color:var(--c-ice);text-decoration:none}
.spin{width:32px;height:32px;border-radius:50%;border:3px solid var(--c-line2);border-top-color:var(--c-ice);margin:0 auto;animation:tkr .8s linear infinite}
@keyframes tkr{to{transform:rotate(360deg)}}
.prog{margin:16px 0 6px}
.prog .bar{height:8px;border-radius:6px;background:var(--c-surface2);overflow:hidden}
.prog .bar i{display:block;height:100%;background:var(--c-aura);border-radius:6px;transition:width .4s}
.prog .lab{display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--c-text2);margin-top:9px}
.rows{margin-top:16px;display:flex;flex-direction:column;gap:1px;border:1px solid var(--c-line);border-radius:14px;overflow:hidden}
.row{display:flex;align-items:center;gap:12px;padding:13px 14px;background:var(--c-surface)}
.av{width:32px;height:32px;border-radius:50%;background:var(--c-indigo);color:var(--c-ice);display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:600;font-size:13px;flex:0 0 auto}
.who{flex:1;min-width:0}.who .n{font-size:14px;font-weight:500}.who .p{font-family:var(--mono);font-size:11px;color:var(--c-text3)}
.pill{font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;padding:4px 9px;border-radius:20px;text-transform:uppercase}
.pill.paid{background:rgba(63,224,255,.14);color:var(--c-cyan)}
.pill.pend{background:rgba(155,163,196,.14);color:var(--c-text2)}
.cd{display:flex;align-items:center;gap:8px;justify-content:center;font-family:var(--mono);font-size:11px;color:var(--c-text2);margin-top:16px;background:var(--c-surface);border:1px solid var(--c-line);border-radius:10px;padding:11px}
.cd b{color:var(--c-ice)}
.btn{display:block;text-align:center;font-family:var(--disp);font-weight:600;font-size:14px;padding:14px;border-radius:13px;background:var(--c-aura);color:#fff;text-decoration:none;margin-top:16px}
.note{color:var(--c-text2);font-size:12.5px;line-height:1.6;margin-top:14px;text-align:center}.note b{color:var(--c-text)}
`;
