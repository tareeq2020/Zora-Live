'use client';

/* PR-BS36 — VERIFICATION section. The legacy "KYC REVIEW" panel + its review
   drawer, ported 1:1 onto the same endpoints:
     GET  /api/kyc                       (queue, newest first)
     GET  /api/kyc/reasons               (standardized rejection reasons)
     GET  /api/kyc/:id/documents/:docId  (gated, no-cache document stream)
     POST /api/kyc/:id/approve · POST /api/kyc/:id/reject { code, note }
   Documents are still streamed through the gated endpoint (never publicly
   served) and the on-image "admin review" watermark is preserved.

   PR-BS41 (#5) — SELF-SIGNUP ORGANIZERS join this SAME section, above the
   identity submissions:
     GET  /api/kyc/organizers
     POST /api/kyc/organizers/:id/approve · .../reject { code, note }

   One section, not two, because there is one gate: `kyc_status === 'approved'`
   is what unlocks publishing a sellable drop and requesting a payout, whichever
   queue produced it. Splitting them into "verification" and "KYC" would create a
   question nobody could answer — approved here but not there, can they sell?

   They are two TABLES inside that one section because the subject genuinely
   differs: an identity submission is a document to look at, a self-signup is an
   organizer to vet, and they carry different columns. The `self-signup` marker
   (design spec) rides along explicitly so a reviewer never has to infer which
   kind of thing they are deciding on. Both share the rejection vocabulary from
   /api/kyc/reasons, so the organizer reads the existing KYC reject copy. */

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

/* BS41 (#5) — a self-registered organizer awaiting (or holding) a decision. */
type OrgSignup = {
  id: string;
  name: string;
  handle: string;
  email: string | null;
  phone: string | null;
  status: string;
  kycStatus: string | null;
  source: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejection: string | null;
  events: number;
};

