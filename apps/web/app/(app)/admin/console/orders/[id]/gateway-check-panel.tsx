'use client';

/* BS164 — "Check with x-bridge": ask the gateway what happened to every attempt
   on this cart (POST /api/admin/orders/:id/gateway-check) and update the cart to
   match. Covers what the worker no longer polls: attempts past their window
   ('expired') that may have settled late. A disagreement with a finished
   attempt is shown and flagged in Needs attention, never changed here. After a
   check the page's detail is re-read so the header, attempts and timeline
   show the result. */

import { useEffect, useRef, useState } from 'react';
import { FAILURE_WORDS } from './push-panel';

type Verdict = 'updated' | 'unchanged' | 'still_pending' | 'needs_refund' | 'mismatch' | 'skipped' | 'error';

type AttemptCheck = {
  transactionId: string;
  method: string | null;
  scheduleN: number | null;
  before: string;
  after: string;
  gatewayStatus: string | null;
  collectedAmount: number | null;
  failureReason: string | null;
  verdict: Verdict;
  /** What x-bridge's answer means: successful | short | failed | pending. */
  outcome: 'successful' | 'short' | 'failed' | 'pending' | null;
  /** BS165: the server says a person may accept x-bridge's answer here. */
  acceptable?: boolean;
  note: string;
};

type CheckResult = {
  orderStatusBefore: string;
  orderStatusAfter: string;
  checkedAt: string;
  attempts: AttemptCheck[];
  notChecked: number;
  updated: number;
  mismatches: number;
  needsRefund: number;
  errors: number;
};

const VERDICT_LABEL: Record<Verdict, string> = {
  updated: 'Updated',
  unchanged: 'Matches',
  still_pending: 'Still pending',
  needs_refund: 'Needs refund',
  mismatch: 'Disagrees',
  skipped: 'Skipped',
  error: "Couldn't read",
};

function summary(r: CheckResult): string {
  if (!r.attempts.length) return 'This cart has no payment attempts to check.';
  const parts = [`${r.attempts.length} attempt${r.attempts.length === 1 ? '' : 's'} checked`];
  if (r.updated) parts.push(`${r.updated} updated`);
  else if (!r.needsRefund) parts.push('nothing changed');
  if (r.needsRefund) parts.push(`${r.needsRefund} need${r.needsRefund === 1 ? 's' : ''} a refund`);
  if (r.mismatches) parts.push(`${r.mismatches} disagree${r.mismatches === 1 ? 's' : ''}`);
  if (r.errors) parts.push(`${r.errors} couldn't be read`);
  const status = r.orderStatusBefore !== r.orderStatusAfter ? ` Cart: ${r.orderStatusBefore} → ${r.orderStatusAfter}.` : '';
  return `${parts.join(' · ')}.${status}`;
}

type AcceptResult = {
  transactionId: string;
  collected: number | null;
  attemptStatus: string;
  orderStatusBefore: string;
  orderStatusAfter: string;
  unapplied: string | null;
  otherOpenAttempts: string[];
  passesOnCart: number | null;
};

/** BS165: we have it failed, x-bridge says paid, pay-in-full cart (the server decides). */
const canAccept = (a: AttemptCheck) => a.verdict === 'mismatch' && a.acceptable === true && a.after === 'failed';

function acceptedText(r: AcceptResult): string {
  if (r.unapplied === 'duplicate') return 'Accepted. The cart was already paid by another attempt, so this is a second collection: flagged in Needs attention to refund.';
  if (r.unapplied === 'late') return `Accepted. The cart (${r.orderStatusAfter}) can no longer take this money, so it is recorded on the attempt and flagged in Needs attention to refund or reconcile.`;
  if (r.orderStatusAfter === 'paid_unseatable') return "Accepted. The money is in but the cart's tickets are gone, so no pass was issued (paid_unseatable). Refund or reseat the buyer.";
  if (r.orderStatusAfter === 'paid') {
    return r.passesOnCart == null
      ? 'Accepted. The table is paid and its reservation confirmed; the buyer was notified.'
      : `Accepted. The cart is paid; ${r.passesOnCart} pass${r.passesOnCart === 1 ? '' : 'es'} on it and the buyer notified.`;
  }
  if (r.orderStatusAfter === 'payment_short') return "Accepted. Less than this attempt's amount was collected, so the cart is payment_short and no pass was issued. Top up or refund.";
  return `Accepted. Attempt ${r.attemptStatus}; cart ${r.orderStatusBefore} → ${r.orderStatusAfter}.`;
}

