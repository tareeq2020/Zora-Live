'use client';

/* PR-BS38 (#7) — PAYOUTS section. Replaces the BS36 placeholder with the real
   withdrawal queue on the endpoints the payouts lane added:

     GET /api/admin/payouts?status=requested   the queue
     GET /api/admin/payouts                    everything (the decided tab)
     PUT /api/admin/payouts/:id                { decision:'approve', reference, fxNote }
                                             | { decision:'reject', reason }

   Settlement is OUT-OF-BAND and this screen is deliberately honest about that:
   Zora does not push money anywhere, a human makes the transfer and types the
   reference in here. So `reference` is required to approve (an approved payout
   with no reference is money that left with no proof) and `reason` is required
   to reject (the organizer reads it). Both rules are enforced server-side too —
   the disabled buttons below are courtesy, not the gate.

   Everything else comes free from the shared primitives: `useAdminResource`
   gives the six states, `AdminTable` is responsive by construction (stacked
   cards below 620px), amounts are mono per DESIGN.md 4b. */

import { useCallback, useState } from 'react';
import {
  AdminCard,
  AdminTable,
  adminApi,
  ageLabel,
  errText,
  useAdminResource,
  useJsonLoader,
  useNow,
  useToast,
  whenLocal,
  type AdminColumn,
} from '../admin-kit';

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
};

const STATUS_PILL: Record<string, string> = {
  requested: 'pending',
  approved: 'approved',
  rejected: 'rejected',
};
const STATUS_LABEL: Record<string, string> = {
  requested: 'PENDING',
  approved: 'PAID',
  rejected: 'REJECTED',
};

/** Whole units, grouped — the exact figure, never abbreviated. This is the
    number a staffer retypes into a banking app, so `1.2M` would be a hazard. */
const exact = (n: number) => (Number(n) || 0).toLocaleString('en-US');