const ORG_PILL: Record<string, string> = {
  unverified: 'pending',
  approved: 'approved',
  rejected: 'rejected',
};
const ORG_LABEL: Record<string, string> = {
  unverified: 'WAITING',
  approved: 'APPROVED',
  rejected: 'REJECTED',
};

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
  const orgsLoader = useJsonLoader<OrgSignup[]>('/api/kyc/organizers');
  const queue = useAdminResource(queueLoader);
  const reasons = useAdminResource(reasonsLoader);
  const orgs = useAdminResource(orgsLoader);

  const [openId, setOpenId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // BS41 — the ORGANIZER review drawer. Separate open-state from the identity
  // drawer above: they are different subjects and only one can be open at a time.
  const [openOrgId, setOpenOrgId] = useState<string | null>(null);
  const [orgRejecting, setOrgRejecting] = useState(false);
  const [orgReasonCode, setOrgReasonCode] = useState('');
  const [orgNote, setOrgNote] = useState('');

  const current = queue.data?.find((v) => v.id === openId) || null;
  const currentOrg = orgs.data?.find((o) => o.id === openOrgId) || null;

  // Waiting first — the queue is a work list, and a decided org is reference.
  const waitingOrgs = (orgs.data || []).filter((o) => o.kycStatus !== 'approved');
  const decidedOrgs = (orgs.data || []).filter((o) => o.kycStatus === 'approved');

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

  // ── BS41 (#5): organizer decisions ────────────────────────────────────────
  const closeOrg = useCallback(() => {
    setOpenOrgId(null);
    setOrgRejecting(false);
    setOrgNote('');
  }, []);

  function openOrg(o: OrgSignup) {
    setOpenOrgId(o.id);
    setOrgRejecting(false);
    setOrgNote('');
    setOrgReasonCode(reasons.data?.[0]?.code || '');
  }

  async function decideOrg(decision: 'approve' | 'reject') {
    if (!currentOrg) return;
    if (decision === 'approve') {
      if (
        !window.confirm(
          `Approve ${currentOrg.name} (@${currentOrg.handle})? They can publish sellable drops and request withdrawals immediately. The decision is logged.`,
        )
      ) {
        return;
      }
    }
    const code = orgReasonCode || reasons.data?.[0]?.code;
    if (decision === 'reject' && !code) {
      toast('Pick a rejection reason', true);
      return;
    }
    setBusy(true);
    try {
      await adminApi(`/api/kyc/organizers/${currentOrg.id}/${decision}`, {
        method: 'POST',
        ...(decision === 'reject' ? { body: JSON.stringify({ code, note: orgNote }) } : {}),
      });
      toast(
        decision === 'approve'
          ? 'Approved — they can sell and withdraw'
          : 'Rejected — they see the reason on their dashboard',
      );
      closeOrg();
      orgs.reload();
      onDecision?.();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setBusy(false);
    }
  }

  const orgCols: AdminColumn<OrgSignup>[] = [
    {
      key: 'age',
      label: 'SIGNED UP',
      render: (o) => {
        if (!o.submittedAt) return <span className="mono">—</span>;
        const a = ageLabel(o.submittedAt, now);
        // Same >24h "late" colouring as the identity queue — one SLA, one signal.
        return <span className={'kyc-sla' + (a.late && o.kycStatus !== 'approved' ? ' late' : '')}>{a.text}</span>;
      },
    },
    {
      key: 'org',
      label: 'ORGANIZER',
      render: (o) => (
        <div>
          <b>{o.name}</b>
          <br />
          <span className="mono" style={{ color: 'var(--mut)' }}>
            @{o.handle}
          </span>
        </div>
      ),
    },
    {
      key: 'phone',
      label: 'VERIFIED PHONE',
      render: (o) => <span className="mono">{o.phone ? '+' + o.phone : '—'}</span>,
    },
    {
      key: 'source',
      label: 'SOURCE',
      // The design spec's explicit `self-signup` marker: nobody at Zora vouched
      // for this row, which is exactly what makes it need a decision.
      render: (o) => <span className="pill blue">{(o.source || 'staff').replace('-', ' ').toUpperCase()}</span>,
    },
    {
      key: 'status',
      label: 'STATUS',
      render: (o) => (
        <span className={'pill ' + (ORG_PILL[o.kycStatus || 'unverified'] || 'pending')}>
          {ORG_LABEL[o.kycStatus || 'unverified'] || String(o.kycStatus).toUpperCase()}
        </span>
      ),
    },
    {
      key: 'act',
      label: '',
      actions: true,
      render: (o) => (
        <button type="button" className="btn small" onClick={() => openOrg(o)}>
          REVIEW
        </button>
      ),
    },
  ];

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
          Two things wait here and both end in the same gate: an approval lets an organizer publish sellable drops and
          request withdrawals. New sign-ups are vetted as organizations; identity submissions are documents, encrypted
          at rest and shown through a gated, no-cache stream — never publicly served. Every decision is logged to the
          audit trail.
        </p>
      </div>

      <div className="stack">
        <AdminCard
          title="ORGANIZER SIGN-UPS"
          subtitle="Registered themselves over phone — nobody at Zora has vetted them yet."
          flush
        >
          <AdminTable
            columns={orgCols}
            rows={waitingOrgs}
            rowKey={(o) => o.id}
            resource={orgs}
            empty="No organizers waiting."
            emptySub="Anyone who signs up at zora.com/dashboard/signup lands here within seconds of proving their phone."
          />
        </AdminCard>

        {decidedOrgs.length ? (
          <AdminCard title="APPROVED SIGN-UPS" subtitle={`${decidedOrgs.length} selling`} flush>
            <AdminTable
              columns={orgCols}
              rows={decidedOrgs}
              rowKey={(o) => o.id}
              empty="Nothing approved yet."
            />
          </AdminCard>
        ) : null}

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

      {/* ── BS41 (#5): the organizer review drawer. Same sheet, same buttons, same
          rejection reasons as the identity drawer below — a reviewer learns one
          interaction, not two. ── */}
      {currentOrg ? (
        <div
          className="drawer"
          role="dialog"
          aria-modal="true"
          aria-label={`Organizer review — ${currentOrg.name}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeOrg();
          }}
        >
          <div className="drawer-sheet">
            <button type="button" className="drawer-close" aria-label="Close" onClick={closeOrg}>
              ×
            </button>
            <h3>{currentOrg.name}</h3>

            <div className="kyc-meta">
              {(
                [
                  ['HANDLE', '@' + currentOrg.handle],
                  ['STOREFRONT', 'zora.com/' + currentOrg.handle],
                  ['VERIFIED PHONE', currentOrg.phone ? '+' + currentOrg.phone : '—'],
                  ['EMAIL', currentOrg.email || '—'],
                  ['SOURCE', (currentOrg.source || 'staff').toUpperCase()],
                  ['ACCOUNT STATUS', String(currentOrg.status || '').toUpperCase()],
                  ['VERIFICATION', ORG_LABEL[currentOrg.kycStatus || 'unverified'] || String(currentOrg.kycStatus).toUpperCase()],
                  ['SIGNED UP', whenLocal(currentOrg.submittedAt)],
                  [
                    'REVIEWED',
                    currentOrg.reviewedAt ? `${whenLocal(currentOrg.reviewedAt)} · ${currentOrg.reviewedBy || ''}` : '—',
                  ],
                  ['LAST REASON', currentOrg.rejection || '—'],
                  ['DROPS', String(currentOrg.events ?? 0)],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k}>
                  <p className="m-k">{k}</p>
                  <p className="m-v">{v}</p>
                </div>
              ))}
            </div>

            <p className="hint" style={{ margin: '0 0 14px' }}>
              This organizer proved a phone number, nothing more. Approving lets them sell tickets to the public and
              withdraw the money — check the name against the phone and any drops they have drafted before you do.
            </p>

            {currentOrg.kycStatus !== 'approved' ? (
              <>
                <div className="kyc-decide">
                  <button type="button" className="btn" onClick={() => decideOrg('approve')} disabled={busy}>
                    APPROVE — UNLOCK SELLING + WITHDRAWALS
                  </button>
                  <button type="button" className="btn danger" onClick={() => setOrgRejecting((r) => !r)} disabled={busy}>
                    REJECT…
                  </button>
                </div>
                {orgRejecting ? (
                  <div className="kyc-reject-box">
                    <label htmlFor="org-reason">REJECTION REASON (required — the organizer sees a matching message)</label>
                    <select id="org-reason" value={orgReasonCode} onChange={(e) => setOrgReasonCode(e.target.value)}>
                      {(reasons.data || []).map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <textarea
                      rows={2}
                      value={orgNote}
                      onChange={(e) => setOrgNote(e.target.value)}
                      placeholder="Optional note for the audit log (not shown to the organizer)"
                    />
                    <button
                      type="button"
                      className="btn danger"
                      style={{ marginTop: 10 }}
                      onClick={() => decideOrg('reject')}
                      disabled={busy}
                    >
                      CONFIRM REJECTION
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="hint">
                Approved {whenLocal(currentOrg.reviewedAt)}. They are selling. To stop them, suspend the account in
                ORGANIZERS.
              </p>
            )}
          </div>
        </div>
      ) : null}

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
