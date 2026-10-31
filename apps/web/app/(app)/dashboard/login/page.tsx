'use client';

/* PR-F6 — organizer (SELLER) sign-in. Retargeted at the real ORGANIZER credential
   flow from PR-F-AUTH: POST /api/org/login. This route is the one path under
   /dashboard that the middleware gate EXEMPTS (posting here is how an anon
   organizer obtains the session the gate requires), so it must render without a
   session. Styles are page-scoped under .org-login.

   BS93 (Phase 2, T3 / D1): ONE "Email or handle" field. The API accepts an email
   OR the legacy handle in the same `identifier` field.

   BS148: Google sign-in for organizers. When /api/auth/google/config says it is
   on, CONTINUE WITH GOOGLE is the first action (same callback as the admin
   BS141 flow, intent=org carried in the signed state) and the password form sits
   behind "Use a password instead". The gate REWRITES (not redirects) a gated
   /dashboard/* URL to this page, so the address bar still holds where the
   organizer was going — that path rides along as `next` (the API re-sanitizes it).
   Restyled to the ZoraPass handoff (bone/yellow on board-black, Bricolage, 12px+
   labels, 56px primary, 44px+ link targets, "ZoraPass" wordmark). */

import { useEffect, useState } from 'react';

const STYLES = `
.org-login{--black:var(--zp-color-board-black);--ink:var(--zp-color-night);--hair:var(--zp-color-line-dark);--bone:var(--zp-color-bone);--mut:var(--zp-color-ink-300);--yellow:var(--zp-color-signal-yellow);--alert:#FF8A80;
  --sans:var(--zp-font-family-sans);--mono:var(--zp-font-family-mono);--display:var(--zp-font-family-display);
  background:var(--black);color:var(--bone);font-family:var(--sans);min-height:100vh;
  display:flex;align-items:center;justify-content:center;padding:24px 16px}
.org-login *{margin:0;padding:0;box-sizing:border-box}
.org-login .card{width:100%;max-width:420px;border:1px solid var(--hair);border-radius:16px;background:var(--ink);padding:40px 32px}
.org-login .wordmark{font-family:var(--sans);font-weight:800;font-size:28px;letter-spacing:-.035em;color:var(--bone)}
.org-login .sub{font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--mut);margin:10px 0 28px;text-transform:uppercase}
.org-login label{display:block;font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--mut);margin-bottom:8px;text-transform:uppercase}
.org-login input{width:100%;height:48px;background:var(--black);border:2px solid var(--hair);border-radius:12px;color:var(--bone);font-family:var(--sans);
  font-size:16px;padding:0 14px;outline:none;margin-bottom:20px}
.org-login input:focus-visible{border-color:var(--yellow);outline:3px solid var(--yellow);outline-offset:2px}
.org-login .btn{width:100%;min-height:56px;border-radius:16px;font-family:var(--display);font-size:20px;letter-spacing:0;
  padding:0 20px;cursor:pointer;transition:background .12s,transform .06s;display:flex;align-items:center;justify-content:center;gap:12px;text-decoration:none}
.org-login .btn:active{transform:translateY(2px)}
.org-login .btn.primary{background:var(--yellow);color:var(--black);border:none}
.org-login .btn.primary:hover{background:var(--zp-color-yellow-press)}
.org-login .btn.secondary{background:transparent;color:var(--bone);border:2px solid var(--bone)}
.org-login .btn.secondary:hover{background:rgba(247,245,238,.06)}
.org-login .btn:disabled{background:var(--hair);color:var(--zp-color-ink-500);border-color:var(--hair);cursor:not-allowed}
.org-login .btn .g{width:24px;height:24px;border-radius:50%;background:#fff;display:inline-flex;align-items:center;justify-content:center;flex:none}
.org-login .btn:focus-visible,.org-login a:focus-visible,.org-login .linkish:focus-visible{outline:3px solid var(--yellow);outline-offset:2px}
.org-login .linkish{background:none;border:none;color:var(--bone);text-decoration:underline;text-underline-offset:3px;font-family:var(--sans);
  font-size:16px;font-weight:500;min-height:44px;cursor:pointer;display:inline-flex;align-items:center;margin-top:8px}
.org-login .err{font-size:14px;line-height:1.45;color:var(--alert);margin-top:16px;border:1px solid var(--alert);border-radius:12px;padding:12px 14px}
.org-login .err a{color:var(--bone);font-weight:700;text-underline-offset:3px;display:inline-flex;align-items:center;min-height:44px}
.org-login .alt{text-align:center;font-size:16px;color:var(--mut);margin-top:28px;line-height:1.5}
.org-login .alt a{color:var(--bone);font-weight:700;text-decoration:underline;text-underline-offset:3px;display:inline-flex;align-items:center;min-height:44px;padding:0 4px}
.org-login .back{display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:12px;letter-spacing:.12em;
  color:var(--mut);margin-top:12px;text-decoration:none;min-height:44px}
.org-login .back:hover{color:var(--bone)}
@media (max-width:480px){.org-login .card{padding:32px 20px}}
`;

