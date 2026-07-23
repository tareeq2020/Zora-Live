'use client';

/* BS7 — pay ONE existing share order (the order already exists from claim or
   pay-mine, so no cart/checkout step). Reuses the payments contract's pay+poll:
     POST /api/checkout/:orderId/pay   → mobile PIN push / control number
     GET  /api/orders/:orderId/status  → poll to terminal
   On 'paid' the share is settled (the buyer is IN); the whole TABLE completing
   and issuing the pass is a separate event the tracker/SMS surfaces — so 'paid'
   here calls onPaid(), it does NOT claim a ticket. Consumer dark language. */

import { useCallback, useEffect, useRef, useState } from 'react';

const NETWORKS = [
  { id: 'VODACOM', label: 'M-Pesa' },
  { id: 'TIGO', label: 'Mixx by Yas' },
  { id: 'AIRTEL', label: 'Airtel Money' },
  { id: 'HALOTEL', label: 'HaloPesa' },
];
const POLL_MS = 3000;
const POLL_MAX = 60;
const TERMINAL = new Set(['paid', 'payment_short', 'paid_unseatable', 'failed', 'expired']);
const fmt = (n: number) => n.toLocaleString('en-US');

export type SharePayFlowProps = {
  orderId: string;
  amount: number;
  phone: string;
  eventName: string;
  onPaid: () => void;
};