/** One flagged attempt: confirm, then accept x-bridge's answer. */
function AcceptBox({ orderId, a, onDone }: { orderId: string; a: AttemptCheck; onDone: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'sending'>('idle');
  const [done, setDone] = useState<AcceptResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const amount = a.collectedAmount != null ? Number(a.collectedAmount).toLocaleString('en-US') : '?';
  // PARTIAL, or COMPLETED for less than the cart: accepting records a short payment.
  const short = a.outcome === 'short';

  async function accept() {
    setPhase('sending');
    setErr(null);
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/attempts/${encodeURIComponent(a.transactionId)}/accept-gateway`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedCollected: a.collectedAmount }),
      });
      if (res.status === 401) { window.location.href = '/admin'; return; }
      const body = (await res.json().catch(() => ({}))) as any;
      if (res.ok) { setDone(body as AcceptResult); onDone(); }
      else setErr(body?.message || body?.error || 'Not accepted.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setPhase('idle');
  }

  if (a.collectedAmount == null) return null; // nothing to confirm
  if (done) {
    return (
      <div className="gc-accept" role="status">
        <p className="gc-note gc-ink">{acceptedText(done)}</p>
        {done.otherOpenAttempts.length ? (
          <p className="gc-note">
            Still possibly payable at x-bridge: <span className="gc-mono gc-wrap">{done.otherOpenAttempts.join(', ')}</span>. If the buyer
            approves that too it is a second charge; it will be flagged to refund.
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="gc-accept">
      {phase === 'confirm' ? (
        <div className="gc-confirm" role="alertdialog" aria-label="Accept x-bridge's answer">
          <p>
            {short ? (
              <>Record <b className="gc-mono">{amount}</b> collected on this attempt? It is less than the attempt&apos;s amount, so the cart becomes payment_short and no pass is issued.</>
            ) : (
              <>Mark this attempt paid with <b className="gc-mono">{amount}</b> collected and complete the cart?</>
            )}{' '}
            x-bridge is asked again first; confirm the money is in the x-bridge dashboard before you accept.
          </p>
          <div className="gc-actions">
            <button type="button" className="cr-btn cr-btn-primary" onClick={accept}>Yes, accept it</button>
            <button type="button" className="cr-btn" onClick={() => setPhase('idle')}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="gc-actions">
          <button type="button" className="cr-btn" disabled={phase === 'sending'} onClick={() => { setErr(null); setPhase('confirm'); }}>
            {phase === 'sending' ? 'Accepting…' : "Accept x-bridge's answer"}
          </button>
        </div>
      )}
      {err ? <p className="gc-err">{err}</p> : null}
    </div>
  );
}

export function GatewayCheckPanel<T>({ orderId, onDetail }: { orderId: string; onDetail: (d: T) => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null); // never show an old result under a new error
    // Raw fetch, like the push panel: adminApi keeps only the error code, and the
    // server's message ("Try again in 7 s") is what the admin needs to read.
    let refresh = false;
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/gateway-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (res.status === 401) { window.location.href = '/admin'; return; }
      const body = (await res.json().catch(() => ({}))) as any;
      if (!alive.current) return;
      if (res.ok) { setResult(body as CheckResult); refresh = true; }
      else setError(body?.message || (body?.error === 'gateway_check_failed' ? 'The check failed on our side. Try again.' : body?.error) || 'The check failed.');
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
    // Re-read the page so header, attempts and timeline show the result
    // (a refusal changed nothing, so there is nothing to re-read).
    if (refresh) reread();
  }

  function reread() {
    fetch(`/api/admin/orders/${encodeURIComponent(orderId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && alive.current) onDetail(d as T); })
      .catch(() => {});
  }

  return (
    <section className="cr-panel gc" aria-label="Check with x-bridge">
      <h2 className="cr-section-h">Check with x-bridge</h2>
      <p className="gc-lede">
        Asks x-bridge for the status of every attempt on this cart, including ones that timed out, and updates the cart to match.
        Money the cart can no longer take, and a finished attempt x-bridge disagrees with, are flagged, not applied.
      </p>
      <div className="gc-actions">
        <button type="button" className="cr-btn" onClick={run} disabled={busy}>
          {busy ? 'Checking…' : 'Check payment status'}
        </button>
      </div>

      {error ? (
        <div className="gc-box" role="alert">
          <b>Not checked</b>
          <span>{error}</span>
        </div>
      ) : null}

      {result ? (
        <div className="gc-out" aria-live="polite">
          <p className="gc-sum">{summary(result)}</p>
          {result.attempts.length ? (
            <ul className="gc-list">
              {result.attempts.map((a) => (
                <li key={a.transactionId} className={`gc-row is-${a.verdict}`}>
                  <div className="gc-row-h">
                    <span className="gc-mono gc-wrap">
                      {a.transactionId}
                      {a.scheduleN != null ? ` · installment ${a.scheduleN}` : ''}
                    </span>
                    <span className="gc-tag">{VERDICT_LABEL[a.verdict]}</span>
                  </div>
                  <div className="gc-mono gc-meta">
                    ours {a.before}{a.after !== a.before ? ` → ${a.after}` : ''}
                    {a.gatewayStatus ? ` · x-bridge ${a.gatewayStatus}` : ''}
                    {a.collectedAmount != null ? ` · collected ${Number(a.collectedAmount).toLocaleString('en-US')}` : ''}
                  </div>
                  <p className="gc-note">{a.note}</p>
                  {a.failureReason && FAILURE_WORDS[a.failureReason] ? <p className="gc-note">{FAILURE_WORDS[a.failureReason]}</p> : null}
                  {canAccept(a) ? <AcceptBox orderId={orderId} a={a} onDone={reread} /> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {result.notChecked ? <p className="gc-note">{result.notChecked} older attempt{result.notChecked === 1 ? '' : 's'} not checked.</p> : null}
        </div>
      ) : null}
      <style dangerouslySetInnerHTML={{ __html: GC_CSS }} />
    </section>
  );
}

/* Same language as the push panel: flat, bone/black, data in mono. */
const GC_CSS = `
:where(.gc) p { margin: 0; }
.gc { display: grid; gap: 12px; min-width: 0; }
.gc-lede { font-size: 14px; line-height: 1.45; color: var(--cr-ink2); }
.gc-mono { font-family: var(--cr-mono); }
.gc-wrap { overflow-wrap: anywhere; word-break: break-word; }
.gc-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.gc-actions .cr-btn { min-height: 44px; }
.gc-box { display: grid; gap: 4px; padding: 12px; border: 1px solid var(--cr-hair); border-radius: 12px; font-size: 14px; line-height: 1.4; color: var(--cr-ink2); overflow-wrap: anywhere; }
.gc-box b { color: var(--cr-ink); font: 600 14px/1.3 var(--cr-sans); }
.gc-out { display: grid; gap: 10px; border-top: 1px solid var(--cr-hair); padding-top: 12px; }
.gc-sum { font-size: 14px; line-height: 1.45; color: var(--cr-ink); }
.gc-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.gc-row { display: grid; gap: 4px; padding: 10px 12px; border: 1px solid var(--cr-hair); border-radius: 12px; min-width: 0; }
.gc-row-h { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--cr-ink); }
.gc-tag { font: 600 12px/1.2 var(--cr-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--cr-mut); white-space: nowrap; }
.gc-row.is-updated .gc-tag { color: var(--cr-ink); }
.gc-row.is-mismatch, .gc-row.is-error, .gc-row.is-needs_refund { border-color: var(--cr-red); }
.gc-row.is-mismatch .gc-tag, .gc-row.is-error .gc-tag, .gc-row.is-needs_refund .gc-tag { color: var(--cr-red); }
.gc-meta { font-size: 12px; color: var(--cr-ink2); overflow-wrap: anywhere; }
.gc-note { font-size: 13px; line-height: 1.45; color: var(--cr-ink2); }
.gc-ink { color: var(--cr-ink); }
.gc-err { font: 500 12px/1.4 var(--cr-mono); color: var(--cr-red); }
.gc-accept { display: grid; gap: 8px; padding-top: 6px; }
.gc-confirm { display: grid; gap: 10px; padding: 12px; border: 2px solid var(--cr-ink); border-radius: 12px; }
.gc-confirm p { font-size: 14px; line-height: 1.45; color: var(--cr-ink); overflow-wrap: anywhere; }
@media (max-width: 640px) {
  .gc-actions .cr-btn { flex: 1 1 100%; }
}
`;
