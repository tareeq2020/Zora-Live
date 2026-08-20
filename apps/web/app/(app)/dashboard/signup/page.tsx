'use client';

/* PR-BS41 (#4) — ORGANIZER SELF-REGISTRATION at /dashboard/signup.

   Until now the only way to become an organizer was for someone at Zora to
   create the row by hand. This is the public front door: phone → SMS code →
   org name + handle, and you land inside your own dashboard with a pending
   account you can immediately build drafts in.

   Google is deliberately NOT here (locked, deferred): no button, no "or continue
   with", nothing to imply a path that does not exist yet.

   Two steps, not three. The code and the org details share ONE screen because the
   6-digit code is single-use: the server proves the phone and creates the account
   in the same call (POST /api/org/register), so there is nothing to verify early
   and no half-created account if the second half fails. It also means the OTP
   states the design spec asks for (sent · invalid · expired · resend cooldown)
   and the handle states (taken · reserved) can all resolve against the field they
   belong to, on the screen the person is already looking at.

   BS50: restyled onto the CONSUMER plane of DESIGN.md (Space Grotesk / Inter /
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
    if (password.length < 8) {
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
        body: JSON.stringify({ phone: phone.trim(), code, name: name.trim(), handle: h, password }),
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
    code.length === 6 && name.trim().length >= 2 && normalizeHandle(handle).length >= MIN_HANDLE && password.length >= 8;

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="org-signup">
        <div className="card">
          <p className="wordmark">
            z<span className="o">o</span>ra
          </p>
          <p className="sub">START SELLING</p>

          {/* ── step 1 — phone ── */}
          {phase === 'phone' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendCode();
              }}
            >
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
                Already selling with Zora? <a href="/dashboard/login">Sign in</a>
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
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="hint">You’ll sign back in with your handle and this password.</p>
              {errFor('password') ? <p className="err">{errFor('password')}</p> : null}

              {errFor('form') ? <p className="err">{errFor('form')}</p> : null}

              <button type="submit" className="primary" disabled={busy || !canSubmit}>
                {busy ? 'CREATING…' : 'CREATE MY ACCOUNT'}
              </button>
              <p className="foot">
                A Zora admin reviews new organizers before you can sell tickets. You can build drafts straight away.
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
  --bg:#08080A;--surface2:#171A28;
  --text:#EDEFF7;--text2:#9BA3C4;--text3:#5C6488;
  --hair:rgba(124,160,255,.12);--hair2:rgba(124,160,255,.22);
  --blue:#4C6FFF;--ice:#7CA0FF;--cyan:#3FE0FF;
  --aura:linear-gradient(130deg,#D53AD8,#FF4D7D,#FF9145);
  --err:#FFB9B9;--err-border:rgba(255,120,120,.34);--err-bg:rgba(40,14,16,.34);
  --display:'Space Grotesk',system-ui,sans-serif;
  --sans:'Inter',system-ui,-apple-system,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,monospace;
  position:relative;overflow:hidden;background:var(--bg);color:var(--text);font-family:var(--sans);
  min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.org-signup *{margin:0;padding:0;box-sizing:border-box}
.org-signup .mono{font-family:var(--mono)}
.org-signup :focus-visible{outline:2px solid var(--ice);outline-offset:2px;border-radius:8px}

/* ambient glow — CSS only (no canvas/JS): a touch of the consumer plane's
   aura-lit atmosphere without adding weight to a conversion-focused form. */
.org-signup::before{content:'';position:absolute;inset:0;z-index:0;pointer-events:none;
  background:radial-gradient(circle at 18% 12%,rgba(213,58,216,.10),transparent 45%),
             radial-gradient(circle at 86% 82%,rgba(255,145,69,.08),transparent 45%)}

.org-signup .card{position:relative;z-index:1;width:100%;max-width:440px;border:1px solid var(--hair2);
  border-radius:20px;background:rgba(17,19,30,.66);backdrop-filter:blur(12px);padding:44px 36px}
.org-signup .wordmark{font-family:var(--display);font-weight:600;font-size:26px;letter-spacing:-.02em}
.org-signup .wordmark .o{background:var(--aura);-webkit-background-clip:text;background-clip:text;color:transparent}
.org-signup .sub{font-family:var(--mono);font-size:11px;letter-spacing:.3em;color:var(--text2);margin:10px 0 30px}
.org-signup h1{font-family:var(--display);font-size:25px;font-weight:600;letter-spacing:-.025em;line-height:1.15;margin-bottom:10px}
.org-signup .lede{color:var(--text2);font-size:14px;line-height:1.6;margin-bottom:26px}
.org-signup .lede b{color:var(--text);font-weight:500}
.org-signup label{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.25em;color:var(--text2);margin:0 0 8px}
.org-signup input{width:100%;background:rgba(23,26,40,.66);border:1px solid var(--hair2);color:var(--text);
  font-family:var(--mono);font-size:15px;padding:13px 15px;outline:none;margin-bottom:18px;border-radius:12px;min-height:46px;
  transition:border-color .2s,box-shadow .2s}
.org-signup input::placeholder{color:var(--text3)}
.org-signup input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(76,111,255,.18)}
.org-signup input.bad{border-color:var(--err-border)}

