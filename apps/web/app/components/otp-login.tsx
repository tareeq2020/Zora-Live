'use client';

/* BS8 — consumer SMS-OTP sign-in (A3/D6). Reusable: phone → 6-digit code →
   consumer session (zora_buyer cookie set by the API). No password, no download.
   POST /api/otp/request, POST /api/otp/verify.
   BS119: ZoraPass flow primitives (zp-flow-css) — bone, black, one yellow. */

import { useEffect, useState } from 'react';
import { ZP_FLOW_CSS } from './zp-flow-css';

export default function OtpLogin({ onSignedIn, lead }: { onSignedIn: (phone: string) => void; lead?: string }) {
  const [phase, setPhase] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function request() {
    if (phone.replace(/\D/g, '').length < 9) { setError('Enter your mobile number.'); return; }
    setError(null); setBusy(true);
    try {
      const res = await fetch('/api/otp/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.trim() }),
      });
      if (res.status === 429) { setError('Too many requests. Wait a minute and try again.'); return; }
      if (!res.ok) { setError('Could not send a code. Try again.'); return; }
      setPhase('code'); setResendIn(30);
    } catch { setError('No connection. Try again.'); }
    finally { setBusy(false); }
  }

  async function verify() {
    if (code.length < 6) { setError('Enter the 6-digit code.'); return; }
    setError(null); setBusy(true);
    try {
      const res = await fetch('/api/otp/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.trim(), code }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 200 && d.ok) { onSignedIn(phone.trim()); return; }
      if (d.error === 'too_many_attempts') { setError('Too many tries. Wait a bit and resend a new code.'); return; }
      if (d.error === 'expired') { setError('That code expired. Resend a new one.'); return; }
      setError(d.attemptsLeft != null ? `That code didn't match. ${d.attemptsLeft} tries left.` : "That code didn't match. Check the message and try again.");
    } catch { setError('No connection. Try again.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="zpf ol">
      <style dangerouslySetInnerHTML={{ __html: ZP_FLOW_CSS + CSS }} />
      {phase === 'phone' ? (
        <>
          <h2 className="zpf-t">Your number is your pass.</h2>
          <p className="zpf-sub">{lead || "We'll text you a code. No password, nothing to download."}</p>
          <label className="zpf-lab" htmlFor="ol-phone">Mobile number</label>
          <div className="zpf-field"><span className="pfx">+255</span>
            <input id="ol-phone" inputMode="tel" autoFocus placeholder="712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && request()} /></div>
          {error ? <div className="zpf-err" role="alert">{error}</div> : null}
          <button className="zpf-btn" disabled={busy} onClick={request}>TEXT ME A CODE{busy ? <span className="spin" aria-label="Sending" /> : <span aria-hidden="true">→</span>}</button>
        </>
      ) : (
        <>
          <h2 className="zpf-t">Enter the code</h2>
          <p className="zpf-sub">Sent to <b className="mono">+255 {phone}</b>. <button type="button" className="zpf-link" onClick={() => { setPhase('phone'); setCode(''); setError(null); }}>Change</button></p>
          <label className="zpf-lab" htmlFor="ol-code">6-digit code</label>
          <input id="ol-code" className="code" inputMode="numeric" autoFocus maxLength={6} placeholder="••••••" value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(e) => e.key === 'Enter' && verify()} />
          <p className="resend">{resendIn > 0 ? `RESEND IN 0:${String(resendIn).padStart(2, '0')}` : <button type="button" className="zpf-link" onClick={request}>Resend code</button>}</p>
          {error ? <div className="zpf-err" role="alert">{error}</div> : null}
          <button className="zpf-btn" disabled={busy} onClick={verify}>VERIFY{busy ? <span className="spin" aria-label="Verifying" /> : <span aria-hidden="true">→</span>}</button>
        </>
      )}
    </div>
  );
}

const CSS = `
.ol .mono{font-family:var(--zp-font-family-mono)}
.ol .code{width:100%;height:56px;background:var(--raised);border:2px solid var(--line);border-radius:12px;padding:0 14px;text-align:center;letter-spacing:.5em;font-family:var(--zp-font-family-mono);font-size:24px;color:var(--ink);outline:none}
.ol .code:focus{border-color:var(--ink);outline:3px solid var(--yellow);outline-offset:2px}
.ol .resend{font-family:var(--zp-font-family-mono);font-size:13px;letter-spacing:.08em;color:var(--mut);margin:12px 0 0;min-height:24px}
`;
