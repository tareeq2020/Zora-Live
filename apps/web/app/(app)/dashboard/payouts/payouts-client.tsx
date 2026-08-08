'use client';

/* PR-BS38 (#7) — the organizer WITHDRAWALS view (client).

   Hierarchy is fixed by the design spec: BALANCE → ACTION → HISTORY. The balance
   is the biggest thing on the page, in mono, with the commission context spelled
   out next to it ("net of 5% Zora commission") — the organizer should never have
   to work out why the number is smaller than their sales figure (DESIGN.md 4b/5).

   One endpoint drives everything:
     GET  /api/org/payouts  -> { balances[{currency,earned,reserved,paidOut,
                                 available,minimum}], payouts[], verified,
                                 commissionRate, pendingCount }
     POST /api/org/payouts  <- { amount, currency, note }
                            -> 400 { error: <typed code>, message, balance }

   Nothing is computed here. The client never derives a balance, never applies a
   commission, and never decides whether an amount is allowed — it sends the
   amount and renders whatever the server says (plan #7: "balance guard is
   authoritative server-side"). The local checks below only keep the button from
   firing an obviously doomed request; the server still re-decides every one.

   All six states are here: loading (skeleton), zero balance, below-minimum,
   pending request (disabled + explained), unverified (disabled + explained),
   error (cause + retry), and success.

   Styles are scoped under `.zora-payouts` — the same light control-room token
   set as /dashboard and /dashboard/sales, so this reads as one surface. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type Balance = {
  currency: string;
  earned: number;
  reserved: number;
  paidOut: number;
  available: number;
  minimum: number;
};
type Payout = {
  id: string;
  amount: number;
  currency: string;
  status: 'requested' | 'approved' | 'rejected' | string;
  requestedAt: string;
  decidedAt: string | null;
  reference: string | null;
  fxNote: string | null;
  note: string | null;
  reason: string | null;
};
type PayoutView = {
  balances: Balance[];
  payouts: Payout[];
  verified: boolean;
  commissionRate: number;
  pendingCount: number;
};

const fmt = (n: number) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US') : '—');

function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** requested = money held back, approved = paid, rejected = returned. */
const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  requested: { label: 'PENDING', tone: 'pending' },
  approved: { label: 'PAID', tone: 'paid' },
  rejected: { label: 'REJECTED', tone: 'failed' },
};

