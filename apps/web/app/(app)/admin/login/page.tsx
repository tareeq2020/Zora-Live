'use client';

/* PR-F9 — the INTERNAL STAFF sign-in (admin/login.html) as a React route at
   /admin/login. Idiomatic React port (like the F2 marketing pages / the F6
   organizer login), retargeted at the admin credential flow: POST /api/login
   with { username, password }. This is the login the middleware /admin gate
   rewrites to for an anonymous visitor, so it must render without a session.
   On success we do a FULL navigation to /admin (not a reload) so the gate
   re-runs with the fresh admin cookie and rewrites through to the staff
   console. Styles + fonts are page-scoped under .admin-login so the bespoke
   control-room look never leaks into the rest of the app tree. This is the
   INTERNAL staff console — distinct from the organizer seller sign-in at
   /dashboard/login. */

import { useEffect, useState } from 'react';

const STYLES = `
.admin-login{--black:var(--zp-color-board-black);--ink:var(--zp-color-night);--hair:var(--zp-color-line-dark);--bone:var(--zp-color-bone);--mut:var(--zp-color-ink-300);--yellow:var(--zp-color-signal-yellow);--alert:#FF8A80;
  --sans:var(--zp-font-family-sans);--mono:var(--zp-font-family-mono);
  background:var(--black);color:var(--bone);font-family:var(--sans);min-height:100vh;
  display:flex;align-items:center;justify-content:center;padding:24px}
.admin-login *{margin:0;padding:0;box-sizing:border-box}
.admin-login .card{width:100%;max-width:400px;border:1px solid var(--hair);border-radius:16px;background:var(--ink);padding:40px 32px}
.admin-login .wordmark{font-weight:700;font-size:28px;letter-spacing:-.035em;color:var(--bone)}
.admin-login .sub{font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--mut);margin:10px 0 32px;text-transform:uppercase}
.admin-login label{display:block;font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--mut);margin-bottom:8px}
.admin-login input{width:100%;height:48px;background:var(--black);border:2px solid var(--hair);border-radius:12px;color:var(--bone);font-family:var(--sans);
  font-size:16px;padding:0 14px;outline:none;margin-bottom:20px}
.admin-login input:focus-visible{border-color:var(--yellow);outline:3px solid var(--yellow);outline-offset:2px}
.admin-login button,.admin-login .google{width:100%;min-height:56px;background:var(--yellow);color:var(--black);border:none;border-radius:16px;font-family:var(--sans);font-size:16px;
  font-weight:700;letter-spacing:.02em;padding:0 20px;cursor:pointer;transition:background .12s;display:flex;align-items:center;justify-content:center;text-decoration:none}
.admin-login button:hover,.admin-login .google:hover{background:var(--zp-color-yellow-press)}
.admin-login button:focus-visible,.admin-login .google:focus-visible,.admin-login .back:focus-visible{outline:3px solid var(--yellow);outline-offset:2px}
.admin-login .google{margin:8px 0 12px}
.admin-login .linkish{background:none!important;color:var(--bone)!important;text-decoration:underline;font-size:14px;font-weight:500;min-height:44px;padding:0!important;width:auto!important;justify-content:flex-start}
.admin-login .err{font-size:14px;color:var(--alert);margin-top:16px;border:1px solid var(--alert);border-radius:12px;padding:12px 14px}
.admin-login .back{display:block;text-align:center;font-family:var(--mono);font-size:12px;letter-spacing:.12em;
  color:var(--mut);margin-top:24px;text-decoration:none;min-height:44px;line-height:44px}
.admin-login .back:hover{color:var(--bone)}
`;

export default function AdminLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // BS141: Google is the default admin sign-in when configured; the password
  // form stays as the break-glass fallback behind a link.
  const [google, setGoogle] = useState<boolean | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => {
    fetch('/api/auth/google/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => setGoogle(!!d?.enabled))
      .catch(() => setGoogle(false));
    const q = new URLSearchParams(window.location.search).get('error');
    const msg: Record<string, string> = {
      not_allowed: 'THAT GOOGLE ACCOUNT IS NOT AN ADMIN. ASK AN ADMIN TO ADD YOU.',
      state: 'THAT TOOK TOO LONG. START AGAIN.',
      google_off: 'GOOGLE SIGN-IN IS NOT SET UP. USE YOUR PASSWORD.',
    };
    if (q) setError(msg[q] || 'GOOGLE SIGN-IN DIDN\'T GO THROUGH. TRY AGAIN.');
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'Login failed');
      }
      // Full navigation to /admin so the middleware gate re-runs with the fresh
      // admin cookie and rewrites through to the staff console.
      window.location.href = '/admin';
    } catch (ex: any) {
      setError(String(ex?.message || ex).toUpperCase());
      setBusy(false);
    }
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="admin-login">
        <div className="card">
          <p className="wordmark">ZoraPass</p>
          <p className="sub">Staff console · authorized only</p>
          {google && (
            <a className="google" href="/api/auth/google/start">CONTINUE WITH GOOGLE</a>
          )}
          {google && !showPassword && (
            <button type="button" className="linkish" onClick={() => setShowPassword(true)}>
              Use a password instead
            </button>
          )}
          {google && !showPassword && error && <p className="err">{error}</p>}
          {(google === false || showPassword) && (
          <form onSubmit={onSubmit}>
            <label htmlFor="u">USERNAME</label>
            <input
              id="u"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <label htmlFor="p">PASSWORD</label>
            <input
              id="p"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="submit" disabled={busy}>
              {busy ? 'ENTERING…' : 'ENTER'}
            </button>
            {error && <p className="err">{error}</p>}
          </form>
          )}
          <a className="back" href="/">
            &larr; BACK TO THE SITE
          </a>
        </div>
      </div>
    </>
  );
}
