'use client';

/* PR-BS89 · Control-Room console — VERIFICATION, ported from the legacy
   dashboard/sections/verification-section.tsx onto the CR primitives.

   Re-skin, NOT new logic. The exact same endpoints and decision flow as the
   legacy KYC review panel:
     GET  /api/kyc                       (identity queue, newest first)
     GET  /api/kyc/organizers            (self-signup organizers)
     GET  /api/kyc/reasons               (standardized rejection reasons)
     GET  /api/kyc/:id/documents/:docId  (gated, no-cache document stream)
     POST /api/kyc/:id/approve · POST /api/kyc/:id/reject { code, note }
     POST /api/kyc/organizers/:id/approve · .../reject { code, note }

   One section, two subjects (organizer sign-ups + identity submissions), one
   gate: kyc_status === 'approved' unlocks selling + withdrawals. A rejection
   reason is REQUIRED for either queue (enforced server-side too). Documents are
   still streamed through the gated endpoint and carry the on-image admin-review
   watermark — never publicly served. */

import { useCallback, useState } from 'react';
import { CrDrawer, DataTable, StatusPill, type Column, type PillTone } from '@/app/components/cr';
import { adminApi, ageLabel, errText, useAdminResource, useJsonLoader, useNow, whenLocal } from '../../dashboard/admin-kit';
import { AdminConsoleShell } from '../console-shell';
import { ConsoleToastProvider, CrMeta, CrSectionHead, crDangerBtn, crPrimaryBtn, useConsoleToast } from '../console-kit';

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

const ID_LABEL: Record<string, string> = {
  passport: 'Passport',
  drivers_license: "Driver's License",
  national_id: 'National ID',
};

const kycTone = (s: string): PillTone => {
  switch (s) {
    case 'approved':
      return 'live';
    case 'rejected':
      return 'failed';
    default:
      return 'pending'; // submitted / in_review
  }
};
const kycLabel = (s: string) => (s === 'in_review' ? 'IN REVIEW' : String(s).toUpperCase());

const orgTone = (s: string | null): PillTone => (s === 'approved' ? 'live' : s === 'rejected' ? 'failed' : 'pending');
const orgLabel = (s: string | null): string =>
  s === 'approved' ? 'APPROVED' : s === 'rejected' ? 'REJECTED' : 'WAITING';

/** Age with the legacy KYC SLA colouring (>24h = late → red). */
function Sla({ iso, now, late }: { iso: string; now: number; late?: boolean }) {
  const a = ageLabel(iso, now);
  const isLate = a.late && late !== false;
  return <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: isLate ? 'var(--cr-red)' : 'var(--cr-ink2)' }}>{a.text}</span>;
}

export default function AdminVerificationClient() {
  return (
    <ConsoleToastProvider>
      <VerificationInner />
    </ConsoleToastProvider>
  );
}