export function PayoutsSection() {
  const toast = useToast();
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

  const queueCols: AdminColumn<Payout>[] = [
    {
      key: 'age',
      label: 'REQUESTED',
      render: (p) => {
        const a = ageLabel(p.requestedAt, now);
        return <span className={'kyc-sla' + (a.late ? ' late' : '')}>{a.text}</span>;
      },
    },
    {
      key: 'org',
      label: 'ORGANIZER',
      render: (p) => (
        <div>
          <b>{p.organizerName}</b>
          <br />
          <span className="mono" style={{ color: 'var(--mut)' }}>
            {p.organizerHandle}
          </span>
        </div>
      ),
    },
    { key: 'amount', label: 'AMOUNT', render: (p) => <span className="mono">{exact(p.amount)}</span> },
    { key: 'currency', label: 'CURRENCY', render: (p) => <span className="mono">{p.currency}</span> },
    {
      key: 'dest',
      label: 'SEND TO',
      render: (p) => (p.note ? <span className="mono">{p.note}</span> : <span style={{ color: 'var(--mut)' }}>—</span>),
    },
    {
      key: 'act',
      label: '',
      actions: true,
      render: (p) => (
        <button type="button" className="btn small" onClick={() => open(p)}>
          SETTLE
        </button>
      ),
    },
  ];

  const historyCols: AdminColumn<Payout>[] = [
    { key: 'when', label: 'REQUESTED', render: (p) => <span className="mono">{whenLocal(p.requestedAt)}</span> },
    {
      key: 'org',
      label: 'ORGANIZER',
      render: (p) => (
        <div>
          <b>{p.organizerName}</b>
          <br />
          <span className="mono" style={{ color: 'var(--mut)' }}>
            {p.organizerHandle}
          </span>
        </div>
      ),
    },
    {
      key: 'amount',
      label: 'AMOUNT',
      render: (p) => (
        <span className="mono">
          {exact(p.amount)} {p.currency}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'STATUS',
      render: (p) => (
        <span className={'pill ' + (STATUS_PILL[p.status] || 'pending')}>{STATUS_LABEL[p.status] || String(p.status).toUpperCase()}</span>
      ),
    },
    {
      key: 'proof',
      label: 'REFERENCE / REASON',
      render: (p) => (
        <div>
          {p.reference ? <span className="mono">{p.reference}</span> : null}
          {p.fxNote ? (
            <>
              <br />
              <span className="mono" style={{ color: 'var(--mut)' }}>
                {p.fxNote}
              </span>
            </>
          ) : null}
          {p.reason ? <span style={{ color: 'var(--mut)' }}>{p.reason}</span> : null}
          {!p.reference && !p.reason ? <span style={{ color: 'var(--mut)' }}>—</span> : null}
        </div>
      ),
    },
    { key: 'decided', label: 'DECIDED', render: (p) => <span className="mono">{whenLocal(p.decidedAt)}</span> },
  ];

  const decided = (history.data || []).filter((p) => p.status !== 'requested');

  return (
    <>
      <div className="sec-h">
        <h2>Payouts</h2>
        <p className="hint">
          The withdrawal queue. Balances are net of the Zora commission and settle per currency — Zora does not
          convert. Make the transfer yourself, then record the reference here (and the rate you used, when the
          settlement currency differs). Every decision is logged.
        </p>
      </div>

      <div className="stack">
        <AdminCard
          title="AWAITING SETTLEMENT"
          subtitle="The amount is already held back from the organizer's available balance."
          actions={
            <button type="button" className="btn small ghost" onClick={queue.reload}>
              REFRESH
            </button>
          }
          flush
        >
          <AdminTable
            columns={queueCols}
            rows={queue.data}
            rowKey={(p) => p.id}
            resource={queue}
            empty="Nothing waiting to be paid."
            emptySub="When a verified organizer requests a withdrawal it lands here with the amount already reserved against their balance."
          />
        </AdminCard>

        <AdminCard title="SETTLED & REJECTED" flush>
          <AdminTable
            columns={historyCols}
            rows={decided}
            rowKey={(p) => p.id}
            resource={history}
            empty="No payouts have been decided yet."
            emptySub="Approved transfers keep their bank or mobile-money reference here; rejected ones keep the reason the organizer was given."
          />
        </AdminCard>
      </div>

      {current ? (
        <div
          className="drawer"
          role="dialog"
          aria-modal="true"
          aria-label={`Settle payout — ${current.organizerName}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="drawer-sheet">
            <button type="button" className="drawer-close" aria-label="Close" onClick={close}>
              ×
            </button>
            <h3>{current.organizerName}</h3>

            <div className="kyc-meta">
              {(
                [
                  ['AMOUNT', `${exact(current.amount)} ${current.currency}`],
                  ['HANDLE', current.organizerHandle],
                  ['REQUESTED', whenLocal(current.requestedAt)],
                  ['SEND TO', current.note || '— (not supplied)'],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k}>
                  <p className="m-k">{k}</p>
                  <p className="m-v">{v}</p>
                </div>
              ))}
            </div>

            <div className="kyc-decide">
              <button
                type="button"
                className={'btn' + (mode === 'approve' ? '' : ' ghost')}
                onClick={() => setMode('approve')}
                disabled={busy}
              >
                MARK PAID
              </button>
              <button
                type="button"
                className={'btn danger'}
                onClick={() => setMode('reject')}
                disabled={busy}
              >
                REJECT…
              </button>
            </div>

            {mode === 'approve' ? (
              <div className="kyc-reject-box" style={{ borderColor: 'var(--hair)' }}>
                <label htmlFor="po-ref">TRANSFER REFERENCE (required — proof the money moved)</label>
                <input
                  id="po-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="MPESA-7X41-QQ / CRDB TT-889201"
                  autoComplete="off"
                />
                <label htmlFor="po-fx" style={{ marginTop: 12 }}>
                  FX NOTE (only if you settled in another currency)
                </label>
                <input
                  id="po-fx"
                  value={fxNote}
                  onChange={(e) => setFxNote(e.target.value)}
                  placeholder="e.g. paid USD 40 @ 2,500 TZS/USD"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 12 }}
                  onClick={() => decide('approve')}
                  disabled={busy || !reference.trim()}
                >
                  CONFIRM — {exact(current.amount)} {current.currency} SENT
                </button>
              </div>
            ) : (
              <div className="kyc-reject-box">
                <label htmlFor="po-reason">REJECTION REASON (required — the organizer sees this)</label>
                <textarea
                  id="po-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Bank details do not match the registered organizer."
                />
                <button
                  type="button"
                  className="btn danger"
                  style={{ marginTop: 12 }}
                  onClick={() => decide('reject')}
                  disabled={busy || !reason.trim()}
                >
                  CONFIRM REJECTION — AMOUNT RETURNS TO THEIR BALANCE
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
