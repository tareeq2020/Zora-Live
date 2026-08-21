'use client';

/* PR-BS89 · Control-Room console — MEDIA, ported from the legacy
   dashboard/sections/media-section.tsx onto the CR primitives.

   Re-skin, NOT new logic. Two sub-tabs, same endpoints:
     ASSETS & CDN  GET /api/media · PUT /api/media/:name/status {status,flagReason}
     SITE MEDIA    GET /api/placements · POST /api/upload {name,dataUrl}
                   · PUT /api/placements { [slotKey]: url }
   Site-media keeps the drag-and-drop + click-to-replace on each slot, the
   "UPLOADING…" affordance, and the exact upload→map two-call sequence. */

import { useCallback, useRef, useState, type DragEvent } from 'react';
import { StatusPill, type PillTone } from '@/app/components/cr';
import { adminApi, errText, useAdminResource, useJsonLoader } from '../../dashboard/admin-kit';
import { AdminConsoleShell } from '../console-shell';
import { ConsoleToastProvider, CrSectionHead, useConsoleToast } from '../console-kit';

// ── assets & CDN ────────────────────────────────────────────────────────────

type MediaItem = {
  name: string;
  url: string;
  cdnUrl: string;
  sizeKB: number;
  optimizedKB: number;
  dims: string;
  lowres?: boolean;
  category: string;
  status: 'pending' | 'approved' | 'flagged' | string;
  flagReason?: string;
};

const FILTERS = [
  ['all', 'ALL'],
  ['pending', 'PENDING'],
  ['approved', 'APPROVED'],
  ['flagged', 'FLAGGED'],
] as const;

const mstatusTone = (s: string): PillTone => (s === 'approved' ? 'live' : s === 'flagged' ? 'failed' : 'pending');