function VerificationInner() {
  const toast = useConsoleToast();
  const now = useNow();
  const queueLoader = useJsonLoader<KycRecord[]>('/api/kyc');
  const reasonsLoader = useJsonLoader<Reason[]>('/api/kyc/reasons');
  const orgsLoader = useJsonLoader<OrgSignup[]>('/api/kyc/organizers');
  const queue = useAdminResource(queueLoader);
  const reasons = useAdminResource(reasonsLoader);
  const orgs = useAdminResource(orgsLoader);

  // identity drawer
  const [openId, setOpenId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // organizer drawer
  const [openOrgId, setOpenOrgId] = useState<string | null>(null);
  const [orgRejecting, setOrgRejecting] = useState(false);
  const [orgReasonCode, setOrgReasonCode] = useState('');
  const [orgNote, setOrgNote] = useState('');

  const current = queue.data?.find((v) => v.id === openId) || null;
  const currentOrg = orgs.data?.find((o) => o.id === openOrgId) || null;

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
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setBusy(false);
    }
  }

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
      toast(decision === 'approve' ? 'Approved — they can sell and withdraw' : 'Rejected — they see the reason on their dashboard');
      closeOrg();
      orgs.reload();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setBusy(false);
    }
  }

  const orgCols: Column<OrgSignup>[] = [
    {
      key: 'age',
      header: 'Signed up',
      render: (o) => (o.submittedAt ? <Sla iso={o.submittedAt} now={now} late={o.kycStatus !== 'approved'} /> : <span style={{ color: 'var(--cr-mut)' }}>—</span>),
    },
    {
      key: 'org',
      header: 'Organizer',
      primary: true,
      render: (o) => (
        <span>
          {o.name}
          <br />
          <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 11, color: 'var(--cr-mut)' }}>@{o.handle}</span>
        </span>
      ),
    },
    { key: 'phone', header: 'Verified phone', render: (o) => <span style={{ fontFamily: 'var(--cr-mono)' }}>{o.phone ? '+' + o.phone : '—'}</span> },
    { key: 'source', header: 'Source', render: (o) => <StatusPill tone="neutral" label={(o.source || 'staff').replace('-', ' ')} /> },
    { key: 'status', header: 'Status', render: (o) => <StatusPill tone={orgTone(o.kycStatus)} label={orgLabel(o.kycStatus)} /> },
    {
      key: 'act',
      header: '',
      render: (o) => (
        <button type="button" className="cr-btn" onClick={() => openOrg(o)}>
          Review
        </button>
      ),
    },
  ];

  const cols: Column<KycRecord>[] = [
    { key: 'age', header: 'Submitted', render: (v) => <Sla iso={v.submittedAt} now={now} late={v.status !== 'approved'} /> },
    {
      key: 'name',
      header: 'Name',
      primary: true,
      render: (v) => (
        <span>
          {v.fullName}
          {v.docNumberMasked ? (
            <>
              <br />
              <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 11, color: 'var(--cr-mut)' }}>{v.docNumberMasked}</span>
            </>
          ) : null}
        </span>
      ),
    },
    { key: 'idType', header: 'ID type', render: (v) => ID_LABEL[v.idType] || v.idType },
    { key: 'country', header: 'Country', render: (v) => <span style={{ fontFamily: 'var(--cr-mono)' }}>{v.country}</span> },
    { key: 'attempt', header: 'Attempt', numeric: true, render: (v) => `#${v.attempt}` },
    { key: 'status', header: 'Status', render: (v) => <StatusPill tone={kycTone(v.status)} label={kycLabel(v.status)} /> },
    {
      key: 'act',
      header: '',
      render: (v) => (
        <button type="button" className="cr-btn" onClick={() => open(v)}>
          Review
        </button>
      ),
    },
  ];

  const lastReason = current?.rejection ? reasons.data?.find((r) => r.code === current.rejection?.code)?.label || current.rejection.code : '—';

  return (
    <AdminConsoleShell title="Verification">
      <div className="cr-stack">
        <CrSectionHead
          title="Verification"
          hint="Two things wait here and both end in the same gate: an approval lets an organizer publish sellable drops and request withdrawals. New sign-ups are vetted as organizations; identity submissions are documents, encrypted at rest and shown through a gated, no-cache stream — never publicly served. Every decision is logged to the audit trail."
        />

        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Organizer sign-ups
            </h2>
            <span style={{ fontSize: 12, color: 'var(--cr-ink2)' }}>Registered themselves over phone — nobody at Zora has vetted them yet.</span>
          </div>
          <DataTable
            columns={orgCols}
            rows={waitingOrgs}
            rowKey={(o) => o.id}
            loading={orgs.status === 'loading' && !orgs.loaded}
            error={orgs.status === 'error' ? orgs.error : null}
            onRetry={orgs.reload}
            caption="Organizer sign-ups waiting"
            emptyTitle="No organizers waiting"
            emptyBody={<span>Anyone who signs up at zorapass.com/dashboard/signup lands here within seconds of proving their phone.</span>}
          />
        </section>

        {decidedOrgs.length ? (
          <section className="cr-panel">
            <div className="cr-panel-head">
              <h2 className="cr-section-h" style={{ margin: 0 }}>
                Approved sign-ups
              </h2>
              <span style={{ fontSize: 12, color: 'var(--cr-ink2)' }}>{decidedOrgs.length} selling</span>
            </div>
            <DataTable columns={orgCols} rows={decidedOrgs} rowKey={(o) => o.id} caption="Approved sign-ups" emptyTitle="Nothing approved yet" />
          </section>
        ) : null}

        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Identity submissions
            </h2>
          </div>
          <DataTable
            columns={cols}
            rows={queue.data || []}
            rowKey={(v) => v.id}
            loading={queue.status === 'loading' && !queue.loaded}
            error={queue.status === 'error' ? queue.error : null}
            onRetry={queue.reload}
            caption="Identity submissions"
            emptyTitle="No identity submissions yet"
            emptyBody={<span>Organizers who submit an ID for payout verification show up here within seconds.</span>}
          />
        </section>
      </div>

      {/* ── organizer review drawer ── */}
      {currentOrg ? (
        <CrDrawer open onClose={closeOrg} ariaLabel={`Organizer review — ${currentOrg.name}`} title={currentOrg.name} subtitle={'@' + currentOrg.handle}>
          <CrMeta
            rows={[
              ['STOREFRONT', <span style={{ fontFamily: 'var(--cr-mono)' }}>{'zorapass.com/' + currentOrg.handle}</span>],
              ['VERIFIED PHONE', currentOrg.phone ? '+' + currentOrg.phone : '—'],
              ['EMAIL', currentOrg.email || '—'],
              ['SOURCE', (currentOrg.source || 'staff').toUpperCase()],
              ['ACCOUNT STATUS', String(currentOrg.status || '').toUpperCase()],
              ['VERIFICATION', orgLabel(currentOrg.kycStatus)],
              ['SIGNED UP', whenLocal(currentOrg.submittedAt)],
              ['REVIEWED', currentOrg.reviewedAt ? `${whenLocal(currentOrg.reviewedAt)} · ${currentOrg.reviewedBy || ''}` : '—'],
              ['LAST REASON', currentOrg.rejection || '—'],
              ['DROPS', String(currentOrg.events ?? 0)],
            ]}
          />

          {currentOrg.kycStatus !== 'approved' ? (
            <>
              <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--cr-ink2)', margin: '0 0 14px' }}>
                This organizer proved a phone number, nothing more. Approving lets them sell tickets to the public and withdraw the money — check the name
                against the phone and any drops they have drafted before you do.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="cr-btn" style={crPrimaryBtn} onClick={() => decideOrg('approve')} disabled={busy}>
                  Approve — unlock selling + withdrawals
                </button>
                <button type="button" className="cr-btn" style={crDangerBtn} onClick={() => setOrgRejecting((r) => !r)} disabled={busy}>
                  Reject…
                </button>
              </div>
              {orgRejecting ? (
                <div style={{ marginTop: 14, padding: 14, border: '1px solid var(--cr-hair)', borderRadius: 12, display: 'grid', gap: 10 }}>
                  <label htmlFor="org-reason" style={{ fontFamily: 'var(--cr-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--cr-mut)' }}>
                    REJECTION REASON (required — the organizer sees a matching message)
                  </label>
                  <select id="org-reason" className="cr-select" value={orgReasonCode} onChange={(e) => setOrgReasonCode(e.target.value)}>
                    {(reasons.data || []).map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    className="cr-textarea"
                    rows={2}
                    value={orgNote}
                    onChange={(e) => setOrgNote(e.target.value)}
                    placeholder="Optional note for the audit log (not shown to the organizer)"
                  />
                  <button type="button" className="cr-btn" style={crDangerBtn} onClick={() => decideOrg('reject')} disabled={busy}>
                    Confirm rejection
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--cr-ink2)' }}>
              Approved {whenLocal(currentOrg.reviewedAt)}. They are selling. To stop them, suspend the account in Organizers.
            </p>
          )}
        </CrDrawer>
      ) : null}

      {/* ── identity review drawer ── */}
      {current ? (
        <CrDrawer open onClose={close} ariaLabel={`Identity review — ${current.fullName}`} title={current.fullName} subtitle={current.ref}>
          <CrMeta
            rows={[
              ['STATUS', kycLabel(current.status)],
              ['ID TYPE', ID_LABEL[current.idType] || current.idType],
              ['COUNTRY', current.country],
              ['DOC NUMBER', current.docNumberMasked || '—'],
              ['ATTEMPT', '#' + current.attempt],
              ['SUBMITTED', whenLocal(current.submittedAt)],
              ['REVIEWED', current.reviewedAt ? `${whenLocal(current.reviewedAt)} · ${current.reviewedBy || ''}` : '—'],
              ['LAST REASON', lastReason],
            ]}
          />

          <p style={{ fontFamily: 'var(--cr-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--cr-mut)', margin: '0 0 10px' }}>
            DOCUMENTS · click to open full size
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {(current.documents || []).map((d) => {
              const src = `/api/kyc/${current.id}/documents/${d.id}`;
              const isPdf = /pdf/.test(d.contentType || '');
              return (
                <div key={d.id} style={{ border: '1px solid var(--cr-hair)', borderRadius: 12, overflow: 'hidden', background: 'var(--cr-card2)' }}>
                  <p style={{ margin: 0, padding: '8px 10px', fontFamily: 'var(--cr-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--cr-mut)' }}>
                    {d.side.replace(/_/g, ' ').toUpperCase()}
                  </p>
                  {isPdf ? (
                    <a
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'block', padding: '24px 10px', textAlign: 'center', color: 'var(--cr-blue)', fontFamily: 'var(--cr-mono)', fontSize: 12 }}
                    >
                      OPEN PDF →
                    </a>
                  ) : (
                    <div style={{ position: 'relative' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={src}
                        alt={d.side}
                        onClick={() => window.open(src, '_blank', 'noopener')}
                        style={{ display: 'block', width: '100%', cursor: 'zoom-in' }}
                      />
                      <span
                        style={{
                          position: 'absolute',
                          bottom: 6,
                          left: 6,
                          padding: '2px 6px',
                          background: 'rgba(0,0,0,0.55)',
                          color: '#fff',
                          fontFamily: 'var(--cr-mono)',
                          fontSize: 9,
                          letterSpacing: '0.06em',
                          borderRadius: 4,
                        }}
                      >
                        ZORA · admin review · {new Date().toISOString().slice(0, 10)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            {(current.documents || []).length === 0 ? <p style={{ fontSize: 13, color: 'var(--cr-ink2)' }}>No documents attached to this submission.</p> : null}
          </div>

          {current.status !== 'approved' ? (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="cr-btn" style={crPrimaryBtn} onClick={approve} disabled={busy}>
                  Approve — unlock payouts
                </button>
                <button type="button" className="cr-btn" style={crDangerBtn} onClick={() => setRejecting((r) => !r)} disabled={busy}>
                  Reject…
                </button>
              </div>
              {rejecting ? (
                <div style={{ marginTop: 14, padding: 14, border: '1px solid var(--cr-hair)', borderRadius: 12, display: 'grid', gap: 10 }}>
                  <label htmlFor="kyc-reason" style={{ fontFamily: 'var(--cr-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--cr-mut)' }}>
                    REJECTION REASON (required — the user sees a matching message)
                  </label>
                  <select id="kyc-reason" className="cr-select" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                    {(reasons.data || []).map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    className="cr-textarea"
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional note for the audit log (not shown to the user)"
                  />
                  <button type="button" className="cr-btn" style={crDangerBtn} onClick={reject} disabled={busy}>
                    Confirm rejection
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {(current.events || []).length ? (
            <ul style={{ listStyle: 'none', margin: '18px 0 0', padding: 0, display: 'grid', gap: 6 }}>
              {(current.events || [])
                .slice()
                .reverse()
                .map((e, i) => (
                  <li key={`${e.at}-${i}`} style={{ display: 'flex', gap: 10, fontFamily: 'var(--cr-mono)', fontSize: 11, color: 'var(--cr-ink2)' }}>
                    <span>{new Date(e.at).toLocaleTimeString()}</span>
                    <span style={{ color: 'var(--cr-ink)' }}>{e.action}</span>
                    <span>
                      {e.actor}
                      {e.detail ? ` · ${e.detail}` : ''}
                    </span>
                  </li>
                ))}
            </ul>
          ) : null}
        </CrDrawer>
      ) : null}
    </AdminConsoleShell>
  );
}
