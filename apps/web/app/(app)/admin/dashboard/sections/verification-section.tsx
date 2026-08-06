'use client';

/* PR-BS36 — VERIFICATION section. The legacy "KYC REVIEW" panel + its review
   drawer, ported 1:1 onto the same endpoints:
     GET  /api/kyc                       (queue, newest first)
     GET  /api/kyc/reasons               (standardized rejection reasons)
     GET  /api/kyc/:id/documents/:docId  (gated, no-cache document stream)
     POST /api/kyc/:id/approve · POST /api/kyc/:id/reject { code, note }
   Documents are still streamed through the gated endpoint (never publicly
   served) and the on-image "admin review" watermark is preserved.

   #5 (the self-signup ORGANIZER verification queue) is a separate lane — the
   banner below says so rather than pretending this section is finished. */

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

type KycDoc = { id: string; side: string; contentType?: string };
type KycEvent = { at: string; action: string; actor: string; detail?: string };
type KycRecord = {
  id: string;
  ref: string;
  fullName: string;
  idType: string;
  country: string;
  attempt: number;
  status: 'submitted' | 'in_review' | 'approved' | 'rejected' | string;
  submittedAt: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  docNumberMasked?: string | null;
  rejection?: { code: string; note?: string } | null;
  documents: KycDoc[];
  events?: KycEvent[];
};
type Reason = { code: string; label: string };

const ID_LABEL: Record<string, string> = {
  passport: 'Passport',
  drivers_license: "Driver's License",
  national_id: 'National ID',
};
const statusLabel = (s: string) => (s === 'in_review' ? 'IN REVIEW' : String(s).toUpperCase());