function AssetsPanel() {
  const toast = useConsoleToast();
  const loader = useJsonLoader<MediaItem[]>('/api/media');
  const res = useAdminResource(loader);
  const [filter, setFilter] = useState<string>('all');

  const all = res.data || [];
  const list = all.filter((m) => filter === 'all' || m.status === filter);
  const flagged = all.filter((m) => m.status === 'flagged' || m.lowres).length;
  const savedKB = all.reduce((a, m) => a + Math.max(0, m.sizeKB - m.optimizedKB), 0);
  const saved = savedKB > 1024 ? (savedKB / 1024).toFixed(1) + ' MB' : savedKB + ' KB';

  const setStatus = useCallback(
    async (name: string, status: 'approved' | 'flagged') => {
      let flagReason: string | undefined;
      if (status === 'flagged') {
        const r = window.prompt('Flag reason (optional):', 'Inappropriate or low-quality');
        if (r === null) return;
        flagReason = r || 'Flagged by admin';
      }
      try {
        await adminApi(`/api/media/${encodeURIComponent(name)}/status`, {
          method: 'PUT',
          body: JSON.stringify(status === 'flagged' ? { status, flagReason } : { status }),
        });
        toast(status === 'approved' ? 'Approved' : 'Flagged');
        res.reload();
      } catch (ex) {
        toast(errText(ex), true);
      }
    },
    [res, toast],
  );

  const stat = (v: React.ReactNode, k: string) => (
    <div style={{ padding: 14, border: '1px solid var(--cr-hair)', borderRadius: 12, background: 'var(--cr-card)' }}>
      <p style={{ margin: 0, fontFamily: 'var(--cr-mono)', fontSize: 22, fontWeight: 600 }}>{v}</p>
      <p style={{ margin: '4px 0 0', fontFamily: 'var(--cr-mono)', fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--cr-mut)' }}>{k}</p>
    </div>
  );

  return (
    <div className="cr-stack">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {stat(res.loaded ? all.length : '—', 'ASSETS ON CDN')}
        {stat(res.loaded ? flagged : '—', 'FLAGGED / LOW-RES')}
        {stat(res.loaded ? saved : '—', 'EST. SAVED BY COMPRESSION')}
      </div>

      <section className="cr-panel">
        <div className="cr-panel-head">
          <h2 className="cr-section-h" style={{ margin: 0 }}>
            Assets &amp; CDN
          </h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Filter assets">
            {FILTERS.map(([k, l]) => (
              <button key={k} type="button" className="cr-btn" aria-pressed={filter === k} onClick={() => setFilter(k)} style={filter === k ? { borderColor: 'var(--cr-blue)', color: 'var(--cr-blue)' } : undefined}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--cr-ink2)' }}>
          Every image across the site — banners, marketplace tiles, organizer maps — auto-optimized and sorted to the CDN. Approve or flag promoter artwork.
        </p>

        {res.status === 'loading' && !res.loaded ? <div className="cr-cards" aria-busy="true"><span className="cr-skel" style={{ height: 60, borderRadius: 12 }} /></div> : null}
        {res.status === 'error' ? (
          <div className="cr-error" role="alert">
            <strong>Couldn&apos;t load</strong>
            <span>{res.error}</span>
            <div style={{ marginTop: 8 }}>
              <button type="button" className="cr-linkbtn" onClick={res.reload}>
                RETRY
              </button>
            </div>
          </div>
        ) : null}
        {res.loaded && list.length === 0 ? (
          <div className="cr-empty">
            <strong>{filter === 'all' ? 'No assets on the CDN yet' : `Nothing in the ${filter} filter`}</strong>
            <span>{filter === 'all' ? 'Images uploaded anywhere on the platform are indexed here automatically.' : 'Try another filter.'}</span>
            {filter !== 'all' ? (
              <div style={{ marginTop: 10 }}>
                <button type="button" className="cr-btn" onClick={() => setFilter('all')}>
                  Show all
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {list.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
            {list.map((m) => (
              <div key={m.name} style={{ border: '1px solid var(--cr-hair)', borderRadius: 12, overflow: 'hidden', background: 'var(--cr-card)' }}>
                <div style={{ position: 'relative', aspectRatio: '16 / 10', backgroundImage: `url(${m.url})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
                  <span style={{ position: 'absolute', top: 8, left: 8, padding: '2px 7px', borderRadius: 6, background: 'rgba(0,0,0,0.55)', color: '#fff', fontFamily: 'var(--cr-mono)', fontSize: 9, letterSpacing: '0.06em' }}>
                    {m.category}
                  </span>
                  <span style={{ position: 'absolute', top: 8, right: 8 }}>
                    <StatusPill tone={mstatusTone(m.status)} label={String(m.status)} />
                  </span>
                </div>
                <div style={{ padding: 12 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.name}>
                    {m.name}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--cr-ink2)' }}>
                    {m.dims} · {m.sizeKB} KB → <b style={{ color: 'var(--cr-green)' }}>{m.optimizedKB} KB</b> webp
                    {m.lowres ? (
                      <>
                        <br />
                        <span style={{ color: 'var(--cr-red)' }}>⚠ low resolution</span>
                      </>
                    ) : null}
                    {m.flagReason && m.status === 'flagged' ? (
                      <>
                        <br />
                        <span style={{ color: 'var(--cr-red)' }}>{m.flagReason}</span>
                      </>
                    ) : null}
                  </p>
                  <p style={{ margin: '6px 0 0', fontFamily: 'var(--cr-mono)', fontSize: 10, color: 'var(--cr-mut)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.cdnUrl}</p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button type="button" className="cr-btn" onClick={() => setStatus(m.name, 'approved')}>
                      Approve
                    </button>
                    <button type="button" className="cr-btn" onClick={() => setStatus(m.name, 'flagged')}>
                      Flag
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

// ── site media (placements) ─────────────────────────────────────────────────

type Placements = {
  slots: { key: string; label: string }[];
  placements: Record<string, { label: string; url: string }>;
};

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read that file'));
    r.readAsDataURL(f);
  });
}

function SlotCard({ slotKey, label, url, onMapped }: { slotKey: string; label: string; url: string; onMapped: (url: string) => void }) {
  const toast = useConsoleToast();
  const input = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);

  const upload = useCallback(
    async (file: File | undefined) => {
      if (!file || !/^image\//.test(file.type)) {
        toast('Choose an image', true);
        return;
      }
      setUploading(true);
      try {
        const dataUrl = await fileToDataUrl(file);
        const up = await adminApi<{ url: string }>('/api/upload', { method: 'POST', body: JSON.stringify({ name: file.name, dataUrl }) });
        await adminApi('/api/placements', { method: 'PUT', body: JSON.stringify({ [slotKey]: up.url }) });
        onMapped(up.url);
        toast('Mapped to ' + slotKey);
      } catch (ex) {
        toast(errText(ex), true);
      } finally {
        setUploading(false);
      }
    },
    [onMapped, slotKey, toast],
  );

  const stop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div style={{ border: '1px solid var(--cr-hair)', borderRadius: 12, overflow: 'hidden', background: 'var(--cr-card)' }}>
      <div style={{ padding: '10px 12px' }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>{label}</p>
        <p style={{ margin: '2px 0 0', fontFamily: 'var(--cr-mono)', fontSize: 10, color: 'var(--cr-mut)' }}>{slotKey}</p>
      </div>
      <button
        type="button"
        aria-label={`Replace the ${label} image`}
        onClick={() => input.current?.click()}
        onDragEnter={(e) => {
          stop(e);
          setDrag(true);
        }}
        onDragOver={(e) => {
          stop(e);
          setDrag(true);
        }}
        onDragLeave={(e) => {
          stop(e);
          setDrag(false);
        }}
        onDrop={(e) => {
          stop(e);
          setDrag(false);
          void upload(e.dataTransfer.files?.[0]);
        }}
        style={{
          display: 'block',
          width: '100%',
          aspectRatio: '16 / 9',
          border: 'none',
          borderTop: '1px dashed ' + (drag ? 'var(--cr-blue)' : 'var(--cr-hair)'),
          cursor: 'pointer',
          backgroundColor: drag ? 'var(--cr-wash-blue)' : 'var(--cr-card2)',
          backgroundImage: url ? `url(${url})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          position: 'relative',
        }}
      >
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--cr-mono)', fontSize: 11, letterSpacing: '0.06em', color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>
          {uploading ? 'UPLOADING…' : 'Drop image or click to replace'}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function SitePanel() {
  const loader = useJsonLoader<Placements>('/api/placements');
  const res = useAdminResource(loader);

  if (res.status === 'loading' && !res.loaded)
    return <div className="cr-cards" aria-busy="true"><span className="cr-skel" style={{ height: 120, borderRadius: 12 }} /></div>;
  if (res.status === 'error')
    return (
      <div className="cr-error" role="alert">
        <strong>Couldn&apos;t load</strong>
        <span>{res.error}</span>
        <div style={{ marginTop: 8 }}>
          <button type="button" className="cr-linkbtn" onClick={res.reload}>
            RETRY
          </button>
        </div>
      </div>
    );
  const d = res.data;
  if (!d || d.slots.length === 0)
    return (
      <div className="cr-empty">
        <strong>No site-media slots are configured</strong>
        <span>Slots are defined by the API — add one there and it appears here.</span>
      </div>
    );

  return (
    <section className="cr-panel">
      <div className="cr-panel-head">
        <h2 className="cr-section-h" style={{ margin: 0 }}>
          Site media
        </h2>
      </div>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--cr-ink2)' }}>
        Upload and map core layout media to specific regions of the public site — hero banners, gallery, About visuals. Separate from event-creation and
        organizer uploaders. Changes go live on refresh.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {d.slots.map((s) => (
          <SlotCard
            key={s.key}
            slotKey={s.key}
            label={d.placements[s.key]?.label || s.label}
            url={d.placements[s.key]?.url || ''}
            onMapped={(url) => res.set({ ...d, placements: { ...d.placements, [s.key]: { label: d.placements[s.key]?.label || s.label, url } } })}
          />
        ))}
      </div>
    </section>
  );
}

// ── section ─────────────────────────────────────────────────────────────────

const TABS = [
  ['assets', 'ASSETS & CDN'],
  ['site', 'SITE MEDIA'],
] as const;

export default function AdminMediaClient() {
  return (
    <ConsoleToastProvider>
      <MediaInner />
    </ConsoleToastProvider>
  );
}

function MediaInner() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('assets');
  return (
    <AdminConsoleShell title="Media">
      <div className="cr-stack">
        <CrSectionHead title="Media" hint="Platform artwork moderation and the mapped layout media for the public site." />
        <div style={{ display: 'flex', gap: 6 }} role="tablist">
          {TABS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className="cr-btn"
              onClick={() => setTab(k)}
              style={tab === k ? { borderColor: 'var(--cr-blue)', color: 'var(--cr-blue)' } : undefined}
            >
              {l}
            </button>
          ))}
        </div>
        {tab === 'assets' ? <AssetsPanel /> : <SitePanel />}
      </div>
    </AdminConsoleShell>
  );
}
