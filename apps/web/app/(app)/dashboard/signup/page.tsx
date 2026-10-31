'use client';

/* PR-BS41 (#4) — ORGANIZER SELF-REGISTRATION at /dashboard/signup.

   Until now the only way to become an organizer was for someone at Zora to
   create the row by hand. This is the public front door: phone → SMS code →
   org name + handle, and you land inside your own dashboard with a pending
   account you can immediately build drafts in.

   BS148 (owner request 2026-10-31): "Continue with Google" is now offered on the
   phone step. It goes through the shared /api/auth/google flow (intent=signup);
   an existing organizer is simply signed in, anyone else comes back here with
   ?google=1 and a signed ticket cookie the API reads. GET /api/org/google-signup
   returns the verified email/name, which this page shows LOCKED — the register
   call takes the email from the ticket, never the form. The phone OTP below is
   unchanged and still required (phone stays the verified identity); the password
   becomes optional because they can sign back in with Google.

   Two steps, not three. The code and the org details share ONE screen because the
   6-digit code is single-use: the server proves the phone and creates the account
   in the same call (POST /api/org/register), so there is nothing to verify early
   and no half-created account if the second half fails. It also means the OTP
   states the design spec asks for (sent · invalid · expired · resend cooldown)
   and the handle states (taken · reserved) can all resolve against the field they
   belong to, on the screen the person is already looking at.

   BS50: restyled onto the CONSUMER plane of DESIGN.md (Bricolage Grotesque /
   IBM Plex Mono, the sunrise aura reserved for the wordmark O + the primary
   CTA, blue focus rings, the same soft ambient glow language as /discover) —
   this is a public acquisition funnel, not an internal tool, so it reads like
   the rest of the fan-facing surfaces rather than the organizer control-room.
   /dashboard/login stays on the control-room palette; the two no longer need
   to match now that signup lives on a different plane. Page-scoped under
   .org-signup. No Tailwind.

   Every state on this screen: default · checking/submitting (disabled + labelled)
   · empty (nothing typed → the primary action is disabled, not silently inert)
   · error (each one names a cause AND a way forward) · disabled · success. */

import { useCallback, useEffect, useRef, useState } from 'react';

type Phase = 'phone' | 'details' | 'done';

/** Live handle-availability state — the picker's whole vocabulary. */
type HandleState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'free'; message: string }
  | { kind: 'blocked'; reason: string; message: string };

const MIN_HANDLE = 3;
const RESEND_SECONDS = 30;

/** Same normalization the API applies, so what the field shows is what is saved. */
function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9-]/g, '');
}

