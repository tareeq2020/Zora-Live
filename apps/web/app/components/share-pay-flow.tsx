'use client';

/* BS7 — pay ONE existing share order (the order already exists from claim or
   pay-mine, so no cart/checkout step). Reuses the payments contract's pay+poll:
     POST /api/checkout/:orderId/pay   → mobile PIN push / control number
     GET  /api/orders/:orderId/status  → poll to terminal
   On 'paid' the share is settled (the buyer is IN); the whole TABLE completing
   and issuing the pass is a separate event the tracker/SMS surfaces — so 'paid'
   here calls onPaid(), it does NOT claim a ticket. BS119: ZoraPass flow primitives
   (zp-flow-css) — bone ground, black primary with a yellow Bungee label. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ZP_FLOW_CSS } from './zp-flow-css';

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
  const [payPhone, setPayPhone] = useState(phone || '');   // the mobile-money number (may differ from login/contact)
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
    if (payPhone.replace(/\D/g, '').length < 9) { setNotice("Enter the number you'll pay with."); return; }
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/checkout/${encodeURIComponent(orderId)}/pay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'mobile', payerPhone: payPhone.trim(), mno: network }),
      });
      if (res.status !== 200) {
        const d = await res.json().catch(() => ({}));
        setNotice(d.error === 'not_payable' ? 'This share is no longer payable.' : "That payment didn't go through. Try again, or use another method.");
        return;
      }
      setStatusVal('pending');
      setStep('poll');
      startPolling();
    } catch { setNotice('No connection. Try again.'); }
    finally { setBusy(false); }
  }

  const arrow = (label: string) => (busy ? <span className="spin" aria-label={label} /> : <span aria-hidden="true">→</span>);

  return (
    <div className="zpf spf">
      <style dangerouslySetInnerHTML={{ __html: ZP_FLOW_CSS + CSS }} />
      {notice ? <div className="zpf-err" role="alert" style={{ marginTop: 0, marginBottom: 16 }}>{notice}</div> : null}

      {step === 'method' ? (
        <>
          <div className="zpf-amt"><span className="k">YOUR SHARE</span><span className="v">TSh {fmt(amount)}</span></div>
          <p className="zpf-sub" style={{ margin: '16px 0 0' }}>Pay with mobile money. We text a prompt to the number below; approve it with your PIN. Your money goes straight to the table.</p>
          <label className="zpf-lab" htmlFor="spf-phone">Mobile-money number</label>
          <div className="zpf-field"><span className="pfx">+255</span>
            <input id="spf-phone" inputMode="tel" autoFocus placeholder="712 345 678" value={payPhone} onChange={(e) => setPayPhone(e.target.value)} /></div>
          <span className="zpf-lab" id="spf-net">Network</span>
          <div className="spf-pm" role="radiogroup" aria-labelledby="spf-net">
            {NETWORKS.map((n) => (
              <button key={n.id} type="button" role="radio" aria-checked={network === n.id} className={'spf-m' + (network === n.id ? ' on' : '')} onClick={() => setNetwork(n.id)}>{n.label}</button>
            ))}
          </div>
          <button className="zpf-btn" disabled={busy} onClick={submitPay}>PAY MY SHARE{arrow('Sending')}</button>
        </>
      ) : null}

      {step === 'poll' ? (
        <div className="spf-wait" aria-live="polite">
          <div className="zpf-spinner" />
          <h3>Check your phone</h3>
          <p>Approve the {NETWORKS.find((n) => n.id === network)?.label} prompt on <b className="mono">+255 {payPhone}</b> with your PIN.</p>
          <p className="spf-muted">Waiting for confirmation. This can take a minute — keep this open.</p>
          <button className="zpf-btn2" onClick={() => { stopPolling(); setStep('method'); }}>Didn&apos;t get it? Try again</button>
        </div>
      ) : null}

      {step === 'result' ? (
        <div className="spf-wait" aria-live="polite">
          {statusVal === 'payment_short' ? (
            <>
              <h3>Came up short</h3>
              <p>We only received part of your <span className="mono">TSh {fmt(amount)}</span>. Your seat&apos;s still open — pay your share again to keep it.</p>
              <button className="zpf-btn" onClick={() => setStep('method')}>PAY MY SHARE<span aria-hidden="true">→</span></button>
            </>
          ) : statusVal === 'slow' ? (
            <>
              <h3>Still processing</h3>
              <p>Mobile money can be slow. We&apos;ll text you the moment it clears — you can close this.</p>
            </>
          ) : (
            <>
              <h3>That payment didn&apos;t go through</h3>
              <p>Nothing was charged. Try again, or use another method.</p>
              <button className="zpf-btn" onClick={() => setStep('method')}>TRY AGAIN<span aria-hidden="true">→</span></button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

const CSS = `
.spf .mono{font-family:var(--zp-font-family-mono)}
.spf-pm{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.spf-m{min-height:48px;padding:0 12px;border-radius:999px;border:2px solid var(--ink);background:transparent;color:var(--ink);
  font-family:var(--zp-font-family-sans);font-weight:700;font-size:16px;cursor:pointer}
.spf-m:hover{background:var(--sunken)}
.spf-m.on{background:var(--zp-color-board-black);color:var(--yellow)}
.spf-wait{text-align:center;padding:16px 0}
.spf-wait .zpf-spinner{margin-bottom:16px}
.spf-wait h3{font-weight:800;font-size:24px;letter-spacing:-.02em;margin:0 0 8px}
.spf-wait p{color:var(--mut);font-size:16px;line-height:1.45;margin:0 0 8px}
.spf-wait p b{color:var(--ink)}
.spf-muted{font-size:14px}
`;
