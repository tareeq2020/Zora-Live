'use client';

/* BS158 — "Send payment prompt": an admin sends a mobile-money prompt for this
   cart's own amount (POST /api/admin/orders/:id/push), then watches it land.
   The page's detail read (GET /api/admin/orders/:id?reconcile=1) is polled
   every 3 s for up to 2 min; each read refreshes the timeline and outcome too.
   The server decides whether a prompt may go (detail.push); this panel only
   shows that decision and why. */

import { useEffect, useRef, useState } from 'react';

export type PushPreview = {
  available: boolean;
  code: string | null;
  message: string | null;
  retryAfterSecs: number | null;
  amount: number | null;
  scheduleN: number | null;
  revives: string | null;
  buyerPhoneValid: boolean;
};

type AttemptLite = { transactionId: string; status: string; failureReason?: string | null; error?: string | null };

type PushOrder = {
  id: string;
  status: string;
  currency: string;
  buyer: { phone: string | null };
  piiRedacted: boolean;
  attempts: AttemptLite[];
  push?: PushPreview | null;
};

const POLL_MS = 3000;
const WATCH_MS = 120_000;

/** Plain words for x-bridge's failureReason. */
export const FAILURE_WORDS: Record<string, string> = {
  payer_no_response: "The buyer didn't answer the prompt.",
  payer_cancelled: 'The buyer cancelled the prompt.',
  insufficient_funds: "There wasn't enough money in the buyer's wallet.",
  wrong_pin: 'The buyer entered the wrong PIN.',
  invalid_number: "This number isn't a mobile-money account.",
  provider_error: 'The mobile-money network had an error. Not the buyer.',
  unknown: "The network didn't say why.",
};

const REFUSAL_TITLE: Record<string, string> = {
  not_payable: "This cart can't take a payment",
  method_disabled: 'Mobile money is off',
  attempt_in_flight: 'A payment is already in progress',
  rate_limited: 'Too many prompts for now',
  inventory_unavailable: 'Tickets no longer available',
  invalid_phone: 'Check the number',
};

/** +255 + 9 digits starting 6 or 7 (same rule as the server), else null. */
function tzMobile(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0')) d = '255' + d.slice(1);
  else if (d.length === 9) d = '255' + d;
  return /^255[67]\d{8}$/.test(d) ? '+' + d : null;
}
function mask(n: string): string {
  const d = n.slice(4);
  return `+255 ${d[0]}•• ••• ${d.slice(6)}`;
}
const fmt = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

type Phase = 'idle' | 'confirm' | 'sending' | 'watching' | 'done';
type Result =
  | { kind: 'accepted'; transactionId: string; phone: string; revivedFrom: string | null }
  | { kind: 'rejected'; transactionId: string | null; error: string }
  | { kind: 'refused'; code: string; message: string };

