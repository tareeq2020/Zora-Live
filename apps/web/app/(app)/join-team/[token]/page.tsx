'use client';

/* BS94 · auth Phase 3 — the TEAM INVITE accept page. A pre-auth surface: the
   invitee may be a brand-new user with no session, so this route is public (the
   token IS the authorization). It reads GET /api/org/invites/:token to show the
   org + role you're invited to, offers a password field when you're new, and
   POSTs the accept — on success the API logs you in and we land you on the
   organizer dashboard for that org.

   Page-scoped styles (scoped under .join-team) mirror the seller sign-in card so
   the bespoke control-room look never leaks into the app tree. */

import { use, useEffect, useState } from 'react';

const STYLES = `
.join-team{--black:#0A0A0B;--ink:#101012;--hair:#222226;--bone:#F4F1EA;--mut:#8A877E;--blue:#3D5AFE;--orange:#FF5A1F;--green:#2ECC71;
  --sans:'Archivo',system-ui,sans-serif;--mono:'IBM Plex Mono',monospace;
  background:var(--black);color:var(--bone);font-family:var(--sans);min-height:100vh;
  display:flex;align-items:center;justify-content:center;padding:24px}
.join-team *{margin:0;padding:0;box-sizing:border-box}
.join-team .card{width:100%;max-width:420px;border:1px solid var(--hair);padding:44px 36px}
.join-team .wordmark{font-weight:600;font-size:26px;letter-spacing:-.02em}
.join-team .wordmark .o{color:var(--blue)}
.join-team .sub{font-family:var(--mono);font-size:11px;letter-spacing:.3em;color:var(--mut);margin:10px 0 30px}
.join-team h1{font-size:22px;font-weight:600;line-height:1.3;margin-bottom:10px}
.join-team .lede{font-size:14px;line-height:1.6;color:var(--mut);margin-bottom:24px}
.join-team .lede strong{color:var(--bone)}
.join-team .role{display:inline-block;font-family:var(--mono);font-size:11px;letter-spacing:.2em;color:var(--blue);
  border:1px solid var(--hair);padding:5px 10px;margin-bottom:24px}
.join-team label{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.25em;color:var(--mut);margin-bottom:8px}
.join-team input{width:100%;background:var(--ink);border:1px solid var(--hair);color:var(--bone);font-family:var(--mono);
  font-size:15px;padding:13px 15px;outline:none;margin-bottom:20px;border-radius:0}
.join-team input:focus{border-color:var(--blue)}
.join-team input:disabled{opacity:.6}
.join-team button{width:100%;background:var(--bone);color:var(--black);border:none;font-family:var(--mono);font-size:13px;
  font-weight:500;letter-spacing:.2em;padding:15px;cursor:pointer;transition:background .2s}
.join-team button:hover:not(:disabled){background:var(--blue);color:var(--bone)}
.join-team button:disabled{opacity:.5;cursor:default}
.join-team .err{font-family:var(--mono);font-size:12px;color:var(--orange);letter-spacing:.05em;margin-top:16px;
  border:1px dashed var(--orange);padding:12px 14px}
.join-team .hint{font-family:var(--mono);font-size:11px;color:var(--mut);margin:-12px 0 20px}
.join-team .back{display:block;text-align:center;font-family:var(--mono);font-size:11px;letter-spacing:.15em;
  color:var(--mut);margin-top:22px;text-decoration:none}
.join-team .back:hover{color:var(--bone)}
`;

type InviteInfo = {
  valid: boolean;
  reason?: string;
  email?: string;
  role?: string;
  orgName?: string | null;
  needsPassword?: boolean;
};

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin', finance: 'Finance', door: 'Door', viewer: 'Viewer', owner: 'Owner',
};
const INVALID_COPY: Record<string, string> = {
  not_found: 'This invitation link is not valid. Ask whoever invited you for a fresh one.',
  expired: 'This invitation has expired. Ask whoever invited you to send a new one.',
  accepted: 'This invitation has already been used. Try signing in instead.',
};

export default function JoinTeamPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch(`/api/org/invites/${encodeURIComponent(token)}`, { cache: 'no-store' });
        const d = (await r.json().catch(() => ({}))) as InviteInfo;
        if (live) setInfo(d && typeof d.valid === 'boolean' ? d : { valid: false, reason: 'not_found' });
      } catch {
        if (live) setInfo({ valid: false, reason: 'not_found' });
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [token]);

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (info?.needsPassword && password.length < 8) {
      setError('CHOOSE A PASSWORD OF AT LEAST 8 CHARACTERS');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/org/invites/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(info?.needsPassword ? { password } : {}),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.message || d.error || 'Could not accept the invitation');
      }
      // Full navigation so the middleware gate re-runs with the fresh cookie.
      window.location.href = '/dashboard/overview';
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
      <div className="join-team">
        <div className="card">
          <p className="wordmark">z<span className="o">o</span>ra</p>
          <p className="sub">TEAM INVITATION</p>

          {loading ? (
            <p className="lede">Checking your invitation…</p>
          ) : !info || !info.valid ? (
            <>
              <h1>Invitation unavailable</h1>
              <p className="lede">{INVALID_COPY[info?.reason ?? 'not_found'] ?? INVALID_COPY.not_found}</p>
              <a className="back" href="/dashboard/login">&larr; GO TO SIGN-IN</a>
            </>
          ) : (
            <>
              <h1>Join {info.orgName || 'the team'}</h1>
              <p className="lede">
                You&apos;ve been invited to join <strong>{info.orgName || 'this organizer'}</strong>
                {info.email ? <> as <strong>{info.email}</strong></> : null}. Accept below to get access.
              </p>
              <span className="role">ROLE · {ROLE_LABEL[info.role ?? ''] ?? (info.role ?? '').toUpperCase()}</span>

              <form onSubmit={accept}>
                {info.needsPassword ? (
                  <>
                    <label htmlFor="jt-pass">SET A PASSWORD</label>
                    <input
                      id="jt-pass"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy}
                    />
                    <p className="hint">At least 8 characters — you&apos;ll sign in with this next time.</p>
                  </>
                ) : (
                  <p className="hint" style={{ marginTop: 0 }}>You already have a Zora account — accepting adds this organizer to it.</p>
                )}
                <button type="submit" disabled={busy}>
                  {busy ? 'JOINING…' : 'ACCEPT INVITATION'}
                </button>
                {error && <p className="err">{error}</p>}
              </form>
            </>
          )}
        </div>
      </div>
    </>
  );
}
