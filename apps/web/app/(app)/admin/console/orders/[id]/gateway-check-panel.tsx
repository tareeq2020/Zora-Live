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
    if (!refresh) return;
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
@media (max-width: 640px) {
  .gc-actions .cr-btn { flex: 1 1 100%; }
}
`;
