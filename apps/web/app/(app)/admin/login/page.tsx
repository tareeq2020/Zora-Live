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

import { useState } from 'react';

const STYLES = `
.admin-login{--black:#0A0A0B;--ink:#101012;--hair:#222226;--bone:#F4F1EA;--mut:#8A877E;--blue:#3D5AFE;--orange:#FF5A1F;
  --sans:'Archivo',system-ui,sans-serif;--mono:'IBM Plex Mono',monospace;
  background:var(--black);color:var(--bone);font-family:var(--sans);min-height:100vh;
  display:flex;align-items:center;justify-content:center;padding:24px}
.admin-login *{margin:0;padding:0;box-sizing:border-box}
.admin-login .card{width:100%;max-width:400px;border:1px solid var(--hair);padding:44px 36px}
.admin-login .wordmark{font-weight:600;font-size:26px;letter-spacing:-.02em}
.admin-login .wordmark .o{color:var(--blue)}
.admin-login .sub{font-family:var(--mono);font-size:11px;letter-spacing:.3em;color:var(--mut);margin:10px 0 34px}
.admin-login label{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.25em;color:var(--mut);margin-bottom:8px}
.admin-login input{width:100%;background:var(--ink);border:1px solid var(--hair);color:var(--bone);font-family:var(--mono);
  font-size:15px;padding:13px 15px;outline:none;margin-bottom:20px;border-radius:0}
.admin-login input:focus{border-color:var(--blue)}
.admin-login button{width:100%;background:var(--bone);color:var(--black);border:none;font-family:var(--mono);font-size:13px;
  font-weight:500;letter-spacing:.2em;padding:15px;cursor:pointer;transition:background .2s}
.admin-login button:hover{background:var(--blue);color:var(--bone)}
.admin-login .err{font-family:var(--mono);font-size:12px;color:var(--orange);letter-spacing:.05em;margin-top:16px;
  border:1px dashed var(--orange);padding:12px 14px}
.admin-login .back{display:block;text-align:center;font-family:var(--mono);font-size:11px;letter-spacing:.15em;
  color:var(--mut);margin-top:26px;text-decoration:none}
.admin-login .back:hover{color:var(--bone)}
`;

export default function AdminLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="admin-login">
        <div className="card">
          <p className="wordmark">
            z<span className="o">o</span>ra
          </p>
          <p className="sub">INTERNAL STAFF CONSOLE — AUTHORIZED ONLY</p>
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
          <a className="back" href="/">
            &larr; BACK TO THE SITE
          </a>
        </div>
      </div>
    </>
  );
}
