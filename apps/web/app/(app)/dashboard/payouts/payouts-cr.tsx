'use client';

/* BS71 · Lane B — the organizer WITHDRAWALS view, ported onto the Control-Room
   v2 component library (Lane A · BS69). Replaces the imperative dark-only
   `payouts-client.tsx` scoped-`<style>` surface with idiomatic CR primitives
   (<OrgShell>, the `.org-balance` hero, DataTable→cards, StatusPill) so it is
   theme-aware + responsive for free.

   Hierarchy is unchanged (design spec #7): BALANCE → ACTION → HISTORY, balance
   biggest, money at the highest-contrast ink (rule 4b). DATA IS UNCHANGED — one
   real endpoint drives everything and NOTHING is computed in the browser:
     GET  /api/org/payouts  → { balances[], payouts[], verified, commissionRate, pendingCount }
     POST /api/org/payouts  ← { amount, currency, note }  (server re-decides every request)
   The legacy `payouts-client.tsx` stays in-tree (strangler-fig) for parity. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { DataTable, StatusPill, type Column } from '@/app/components/cr';
import { OrgShell } from '../components/org-shell';
import { ORG_NAV } from '../components/org-nav';
import '../components/org-surfaces.css';

type Balance = { currency: string; earned: number; reserved: number; paidOut: number; available: number; minimum: number };
type Payout = {
  id: string; amount: number; currency: string; status: string; requestedAt: string; decidedAt: string | null;
  reference: string | null; fxNote: string | null; note: string | null; reason: string | null;
};
type PayoutView = { balances: Balance[]; payouts: Payout[]; verified: boolean; commissionRate: number; pendingCount: number };

const fmt = (n: number) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US') : '—');
function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}
const STATUS_LABEL: Record<string, string> = { requested: 'PENDING', approved: 'PAID', rejected: 'REJECTED' };

export default function PayoutsCr() {
  const [view, setView] = useState<PayoutView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [currency, setCurrency] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch('/api/org/payouts', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PayoutView;
      setView(data);
      setCurrency((c) => c || data.balances[0]?.currency || '');
    } catch {
      setLoadError(true);
      setView(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const balances = view?.balances ?? [];
  const selected = useMemo(() => balances.find((b) => b.currency === currency) ?? balances[0] ?? null, [balances, currency]);

  const pending = (view?.pendingCount ?? 0) > 0;
  const verified = view?.verified ?? false;
  const commissionPct = ((view?.commissionRate ?? 0) * 100).toFixed(1).replace(/\.0$/, '');

  const parsedAmount = Number(String(amount).replace(/[\s,]/g, ''));
  const amountOk =
    !!selected && Number.isFinite(parsedAmount) && Number.isInteger(parsedAmount) &&
    parsedAmount >= selected.minimum && parsedAmount <= selected.available;
  const belowMinimum = !!selected && selected.available > 0 && selected.available < selected.minimum;
  const canRequest = verified && !pending && !!selected && selected.available >= selected.minimum;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || submitting) return;
    setSubmitting(true);
    setFormError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/org/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ amount: parsedAmount, currency: selected.currency, note: note || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setFormError(data?.message || 'That withdrawal could not be requested.');
        await load();
        return;
      }
      setSuccess(`Requested ${fmt(parsedAmount)} ${selected.currency}. We'll transfer it and record the reference here — usually within 2 business days.`);
      setAmount('');
      setNote('');
      await load();
    } catch {
      setFormError('We could not reach Zora just then. Check your connection and try again — nothing was requested.');
    } finally {
      setSubmitting(false);
    }
  }

  const payoutCols: Column<Payout>[] = [
    { key: 'requestedAt', header: 'Requested', primary: true, render: (p) => <span className="org-muted">{fmtWhen(p.requestedAt)}</span> },
    { key: 'amount', header: 'Amount', numeric: true, render: (p) => `${fmt(p.amount)} ${p.currency}` },
    {
      key: 'status',
      header: 'Status',
      render: (p) => (
        <span>
          <StatusPill tone={toneForPayout(p.status)} label={STATUS_LABEL[p.status] ?? (p.status || '—').toUpperCase()} />
          {p.reason ? <span className="org-muted" style={{ display: 'block', marginTop: 6, maxWidth: '34ch' }}>{p.reason}</span> : null}
        </span>
      ),
    },
    {
      key: 'reference',
      header: 'Reference',
      render: (p) => (
        <span>
          {p.reference ? <span className="cr-num">{p.reference}</span> : <span className="org-muted">—</span>}
          {p.fxNote ? <span className="org-muted" style={{ display: 'block', marginTop: 5 }}>{p.fxNote}</span> : null}
        </span>
      ),
    },
    { key: 'decidedAt', header: 'Decided', render: (p) => <span className="org-muted">{fmtWhen(p.decidedAt)}</span> },
  ];

  return (
    <OrgShell
      nav={ORG_NAV}
      topbarTitle="Withdrawals"
      topbarExtra={<span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: 'var(--cr-ink2)' }}>Your money, on request</span>}
      footer={<><a href="/dashboard/onboarding">GET STARTED</a> &middot; <a href="/">ZORA.COM</a></>}
    >
      <div className="cr-stack">
        <div>
          <p className="org-crumb"><Link href="/dashboard/overview">DASHBOARD</Link> / WITHDRAWALS</p>
          <h1 className="org-h1">Withdrawals</h1>
          <p className="org-sub">
            Your money, on request. Zora transfers it to your bank or mobile-money account by hand and
            records the reference here — we never hold a payout you can&apos;t see.
          </p>
        </div>

        {/* ① BALANCE — first, biggest, mono */}
        {loading ? (
          <div className="org-balance" aria-busy="true">
            <span className="cr-skel" style={{ width: 200, height: 14, display: 'block' }} />
            <span className="cr-skel" style={{ width: 260, height: 46, display: 'block', marginTop: 12 }} />
            <span className="cr-skel" style={{ width: '60%', height: 14, display: 'block', marginTop: 12 }} />
          </div>
        ) : loadError ? (
          <div className="cr-error" role="alert">
            <strong>We couldn&apos;t load your balance</strong>
            <span>Nothing is wrong with your money — this is just the page failing to fetch it.</span>
            <div style={{ marginTop: 8 }}><button className="cr-linkbtn" onClick={load}>RETRY</button></div>
          </div>
        ) : !selected ? (
          <div className="org-balance empty">
            <p className="k">Available to withdraw</p>
            <p className="big">0</p>
            <p className="d">Nothing to withdraw yet — earnings from paid orders show up here, net of the {commissionPct}% Zora commission.</p>
            <Link className="org-btn" href="/dashboard/events/new" style={{ marginTop: 18 }}>CREATE YOUR FIRST DROP</Link>
          </div>
        ) : (
          <>
            {balances.length > 1 ? (
              <div className="org-chips" role="tablist" aria-label="Balance currency">
                {balances.map((b) => (
                  <button key={b.currency} className={'org-chip' + (b.currency === selected.currency ? ' on' : '')} onClick={() => setCurrency(b.currency)} aria-pressed={b.currency === selected.currency}>
                    {b.currency}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="org-balance">
              <p className="k">Available to withdraw</p>
              <p className="big">{fmt(selected.available)} <span className="cur">{selected.currency}</span></p>
              <p className="d">Net of the {commissionPct}% Zora commission, from paid orders only. Refunds are already taken off.</p>
              <div className="org-breakdown">
                <div><p className="bk">Earned (net)</p><p className="bv">{fmt(selected.earned)} {selected.currency}</p></div>
                <div><p className="bk">Held for a pending request</p><p className="bv">{fmt(selected.reserved)} {selected.currency}</p></div>
                <div><p className="bk">Already paid out</p><p className="bv">{fmt(selected.paidOut)} {selected.currency}</p></div>
              </div>
            </div>
          </>
        )}

        {/* ② REQUEST — the action */}
        {!loading && !loadError && selected ? (
          <section className="cr-panel">
            <div className="cr-panel-head"><h2 className="cr-section-h">Request a withdrawal</h2></div>

            {!verified ? (
              <p className="org-notice" role="status">Withdrawals unlock once a Zora admin verifies your organizer account. Your earnings keep accruing in the meantime — nothing is lost.</p>
            ) : pending ? (
              <p className="org-notice" role="status">You have 1 request pending. We settle one at a time, so the next one opens as soon as this is paid or rejected.</p>
            ) : belowMinimum ? (
              <p className="org-notice" role="status">You need at least {fmt(selected.minimum)} {selected.currency} to withdraw. You have {fmt(selected.available)} {selected.currency} — keep selling and it&apos;ll open up.</p>
            ) : null}

            <form onSubmit={submit}>
              <div className="org-form-row">
                <div className="org-field">
                  <label htmlFor="po-amount">Amount ({selected.currency})</label>
                  <input id="po-amount" inputMode="numeric" autoComplete="off" className="mono" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(selected.available)} disabled={!canRequest || submitting} aria-describedby="po-amount-help" />
                  <p className="org-help" id="po-amount-help">Minimum {fmt(selected.minimum)} · maximum {fmt(selected.available)} {selected.currency}</p>
                </div>
                <div className="org-field">
                  <label htmlFor="po-note">Where to send it (optional)</label>
                  <input id="po-note" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} placeholder="M-Pesa 0712 345 678 / CRDB 0150…" disabled={!canRequest || submitting} />
                  <p className="org-help">Whatever helps our team pay the right account.</p>
                </div>
              </div>
              <div className="org-actions">
                <button className="org-btn" type="submit" disabled={!canRequest || !amountOk || submitting}>
                  {submitting ? 'REQUESTING…' : 'REQUEST WITHDRAWAL'}
                </button>
                {canRequest && amount && !amountOk ? (
                  <span className="org-inline-warn">Enter a whole amount between {fmt(selected.minimum)} and {fmt(selected.available)}.</span>
                ) : null}
              </div>
              {formError ? <p className="org-alert err" role="alert">{formError}</p> : null}
              {success ? <p className="org-alert ok" role="status">{success}</p> : null}
            </form>
          </section>
        ) : null}

        {/* ③ HISTORY */}
        <section className="cr-panel">
          <div className="cr-panel-head"><h2 className="cr-section-h">Withdrawal history</h2></div>
          <DataTable
            columns={payoutCols}
            rows={view?.payouts ?? []}
            rowKey={(p) => p.id}
            loading={loading}
            error={loadError ? 'Could not load your withdrawal history.' : null}
            onRetry={load}
            caption="Withdrawal history"
            emptyTitle="No withdrawals yet"
            emptyBody={<span>Every request and its transfer reference lands here.</span>}
          />
        </section>
      </div>
    </OrgShell>
  );
}

/** requested→pending · approved→paid · rejected→failed (StatusPill tones). */
function toneForPayout(status: string): 'pending' | 'paid' | 'failed' | 'neutral' {
  switch ((status || '').toLowerCase()) {
    case 'requested':
      return 'pending';
    case 'approved':
      return 'paid';
    case 'rejected':
      return 'failed';
    default:
      return 'neutral';
  }
}
