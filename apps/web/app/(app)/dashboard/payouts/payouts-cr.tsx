'use client';

/* BS71 · Lane B — the organizer WITHDRAWALS view, ported onto the Control-Room
   v2 component library (Lane A · BS69). Replaces the imperative dark-only
   `payouts-client.tsx` scoped-`<style>` surface with idiomatic CR primitives
   (<CrShell>, the `.org-balance` hero, DataTable→cards, StatusPill) so it is
   theme-aware + responsive for free.

   Hierarchy is unchanged (design spec #7): BALANCE → ACTION → HISTORY, balance
   biggest, money at the highest-contrast ink (rule 4b). DATA IS UNCHANGED — one
   real endpoint drives everything and NOTHING is computed in the browser:
     GET  /api/org/payouts  → { balances[], payouts[], verified, commissionRate, pendingCount }
     POST /api/org/payouts  ← { amount, currency, note }  (server re-decides every request)
   The legacy `payouts-client.tsx` stays in-tree (strangler-fig) for parity. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CrShell, DataTable, StatusPill, type Column } from '@/app/components/cr';
import { ORG_NAV } from '../components/org-nav';
import '../components/org-surfaces.css';

const ORG_BRAND = { name: (<>z<span className="cr-o">o</span>ra</>), sublabel: 'Organizer' };

type Balance = { currency: string; earned: number; reserved: number; paidOut: number; available: number; minimum: number };
type Payout = {
  id: string; amount: number; currency: string; status: string; requestedAt: string; decidedAt: string | null;
  reference: string | null; fxNote: string | null; note: string | null; reason: string | null;
};
type PayoutView = { balances: Balance[]; payouts: Payout[]; verified: boolean; commissionRate: number; pendingCount: number };
type Method = 'mobile_money' | 'bank';
type Catalog = {
  methods: { id: Method; label: string }[];
  banks: { code: string; name: string }[];
  mnos: { code: string; name: string }[];
};

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

  // BS98 — the structured destination: method → provider → account (+ name for bank).
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [method, setMethod] = useState<Method>('mobile_money');
  const [provider, setProvider] = useState('');
  const [account, setAccount] = useState('');
  const [accountName, setAccountName] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/org/payouts/methods', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: Catalog | null) => {
        if (alive && c) setCatalog(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // The provider list for the chosen method; reset the selected provider whenever
  // the method flips so a bank code can never linger under "mobile money".
  const providerOptions = method === 'bank' ? catalog?.banks ?? [] : catalog?.mnos ?? [];
  function chooseMethod(m: Method) {
    setMethod(m);
    setProvider('');
    setAccountName('');
  }

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

  // Destination completeness mirrors the server rule (core validateDestination):
  // a provider, an account, and — for a bank — the account holder's name.
  const accountDigits = account.replace(/[^0-9]/g, '').length;
  const accountOk = method === 'mobile_money' ? accountDigits >= 9 && accountDigits <= 12 : accountDigits >= 6;
  const destinationOk = !!provider && accountOk && (method !== 'bank' || accountName.trim().length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || submitting) return;
    setSubmitting(true);
    setFormError(null);
    setSuccess(null);
    try {
      const providerName = providerOptions.find((p) => p.code === provider)?.name ?? provider;
      const res = await fetch('/api/org/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          amount: parsedAmount,
          currency: selected.currency,
          note: note || undefined,
          destination: {
            method,
            provider,
            providerName,
            account: account.trim(),
            accountName: method === 'bank' ? accountName.trim() : undefined,
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setFormError(data?.message || 'That withdrawal could not be requested.');
        await load();
        return;
      }
      setSuccess(`Requested ${fmt(parsedAmount)} ${selected.currency} to your ${providerName} account. We'll transfer it and record the reference here — usually within 2 business days.`);
      setAmount('');
      setNote('');
      setAccount('');
      setAccountName('');
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
    <CrShell
      nav={ORG_NAV}
      brand={ORG_BRAND}
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
              </div>

              {/* ── BS98: WHERE to send it — method → provider → account ── */}
              <div className="org-field">
                <label>How do you want to be paid?</label>
                <div className="org-seg" role="radiogroup" aria-label="Payout method">
                  {(catalog?.methods ?? [{ id: 'mobile_money', label: 'Mobile money' }, { id: 'bank', label: 'Bank account' }]).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={method === m.id}
                      className={method === m.id ? 'on' : undefined}
                      onClick={() => chooseMethod(m.id)}
                      disabled={!canRequest || submitting}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="org-form-row">
                <div className="org-field">
                  <label htmlFor="po-provider">{method === 'bank' ? 'Bank' : 'Mobile-money operator'}</label>
                  <select
                    id="po-provider"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    disabled={!canRequest || submitting || !catalog}
                  >
                    <option value="" disabled>{catalog ? `Select ${method === 'bank' ? 'a bank' : 'an operator'}` : 'Loading…'}</option>
                    {providerOptions.map((p) => (
                      <option key={p.code} value={p.code}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="org-field">
                  <label htmlFor="po-account">{method === 'bank' ? 'Account number' : 'Mobile-money number'}</label>
                  <input
                    id="po-account"
                    inputMode={method === 'bank' ? 'numeric' : 'tel'}
                    autoComplete="off"
                    className="mono"
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    placeholder={method === 'bank' ? '0150 1234 5678' : '0712 345 678'}
                    disabled={!canRequest || submitting}
                  />
                  <p className="org-help">{method === 'bank' ? 'The account the money settles into.' : 'The phone number registered for mobile money.'}</p>
                </div>
              </div>

              {method === 'bank' ? (
                <div className="org-field">
                  <label htmlFor="po-account-name">Account holder name</label>
                  <input
                    id="po-account-name"
                    autoComplete="off"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="As it appears on the bank account"
                    disabled={!canRequest || submitting}
                  />
                  <p className="org-help">Banks require the beneficiary name to match the account.</p>
                </div>
              ) : null}

              <div className="org-field">
                <label htmlFor="po-note">Note for our team (optional)</label>
                <input id="po-note" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything else that helps us pay the right account" disabled={!canRequest || submitting} />
              </div>

              <div className="org-actions">
                <button className="org-btn" type="submit" disabled={!canRequest || !amountOk || !destinationOk || submitting}>
                  {submitting ? 'REQUESTING…' : 'REQUEST WITHDRAWAL'}
                </button>
                {canRequest && amount && !amountOk ? (
                  <span className="org-inline-warn">Enter a whole amount between {fmt(selected.minimum)} and {fmt(selected.available)}.</span>
                ) : canRequest && amountOk && !destinationOk ? (
                  <span className="org-inline-warn">Choose a {method === 'bank' ? 'bank, account number and holder name' : 'provider and mobile-money number'} to continue.</span>
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
    </CrShell>
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
