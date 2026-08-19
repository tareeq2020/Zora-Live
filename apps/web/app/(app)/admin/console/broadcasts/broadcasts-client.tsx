'use client';

/* PR-BS72 · Lane C — super-admin BROADCASTS, on the Control-Room v2 lib.

   Hierarchy (plan "Broadcasts"): ① compose (audience picker w/ live count + est
   SMS cost · channel · SMS/email body) → ② preview (the count + cost-confirm
   gate) → ③ history w/ per-broadcast delivery.

   WIRED (not stubbed): the BS43 staff endpoints already exist in apps/api —
     · GET  /api/admin/broadcasts          → composer options + cap + history
     · POST /api/admin/broadcasts/preview  → live audience count + SMS cost
     · POST /api/admin/broadcasts          → queue the send
   Audience maths + the cost-confirm gate live in @zora/core; this UI never
   materializes recipients (PERF-2) — it asks preview for the aggregate. */

import { useCallback, useMemo, useState } from 'react';
import { DataTable, StatusPill, toneForStatus, type Column } from '@/app/components/cr';
import { adminApi, useAdminResource } from '../../dashboard/admin-kit';
import { AdminConsoleShell } from '../console-shell';

// ── contracts (mirror @zora/core + admin-broadcasts.controller) ──────────────
type ScopeKind = 'platform' | 'organizer' | 'event';
type AudienceOptionEvent = { id: string; name: string | null; organizerHandle: string | null; tiers: { id: string; name: string }[] };
type SmsCapState = { limit: number; used: number; remaining: number; resetsAt: string };
type AudienceCount = { people: number; sms: number; email: number; suppressed: number };
type SmsCostEstimate = { segments: number; recipients: number; units: number; unitCost: number; total: number; currency: string };
type BroadcastRecord = {
  id: string;
  scopeKind: string;
  scopeEventId: string | null;
  scopeOrganizerHandle: string | null;
  channel: string;
  subject: string | null;
  audienceCount: number;
  smsCount: number;
  emailCount: number;
  sentCount: number;
  failedCount: number;
  status: string;
  createdAt: string;
};
type ViewPayload = {
  smsUnitCost: number;
  currency: string;
  defaultSenderId: string;
  cap: SmsCapState;
  events: AudienceOptionEvent[];
  organizers: { handle: string; name: string }[];
  broadcasts: BroadcastRecord[];
};
type PreviewPayload = { audience: AudienceCount; cost: SmsCostEstimate; cap: SmsCapState; unitCost: number; scopeLabel: string };

const fmt = (n: number) => n.toLocaleString('en-US');
const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const loadView = () => adminApi<ViewPayload>('/api/admin/broadcasts?limit=30');

