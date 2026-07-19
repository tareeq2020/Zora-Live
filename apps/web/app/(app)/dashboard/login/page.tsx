'use client';

/* PR-F6 — organizer (SELLER) sign-in. Faithful React port of the admin login
   card design, retargeted at the real ORGANIZER credential flow from PR-F-AUTH:
   POST /api/org/login with { handle, password }. This route is the one path
   under /dashboard that the middleware gate EXEMPTS (posting here is how an anon
   organizer obtains the session the gate requires), so it must render without a
   session. On success the API sets the organizer cookie and we send the seller
   to /dashboard. Styles + fonts are page-scoped (scoped under .org-login) so the
   bespoke control-room look never leaks into the rest of the app tree. */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STYLES = `
.org-login{--black:#0A0A0B;--ink:#101012;--hair:#222226;--bone:#F4F1EA;--mut:#8A877E;--blue:#3D5AFE;--orange:#FF5A1F;
  --sans:'Archivo',system-ui,sans-serif;--mono:'IBM Plex Mono',monospace;
  background:var(--black);color:var(--bone);font-family:var(--sans);min-height:100vh;
  display:flex;align-items:center;justify-content:center;padding:24px}
.org-login *{margin:0;padding:0;box-sizing:border-box}
.org-login .card{width:100%;max-width:400px;border:1px solid var(--hair);padding:44px 36px}
.org-login .wordmark{font-weight:600;font-size:26px;letter-spacing:-.02em}
.org-login .wordmark .o{color:var(--blue)}
.org-login .sub{font-family:var(--mono);font-size:11px;letter-spacing:.3em;color:var(--mut);margin:10px 0 34px}
.org-login label{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.25em;color:var(--mut);margin-bottom:8px}
.org-login input{width:100%;background:var(--ink);border:1px solid var(--hair);color:var(--bone);font-family:var(--mono);
  font-size:15px;padding:13px 15px;outline:none;margin-bottom:20px;border-radius:0}
.org-login input:focus{border-color:var(--blue)}
.org-login button{width:100%;background:var(--bone);color:var(--black);border:none;font-family:var(--mono);font-size:13px;
  font-weight:500;letter-spacing:.2em;padding:15px;cursor:pointer;transition:background .2s}
.org-login button:hover{background:var(--blue);color:var(--bone)}
.org-login .err{font-family:var(--mono);font-size:12px;color:var(--orange);letter-spacing:.05em;margin-top:16px;
  border:1px dashed var(--orange);padding:12px 14px}
.org-login .back{display:block;text-align:center;font-family:var(--mono);font-size:11px;letter-spacing:.15em;
  color:var(--mut);margin-top:26px;text-decoration:none}
.org-login .back:hover{color:var(--bone)}
`;

export default function OrganizerLoginPage() {
  const router = useRouter();
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await fetch('/api/org/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, password }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'Login failed');
      }
      // Full navigation so the middleware gate re-runs with the fresh cookie.
      window.location.href = '/dashboard';
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
      <div className="org-login">
        <div className="card">
          <p className="wordmark">
            z<span className="o">o</span>ra
          </p>
          <p className="sub">SELLER SIGN-IN</p>
          <form onSubmit={onSubmit}>
            <label htmlFor="handle">ORGANIZER HANDLE</label>
            <input
              id="handle"
              autoComplete="username"
              required
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
            <label htmlFor="password">PASSWORD</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="submit" disabled={busy}>
              {busy ? 'SIGNING IN…' : 'ENTER'}
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