/** Client-side mirror of the API's sanitizer (the API is the authority). */
function safeNext(raw: string | null): string | null {
  if (!raw || raw[0] !== '/' || raw[1] === '/' || raw.includes('\\')) return null;
  const path = raw.split(/[?#]/)[0];
  if (path === '/dashboard/login' || path === '/dashboard/signup') return null;
  return path === '/dashboard' || path.startsWith('/dashboard/') ? raw : null;
}

const GOOGLE_ERRORS: Record<string, string> = {
  suspended: 'This organizer account is suspended. Contact ZoraPass support to sort it out.',
  google_mismatch: 'That email is linked to a different Google account. Sign in with your password instead.',
  state: 'That took too long. Start again.',
  google_off: 'Google sign-in isn’t set up yet. Use your password.',
};

export default function OrganizerLoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [noAccount, setNoAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState<boolean | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [next, setNext] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/google/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => setGoogle(!!d?.enabled))
      .catch(() => setGoogle(false));
    const params = new URLSearchParams(window.location.search);
    // An explicit ?next=, else the gated URL the middleware rewrote from.
    setNext(safeNext(params.get('next')) ?? safeNext(window.location.pathname + window.location.search));
    const q = params.get('error');
    if (q === 'no_account') setNoAccount(true);
    else if (q) setError(GOOGLE_ERRORS[q] || 'Google sign-in didn’t go through. Try again, or use your password.');
  }, []);

  const googleHref = '/api/auth/google/start?intent=org' + (next ? `&next=${encodeURIComponent(next)}` : '');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNoAccount(false);
    setBusy(true);
    try {
      const r = await fetch('/api/org/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // BS93: `identifier` = email OR legacy handle (one field).
        body: JSON.stringify({ identifier, password }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'Login failed');
      }
      // Full navigation so the middleware gate re-runs with the fresh cookie.
      window.location.href = next || '/dashboard';
    } catch (ex: any) {
      setError(String(ex?.message || ex));
      setBusy(false);
    }
  }

  const passwordVisible = google === false || showPassword;
  const errorBox = (noAccount || error) && (
    <div className="err" role="alert">
      {noAccount ? (
        <>
          No ZoraPass organizer account uses that Google email.{' '}
          <a href="/api/auth/google/start?intent=signup">Sign up with Google</a>, or sign in with your password.
        </>
      ) : (
        error
      )}
    </div>
  );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="org-login">
        <div className="card">
          <p className="wordmark">ZoraPass</p>
          <p className="sub">Organizer sign-in</p>
          {google && (
            <a className="btn primary" href={googleHref}>
              <span className="g" aria-hidden="true">
                <GoogleG />
              </span>
              CONTINUE WITH GOOGLE
            </a>
          )}
          {google && !showPassword && (
            <button type="button" className="linkish" onClick={() => setShowPassword(true)}>
              Use a password instead
            </button>
          )}
          {!passwordVisible && errorBox}
          {passwordVisible && (
            <form onSubmit={onSubmit} style={google ? { marginTop: 20 } : undefined}>
              <label htmlFor="identifier">Email or handle</label>
              <input
                id="identifier"
                autoComplete="username"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {/* One primary per view: with Google on, the password submit is secondary. */}
              <button type="submit" className={'btn ' + (google ? 'secondary' : 'primary')} disabled={busy}>
                {busy ? 'SIGNING IN…' : 'SIGN IN'}
              </button>
              {errorBox}
            </form>
          )}
          {/* BS41 (#4): sign-in and sign-up are one surface. */}
          <p className="alt">
            Don’t have an account? <a href="/dashboard/signup">Start selling on ZoraPass</a>
          </p>
          <a className="back" href="/">
            &larr; BACK TO THE SITE
          </a>
        </div>
      </div>
    </>
  );
}

function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.9-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-10l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