export function VerificationSection({ onDecision }: { onDecision?: () => void }) {
  const toast = useToast();
  const now = useNow();
  const queueLoader = useJsonLoader<KycRecord[]>('/api/kyc');
  const reasonsLoader = useJsonLoader<Reason[]>('/api/kyc/reasons');
  const queue = useAdminResource(queueLoader);
  const reasons = useAdminResource(reasonsLoader);

  const [openId, setOpenId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const current = queue.data?.find((v) => v.id === openId) || null;

  const close = useCallback(() => {
    setOpenId(null);
    setRejecting(false);
    setNote('');
  }, []);

  function open(v: KycRecord) {
    setOpenId(v.id);
    setRejecting(false);
    setNote('');
    setReasonCode(reasons.data?.[0]?.code || '');
  }

  async function approve() {
    if (!current) return;
    if (!window.confirm('Approve this identity? Payouts unlock and the decision is logged.')) return;
    setBusy(true);
    try {
      await adminApi(`/api/kyc/${current.id}/approve`, { method: 'POST' });
      toast('Approved — payouts unlocked');
      close();
      queue.reload();
      onDecision?.();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!current) return;
    const code = reasonCode || reasons.data?.[0]?.code;
    if (!code) {
      toast('Pick a rejection reason', true);
      return;
    }
    setBusy(true);
    try {
      await adminApi(`/api/kyc/${current.id}/reject`, { method: 'POST', body: JSON.stringify({ code, note }) });
      toast('Rejected — user notified with the reason');
      close();
      queue.reload();
      onDecision?.();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setBusy(false);
    }
  }

  const cols: AdminColumn<KycRecord>[] = [
    {
      key: 'age',
      label: 'SUBMITTED',
      render: (v) => {
        const a = ageLabel(v.submittedAt, now);
        return <span className={'kyc-sla' + (a.late ? ' late' : '')}>{a.text}</span>;
      },
    },
    {
      key: 'name',
      label: 'NAME',
      render: (v) => (
        <div>
          <b>{v.fullName}</b>
          {v.docNumberMasked ? (
            <>
              <br />
              <span className="mono" style={{ color: 'var(--mut)' }}>
                {v.docNumberMasked}
              </span>
            </>
          ) : null}
        </div>
      ),
    },
    { key: 'idType', label: 'ID TYPE', render: (v) => ID_LABEL[v.idType] || v.idType },
    { key: 'country', label: 'COUNTRY', render: (v) => <span className="mono">{v.country}</span> },
    { key: 'attempt', label: 'ATTEMPT', render: (v) => <span className="mono">#{v.attempt}</span> },
    { key: 'status', label: 'STATUS', render: (v) => <span className={'pill ' + v.status}>{statusLabel(v.status)}</span> },
    {
      key: 'act',
      label: '',
      actions: true,
      render: (v) => (
        <button type="button" className="btn small" onClick={() => open(v)}>
          REVIEW
        </button>
      ),
    },
  ];

  const lastReason =
    current?.rejection ? reasons.data?.find((r) => r.code === current.rejection?.code)?.label || current.rejection.code : '—';

  return (
    <>
      <div className="sec-h">
        <h2>Verification</h2>
        <p className="hint">
          Review submitted IDs and unlock payouts. Documents are encrypted at rest and shown here through a gated,
          no-cache stream — they are never publicly served. Approve and reject are logged to the audit trail.
        </p>
      </div>

      <div className="stack">
        <p className="banner-soon">
          IDENTITY (KYC) REVIEW IS LIVE BELOW. THE SELF-SIGNUP ORGANIZER APPROVAL QUEUE — NEW ORGS WAITING TO SELL —
          ARRIVES WITH THE REGISTRATION LANE.
        </p>

        <AdminCard title="IDENTITY SUBMISSIONS" flush>
          <AdminTable
            columns={cols}
            rows={queue.data}
            rowKey={(v) => v.id}
            resource={queue}
            empty="No identity submissions yet."
            emptySub="Organizers who submit an ID for payout verification show up here within seconds."
          />
        </AdminCard>
      </div>

      {current ? (
        <div
          className="drawer"
          role="dialog"
          aria-modal="true"
          aria-label={`Identity review — ${current.fullName}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="drawer-sheet">
            <button type="button" className="drawer-close" aria-label="Close" onClick={close}>
              ×
            </button>
            <h3>{current.fullName}</h3>

            <div className="kyc-meta">
              {(
                [
                  ['REF', current.ref],
                  ['STATUS', statusLabel(current.status)],
                  ['ID TYPE', ID_LABEL[current.idType] || current.idType],
                  ['COUNTRY', current.country],
                  ['DOC NUMBER', current.docNumberMasked || '—'],
                  ['ATTEMPT', '#' + current.attempt],
                  ['SUBMITTED', whenLocal(current.submittedAt)],
                  ['REVIEWED', current.reviewedAt ? `${whenLocal(current.reviewedAt)} · ${current.reviewedBy || ''}` : '—'],
                  ['LAST REASON', lastReason],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k}>
                  <p className="m-k">{k}</p>
                  <p className="m-v">{v}</p>
                </div>
              ))}
            </div>

            <p className="hint" style={{ margin: '0 0 10px' }}>
              DOCUMENTS · click to open full size
            </p>
            <div className="kyc-docs">
              {(current.documents || []).map((d) => {
                const src = `/api/kyc/${current.id}/documents/${d.id}`;
                const isPdf = /pdf/.test(d.contentType || '');
                return (
                  <div className="kyc-doc" key={d.id}>
                    <p className="kd-h">{d.side.replace(/_/g, ' ').toUpperCase()}</p>
                    {isPdf ? (
                      <a className="kd-pdf" href={src} target="_blank" rel="noopener noreferrer">
                        OPEN PDF →
                      </a>
                    ) : (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt={d.side} onClick={() => window.open(src, '_blank', 'noopener')} />
                        <span className="kd-wm">ZORA · admin review · {new Date().toISOString().slice(0, 10)}</span>
                      </>
                    )}
                  </div>
                );
              })}
              {(current.documents || []).length === 0 ? (
                <p className="hint">No documents attached to this submission.</p>
              ) : null}
            </div>

            {current.status !== 'approved' ? (
              <>
                <div className="kyc-decide">
                  <button type="button" className="btn" onClick={approve} disabled={busy}>
                    APPROVE — UNLOCK PAYOUTS
                  </button>
                  <button type="button" className="btn danger" onClick={() => setRejecting((r) => !r)} disabled={busy}>
                    REJECT…
                  </button>
                </div>
                {rejecting ? (
                  <div className="kyc-reject-box">
                    <label htmlFor="kyc-reason">REJECTION REASON (required — the user sees a matching message)</label>
                    <select id="kyc-reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                      {(reasons.data || []).map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <textarea
                      rows={2}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Optional note for the audit log (not shown to the user)"
                    />
                    <button type="button" className="btn danger" style={{ marginTop: 10 }} onClick={reject} disabled={busy}>
                      CONFIRM REJECTION
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}

            <ul className="kyc-events">
              {(current.events || [])
                .slice()
                .reverse()
                .map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    <span>{new Date(e.at).toLocaleTimeString()}</span>
                    <span className="ke-a">{e.action}</span>
                    <span>
                      {e.actor}
                      {e.detail ? ` · ${e.detail}` : ''}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