export default function SharePayFlow({ orderId, amount, phone, eventName, onPaid }: SharePayFlowProps) {
  const [step, setStep] = useState<'method' | 'poll' | 'result'>('method');
  const [network, setNetwork] = useState('VODACOM');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusVal, setStatusVal] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCount = useRef(0);

  const stopPolling = useCallback(() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }, []);
  useEffect(() => () => stopPolling(), [stopPolling]);

  function startPolling() {
    stopPolling();
    pollCount.current = 0;
    const tick = async () => {
      pollCount.current += 1;
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, { cache: 'no-store' });
        if (res.ok) {
          const d = (await res.json()) as { status: string };
          setStatusVal(d.status);
          if (TERMINAL.has(d.status)) {
            stopPolling();
            if (d.status === 'paid') { onPaid(); return; }
            setStep('result');
            return;
          }
        }
      } catch { /* transient */ }
      if (pollCount.current >= POLL_MAX) { stopPolling(); setStatusVal('slow'); setStep('result'); }
    };
    tick();
    pollRef.current = setInterval(tick, POLL_MS);
  }

  async function submitPay() {
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/checkout/${encodeURIComponent(orderId)}/pay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'mobile', payerPhone: phone, mno: network }),
      });
      if (res.status !== 200) {
        const d = await res.json().catch(() => ({}));
        setNotice(d.error === 'not_payable' ? 'This share is no longer payable.' : 'Could not start the payment. Try again.');
        return;
      }
      setStatusVal('pending');
      setStep('poll');
      startPolling();
    } catch { setNotice('Network error — try again.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="spf">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {notice ? <div className="spf-notice">{notice}</div> : null}

      {step === 'method' ? (
        <>
          <div className="spf-amt"><span className="k">YOUR SHARE</span><span className="v">{fmt(amount)} <small>TZS</small></span></div>
          <p className="spf-lead">Pay with mobile money. We send a prompt to <b>{phone}</b> — approve it with your PIN. Your money goes straight to the table.</p>
          <div className="spf-pm">
            {NETWORKS.map((n) => (
              <button key={n.id} className={'spf-m' + (network === n.id ? ' on' : '')} onClick={() => setNetwork(n.id)}>{n.label}</button>
            ))}
          </div>
          <button className="spf-btn" disabled={busy} onClick={submitPay}>{busy ? 'Sending…' : `Send me the payment prompt`}</button>
        </>
      ) : null}

      {step === 'poll' ? (
        <div className="spf-wait">
          <div className="spf-spin" />
          <h3>Check your phone</h3>
          <p>Approve the {NETWORKS.find((n) => n.id === network)?.label} prompt on <b>{phone}</b> with your PIN.</p>
          <p className="spf-muted">Waiting for confirmation… this can take a minute. Keep this open.</p>
          <button className="spf-ghost" onClick={() => { stopPolling(); setStep('method'); }}>Didn't get it? Try again</button>
        </div>
      ) : null}

      {step === 'result' ? (
        <div className="spf-wait">
          {statusVal === 'payment_short' ? (
            <>
              <h3>Came up short</h3>
              <p>We only received part of your {fmt(amount)} TZS. Your seat's still open — re-pay your share to keep it.</p>
              <button className="spf-btn" onClick={() => setStep('method')}>Re-pay my share</button>
            </>
          ) : statusVal === 'slow' ? (
            <>
              <h3>Still processing</h3>
              <p>Mobile money can be slow. We'll text you the moment it clears — you can close this.</p>
            </>
          ) : (
            <>
              <h3>That didn't go through</h3>
              <p>You weren't charged. Give it another go.</p>
              <button className="spf-btn" onClick={() => setStep('method')}>Try again</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

const CSS = `
.spf{--c-bg:#0A0B10;--c-surface:#11131E;--c-surface2:#171A28;--c-text:#EDEFF7;--c-text2:#9BA3C4;--c-text3:#5C6488;
  --c-line:rgba(124,160,255,.12);--c-line2:rgba(124,160,255,.22);--c-blue:#4C6FFF;--c-ice:#7CA0FF;
  --c-aura:linear-gradient(130deg,#D53AD8 0%,#FF4D7D 48%,#FF9145 100%);
  --sans:'Inter',system-ui,sans-serif;--disp:'Space Grotesk',var(--sans);--mono:'IBM Plex Mono',monospace;
  color:var(--c-text);font-family:var(--sans)}
.spf-notice{background:rgba(255,145,69,.1);border:1px solid rgba(255,145,69,.35);color:#FF9145;border-radius:10px;padding:11px 13px;font-size:13px;margin-bottom:14px}
.spf-amt{display:flex;justify-content:space-between;align-items:baseline;background:var(--c-surface2);border:1px solid var(--c-line2);border-radius:14px;padding:16px}
.spf-amt .k{font-family:var(--mono);font-size:10px;letter-spacing:.16em;color:var(--c-text2)}
.spf-amt .v{font-family:var(--disp);font-weight:700;font-size:26px}
.spf-amt .v small{font-size:14px;color:var(--c-text2);font-weight:500}
.spf-lead{color:var(--c-text2);font-size:13px;line-height:1.6;margin:14px 0}
.spf-pm{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.spf-m{flex:1;min-width:calc(50% - 4px);background:var(--c-surface2);border:1px solid var(--c-line);border-radius:11px;padding:12px;font-family:var(--mono);font-size:11.5px;color:var(--c-text2);cursor:pointer}
.spf-m.on{border-color:var(--c-blue);color:var(--c-ice);background:rgba(76,111,255,.1)}
.spf-btn{display:block;width:100%;text-align:center;font-family:var(--disp);font-weight:600;font-size:14.5px;padding:15px;border-radius:13px;border:none;cursor:pointer;background:var(--c-aura);color:#fff;box-shadow:0 8px 26px rgba(255,77,125,.28)}
.spf-btn:disabled{opacity:.6}
.spf-ghost{display:block;width:100%;text-align:center;background:transparent;color:var(--c-text2);border:1px solid var(--c-line2);border-radius:13px;padding:13px;margin-top:12px;font-family:var(--mono);font-size:12px;cursor:pointer}
.spf-wait{text-align:center;padding:14px 0}
.spf-wait h3{font-family:var(--disp);font-weight:600;font-size:20px;margin-bottom:8px}
.spf-wait p{color:var(--c-text2);font-size:13.5px;line-height:1.6;margin-bottom:6px}
.spf-muted{color:var(--c-text3);font-size:12px}
.spf-spin{width:34px;height:34px;border-radius:50%;border:3px solid var(--c-line2);border-top-color:var(--c-ice);margin:0 auto 16px;animation:spf-rot 0.8s linear infinite}
@keyframes spf-rot{to{transform:rotate(360deg)}}
`;
