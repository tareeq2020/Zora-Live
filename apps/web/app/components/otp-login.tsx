'use client';

/* BS8 — consumer SMS-OTP sign-in (A3/D6). Reusable: phone → 6-digit code →
   consumer session (zora_buyer cookie set by the API). No password, no download.
   POST /api/otp/request, POST /api/otp/verify. */

import { useEffect, useState } from 'react';

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
    } catch { setError('Network error — try again.'); }
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
      if (d.error === 'expired') { setError('That code expired — resend a new one.'); return; }
      setError(d.attemptsLeft != null ? `Wrong code. ${d.attemptsLeft} tries left.` : 'Wrong code — try again.');
    } catch { setError('Network error — try again.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="ol">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wm">Z<span className="o" />RA</div>
      {phase === 'phone' ? (
        <>
          <h2 className="t">Your number is your ticket.</h2>
          <p className="sub">{lead || "We'll text you a code — that's it. No password, nothing to download."}</p>
          <div className="field"><span className="pfx">+255</span>
            <input inputMode="tel" autoFocus placeholder="712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && request()} /></div>
          {error ? <div className="err">{error}</div> : null}
          <button className="btn" disabled={busy} onClick={request}>{busy ? 'Sending…' : 'Text me a code'}</button>
        </>
      ) : (
        <>
          <h2 className="t">Enter the code</h2>
          <p className="sub">Sent to <b>+255 {phone}</b>. <a onClick={() => { setPhase('phone'); setCode(''); setError(null); }}>Change</a></p>
          <input className="code" inputMode="numeric" autoFocus maxLength={6} placeholder="••••••" value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(e) => e.key === 'Enter' && verify()} />
          <p className="resend mono">{resendIn > 0 ? `Resend in 0:${String(resendIn).padStart(2, '0')}` : <a onClick={request}>Resend code</a>}</p>
          {error ? <div className="err">{error}</div> : null}
          <button className="btn" disabled={busy} onClick={verify}>{busy ? 'Verifying…' : 'Verify'}</button>
        </>
      )}
    </div>
  );
}

const CSS = `
.ol{--c-surface2:#171A28;--c-text:#EDEFF7;--c-text2:#9BA3C4;--c-text3:#5C6488;--c-line:rgba(124,160,255,.12);--c-line2:rgba(124,160,255,.22);--c-blue:#4C6FFF;--c-ice:#7CA0FF;
  --c-aura:linear-gradient(130deg,#D53AD8 0%,#FF4D7D 48%,#FF9145 100%);--sans:'Inter',system-ui,sans-serif;--disp:'Space Grotesk',var(--sans);--mono:'IBM Plex Mono',monospace;color:var(--c-text);font-family:var(--sans)}
.ol .wm{font-family:var(--disp);font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:18px;display:inline-flex;align-items:center;color:var(--c-text2)}
.ol .wm .o{width:.62em;height:.62em;margin:0 .05em;border-radius:50%;background:var(--c-aura);display:inline-block;box-shadow:0 0 10px rgba(255,90,120,.4)}
.ol .t{font-family:var(--disp);font-weight:600;font-size:23px;line-height:1.15;letter-spacing:-.01em;margin:14px 0 8px}
.ol .sub{color:var(--c-text2);font-size:13.5px;line-height:1.6}
.ol .sub a{color:var(--c-ice);cursor:pointer}
.ol .field{background:var(--c-surface2);border:1px solid var(--c-line);border-radius:12px;padding:14px 15px;display:flex;align-items:center;gap:10px;margin-top:16px}
.ol .field:focus-within{border-color:var(--c-blue);box-shadow:0 0 0 3px rgba(76,111,255,.16)}
.ol .field .pfx{font-family:var(--mono);color:var(--c-text2);font-size:15px}
.ol .field input{background:none;border:none;outline:none;color:var(--c-text);font-family:var(--mono);font-size:16px;width:100%}
.ol .code{width:100%;margin-top:16px;background:var(--c-surface2);border:1px solid var(--c-line2);border-radius:12px;padding:14px;text-align:center;letter-spacing:.5em;font-family:var(--mono);font-size:22px;color:var(--c-text);outline:none}
.ol .code:focus{border-color:var(--c-blue);box-shadow:0 0 0 3px rgba(76,111,255,.16)}
.ol .resend{font-family:var(--mono);font-size:11px;color:var(--c-text3);margin-top:10px}
.ol .resend a{color:var(--c-ice);cursor:pointer}
.ol .err{background:rgba(255,145,69,.1);border:1px solid rgba(255,145,69,.35);color:#FF9145;border-radius:10px;padding:10px 12px;font-size:12.5px;margin-top:12px}
.ol .btn{display:block;width:100%;text-align:center;font-family:var(--disp);font-weight:600;font-size:14.5px;padding:15px;border-radius:13px;border:none;cursor:pointer;background:var(--c-aura);color:#fff;box-shadow:0 8px 26px rgba(255,77,125,.28);margin-top:16px}
.ol .btn:disabled{opacity:.6}
`;
