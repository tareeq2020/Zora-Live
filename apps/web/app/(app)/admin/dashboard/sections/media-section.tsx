'use client';

/* PR-BS36 — MEDIA section, two sub-tabs, same endpoints as the legacy panels:
     ASSETS & CDN  GET /api/media · PUT /api/media/:name/status {status,flagReason}
     SITE MEDIA    GET /api/placements · POST /api/upload {name,dataUrl}
                   · PUT /api/placements { [slotKey]: url }
   Site-media keeps the legacy drag-and-drop + click-to-replace on each slot,
   the "UPLOADING…" affordance, and the exact upload→map two-call sequence. */

import { useCallback, useRef, useState, type DragEvent } from 'react';
import {
  AdminCard,
  AdminEmpty,
  AdminError,
  AdminSkeleton,
  adminApi,
  errText,
  useAdminResource,
  useJsonLoader,
  useToast,
} from '../admin-kit';

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

function AssetsPanel() {
  const toast = useToast();
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

  return (
    <div className="stack">
      <div className="stat-row">
        <div className="stat">
          <p className="sv">{res.loaded ? all.length : '—'}</p>
          <p className="sk">ASSETS ON CDN</p>
        </div>
        <div className="stat">
          <p className="sv">{res.loaded ? flagged : '—'}</p>
          <p className="sk">FLAGGED / LOW-RES</p>
        </div>
        <div className="stat">
          <p className="sv">{res.loaded ? saved : '—'}</p>
          <p className="sk">EST. SAVED BY COMPRESSION</p>
        </div>
      </div>

      <AdminCard
        title="ASSETS & CDN"
        subtitle="Every image across the site — banners, marketplace tiles, organizer maps — auto-optimized and sorted to the CDN. Approve or flag promoter artwork."
      >
        <div className="filterbar" role="group" aria-label="Filter assets">
          {FILTERS.map(([k, l]) => (
            <button key={k} type="button" className={'fbtn' + (filter === k ? ' on' : '')} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {l}
            </button>
          ))}
        </div>

        {res.status === 'loading' && !res.loaded ? <AdminSkeleton rows={4} /> : null}
        {res.status === 'error' ? <AdminError message={res.error} onRetry={res.reload} /> : null}
        {res.loaded && list.length === 0 ? (
          <AdminEmpty
            line={filter === 'all' ? 'No assets on the CDN yet.' : `Nothing in the ${filter} filter.`}
            sub={filter === 'all' ? 'Images uploaded anywhere on the platform are indexed here automatically.' : 'Try another filter.'}
            action={
              filter === 'all' ? undefined : (
                <button type="button" className="btn small ghost" onClick={() => setFilter('all')}>
                  SHOW ALL
                </button>
              )
            }
          />
        ) : null}
        {list.length > 0 ? (
          <div className="media-grid">
            {list.map((m) => (
              <div className="mcard" key={m.name}>
                <div className="thumb" style={{ backgroundImage: `url(${m.url})` }}>
                  <span className="cat">{m.category}</span>
                  <span className={'mstatus ' + m.status}>{String(m.status).toUpperCase()}</span>
                </div>
                <div className="minfo">
                  <p className="mname" title={m.name}>
                    {m.name}
                  </p>
                  <p className="mmeta">
                    {m.dims} · {m.sizeKB} KB → <b style={{ color: 'var(--teal)' }}>{m.optimizedKB} KB</b> webp
                    {m.lowres ? (
                      <>
                        <br />
                        <span className="warn">⚠ low resolution</span>
                      </>
                    ) : null}
                    {m.flagReason && m.status === 'flagged' ? (
                      <>
                        <br />
                        <span className="warn">{m.flagReason}</span>
                      </>
                    ) : null}
                  </p>
                  <p className="mcdn">{m.cdnUrl}</p>
                </div>
                <div className="mact">
                  <button type="button" className="ok" onClick={() => setStatus(m.name, 'approved')}>
                    APPROVE
                  </button>
                  <button type="button" className="flag" onClick={() => setStatus(m.name, 'flagged')}>
                    FLAG
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </AdminCard>
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
  const toast = useToast();
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
    <div className="slot-card">
      <div className="sc-h">
        <p className="rn">{label}</p>
        <p className="rk">{slotKey}</p>
      </div>
      <button
        type="button"
        className={'slot-dz' + (drag ? ' drag' : '')}
        style={{ backgroundImage: url ? `url(${url})` : undefined }}
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
      >
        <span className="dz-hint">{uploading ? 'UPLOADING…' : 'Drop image or click to replace'}</span>
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

  if (res.status === 'loading' && !res.loaded) return <AdminSkeleton rows={4} />;
  if (res.status === 'error') return <AdminError message={res.error} onRetry={res.reload} />;
  const d = res.data;
  if (!d || d.slots.length === 0)
    return <AdminEmpty line="No site-media slots are configured." sub="Slots are defined by the API — add one there and it appears here." />;

  return (
    <AdminCard
      title="SITE MEDIA"
      subtitle="Upload and map core layout media to specific regions of the public site — hero banners, gallery, About visuals. Separate from event-creation and organizer uploaders. Changes go live on refresh."
    >
      <div className="slots-grid">
        {d.slots.map((s) => (
          <SlotCard
            key={s.key}
            slotKey={s.key}
            label={d.placements[s.key]?.label || s.label}
            url={d.placements[s.key]?.url || ''}
            onMapped={(url) =>
              res.set({
                ...d,
                placements: { ...d.placements, [s.key]: { label: d.placements[s.key]?.label || s.label, url } },
              })
            }
          />
        ))}
      </div>
    </AdminCard>
  );
}

// ── section ─────────────────────────────────────────────────────────────────

const TABS = [
  ['assets', 'ASSETS & CDN'],
  ['site', 'SITE MEDIA'],
] as const;

export function MediaSection() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('assets');
  return (
    <>
      <div className="sec-h">
        <h2>Media</h2>
        <p className="hint">Platform artwork moderation and the mapped layout media for the public site.</p>
      </div>
      <div className="subtabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={'subtab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'assets' ? <AssetsPanel /> : <SitePanel />}
    </>
  );
}