export default function PayoutsClient() {
  const [view, setView] = useState<PayoutView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [currency, setCurrency] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  // The server's typed rejection — code drives nothing but the tone; the message
  // is the server's own copy, so there is ONE place the wording lives (CQ3).
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
  const selected = useMemo(
    () => balances.find((b) => b.currency === currency) ?? balances[0] ?? null,
    [balances, currency],
  );

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
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string; payout?: Payout };
      if (!res.ok) {
        // The server's message is the copy. Never re-word it here.
        setFormError(data?.message || 'That withdrawal could not be requested.');
        await load();
        return;
      }
      setSuccess(
        `Requested ${fmt(parsedAmount)} ${selected.currency}. We'll transfer it and record the reference here — usually within 2 business days.`,
      );
      setAmount('');
      setNote('');
      await load();
    } catch {
      setFormError('We could not reach Zora just then. Check your connection and try again — nothing was requested.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />

      <div className="zora-payouts">
        <main>
          <p className="crumb">
            <Link href="/dashboard">DASHBOARD</Link> / WITHDRAWALS
          </p>
          <h1>Withdrawals</h1>
          <p className="sub">
            Your money, on request. Zora transfers it to your bank or mobile-money account by hand and
            records the reference here — we never hold a payout you can&apos;t see.
          </p>

          {/* ── 1. BALANCE (first, biggest, mono) ─────────────────────── */}
          {loading ? (
            <div className="bal skeleton" aria-busy="true">
              <p className="k">&nbsp;</p>
              <p className="big">&nbsp;</p>
              <p className="d">&nbsp;</p>
            </div>
          ) : loadError ? (
            <div className="state error" role="alert">
              <p>
                We couldn&apos;t load your balance. Nothing is wrong with your money — this is just the
                page failing to fetch it.
              </p>
              <button className="btn ghost" onClick={load}>
                RETRY
              </button>
            </div>
          ) : !selected ? (
            <div className="bal empty">
              <p className="k">AVAILABLE TO WITHDRAW</p>
              <p className="big">0</p>
              <p className="d">
                Nothing to withdraw yet — earnings from paid orders show up here, net of the{' '}
                {commissionPct}% Zora commission.
              </p>
              <Link className="btn" href="/dashboard/events/new">
                CREATE YOUR FIRST DROP
              </Link>
            </div>
          ) : (
            <>
              {balances.length > 1 ? (
                <div className="chips" role="tablist" aria-label="Balance currency">
                  {balances.map((b) => (
                    <button
                      key={b.currency}
                      className={'chip' + (b.currency === selected.currency ? ' on' : '')}
                      onClick={() => setCurrency(b.currency)}
                      aria-pressed={b.currency === selected.currency}
                    >
                      {b.currency}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="bal">
                <p className="k">AVAILABLE TO WITHDRAW</p>
                <p className="big">
                  {fmt(selected.available)} <span className="cur">{selected.currency}</span>
                </p>
                <p className="d">
                  Net of the {commissionPct}% Zora commission, from paid orders only. Refunds are already
                  taken off.
                </p>
                <div className="breakdown">
                  <div>
                    <p className="bk">EARNED (NET)</p>
                    <p className="bv">
                      {fmt(selected.earned)} {selected.currency}
                    </p>
                  </div>
                  <div>
                    <p className="bk">HELD FOR A PENDING REQUEST</p>
                    <p className="bv">
                      {fmt(selected.reserved)} {selected.currency}
                    </p>
                  </div>
                  <div>
                    <p className="bk">ALREADY PAID OUT</p>
                    <p className="bv">
                      {fmt(selected.paidOut)} {selected.currency}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── 2. REQUEST (the action) ───────────────────────────────── */}
          {!loading && !loadError && selected ? (
            <div className="box request">
              <p className="bh">REQUEST A WITHDRAWAL</p>

              {!verified ? (
                <p className="notice" role="status">
                  Withdrawals unlock once a Zora admin verifies your organizer account. Your earnings keep
                  accruing in the meantime — nothing is lost.
                </p>
              ) : pending ? (
                <p className="notice" role="status">
                  You have 1 request pending. We settle one at a time, so the next one opens as soon as this
                  is paid or rejected.
                </p>
              ) : belowMinimum ? (
                <p className="notice" role="status">
                  You need at least {fmt(selected.minimum)} {selected.currency} to withdraw. You have{' '}
                  {fmt(selected.available)} {selected.currency} — keep selling and it&apos;ll open up.
                </p>
              ) : null}

              <form onSubmit={submit}>
                <div className="row">
                  <div className="field">
                    <label htmlFor="po-amount">AMOUNT ({selected.currency})</label>
                    <input
                      id="po-amount"
                      inputMode="numeric"
                      autoComplete="off"
                      className="mono"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={String(selected.available)}
                      disabled={!canRequest || submitting}
                      aria-describedby="po-amount-help"
                    />
                    <p className="help" id="po-amount-help">
                      Minimum {fmt(selected.minimum)} · maximum {fmt(selected.available)} {selected.currency}
                    </p>
                  </div>
                  <div className="field">
                    <label htmlFor="po-note">WHERE TO SEND IT (OPTIONAL)</label>
                    <input
                      id="po-note"
                      autoComplete="off"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="M-Pesa 0712 345 678 / CRDB 0150…"
                      disabled={!canRequest || submitting}
                    />
                    <p className="help">Whatever helps our team pay the right account.</p>
                  </div>
                </div>

                <div className="actions">
                  <button
                    className="btn"
                    type="submit"
                    disabled={!canRequest || !amountOk || submitting}
                  >
                    {submitting ? 'REQUESTING…' : 'REQUEST WITHDRAWAL'}
                  </button>
                  {canRequest && amount && !amountOk ? (
                    <span className="inline-warn">
                      Enter a whole amount between {fmt(selected.minimum)} and {fmt(selected.available)}.
                    </span>
                  ) : null}
                </div>

                {formError ? (
                  <p className="alert err" role="alert">
                    {formError}
                  </p>
                ) : null}
                {success ? (
                  <p className="alert ok" role="status">
                    {success}
                  </p>
                ) : null}
              </form>
            </div>
          ) : null}

          {/* ── 3. HISTORY ───────────────────────────────────────────── */}
          <div className="box" style={{ padding: '6px 20px 16px' }}>
            <div className="table-scroll">
              <table className="ptable">
                <thead>
                  <tr>
                    <th>REQUESTED</th>
                    <th>AMOUNT</th>
                    <th>STATUS</th>
                    <th>REFERENCE</th>
                    <th>DECIDED</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="cell-state">
                        Loading your withdrawals…
                      </td>
                    </tr>
                  ) : loadError ? (
                    <tr>
                      <td colSpan={5} className="cell-state">
                        Could not load your withdrawal history.{' '}
                        <button className="linkbtn" onClick={load}>
                          Retry
                        </button>
                      </td>
                    </tr>
                  ) : (view?.payouts ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="cell-state">
                        No withdrawals yet. Every request and its transfer reference lands here.
                      </td>
                    </tr>
                  ) : (
                    (view?.payouts ?? []).map((p) => {
                      const s = STATUS_COPY[p.status] ?? { label: (p.status || '—').toUpperCase(), tone: 'pending' };
                      return (
                        <tr key={p.id}>
                          <td className="mono note">{fmtWhen(p.requestedAt)}</td>
                          <td className="mono amt">
                            {fmt(p.amount)} {p.currency}
                          </td>
                          <td>
                            <span className={'seg ' + s.tone}>{s.label}</span>
                            {p.reason ? <span className="reason">{p.reason}</span> : null}
                          </td>
                          <td className="mono">
                            {p.reference ? p.reference : <span className="note">—</span>}
                            {p.fxNote ? <span className="fx">{p.fxNote}</span> : null}
                          </td>
                          <td className="mono note">{fmtWhen(p.decidedAt)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

// Scoped control-room palette — the same token vocabulary as /dashboard and
// /dashboard/sales. Money is IBM Plex Mono at >=11.5px against >=--mut contrast
// and every tap target is >=44px (DESIGN.md rules 2/3/4b).
// BS51 (Lane 3C): same dark Control-room tokens + the same --ink text/surface
// and green/red -> teal/orange rules as 3A/3B. Money surfaces (balance figure,
// table amounts) get extra care per DESIGN.md rule 4b — checked each one lands
// on var(--bone), the highest-contrast text color, never var(--mut).
const STYLE = `
.zora-payouts{--black:#0A0A0B;--ink:#101012;--hair:#222226;--bone:#F4F1EA;--mut:#8A877E;
  --blue:#3D5AFE;--orange:#FF5A1F;--teal:#2FA9A0;--amber:#F0C674;
  --sans:'Archivo',system-ui,sans-serif;--mono:'IBM Plex Mono',monospace;
  background:var(--black);color:var(--bone);font-family:var(--sans);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased;min-height:100vh}
.zora-payouts *{margin:0;padding:0;box-sizing:border-box}
.zora-payouts a{color:inherit;text-decoration:none}
.zora-payouts a:hover{color:var(--blue)}
.zora-payouts .mono{font-family:var(--mono)}
.zora-payouts ::selection{background:var(--blue);color:#fff}
.zora-payouts main{padding:34px 40px 80px;max-width:1000px;margin:0 auto}
@media(max-width:820px){.zora-payouts main{padding:24px 18px 60px}}
.zora-payouts .crumb{font-family:var(--mono);font-size:10.5px;letter-spacing:.3em;color:var(--mut);margin-bottom:8px}
.zora-payouts h1{font-size:26px;font-weight:600;letter-spacing:-.02em;margin-bottom:4px}
.zora-payouts .sub{color:var(--mut);font-size:13.5px;margin-bottom:26px;max-width:640px}

/* ── balance card: the biggest thing on the page (design spec #7) ── */
.zora-payouts .bal{background:var(--ink);border:1px solid var(--hair);border-radius:12px;padding:26px 28px;margin-bottom:20px}
.zora-payouts .bal .k{font-family:var(--mono);font-size:11.5px;letter-spacing:.22em;color:var(--mut)}
.zora-payouts .bal .big{font-family:var(--mono);font-size:46px;font-weight:500;letter-spacing:-.02em;line-height:1.15;margin-top:10px;color:var(--bone)}
@media(max-width:520px){.zora-payouts .bal .big{font-size:34px}}
.zora-payouts .bal .big .cur{font-size:19px;color:var(--mut);letter-spacing:.06em;margin-left:6px}
.zora-payouts .bal .d{font-size:13px;color:var(--mut);margin-top:10px;max-width:56ch}
.zora-payouts .bal.empty .big{color:var(--mut)}
.zora-payouts .bal.empty .btn{margin-top:18px;display:inline-block}
.zora-payouts .bal.skeleton .k,.zora-payouts .bal.skeleton .big,.zora-payouts .bal.skeleton .d{background:var(--hair);border-radius:6px;color:transparent;animation:po-pulse 1.6s infinite}
@keyframes po-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.zora-payouts .breakdown{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:22px;padding-top:18px;border-top:1px solid var(--hair)}
.zora-payouts .breakdown .bk{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;color:var(--mut)}
.zora-payouts .breakdown .bv{font-family:var(--mono);font-size:15px;margin-top:5px;color:var(--bone)}

.zora-payouts .chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.zora-payouts .chip{font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;padding:11px 18px;min-height:44px;border-radius:99px;border:1px solid var(--hair);background:none;color:var(--mut);cursor:pointer}
.zora-payouts .chip:hover{color:var(--bone);border-color:var(--mut)}
.zora-payouts .chip.on{background:var(--bone);color:var(--black);border-color:var(--bone)}

/* ── request form ── */
.zora-payouts .box{background:var(--ink);border:1px solid var(--hair);border-radius:10px;padding:22px 24px;margin-bottom:20px}
.zora-payouts .box .bh{font-family:var(--mono);font-size:10.5px;letter-spacing:.25em;color:var(--mut);margin-bottom:16px}
.zora-payouts .notice{background:#191305;color:var(--amber);border-radius:8px;padding:13px 15px;font-size:13px;line-height:1.6;margin-bottom:18px}
.zora-payouts .row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:16px}
@media(max-width:640px){.zora-payouts .row{grid-template-columns:1fr}}
.zora-payouts label{display:block;font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;color:var(--mut);margin-bottom:7px}
.zora-payouts input{width:100%;background:var(--black);border:1px solid var(--hair);border-radius:8px;color:var(--bone);font-family:var(--sans);font-size:15px;padding:13px 14px;min-height:48px}
.zora-payouts input.mono{font-family:var(--mono);font-size:17px;letter-spacing:.02em}
.zora-payouts input:focus{outline:none;border-color:var(--blue)}
.zora-payouts input:disabled{background:var(--ink);color:var(--mut);cursor:not-allowed}
.zora-payouts .help{font-family:var(--mono);font-size:11.5px;color:var(--mut);margin-top:7px;letter-spacing:.02em}
.zora-payouts .actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:18px}
.zora-payouts .inline-warn{font-size:12.5px;color:var(--amber)}
.zora-payouts .alert{margin-top:14px;border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.6}
.zora-payouts .alert.err{background:#2a1208;border:1px solid var(--orange);color:var(--orange)}
.zora-payouts .alert.ok{background:#0d2622;border:1px solid var(--teal);color:var(--teal)}

/* ── history ── */
.zora-payouts .ptable{width:100%;border-collapse:collapse;font-size:13px}
.zora-payouts .ptable th{font-family:var(--mono);font-size:9.5px;letter-spacing:.22em;color:var(--mut);text-align:left;padding:12px 8px;border-bottom:1px solid var(--hair);white-space:nowrap}
.zora-payouts .ptable td{padding:14px 8px;border-bottom:1px solid var(--hair);vertical-align:top}
.zora-payouts .ptable td.mono{font-size:12.5px}
.zora-payouts .ptable td.amt{font-size:15px;color:var(--bone);white-space:nowrap}
.zora-payouts .ptable tr:last-child td{border-bottom:none}
.zora-payouts .cell-state{text-align:center;color:var(--mut);font-size:13px;padding:34px 8px}
.zora-payouts .note{color:var(--mut);font-size:11.5px}
.zora-payouts .reason{display:block;color:var(--mut);font-size:12px;margin-top:6px;max-width:34ch;line-height:1.5}
.zora-payouts .fx{display:block;font-family:var(--mono);font-size:11.5px;color:var(--mut);margin-top:5px}
.zora-payouts .seg{font-family:var(--mono);font-size:10px;letter-spacing:.12em;padding:5px 11px;border-radius:99px;white-space:nowrap;display:inline-block}
.zora-payouts .seg.paid{background:rgba(47,169,160,.14);color:var(--teal)}
.zora-payouts .seg.pending{background:rgba(61,90,254,.14);color:var(--blue)}
.zora-payouts .seg.failed{background:rgba(255,90,31,.14);color:var(--orange)}
.zora-payouts .table-scroll{overflow-x:auto}

.zora-payouts .state{background:var(--ink);border:1px solid var(--hair);border-radius:10px;padding:26px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px}
.zora-payouts .state.error{color:var(--mut);font-size:13.5px}
.zora-payouts .btn{background:var(--bone);color:var(--black);border:1px solid var(--bone);font-family:var(--mono);font-size:11.5px;font-weight:500;letter-spacing:.16em;padding:15px 26px;min-height:48px;border-radius:8px;cursor:pointer;transition:background .2s,color .2s,border-color .2s}
.zora-payouts .btn:hover:not(:disabled){background:var(--blue);border-color:var(--blue);color:var(--bone)}
.zora-payouts .btn:disabled{opacity:.45;cursor:not-allowed}
.zora-payouts .btn.ghost{background:none;border:1px solid var(--hair);color:var(--mut)}
.zora-payouts .btn.ghost:hover{border-color:var(--blue);color:var(--blue);background:none}
.zora-payouts .linkbtn{background:none;border:none;color:var(--blue);font-family:var(--mono);font-size:12px;cursor:pointer;text-decoration:underline;padding:0}
`;
