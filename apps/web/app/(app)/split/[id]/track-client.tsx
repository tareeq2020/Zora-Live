'use client';

/* BS8 — the "who's paid" tracker (host + invitee, read-only; P1 Postgres poll).
   GET /api/splits/:id every 4s. Shows k/N, per-share rows (paid / waiting, word + square marker),
   the window countdown, and the completion + empty states. No gateway calls.
   BS119: ZoraPass flow primitives (zp-flow-css); yellow progress fill. */

import { useEffect, useState } from 'react';
import { ZP_FLOW_CSS } from '../../../components/zp-flow-css';

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

  const toGo = split ? split.capacityN - split.paidCount : 0;

  return (
    <div className="zpf zpf-page tk">
      <style dangerouslySetInnerHTML={{ __html: ZP_FLOW_CSS + CSS }} />
      <div className="zpf-card">
        <div className="zpf-nav">
          <a className="zpf-wm" href="/discover" aria-label="ZoraPass — see what's on">
            <img src="/brand/logo/svg/zorapass-wordmark-black.svg" alt="ZoraPass" />
          </a>
          <a className="zpf-back" href="/discover">What&apos;s on →</a>
        </div>
        {err ? (
          <div className="tk-mid"><h3>Table not found</h3><p>This tracker link may be wrong. <a className="zpf-link" href="/discover">See what&apos;s on</a></p></div>
        ) : !split ? (
          <div className="tk-mid"><div className="zpf-spinner" /></div>
        ) : (
          <>
            <div className="zpf-eyebrow">{split.eventName}</div>
            {split.status === 'complete' ? (
              <h2 className="zpf-t">The table&apos;s locked.</h2>
            ) : split.status === 'refund_pending' ? (
              <h2 className="zpf-t">Didn&apos;t come together</h2>
            ) : split.status === 'expired' ? (
              <h2 className="zpf-t">Table released</h2>
            ) : (
              <h2 className="zpf-t"><span className="mono">{split.paidCount} of {split.capacityN}</span> paid</h2>
            )}

            {split.status === 'forming' ? (
              <div className="prog">
                <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={split.capacityN} aria-valuenow={split.paidCount} aria-label="Shares paid"><i style={{ width: `${Math.round((split.paidCount / split.capacityN) * 100)}%` }} /></div>
                <div className="lab"><span>TSh {fmt(split.paidCount * (split.target / split.capacityN) | 0)} in</span><span>Waiting on {toGo} {toGo === 1 ? 'person' : 'people'}</span></div></div>
            ) : null}

            <div className="zpf-rows">
              {split.shares.map((s) => (
                <div className="zpf-row" key={s.index}>
                  <span className="zpf-av">{(s.payerName || (s.isHost ? 'H' : String(s.index + 1)))[0].toUpperCase()}</span>
                  <div className="zpf-who"><div className="n">{s.payerName || (s.isHost ? 'Host' : `Share ${s.index + 1}`)}{s.isHost ? ' · host' : ''}</div>
                    <div className="p">TSh {fmt(s.amount)}</div></div>
                  <span className={'zpf-state ' + (s.state === 'paid' ? 'paid' : 'pend')}>{s.state === 'paid' ? 'Paid' : s.state === 'unclaimed' ? 'Not sent' : 'Waiting'}</span>
                </div>
              ))}
            </div>

            {split.status === 'forming' ? (
              <div className="cd">Table held — <b>{countdown(split.windowExpiresAt)}</b> left to fill</div>
            ) : split.status === 'complete' ? (
              <a className="zpf-btn" href="/account/tickets">OPEN MY PASS<span aria-hidden="true">→</span></a>
            ) : split.status === 'refund_pending' ? (
              <p className="note">The table didn&apos;t fill in time. Anyone who paid is refunded within <b>24 hours</b> — we&apos;ll text you.</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

const CSS = `
.tk .mono{font-family:var(--zp-font-family-mono);font-weight:600}
.tk-mid{text-align:center;padding:40px 0;color:var(--mut)}
.tk-mid h3{color:var(--ink);font-weight:800;font-size:24px;margin:0 0 8px}
.tk .prog{margin:16px 0 8px}
.tk .prog .bar{height:12px;border-radius:999px;background:var(--sunken);border:2px solid var(--ink);overflow:hidden}
.tk .prog .bar i{display:block;height:100%;background:var(--yellow);transition:width .4s}
.tk .prog .lab{display:flex;justify-content:space-between;gap:12px;font-family:var(--zp-font-family-mono);font-size:13px;color:var(--mut);margin-top:8px}
.tk .cd{text-align:center;font-family:var(--zp-font-family-mono);font-size:13px;letter-spacing:.04em;color:var(--mut);margin-top:16px;background:var(--sunken);border-radius:12px;padding:12px}
.tk .cd b{color:var(--ink);font-weight:600}
.tk .note{color:var(--mut);font-size:16px;line-height:1.5;margin:16px 0 0;text-align:center}
.tk .note b{color:var(--ink)}
@media (prefers-reduced-motion:reduce){.tk .prog .bar i{transition:none}}
`;
