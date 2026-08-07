'use client';

/* PR-BS36 — OVERVIEW section: the platform at a glance + the audit trail.
   Read-only, same endpoints as the legacy panels it draws from:
     GET /api/organizers · /api/kyc · /api/registrations · /api/media · /api/audit
   The audit table lived at the bottom of the legacy ORGANIZERS panel; it is a
   platform-wide log, so it moves here and every section links to it in copy.
   Nothing is lost — same endpoint, same rows, longer window (24 vs. 12). */

import { AdminCard, AdminTable, useAdminResource, useJsonLoader, whenLocal, type AdminColumn } from '../admin-kit';

type AuditRow = { at: string; action: string; detail: string };
type Organizer = { status?: string };
type KycRow = { status?: string };
type OrgSignupRow = { kycStatus?: string | null };
type Crew = { size?: number | string };
type MediaRow = { status?: string; lowres?: boolean };

const AUDIT_LIMIT = 24;

function Stat({ label, value, loaded }: { label: string; value: string | number; loaded: boolean }) {
  return (
    <div className="stat">
      <p className="sv">{loaded ? value : '—'}</p>
      <p className="sk">{label}</p>
    </div>
  );
}

export function OverviewSection({ onGo }: { onGo: (section: string) => void }) {
  const orgs = useAdminResource(useJsonLoader<Organizer[]>('/api/organizers'));
  const kyc = useAdminResource(useJsonLoader<KycRow[]>('/api/kyc'));
  // BS41 (#5): a self-signup nobody looks at is an organizer who can never sell.
  // Surface the count here so the queue is discoverable from the first screen.
  const signups = useAdminResource(useJsonLoader<OrgSignupRow[]>('/api/kyc/organizers'));
  const crews = useAdminResource(useJsonLoader<Crew[]>('/api/registrations'));
  const media = useAdminResource(useJsonLoader<MediaRow[]>('/api/media'));
  const audit = useAdminResource(useJsonLoader<AuditRow[]>('/api/audit'));

  const pendingKyc = (kyc.data || []).filter((v) => v.status === 'submitted' || v.status === 'in_review').length;
  const pendingSignups = (signups.data || []).filter((o) => o.kycStatus !== 'approved').length;
  const suspended = (orgs.data || []).filter((o) => o.status === 'suspended').length;
  const heads = (crews.data || []).reduce((n, c) => n + (parseInt(String(c.size), 10) || 0), 0);
  const flagged = (media.data || []).filter((m) => m.status === 'flagged' || m.lowres).length;

  const cols: AdminColumn<AuditRow>[] = [
    { key: 'at', label: 'WHEN', render: (a) => <span className="mono" style={{ color: 'var(--mut)' }}>{whenLocal(a.at)}</span> },
    { key: 'action', label: 'ACTION', render: (a) => <span className="mono">{a.action}</span> },
    { key: 'detail', label: 'TARGET', render: (a) => a.detail },
  ];

  const rows = audit.data ? audit.data.slice(0, AUDIT_LIMIT) : null;

  return (
    <>
      <div className="sec-h">
        <h2>Overview</h2>
        <p className="hint">The platform at a glance, and every privileged action taken from this console.</p>
      </div>

      <div className="stack">
        <div className="stat-row">
          <Stat label="ORGANIZERS" value={orgs.data?.length ?? 0} loaded={orgs.loaded} />
          <Stat label="SUSPENDED" value={suspended} loaded={orgs.loaded} />
          <Stat label="SIGN-UPS AWAITING REVIEW" value={pendingSignups} loaded={signups.loaded} />
          <Stat label="IDS AWAITING REVIEW" value={pendingKyc} loaded={kyc.loaded} />
          <Stat label="CREWS" value={crews.data?.length ?? 0} loaded={crews.loaded} />
          <Stat label="HEADS" value={heads} loaded={crews.loaded} />
          <Stat label="FLAGGED MEDIA" value={flagged} loaded={media.loaded} />
        </div>

        {signups.loaded && pendingSignups > 0 ? (
          <p className="banner-soon">
            {pendingSignups} NEW ORGANIZER{pendingSignups === 1 ? '' : 'S'} WAITING TO BE APPROVED — THEY CANNOT SELL
            OR WITHDRAW UNTIL SOMEONE DECIDES —{' '}
            <button
              type="button"
              onClick={() => onGo('verification')}
              style={{ background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 }}
            >
              OPEN VERIFICATION
            </button>
          </p>
        ) : null}

        {kyc.loaded && pendingKyc > 0 ? (
          <p className="banner-soon">
            {pendingKyc} IDENTITY SUBMISSION{pendingKyc === 1 ? '' : 'S'} WAITING ON A DECISION —{' '}
            <button
              type="button"
              onClick={() => onGo('verification')}
              style={{ background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 }}
            >
              OPEN VERIFICATION
            </button>
          </p>
        ) : null}

        <AdminCard title="RECENT ADMIN ACTIONS · AUDIT LOG" subtitle="Impersonation, suspensions, commission changes and KYC decisions are all recorded." flush>
          <AdminTable
            columns={cols}
            rows={rows}
            rowKey={(a, i) => `${a.at}-${i}`}
            resource={audit}
            empty="No admin actions logged yet."
            emptySub="Anything privileged you do from this console lands here with a timestamp."
          />
        </AdminCard>
      </div>
    </>
  );
}