export default function OrganizerSignupPage() {
  const [phase, setPhase] = useState<Phase>('phone');

  // step 1
  const [phone, setPhone] = useState('');
  // step 2
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [handleTouched, setHandleTouched] = useState(false);
  const [password, setPassword] = useState('');

  const [busy, setBusy] = useState(false);
  // Errors are keyed by the field they belong to so the message sits next to the
  // thing that has to change — a global banner would make "wrong code" and
  // "handle taken" look like the same problem.
  const [error, setError] = useState<{ field: 'phone' | 'code' | 'name' | 'handle' | 'password' | 'form'; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [handleState, setHandleState] = useState<HandleState>({ kind: 'idle' });
  // BS148 — Google: is it configured, and has a verified identity been handed over?
  const [googleOn, setGoogleOn] = useState(false);
  const [googleId, setGoogleId] = useState<{ email: string; name: string | null } | null>(null);

  useEffect(() => {
    fetch('/api/auth/google/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => setGoogleOn(!!d?.enabled))
      .catch(() => setGoogleOn(false));
    fetch('/api/org/google-signup', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.email) setGoogleId({ email: String(d.email), name: d.name ? String(d.name) : null });
      })
      .catch(() => {});
    const q = new URLSearchParams(window.location.search).get('error');
    const msg: Record<string, string> = {
      suspended: 'That organizer account is suspended. Contact ZoraPass support to sort it out.',
      google_mismatch: 'That email is linked to a different Google account. Sign in with your password instead.',
      state: 'That took too long. Start again.',
      google_off: 'Google sign-up isn’t set up yet. Use your phone number below.',
    };
    if (q) setError({ field: 'form', text: msg[q] || 'Google sign-up didn’t go through. Try again, or use your phone number.' });
  }, []);

  // ── resend cooldown ────────────────────────────────────────────────────────
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // ── live handle availability ───────────────────────────────────────────────
  // Debounced, and every in-flight check carries a sequence number: a slow reply
  // for "bru" must never overwrite the verdict for "brunch".
  const seq = useRef(0);
  useEffect(() => {
    const h = normalizeHandle(handle);
    if (!h) {
      setHandleState({ kind: 'idle' });
      return;
    }
    if (h.length < MIN_HANDLE) {
      setHandleState({ kind: 'blocked', reason: 'too_short', message: `At least ${MIN_HANDLE} characters.` });
      return;
    }
    setHandleState({ kind: 'checking' });
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/org/handle-available?handle=${encodeURIComponent(h)}`, { cache: 'no-store' });
        const d = await res.json().catch(() => ({}));
        if (mine !== seq.current) return; // a newer keystroke already won
        if (!res.ok) {
          setHandleState({ kind: 'blocked', reason: 'error', message: 'Couldn’t check that handle. It’s checked again when you submit.' });
          return;
        }
        setHandleState(
          d.available
            ? { kind: 'free', message: d.message || `zorapass.com/${h} is yours.` }
            : { kind: 'blocked', reason: String(d.reason || 'taken'), message: d.message || 'Try another handle.' },
        );
      } catch {
        if (mine !== seq.current) return;
        setHandleState({ kind: 'blocked', reason: 'error', message: 'Network error — we’ll check again when you submit.' });
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [handle]);

  // ── step 1: send the code ──────────────────────────────────────────────────
  const sendCode = useCallback(
    async (resend = false) => {
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 9) {
        setError({ field: 'phone', text: 'Enter your mobile number — 9 digits after +255.' });
        return;
      }
      setError(null);
      setBusy(true);
      try {
        const res = await fetch('/api/otp/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone.trim() }),
        });
        const d = await res.json().catch(() => ({}));
        if (res.status === 429) {
          const wait = Number(d?.retryAfterSec) || 60;
          setResendIn(wait);
          setError({ field: 'phone', text: `Too many codes requested. Try again in ${wait} seconds.` });
          return;
        }
        if (!res.ok) {
          setError({ field: 'phone', text: d?.error === 'phone_required' ? 'That number doesn’t look right — check it and try again.' : 'Couldn’t send a code. Try again.' });
          return;
        }
        setPhase('details');
        setResendIn(RESEND_SECONDS);
        setNotice(resend ? 'New code sent.' : `Code sent to +255 ${phone.trim()}. It expires in 5 minutes.`);
      } catch {
        setError({ field: 'phone', text: 'Network error — check your connection and try again.' });
      } finally {
        setBusy(false);
      }
    },
    [phone],
  );

  // ── step 2: create the account ─────────────────────────────────────────────
  async function submit() {
    const h = normalizeHandle(handle);
    if (code.length < 6) {
      setError({ field: 'code', text: 'Enter the 6-digit code from the SMS.' });
      return;
    }
    if (name.trim().length < 2) {
      setError({ field: 'name', text: 'Enter your organization’s name — it’s what buyers see.' });
      return;
    }
    if (h.length < MIN_HANDLE) {
      setError({ field: 'handle', text: `Pick a handle — at least ${MIN_HANDLE} characters.` });
      return;
    }
    if (googleId ? password.length > 0 && password.length < 8 : password.length < 8) {
      setError({ field: 'password', text: 'Password must be at least 8 characters.' });
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch('/api/org/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // BS148: with a Google ticket the API takes the email from it; the
        // password is optional then (empty → omitted).
        body: JSON.stringify({ phone: phone.trim(), code, name: name.trim(), handle: h, ...(password ? { password } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.ok) {
        setPhase('done');
        // Full navigation, not router.push: the middleware /dashboard gate has to
        // re-run against the cookie the API just set.
        setTimeout(() => {
          window.location.href = '/dashboard';
        }, 900);
        return;
      }
      const err = String(d?.error || '');
      const msg = String(d?.message || '');
      if (err === 'expired' || err === 'too_many_attempts' || err === 'wrong_code') {
        // The code is spent either way — offer a fresh one right where they are.
        setCode('');
        setError({ field: 'code', text: msg || 'That code didn’t work — send a new one.' });
        if (err !== 'too_many_attempts') setResendIn(0);
        return;
      }
      if (err === 'handle_taken' || err === 'handle_reserved' || err === 'handle_invalid') {
        setHandleState({ kind: 'blocked', reason: err.replace('handle_', ''), message: msg || 'Try another handle.' });
        setError({ field: 'handle', text: msg || 'Try another handle.' });
        return;
      }
      if (err === 'name_required') {
        setError({ field: 'name', text: msg || 'Enter your organization’s name.' });
        return;
      }
      if (err === 'password_too_short') {
        setError({ field: 'password', text: msg || 'Password must be at least 8 characters.' });
        return;
      }
      if (err === 'phone_required') {
        setError({ field: 'phone', text: msg || 'That number doesn’t look right.' });
        setPhase('phone');
        return;
      }
      setError({ field: 'form', text: msg || 'Couldn’t create your account. Try again.' });
    } catch {
      setError({ field: 'form', text: 'Network error — your account was not created. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  const errFor = (field: string) => (error && error.field === field ? error.text : null);
  const canSubmit =
    code.length === 6 &&
    name.trim().length >= 2 &&
    normalizeHandle(handle).length >= MIN_HANDLE &&
    (googleId ? password.length === 0 || password.length >= 8 : password.length >= 8);

  // BS148 — the verified Google identity, locked (read-only) on both steps.
  const googleLocked = googleId ? (
    <>
      <label htmlFor="su-gemail">GOOGLE EMAIL</label>
      <input id="su-gemail" className="locked" readOnly aria-readonly="true" value={googleId.email} />
      <p className="hint">
        Verified by Google{googleId.name ? ` · ${googleId.name}` : ''}. You’ll sign back in with Google.
      </p>
    </>
  ) : null;

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="org-signup">
        <div className="card">
          <p className="wordmark">ZoraPass</p>
          <p className="sub">START SELLING</p>

          {/* ── step 1 — phone ── */}
          {phase === 'phone' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendCode();
              }}
            >
              {googleOn && !googleId ? (
                <>
                  <a className="google" href="/api/auth/google/start?intent=signup">
                    <span className="g" aria-hidden="true"><GoogleG /></span>
                    CONTINUE WITH GOOGLE
                  </a>
                  <p className="or mono">OR START WITH YOUR NUMBER</p>
                </>
              ) : null}
              {googleLocked}
              {errFor('form') ? <p className="err">{errFor('form')}</p> : null}
              <h1>Your number is your account.</h1>
              <p className="lede">
                We’ll text you a 6-digit code. No forms to email, nothing to download — you’ll be building your first
                drop in a minute.
              </p>

              <label htmlFor="su-phone">MOBILE NUMBER</label>
              <div className={'field' + (errFor('phone') ? ' bad' : '')}>
                <span className="pfx mono">+255</span>
                <input
                  id="su-phone"
                  inputMode="tel"
                  autoComplete="tel-national"
                  autoFocus
                  placeholder="712 345 678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              {errFor('phone') ? <p className="err">{errFor('phone')}</p> : null}

              <button type="submit" className="primary" disabled={busy || phone.replace(/\D/g, '').length < 9}>
                {busy ? 'SENDING…' : 'TEXT ME A CODE'}
              </button>

              <p className="foot">
                Already selling with ZoraPass? <a href="/dashboard/login">Sign in</a>
              </p>
            </form>
          ) : null}

          {/* ── step 2 — code + org name + handle ── */}
          {phase === 'details' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <h1>Set up your storefront.</h1>
              <p className="lede">
                Sent to <b className="mono">+255 {phone.trim()}</b>.{' '}
                <button
                  type="button"
                  className="linkish"
                  onClick={() => {
                    setPhase('phone');
                    setCode('');
                    setError(null);
                    setNotice(null);
                  }}
                >
                  Change number
                </button>
              </p>
              {notice ? <p className="notice">{notice}</p> : null}
              {googleLocked}

              <label htmlFor="su-code">6-DIGIT CODE</label>
              <input
                id="su-code"
                className={'code mono' + (errFor('code') ? ' bad' : '')}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                placeholder="••••••"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
              <p className="resend mono">
                {resendIn > 0 ? (
                  <span className="cooldown">RESEND IN 0:{String(resendIn).padStart(2, '0')}</span>
                ) : (
                  <button type="button" className="linkish" onClick={() => sendCode(true)} disabled={busy}>
                    SEND A NEW CODE
                  </button>
                )}
              </p>
              {errFor('code') ? <p className="err">{errFor('code')}</p> : null}

              <label htmlFor="su-name">ORGANIZATION NAME</label>
              <input
                id="su-name"
                className={errFor('name') ? 'bad' : ''}
                autoComplete="organization"
                placeholder="The Brunch City"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  // Suggest a handle from the name until the person edits it
                  // themselves — then it's theirs and we stop touching it.
                  if (!handleTouched) setHandle(normalizeHandle(e.target.value.replace(/\s+/g, '')));
                }}
              />
              {errFor('name') ? <p className="err">{errFor('name')}</p> : null}

              <label htmlFor="su-handle">YOUR HANDLE</label>
              <div
                className={
                  'field handle' +
                  (handleState.kind === 'free' ? ' ok' : '') +
                  (handleState.kind === 'blocked' ? ' bad' : '')
                }
              >
                <span className="pfx mono">zorapass.com/</span>
                <input
                  id="su-handle"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="organizer"
                  value={handle}
                  onChange={(e) => {
                    setHandleTouched(true);
                    setHandle(normalizeHandle(e.target.value));
                  }}
                />
                <span className="hstate" aria-hidden="true">
                  {handleState.kind === 'checking' ? <i className="spin" /> : null}
                  {handleState.kind === 'free' ? '✓' : null}
                  {handleState.kind === 'blocked' ? '✕' : null}
                </span>
              </div>
              <p
                className={
                  'hmsg mono' +
                  (handleState.kind === 'free' ? ' ok' : '') +
                  (handleState.kind === 'blocked' ? ' bad' : '')
                }
                role="status"
                aria-live="polite"
              >
                {handleState.kind === 'idle' ? 'This is your public store address — zorapass.com/you. It can’t be changed later.' : null}
                {handleState.kind === 'checking' ? 'CHECKING…' : null}
                {handleState.kind === 'free' ? handleState.message : null}
                {handleState.kind === 'blocked' ? handleState.message : null}
              </p>

              <label htmlFor="su-pass">PASSWORD</label>
              <input
                id="su-pass"
                type="password"
                className={errFor('password') ? 'bad' : ''}
                autoComplete="new-password"
                placeholder={googleId ? 'Optional · at least 8 characters' : 'At least 8 characters'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="hint">
                {googleId
                  ? 'Optional. Set one if you also want to sign in with your handle and a password.'
                  : 'You’ll sign back in with your handle and this password.'}
              </p>
              {errFor('password') ? <p className="err">{errFor('password')}</p> : null}

              {errFor('form') ? <p className="err">{errFor('form')}</p> : null}

              <button type="submit" className="primary" disabled={busy || !canSubmit}>
                {busy ? 'CREATING…' : 'CREATE MY ACCOUNT'}
              </button>
              <p className="foot">
                A ZoraPass admin reviews new organizers before you can sell tickets. You can build drafts straight away.
              </p>
            </form>
          ) : null}

          {/* ── success ── */}
          {phase === 'done' ? (
            <div className="done" role="status">
              <p className="tick" aria-hidden="true">
                ✓
              </p>
              <h1>You’re in.</h1>
              <p className="lede">
                <b className="mono">zorapass.com/{normalizeHandle(handle)}</b> is yours. Taking you to your dashboard…
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

const STYLES = `
.org-signup{
  /* BS148: ZoraPass handoff on the dark surface — flat, board black / night / bone / yellow */
  --bg:var(--zp-color-board-black);--surface2:var(--zp-color-ink-700);
  --text:var(--zp-color-bone);--text2:#BDBDBD;--text3:#8F8F8F;
  --hair:var(--zp-color-line-dark);--hair2:var(--zp-color-ink-600);
  --blue:var(--zp-color-signal-yellow);--ice:var(--zp-color-signal-yellow);--cyan:#7FD1AE;
  --aura:var(--zp-color-signal-yellow);
  --err:#FF8A80;--err-border:#FF8A80;--err-bg:transparent;
  color-scheme:dark;
  --display:var(--zp-font-family-sans);
  --sans:var(--zp-font-family-sans);
  --mono:var(--zp-font-family-mono);
  position:relative;overflow:hidden;background:var(--bg);color:var(--text);font-family:var(--sans);
  min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.org-signup *{margin:0;padding:0;box-sizing:border-box}
.org-signup .mono{font-family:var(--mono)}
.org-signup :focus-visible{outline:3px solid var(--zp-color-signal-yellow);outline-offset:2px}

/* ambient glow — CSS only (no canvas/JS): a touch of the consumer plane's
   aura-lit atmosphere without adding weight to a conversion-focused form. */


.org-signup .card{position:relative;z-index:1;width:100%;max-width:440px;border:1px solid var(--hair2);
  border-radius:16px;background:var(--zp-color-night);padding:40px 32px}
.org-signup .wordmark{font-family:var(--display);font-weight:700;font-size:28px;letter-spacing:-.035em}
.org-signup .wordmark .o{color:inherit}
.org-signup .sub{font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--text2);margin:10px 0 30px}
.org-signup h1{font-family:var(--display);font-size:25px;font-weight:600;letter-spacing:-.025em;line-height:1.15;margin-bottom:10px}
.org-signup .lede{color:var(--text2);font-size:14px;line-height:1.6;margin-bottom:26px}
.org-signup .lede b{color:var(--text);font-weight:500}
.org-signup label{display:block;font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--text2);margin:0 0 8px}
.org-signup input{width:100%;background:var(--bg);border:2px solid var(--hair2);color:var(--text);
  font-family:var(--sans);font-size:16px;padding:12px 14px;outline:none;margin-bottom:18px;border-radius:12px;min-height:48px;
  transition:border-color .2s,box-shadow .2s}
.org-signup input::placeholder{color:var(--text3)}
.org-signup input:focus{border-color:var(--blue)}
.org-signup input.bad{border-color:var(--err-border)}

/* prefixed fields (phone, handle) — the prefix is chrome, the input is the value */
.org-signup .field{display:flex;align-items:center;gap:0;background:var(--bg);border:2px solid var(--hair2);
  border-radius:12px;margin-bottom:8px;min-height:48px;transition:border-color .2s}
.org-signup .field:focus-within{border-color:var(--blue)}
.org-signup .field input:focus-visible{outline:none}
.org-signup .field.ok{border-color:var(--cyan)}
.org-signup .field.bad{border-color:var(--err-border)}
.org-signup .field .pfx{color:var(--text2);font-size:14px;padding:0 0 0 15px;white-space:nowrap}
.org-signup .field input{background:none;border:none;margin:0;padding:13px 12px;border-radius:0}
.org-signup .field input:focus{border:none;box-shadow:none}
.org-signup .field .hstate{width:40px;flex:none;text-align:center;font-size:15px;color:var(--text2)}
.org-signup .field.ok .hstate{color:var(--cyan)}
.org-signup .field.bad .hstate{color:var(--err)}
.org-signup .field .spin{display:inline-block;width:13px;height:13px;border:2px solid var(--hair2);
  border-top-color:var(--blue);border-radius:50%;animation:su-spin .7s linear infinite}
@keyframes su-spin{to{transform:rotate(360deg)}}

/* the 6-digit code gets the emphasis it earns — it is the gate (DESIGN.md 4b) */
.org-signup input.code{text-align:center;letter-spacing:.5em;font-size:22px;padding:15px;margin-bottom:8px}

.org-signup .hmsg{font-size:12px;letter-spacing:.04em;color:var(--text2);line-height:1.5;margin-bottom:18px;min-height:17px}
.org-signup .hmsg.ok{color:var(--cyan)}
.org-signup .hmsg.bad{color:var(--err)}
.org-signup .hint{font-size:12px;color:var(--text2);margin:-10px 0 18px;line-height:1.5}
.org-signup .resend{font-size:12px;letter-spacing:.18em;color:var(--text2);margin-bottom:16px}
.org-signup .resend .cooldown{color:var(--text3)}
.org-signup .notice{font-family:var(--mono);font-size:12px;letter-spacing:.05em;color:var(--text);
  border:1px dashed var(--hair2);border-radius:10px;padding:11px 13px;margin-bottom:22px;line-height:1.5}
.org-signup .err{font-family:var(--mono);font-size:12px;color:var(--err);letter-spacing:.03em;line-height:1.5;
  border:1px solid var(--err-border);background:var(--err-bg);border-radius:10px;padding:11px 13px;margin:-8px 0 18px}

.org-signup .primary{width:100%;background:var(--zp-color-signal-yellow);color:var(--zp-color-board-black);border:none;font-family:var(--zp-font-family-display);
  font-size:20px;letter-spacing:0;padding:0 20px;min-height:56px;border-radius:16px;cursor:pointer;
  transition:background .12s;margin-top:6px}
.org-signup .primary:hover:not(:disabled){background:var(--zp-color-yellow-press)}
.org-signup .primary:active:not(:disabled){transform:translateY(2px)}
/* disabled stays readable (handoff: disabled = grey block, still legible) */
.org-signup .primary:disabled{background:#3A3A3A;color:#BDBDBD;cursor:not-allowed}

.org-signup .linkish{background:none;border:none;color:var(--ice);font:inherit;cursor:pointer;padding:0;
  text-decoration:underline;text-underline-offset:3px}
.org-signup .linkish:disabled{color:var(--text2);cursor:not-allowed;text-decoration:none}
.org-signup .foot{font-size:12.5px;color:var(--text2);text-align:center;margin-top:22px;line-height:1.6}
.org-signup .foot a{color:var(--text);text-decoration:underline;text-underline-offset:3px;display:inline-block;min-height:44px;line-height:44px;padding:0 4px}

.org-signup .google{width:100%;min-height:56px;display:flex;align-items:center;justify-content:center;gap:12px;
  background:var(--zp-color-signal-yellow,#FFD21F);color:#111;border-radius:16px;text-decoration:none;
  font-family:var(--zp-font-family-display,var(--display));font-size:20px;letter-spacing:0;margin-bottom:14px}
.org-signup .google:hover{background:var(--zp-color-yellow-press,#E6BD1B)}
.org-signup .google .g{width:28px;height:28px;border-radius:50%;background:#fff;display:inline-flex;
  align-items:center;justify-content:center;flex:none}
.org-signup .or{text-align:center;font-size:12px;letter-spacing:.12em;color:var(--text2);margin:6px 0 26px}
.org-signup input.locked{color:var(--text2);cursor:not-allowed;border-style:dashed}
.org-signup .done{text-align:center;padding:10px 0 6px}
.org-signup .done .tick{font-size:34px;color:var(--zp-color-signal-yellow);margin-bottom:12px}
.org-signup .done .lede{margin-bottom:0}

/* mobile: the card becomes the page — full-bleed, no floating panel on a 360px screen */
@media (max-width:520px){
  .org-signup{padding:0;align-items:flex-start}
  .org-signup .card{max-width:none;border:none;border-radius:0;padding:32px 20px 56px;min-height:100vh;background:var(--bg)}
  .org-signup h1{font-size:23px}
}
@media (prefers-reduced-motion:reduce){
  .org-signup .spin{animation:none;border-top-color:var(--text2)}
}
`;

// BS148: same multicolour Google mark as /dashboard/login (brand-required).
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.9-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-10l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