export function PushPanel<T extends PushOrder>({ o, onDetail }: { o: T; onDetail: (d: T) => void }) {
  const p = o.push ?? null;
  const prefill = !o.piiRedacted && o.buyer.phone ? o.buyer.phone : '';
  const [phone, setPhone] = useState(prefill);
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [pollErr, setPollErr] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const typed = phone.trim();
  const target = typed ? tzMobile(typed) : null;
  // Empty field with a hidden buyer number: the server uses the number on file.
  const useBuyerOnFile = !typed && o.piiRedacted && !!p?.buyerPhoneValid;
  const phoneOk = !!target || useBuyerOnFile;
  const targetText = target ? mask(target) : "the buyer's number on file";
  const currency = o.currency || 'TZS';
  const busy = phase === 'sending' || phase === 'watching';

  const attempt = result?.kind === 'accepted' ? o.attempts.find((a) => a.transactionId === result.transactionId) ?? null : null;
  const landed = attempt && ['successful', 'failed', 'partial', 'expired'].includes(attempt.status);

  // Poll the detail while a prompt is out.
  useEffect(() => {
    if (phase !== 'watching' || result?.kind !== 'accepted') return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const res = await fetch(`/api/admin/orders/${encodeURIComponent(o.id)}?reconcile=1`, { headers: { 'Content-Type': 'application/json' } });
        if (res.status === 401) { window.location.href = '/admin'; return; }
        const d = (await res.json()) as T;
        if (!alive.current || stop) return;
        if (!res.ok) throw new Error((d as any)?.error || 'Request failed');
        setPollErr(null);
        onDetail(d);
        const a = d.attempts.find((x) => x.transactionId === result.transactionId);
        if (a && ['successful', 'failed', 'partial', 'expired'].includes(a.status)) { setPhase('done'); return; }
      } catch (e) {
        if (alive.current) setPollErr(e instanceof Error ? e.message : String(e));
      }
      if (Date.now() - startedAt >= WATCH_MS) { setTimedOut(true); setPhase('done'); return; }
      timer = setTimeout(tick, POLL_MS);
    };
    let timer = setTimeout(tick, POLL_MS);
    return () => { stop = true; clearTimeout(timer); };
  }, [phase, result, o.id, onDetail, startedAt]);

  async function send() {
    setPhase('sending');
    setResult(null);
    setTimedOut(false);
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(o.id)}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(typed ? { phone: typed } : {}), ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      if (res.status === 401) { window.location.href = '/admin'; return; }
      const body = (await res.json().catch(() => ({}))) as any;
      if (!alive.current) return;
      if (res.ok && body.gateway === 'accepted') {
        setResult({ kind: 'accepted', transactionId: body.transactionId, phone: body.phone, revivedFrom: body.revivedFrom ?? null });
        setStartedAt(Date.now());
        setPhase('watching');
      } else if (body.gateway === 'rejected') {
        setResult({ kind: 'rejected', transactionId: body.transactionId ?? null, error: body.error || 'x-bridge refused the prompt.' });
        setPhase('done');
      } else {
        setResult({ kind: 'refused', code: body.error || 'push_failed', message: body.message || 'The prompt was not sent.' });
        setPhase('done');
      }
    } catch (e) {
      if (!alive.current) return;
      setResult({ kind: 'refused', code: 'network', message: e instanceof Error ? e.message : String(e) });
      setPhase('done');
    }
    // Refresh the page's read so the timeline shows what just happened.
    fetch(`/api/admin/orders/${encodeURIComponent(o.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && alive.current) onDetail(d as T); })
      .catch(() => {});
  }

  if (!p) return null;
  const blocked = !p.available && !busy;

  // Steps of the prompt in flight: sent → accepted → paid | failed.
  const finalStep = attempt?.status === 'successful' ? 'paid'
    : attempt?.status === 'failed' ? 'failed'
    : attempt?.status === 'partial' ? 'short'
    : attempt?.status === 'expired' ? 'expired' : null;
  const steps = result?.kind === 'accepted'
    ? [
        { k: 'sent', label: 'Sent', state: 'done' },
        { k: 'accepted', label: 'Accepted by x-bridge', state: 'done' },
        {
          k: 'end',
          label: finalStep === 'paid' ? 'Paid' : finalStep === 'failed' ? 'Failed' : finalStep === 'short' ? 'Short payment' : finalStep === 'expired' ? 'Timed out' : 'Waiting for the buyer',
          state: finalStep === 'paid' ? 'good' : finalStep ? 'bad' : 'wait',
        },
      ]
    : [];

  return (
    <section className="cr-panel pp" aria-label="Send payment prompt">
      <h2 className="cr-section-h">Send payment prompt</h2>
      <p className="pp-lede">
        Sends a mobile-money prompt for this cart&apos;s own amount. The buyer approves it with their PIN.
      </p>
      <div className="pp-amount">
        <span className="pp-k">Amount</span>
        <span className="pp-v">{fmt(p.amount)} {currency}</span>
        {p.scheduleN != null ? <span className="pp-k">installment {p.scheduleN}</span> : null}
      </div>

      {blocked ? (
        <div className="pp-blocked" role="status">
          <b>{REFUSAL_TITLE[p.code ?? ''] ?? 'Not available'}</b>
          <span>{p.message}</span>
        </div>
      ) : (
        <>
          {p.revives ? (
            <p className="pp-note">This cart is {p.revives}. Sending holds its tickets{' '}again first; if they are gone, nothing is sent.</p>
          ) : null}
          <div className="pp-form">
            <label className="pp-field">
              <span className="pp-k">Phone</span>
              <input
                className="cr-input pp-mono"
                inputMode="tel"
                autoComplete="off"
                value={phone}
                placeholder={o.piiRedacted ? "Buyer's number on file" : '+255 7XX XXX XXX'}
                onChange={(e) => { setPhone(e.target.value); if (phase === 'confirm') setPhase('idle'); }}
                disabled={busy}
                aria-invalid={!!typed && !target}
              />
              {typed && !target ? <span className="pp-err">Use a Tanzanian mobile: +255, then 9 digits starting 6 or 7.</span> : null}
              {!typed && !useBuyerOnFile ? <span className="pp-err">Enter the number to prompt.</span> : null}
            </label>
            <label className="pp-field">
              <span className="pp-k">Note (optional)</span>
              <input
                className="cr-input"
                maxLength={280}
                value={note}
                placeholder="Why you are sending it"
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
              />
            </label>
          </div>

          {phase === 'confirm' ? (
            <div className="pp-confirm" role="alertdialog" aria-label="Confirm payment prompt">
              <p>
                Send a mobile-money prompt for <b className="pp-mono">{fmt(p.amount)} {currency}</b> to <b className="pp-mono">{targetText}</b>?
              </p>
              <div className="pp-actions">
                <button type="button" className="cr-btn cr-btn-primary" onClick={send}>
                  Yes, send it
                </button>
                <button type="button" className="cr-btn" onClick={() => setPhase('idle')}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="pp-actions">
              <button
                type="button"
                className="cr-btn"
                disabled={!phoneOk || busy || !p.available}
                onClick={() => { setResult(null); setPhase('confirm'); }}
              >
                {phase === 'sending' ? 'Sending…' : 'Send payment prompt'}
              </button>
            </div>
          )}
        </>
      )}

      {result?.kind === 'accepted' ? (
        <div className="pp-live" aria-live="polite">
          <ol className="pp-steps">
            {steps.map((s) => (
              <li key={s.k} className={`pp-step is-${s.state}`}>
                <span className="pp-dot" aria-hidden="true" />
                {s.label}
              </li>
            ))}
          </ol>
          <p className="pp-mono pp-meta">
            {result.transactionId} · {result.phone}
            {result.revivedFrom ? ` · revived from ${result.revivedFrom}` : ''}
          </p>
          {attempt?.status === 'failed' ? (
            <p className="pp-why">{FAILURE_WORDS[attempt.failureReason ?? ''] ?? (attempt.failureReason ? `Reason: ${attempt.failureReason}` : 'No reason given yet.')}</p>
          ) : null}
          {phase === 'watching' ? <p className="pp-note">Checking every 3 s for up to 2 min…</p> : null}
          {timedOut && !landed ? (
            <p className="pp-note">No answer after 2 min. The attempt stays open; this page updates when x-bridge reports.</p>
          ) : null}
          {pollErr ? <p className="pp-err">Couldn&apos;t refresh: {pollErr}</p> : null}
        </div>
      ) : null}
      {result?.kind === 'rejected' ? (
        <div className="pp-blocked" role="alert">
          <b>x-bridge refused the prompt</b>
          <span className="pp-mono pp-wrap">{result.error}</span>
        </div>
      ) : null}
      {result?.kind === 'refused' ? (
        <div className="pp-blocked" role="alert">
          <b>{REFUSAL_TITLE[result.code] ?? 'Not sent'}</b>
          <span>{result.message}</span>
        </div>
      ) : null}
      <style dangerouslySetInnerHTML={{ __html: PUSH_CSS }} />
    </section>
  );
}

/* Flat, bone/black, data in mono; the only yellow is the primary button. */
const PUSH_CSS = `
:where(.pp) p { margin: 0; }
.pp { display: grid; gap: 12px; min-width: 0; }
.pp-lede { font-size: 14px; line-height: 1.45; color: var(--cr-ink2); }
.pp-k { font: 600 12px/1 var(--cr-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--cr-mut); }
.pp-v { font: 600 22px/1 var(--cr-mono); color: var(--cr-ink); }
.pp-mono { font-family: var(--cr-mono); }
.pp-wrap { overflow-wrap: anywhere; word-break: break-word; }
.pp-amount { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.pp-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.pp-field { display: grid; gap: 6px; min-width: 0; }
.pp-err { font: 500 12px/1.4 var(--cr-mono); color: var(--cr-red); }
.pp-note { font-size: 12px; line-height: 1.45; color: var(--cr-ink2); }
.pp-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.pp-actions .cr-btn { min-height: 44px; }
.pp-confirm { display: grid; gap: 10px; padding: 12px; border: 2px solid var(--cr-ink); border-radius: 12px; }
.pp-confirm p { font-size: 14px; line-height: 1.45; color: var(--cr-ink); overflow-wrap: anywhere; }
.pp-blocked { display: grid; gap: 4px; padding: 12px; border: 1px solid var(--cr-hair); border-radius: 12px; font-size: 14px; line-height: 1.4; color: var(--cr-ink2); overflow-wrap: anywhere; }
.pp-blocked b { color: var(--cr-ink); font: 600 14px/1.3 var(--cr-sans); }
.pp-live { display: grid; gap: 8px; border-top: 1px solid var(--cr-hair); padding-top: 12px; }
.pp-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 18px; }
.pp-step { display: inline-flex; align-items: center; gap: 8px; min-height: 28px; font: 600 12px/1.2 var(--cr-mono); letter-spacing: .04em; text-transform: uppercase; color: var(--cr-ink); }
.pp-dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--cr-ink); }
.pp-step.is-done .pp-dot, .pp-step.is-good .pp-dot { background: var(--cr-ink); }
.pp-step.is-wait { color: var(--cr-mut); }
.pp-step.is-wait .pp-dot { border-color: var(--cr-mut); }
.pp-step.is-bad { color: var(--cr-red); }
.pp-step.is-bad .pp-dot { border-color: var(--cr-red); background: var(--cr-red); }
.pp-meta { font-size: 12px; color: var(--cr-ink2); overflow-wrap: anywhere; }
.pp-why { font-size: 14px; line-height: 1.45; color: var(--cr-ink); }
@media (max-width: 640px) {
  .pp-form { grid-template-columns: minmax(0, 1fr); }
  .pp-actions .cr-btn { flex: 1 1 100%; }
}
`;
