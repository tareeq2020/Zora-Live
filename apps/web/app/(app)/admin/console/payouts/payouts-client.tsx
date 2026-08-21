'use client';

/* PR-BS89 · Control-Room console — PAYOUTS, ported from the legacy
   dashboard/sections/payouts-section.tsx onto the CR primitives.

   Re-skin, NOT new logic. Same withdrawal-queue endpoints:
     GET /api/admin/payouts?status=requested   the queue
     GET /api/admin/payouts                     everything (the decided tab)
     PUT /api/admin/payouts/:id                 { decision:'approve', reference, fxNote }
                                              | { decision:'reject', reason }

   Settlement is OUT-OF-BAND: a human makes the transfer and types the reference
   here, so `reference` is REQUIRED to approve (an approved payout with no
   reference is money that left with no proof) and `reason` is required to
   reject. Both rules are enforced server-side too — the disabled buttons are
   courtesy. Amounts are the exact figure (never abbreviated) — a staffer retypes
   them into a banking app. */

import { useCallback, useState } from 'react';
import { CrDrawer, DataTable, StatusPill, type Column, type PillTone } from '@/app/components/cr';
import { adminApi, ageLabel, errText, useAdminResource, useJsonLoader, useNow, whenLocal } from '../../dashboard/admin-kit';
import { AdminConsoleShell } from '../console-shell';
import { ConsoleToastProvider, CrField, CrMeta, CrSectionHead, crDangerBtn, crPrimaryBtn, useConsoleToast } from '../console-kit';

type Payout = {
  id: string;
  organizerHandle: string;
  organizerName: string;
  amount: number;
  currency: string;
  status: 'requested' | 'approved' | 'rejected' | string;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  reference: string | null;
  fxNote: string | null;
  note: string | null;
  reason: string | null;
  // BS98 — the structured destination the organizer picked (null for legacy rows).
  destination: {
    method: 'mobile_money' | 'bank' | string;
    provider: string;
    providerName: string;
    account: string;
    accountName: string | null;
  } | null;
};

const statusTone = (s: string): PillTone => (s === 'approved' ? 'paid' : s === 'rejected' ? 'failed' : 'pending');
const statusLabel = (s: string) => (s === 'approved' ? 'PAID' : s === 'rejected' ? 'REJECTED' : s === 'requested' ? 'PENDING' : String(s).toUpperCase());

/** Whole units, grouped — the exact figure, never abbreviated. */
const exact = (n: number) => (Number(n) || 0).toLocaleString('en-US');

const methodLabel = (m: string) => (m === 'bank' ? 'Bank' : m === 'mobile_money' ? 'Mobile money' : m);

/** The destination as a single readable line for the queue's "Send to" column —
    the provider + account a staffer types into their banking / momo app, with the
    holder name for a bank. Falls back to the freetext note for legacy rows. */
function destSummary(p: Payout): string | null {
  const d = p.destination;
  if (!d) return p.note || null;
  return `${methodLabel(d.method)} · ${d.providerName} · ${d.account}${d.accountName ? ` · ${d.accountName}` : ''}`;
}

export default function AdminPayoutsClient() {
  return (
    <ConsoleToastProvider>
      <PayoutsInner />
    </ConsoleToastProvider>
  );
}