/* prefixed fields (phone, handle) — the prefix is chrome, the input is the value */
.org-signup .field{display:flex;align-items:center;gap:0;background:rgba(23,26,40,.66);border:1px solid var(--hair2);
  border-radius:12px;margin-bottom:8px;min-height:46px;transition:border-color .2s,box-shadow .2s}
.org-signup .field:focus-within{border-color:var(--blue);box-shadow:0 0 0 3px rgba(76,111,255,.18)}
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

.org-signup .hmsg{font-size:11.5px;letter-spacing:.04em;color:var(--text2);line-height:1.5;margin-bottom:18px;min-height:17px}
.org-signup .hmsg.ok{color:var(--cyan)}
.org-signup .hmsg.bad{color:var(--err)}
.org-signup .hint{font-size:12px;color:var(--text2);margin:-10px 0 18px;line-height:1.5}
.org-signup .resend{font-size:11px;letter-spacing:.18em;color:var(--text2);margin-bottom:16px}
.org-signup .resend .cooldown{color:var(--text3)}
.org-signup .notice{font-family:var(--mono);font-size:11.5px;letter-spacing:.05em;color:var(--text);
  border:1px dashed var(--hair2);border-radius:10px;padding:11px 13px;margin-bottom:22px;line-height:1.5}
.org-signup .err{font-family:var(--mono);font-size:12px;color:var(--err);letter-spacing:.03em;line-height:1.5;
  border:1px solid var(--err-border);background:var(--err-bg);border-radius:10px;padding:11px 13px;margin:-8px 0 18px}

.org-signup .primary{width:100%;background:var(--aura);color:#120409;border:none;font-family:var(--mono);
  font-size:13px;font-weight:600;letter-spacing:.2em;padding:16px;min-height:48px;border-radius:99px;cursor:pointer;
  transition:transform .2s,box-shadow .2s;margin-top:6px;box-shadow:0 14px 40px rgba(213,58,216,.26)}
.org-signup .primary:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 18px 50px rgba(213,58,216,.36)}
.org-signup .primary:disabled{background:var(--surface2);color:var(--text3);box-shadow:none;cursor:not-allowed}

.org-signup .linkish{background:none;border:none;color:var(--ice);font:inherit;cursor:pointer;padding:0;
  text-decoration:underline;text-underline-offset:3px}
.org-signup .linkish:disabled{color:var(--text2);cursor:not-allowed;text-decoration:none}
.org-signup .foot{font-size:12.5px;color:var(--text2);text-align:center;margin-top:22px;line-height:1.6}
.org-signup .foot a{color:var(--text);text-decoration:underline;text-underline-offset:3px}

.org-signup .done{text-align:center;padding:10px 0 6px}
.org-signup .done .tick{font-size:34px;background:var(--aura);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:12px}
.org-signup .done .lede{margin-bottom:0}

/* mobile: the card becomes the page — full-bleed, no floating panel on a 360px screen */
@media (max-width:520px){
  .org-signup{padding:0;align-items:flex-start}
  .org-signup .card{max-width:none;border:none;border-radius:0;padding:32px 20px 56px;min-height:100vh;backdrop-filter:none;background:var(--bg)}
  .org-signup h1{font-size:23px}
}
@media (prefers-reduced-motion:reduce){
  .org-signup .spin{animation:none;border-top-color:var(--text2)}
}
`;