export default function AdminBroadcastsClient() {
  const view = useAdminResource<ViewPayload>(loadView);
  const data = view.data;

  const [kind, setKind] = useState<ScopeKind>('platform');
  const [organizerHandle, setOrganizerHandle] = useState('');
  const [eventId, setEventId] = useState('');
  const [channel, setChannel] = useState<'sms' | 'email' | 'both'>('sms');
  const [senderId, setSenderId] = useState('');
  const [subject, setSubject] = useState('');
  const [bodySms, setBodySms] = useState('');
  const [bodyEmail, setBodyEmail] = useState('');

  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const scope = useMemo(() => {
    if (kind === 'organizer') return { kind, organizerHandle };
    if (kind === 'event') return { kind, eventId };
    return { kind };
  }, [kind, organizerHandle, eventId]);

  // any composer edit invalidates the previewed figure (the cost-confirm gate).
  const invalidate = useCallback(() => setPreview(null), []);

  async function runPreview() {
    setBusy('preview');
    setBanner(null);
    try {
      const p = await adminApi<PreviewPayload>('/api/admin/broadcasts/preview', {
        method: 'POST',
        body: JSON.stringify({ scope, bodySms }),
      });
      setPreview(p);
    } catch (e) {
      setBanner({ ok: false, text: e instanceof Error ? e.message : 'Preview failed' });
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    setBusy('send');
    setBanner(null);
    try {
      const r = await adminApi<{ ok: boolean; broadcast: BroadcastRecord }>('/api/admin/broadcasts', {
        method: 'POST',
        body: JSON.stringify({ scope, channel, subject, bodySms, bodyEmail, senderId: senderId || undefined }),
      });
      setBanner({ ok: true, text: `Queued — reaching ${fmt(r.broadcast.audienceCount)} people.` });
      setPreview(null);
      setBodySms('');
      setBodyEmail('');
      setSubject('');
      view.reload();
    } catch (e) {
      setBanner({ ok: false, text: e instanceof Error ? e.message : 'Send failed' });
    } finally {
      setBusy(null);
    }
  }

  const scopeReady = kind === 'platform' || (kind === 'organizer' && organizerHandle) || (kind === 'event' && eventId);
  const wantsSms = channel === 'sms' || channel === 'both';
  const wantsEmail = channel === 'email' || channel === 'both';
  const bodyReady = (!wantsSms || bodySms.trim()) && (!wantsEmail || bodyEmail.trim());
  const canPreview = !!scopeReady && !!bodyReady && busy === null;
  const canSend = canPreview && preview !== null && busy === null;

  const historyCols: Column<BroadcastRecord>[] = [
    {
      key: 'scope',
      header: 'Audience',
      primary: true,
      render: (b) => (
        <span>
          {b.scopeKind}
          {b.scopeOrganizerHandle ? ` · @${b.scopeOrganizerHandle}` : ''}
          {b.scopeEventId ? ` · ${b.scopeEventId}` : ''}
        </span>
      ),
    },
    { key: 'channel', header: 'Channel', render: (b) => <StatusPill tone="neutral" label={b.channel} /> },
    { key: 'audience', header: 'Reach', numeric: true, render: (b) => fmt(b.audienceCount) },
    { key: 'sent', header: 'Sent', numeric: true, render: (b) => fmt(b.sentCount) },
    { key: 'failed', header: 'Failed', numeric: true, render: (b) => fmt(b.failedCount) },
    { key: 'status', header: 'Status', render: (b) => <StatusPill tone={toneForStatus(b.status)} label={b.status} /> },
    { key: 'at', header: 'When', render: (b) => when(b.createdAt) },
  ];

  const field: React.CSSProperties = {
    height: 36,
    borderRadius: 9,
    border: '1px solid var(--cr-hair)',
    background: 'var(--cr-card)',
    color: 'var(--cr-ink)',
    fontFamily: 'var(--cr-sans)',
    fontSize: 13,
    padding: '0 10px',
    width: '100%',
  };
  const labelStyle: React.CSSProperties = {
    fontFamily: 'var(--cr-mono)',
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--cr-mut)',
    display: 'block',
    marginBottom: 6,
  };

  return (
    <AdminConsoleShell title="Broadcasts">
      <div className="cr-stack">
        {/* ① compose */}
        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Compose a broadcast
            </h2>
            {data ? (
              <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 11, color: 'var(--cr-ink2)' }}>
                Monthly SMS cap {fmt(data.cap.used)}/{fmt(data.cap.limit)} · {fmt(data.cap.remaining)} left
              </span>
            ) : null}
          </div>

          {banner ? (
            <div className={banner.ok ? 'cr-empty' : 'cr-error'} role="status" style={{ marginBottom: 14, textAlign: 'left' }}>
              <strong>{banner.ok ? 'Broadcast queued' : 'Broadcast failed'}</strong>
              <span>{banner.text}</span>
            </div>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <div>
              <label style={labelStyle}>Audience</label>
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as ScopeKind);
                  invalidate();
                }}
                style={field}
                aria-label="Audience scope"
              >
                <option value="platform">Everyone on the platform</option>
                <option value="organizer">One organizer</option>
                <option value="event">One event</option>
              </select>
            </div>

            {kind === 'organizer' ? (
              <div>
                <label style={labelStyle}>Organizer</label>
                <select
                  value={organizerHandle}
                  onChange={(e) => {
                    setOrganizerHandle(e.target.value);
                    invalidate();
                  }}
                  style={field}
                  aria-label="Organizer"
                >
                  <option value="">Select…</option>
                  {(data?.organizers ?? []).map((o) => (
                    <option key={o.handle} value={o.handle}>
                      {o.name || o.handle}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {kind === 'event' ? (
              <div>
                <label style={labelStyle}>Event</label>
                <select
                  value={eventId}
                  onChange={(e) => {
                    setEventId(e.target.value);
                    invalidate();
                  }}
                  style={field}
                  aria-label="Event"
                >
                  <option value="">Select…</option>
                  {(data?.events ?? []).map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name || ev.id}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div>
              <label style={labelStyle}>Channel</label>
              <select
                value={channel}
                onChange={(e) => {
                  setChannel(e.target.value as 'sms' | 'email' | 'both');
                  invalidate();
                }}
                style={field}
                aria-label="Channel"
              >
                <option value="sms">SMS</option>
                <option value="email">Email</option>
                <option value="both">SMS + Email</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Sender ID</label>
              <input value={senderId} onChange={(e) => setSenderId(e.target.value)} placeholder={data?.defaultSenderId || 'ZORA'} maxLength={11} style={field} aria-label="Sender ID" />
            </div>
          </div>

          {wantsEmail ? (
            <div style={{ marginTop: 14 }}>
              <label style={labelStyle}>Email subject</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} style={field} aria-label="Email subject" />
            </div>
          ) : null}

          {wantsSms ? (
            <div style={{ marginTop: 14 }}>
              <label style={labelStyle}>SMS body</label>
              <textarea
                value={bodySms}
                onChange={(e) => {
                  setBodySms(e.target.value);
                  invalidate();
                }}
                rows={3}
                style={{ ...field, height: 'auto', padding: 10, resize: 'vertical' }}
                aria-label="SMS body"
              />
            </div>
          ) : null}

          {wantsEmail ? (
            <div style={{ marginTop: 14 }}>
              <label style={labelStyle}>Email body</label>
              <textarea
                value={bodyEmail}
                onChange={(e) => {
                  setBodyEmail(e.target.value);
                  invalidate();
                }}
                rows={5}
                style={{ ...field, height: 'auto', padding: 10, resize: 'vertical' }}
                aria-label="Email body"
              />
            </div>
          ) : null}

          {/* ② preview — the live count + cost-confirm gate */}
          {preview ? (
            <div className="cr-empty" style={{ textAlign: 'left', marginTop: 16 }}>
              <strong>{preview.scopeLabel}</strong>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8, fontFamily: 'var(--cr-mono)', fontSize: 13, color: 'var(--cr-ink)' }}>
                <span>{fmt(preview.audience.people)} people</span>
                <span>{fmt(preview.audience.sms)} SMS</span>
                <span>{fmt(preview.audience.email)} email</span>
                <span>{fmt(preview.audience.suppressed)} opted-out</span>
                <span>
                  ≈ {fmt(preview.cost.total)} {preview.cost.currency} ({preview.cost.segments} seg × {fmt(preview.cost.recipients)})
                </span>
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button type="button" className="cr-btn" onClick={runPreview} disabled={!canPreview}>
              {busy === 'preview' ? 'Checking…' : 'Preview audience & cost'}
            </button>
            <button
              type="button"
              className="cr-btn"
              onClick={send}
              disabled={!canSend}
              style={canSend ? { borderColor: 'var(--cr-blue)', color: 'var(--cr-blue)', fontWeight: 600 } : undefined}
            >
              {busy === 'send' ? 'Sending…' : preview ? `Send to ${fmt(preview.audience.people)}` : 'Send'}
            </button>
            {!preview ? (
              <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--cr-mut)' }}>Preview first to enable sending.</span>
            ) : null}
          </div>
        </section>

        {/* ③ history */}
        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Recent broadcasts
            </h2>
          </div>
          <DataTable
            columns={historyCols}
            rows={data?.broadcasts ?? []}
            rowKey={(b) => b.id}
            loading={view.status === 'loading' && !view.loaded}
            error={view.status === 'error' ? view.error : null}
            onRetry={view.reload}
            caption="Recent broadcasts"
            emptyTitle="No broadcasts yet"
            emptyBody={<span>Compose one above — its delivery record appears here.</span>}
          />
        </section>
      </div>
    </AdminConsoleShell>
  );
}