function PayoutsInner() {
  const toast = useConsoleToast();
  const now = useNow();

  const queueLoader = useJsonLoader<Payout[]>('/api/admin/payouts?status=requested');
  const historyLoader = useJsonLoader<Payout[]>('/api/admin/payouts');
  const queue = useAdminResource(queueLoader);
  const history = useAdminResource(historyLoader);

  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<'approve' | 'reject'>('approve');
  const [reference, setReference] = useState('');
  const [fxNote, setFxNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const current = queue.data?.find((p) => p.id === openId) || null;

  const close = useCallback(() => {
    setOpenId(null);
    setReference('');
    setFxNote('');
    setReason('');
    setMode('approve');
  }, []);

  function open(p: Payout) {
    setOpenId(p.id);
    setMode('approve');
    setReference('');
    setFxNote('');
    setReason('');
  }

  async function decide(decision: 'approve' | 'reject') {
    if (!current) return;
    const body =
      decision === 'approve'
        ? { decision, reference: reference.trim(), fxNote: fxNote.trim() || undefined }
        : { decision, reason: reason.trim() };

    if (decision === 'approve' && !window.confirm(`Confirm you have already sent ${exact(current.amount)} ${current.currency} to ${current.organizerName}. This is final.`)) {
      return;
    }
    setBusy(true);
    try {
      await adminApi(`/api/admin/payouts/${current.id}`, { method: 'PUT', body: JSON.stringify(body) });
      toast(decision === 'approve' ? 'Marked paid — reference recorded' : 'Rejected — the amount returns to their balance');
      close();
      queue.reload();
      history.reload();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setBusy(false);
    }
  }

  const queueCols: Column<Payout>[] = [
    {
      key: 'age',
      header: 'Requested',
      render: (p) => {
        const a = ageLabel(p.requestedAt, now);
        return <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: a.late ? 'var(--cr-red)' : 'var(--cr-ink2)' }}>{a.text}</span>;
      },
    },
    {
      key: 'org',
      header: 'Organizer',
      primary: true,
      render: (p) => (
        <span>
          {p.organizerName}
          <br />
          <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 11, color: 'var(--cr-mut)' }}>{p.organizerHandle}</span>
        </span>
      ),
    },
    { key: 'amount', header: 'Amount', numeric: true, render: (p) => exact(p.amount) },
    { key: 'currency', header: 'Currency', render: (p) => <span style={{ fontFamily: 'var(--cr-mono)' }}>{p.currency}</span> },
    { key: 'dest', header: 'Send to', render: (p) => { const s = destSummary(p); return s ? <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 11 }}>{s}</span> : <span style={{ color: 'var(--cr-mut)' }}>—</span>; } },
    {
      key: 'act',
      header: '',
      render: (p) => (
        <button type="button" className="cr-btn" onClick={() => open(p)}>
          Settle
        </button>
      ),
    },
  ];

  const historyCols: Column<Payout>[] = [
    { key: 'when', header: 'Requested', render: (p) => <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12 }}>{whenLocal(p.requestedAt)}</span> },
    {
      key: 'org',
      header: 'Organizer',
      primary: true,
      render: (p) => (
        <span>
          {p.organizerName}
          <br />
          <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 11, color: 'var(--cr-mut)' }}>{p.organizerHandle}</span>
        </span>
      ),
    },
    { key: 'amount', header: 'Amount', numeric: true, render: (p) => `${exact(p.amount)} ${p.currency}` },
    { key: 'status', header: 'Status', render: (p) => <StatusPill tone={statusTone(p.status)} label={statusLabel(p.status)} /> },
    {
      key: 'proof',
      header: 'Reference / reason',
      render: (p) => (
        <span>
          {p.reference ? <span style={{ fontFamily: 'var(--cr-mono)' }}>{p.reference}</span> : null}
          {p.fxNote ? (
            <>
              <br />
              <span style={{ fontFamily: 'var(--cr-mono)', color: 'var(--cr-mut)' }}>{p.fxNote}</span>
            </>
          ) : null}
          {p.reason ? <span style={{ color: 'var(--cr-mut)' }}>{p.reason}</span> : null}
          {!p.reference && !p.reason ? <span style={{ color: 'var(--cr-mut)' }}>—</span> : null}
        </span>
      ),
    },
    { key: 'decided', header: 'Decided', render: (p) => <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12 }}>{whenLocal(p.decidedAt)}</span> },
  ];

  const decided = (history.data || []).filter((p) => p.status !== 'requested');

  return (
    <AdminConsoleShell title="Payouts">
      <div className="cr-stack">
        <CrSectionHead
          title="Payouts"
          hint="The withdrawal queue. Balances are net of the Zora commission and settle per currency — Zora does not convert. Make the transfer yourself, then record the reference here (and the rate you used, when the settlement currency differs). Every decision is logged."
        />

        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Awaiting settlement
            </h2>
            <button type="button" className="cr-btn" onClick={queue.reload}>
              Refresh
            </button>
          </div>
          <DataTable
            columns={queueCols}
            rows={queue.data || []}
            rowKey={(p) => p.id}
            loading={queue.status === 'loading' && !queue.loaded}
            error={queue.status === 'error' ? queue.error : null}
            onRetry={queue.reload}
            caption="Payouts awaiting settlement"
            emptyTitle="Nothing waiting to be paid"
            emptyBody={<span>When a verified organizer requests a withdrawal it lands here with the amount already reserved against their balance.</span>}
          />
        </section>

        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Settled &amp; rejected
            </h2>
          </div>
          <DataTable
            columns={historyCols}
            rows={decided}
            rowKey={(p) => p.id}
            loading={history.status === 'loading' && !history.loaded}
            error={history.status === 'error' ? history.error : null}
            onRetry={history.reload}
            caption="Settled and rejected payouts"
            emptyTitle="No payouts have been decided yet"
            emptyBody={<span>Approved transfers keep their bank or mobile-money reference here; rejected ones keep the reason the organizer was given.</span>}
          />
        </section>
      </div>

      {current ? (
        <CrDrawer open onClose={close} ariaLabel={`Settle payout — ${current.organizerName}`} title={current.organizerName} subtitle={current.organizerHandle}>
          <CrMeta
            rows={[
              ['AMOUNT', `${exact(current.amount)} ${current.currency}`],
              ['HANDLE', current.organizerHandle],
              ['REQUESTED', whenLocal(current.requestedAt)],
              ...(current.destination
                ? ([
                    ['METHOD', methodLabel(current.destination.method)],
                    ['PROVIDER', current.destination.providerName],
                    ['ACCOUNT', current.destination.account],
                    ...(current.destination.accountName ? [['ACCOUNT NAME', current.destination.accountName]] : []),
                  ] as [string, string][])
                : ([['SEND TO', current.note || '— (not supplied)']] as [string, string][])),
              ...(current.destination && current.note ? ([['NOTE', current.note]] as [string, string][]) : []),
            ]}
          />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <button type="button" className="cr-btn" style={mode === 'approve' ? crPrimaryBtn : undefined} onClick={() => setMode('approve')} disabled={busy}>
              Mark paid
            </button>
            <button type="button" className="cr-btn" style={mode === 'reject' ? crDangerBtn : undefined} onClick={() => setMode('reject')} disabled={busy}>
              Reject…
            </button>
          </div>

          {mode === 'approve' ? (
            <div style={{ padding: 14, border: '1px solid var(--cr-hair)', borderRadius: 12, display: 'grid', gap: 12 }}>
              <CrField label="Transfer reference (required — proof the money moved)" htmlFor="po-ref">
                <input
                  id="po-ref"
                  className="cr-input"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="MPESA-7X41-QQ / CRDB TT-889201"
                  autoComplete="off"
                />
              </CrField>
              <CrField label="FX note (only if you settled in another currency)" htmlFor="po-fx">
                <input
                  id="po-fx"
                  className="cr-input"
                  value={fxNote}
                  onChange={(e) => setFxNote(e.target.value)}
                  placeholder="e.g. paid USD 40 @ 2,500 TZS/USD"
                  autoComplete="off"
                />
              </CrField>
              <button type="button" className="cr-btn" style={crPrimaryBtn} onClick={() => decide('approve')} disabled={busy || !reference.trim()}>
                Confirm — {exact(current.amount)} {current.currency} sent
              </button>
            </div>
          ) : (
            <div style={{ padding: 14, border: '1px solid var(--cr-hair)', borderRadius: 12, display: 'grid', gap: 12 }}>
              <CrField label="Rejection reason (required — the organizer sees this)" htmlFor="po-reason">
                <textarea
                  id="po-reason"
                  className="cr-textarea"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Bank details do not match the registered organizer."
                />
              </CrField>
              <button type="button" className="cr-btn" style={crDangerBtn} onClick={() => decide('reject')} disabled={busy || !reason.trim()}>
                Confirm rejection — amount returns to their balance
              </button>
            </div>
          )}
        </CrDrawer>
      ) : null}
    </AdminConsoleShell>
  );
}
