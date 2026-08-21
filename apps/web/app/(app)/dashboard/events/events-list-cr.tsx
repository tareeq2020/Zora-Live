'use client';

/* BS78 #3 — the organizer Events list. The legacy /dashboard home carried this
   (GET /api/org/events → NEW / EDIT / DELETE); with the home retired we give it
   its own Control-Room v2 route at /dashboard/events. Reuses the same endpoints
   and confirm copy as the old home so behaviour is unchanged:
     · edit   → /dashboard/events/:id/edit
     · archive/restore → POST /api/org/events/:id/(archive|unarchive)
     · delete → DELETE /api/org/events/:id (409 = has paid orders, archive instead) */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CrShell, DataTable, StatusPill, toneForStatus, type Column } from '@/app/components/cr';
import { ORG_NAV, ORG_BRAND } from '../components/org-nav';

type OrgEvent = {
  id: string;
  name: string;
  category?: string;
  city?: string;
  venue?: string;
  dateLabel?: string;
  time?: string;
  status?: string;
  sellable?: boolean;
};

const CSS = `
.ev-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.ev-h1{font-family:var(--cr-sans);font-size:22px;font-weight:600;color:var(--cr-ink);letter-spacing:-.01em}
.ev-sub{font-size:13px;color:var(--cr-ink2);margin-top:2px}
.ev-new{display:inline-flex;align-items:center;min-height:40px;padding:0 18px;border-radius:10px;background:var(--cr-blue);color:#fff;font-family:var(--cr-mono);font-size:11px;font-weight:600;letter-spacing:.12em;white-space:nowrap}
.ev-new:hover{background:color-mix(in srgb,var(--cr-blue) 84%,#000)}
.ev-msg{padding:10px 14px;border-radius:10px;font-size:13px}
.ev-msg.ok{background:color-mix(in srgb,var(--cr-green) 12%,transparent);color:var(--cr-green);border:1px solid color-mix(in srgb,var(--cr-green) 30%,transparent)}
.ev-msg.err{background:color-mix(in srgb,var(--cr-red) 12%,transparent);color:var(--cr-red);border:1px solid color-mix(in srgb,var(--cr-red) 30%,transparent)}
.ev-actions{display:inline-flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
.ev-btn{display:inline-flex;align-items:center;min-height:34px;padding:0 12px;border-radius:8px;border:1px solid var(--cr-hair);background:var(--cr-card);color:var(--cr-ink);font-family:var(--cr-mono);font-size:11px;letter-spacing:.06em;cursor:pointer}
.ev-btn:hover{border-color:color-mix(in srgb,var(--cr-blue) 40%,var(--cr-hair))}
.ev-btn:disabled{opacity:.5;cursor:wait}
.ev-btn.ev-danger{color:var(--cr-red);border-color:color-mix(in srgb,var(--cr-red) 34%,var(--cr-hair))}
`;

export function EventsListClient() {
  const [rows, setRows] = useState<OrgEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/org/events', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : (data.events ?? []));
    } catch {
      setError(true);
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    fetch('/api/org/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.name === 'string') setOrgName(d.name);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const isArchived = (s?: string) => s === 'archived';

  const onArchive = useCallback(
    async (ev: OrgEvent) => {
      if (!window.confirm(`Archive "${ev.name}"? It comes off your public storefront. You can restore it anytime.`)) return;
      setActing(ev.id);
      try {
        const res = await fetch(`/api/org/events/${encodeURIComponent(ev.id)}/archive`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setMsg({ kind: 'ok', text: `"${ev.name}" was archived.` });
        await load();
      } catch {
        setMsg({ kind: 'err', text: `Couldn't archive "${ev.name}". Please try again.` });
      } finally {
        setActing(null);
      }
    },
    [load],
  );

  const onRestore = useCallback(
    async (ev: OrgEvent) => {
      setActing(ev.id);
      try {
        const res = await fetch(`/api/org/events/${encodeURIComponent(ev.id)}/unarchive`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setMsg({ kind: 'ok', text: `"${ev.name}" was restored.` });
        await load();
      } catch {
        setMsg({ kind: 'err', text: `Couldn't restore "${ev.name}". Please try again.` });
      } finally {
        setActing(null);
      }
    },
    [load],
  );

  const onDelete = useCallback(
    async (ev: OrgEvent) => {
      if (!window.confirm(`Delete "${ev.name}"? It will be archived and removed from your public storefront. This cannot be undone from here.`)) return;
      setActing(ev.id);
      try {
        const res = await fetch(`/api/org/events/${encodeURIComponent(ev.id)}`, { method: 'DELETE' });
        if (!res.ok) {
          if (res.status === 409) {
            setMsg({ kind: 'err', text: `"${ev.name}" has paid orders, so it can't be deleted — archive it instead.` });
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        setMsg({ kind: 'ok', text: `"${ev.name}" was deleted.` });
        await load();
      } catch {
        setMsg({ kind: 'err', text: `Couldn't delete "${ev.name}". Please try again.` });
      } finally {
        setActing(null);
      }
    },
    [load],
  );

  const cols: Column<OrgEvent>[] = [
    { key: 'name', header: 'Event', primary: true, render: (e) => e.name || 'Untitled event' },
    { key: 'when', header: 'When', render: (e) => [e.dateLabel, e.time].filter(Boolean).join(' · ') || '—' },
    { key: 'venue', header: 'Venue', render: (e) => [e.venue, e.city].filter(Boolean).join(', ') || '—' },
    {
      key: 'status',
      header: 'Status',
      render: (e) => <StatusPill tone={toneForStatus(e.status || 'draft')} label={e.status === 'published' ? 'live' : e.status || 'draft'} />,
    },
    {
      key: 'actions',
      header: '',
      render: (e) => (
        <span className="ev-actions">
          <Link className="ev-btn" href={`/dashboard/events/${encodeURIComponent(e.id)}/edit`}>
            Edit
          </Link>
          {isArchived(e.status) ? (
            <button type="button" className="ev-btn" disabled={acting === e.id} onClick={() => onRestore(e)}>
              Restore
            </button>
          ) : (
            <button type="button" className="ev-btn" disabled={acting === e.id} onClick={() => onArchive(e)}>
              Archive
            </button>
          )}
          <button type="button" className="ev-btn ev-danger" disabled={acting === e.id} onClick={() => onDelete(e)}>
            Delete
          </button>
        </span>
      ),
    },
  ];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <CrShell
        nav={ORG_NAV}
        brand={ORG_BRAND}
        topbarTitle="Events"
        topbarExtra={<span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, color: 'var(--cr-ink2)' }}>{orgName || ' '}</span>}
        footer={
          <>
            <a href="/dashboard/onboarding">GET STARTED</a> &middot; <a href="/">ZORAPASS.COM</a>
          </>
        }
      >
        <div className="cr-stack">
          <div className="ev-head">
            <div>
              <h1 className="ev-h1">Events</h1>
              <p className="ev-sub">Create, edit, archive and manage your drops.</p>
            </div>
            <Link className="ev-new" href="/dashboard/events/new">
              + New event
            </Link>
          </div>
          {msg && <div className={`ev-msg ${msg.kind}`}>{msg.text}</div>}
          {/* BS99 (#4): the list sits in a card (.cr-panel), matching every other
              console surface — it was rendering bare on the page background. */}
          <section className="cr-panel">
            <DataTable
              columns={cols}
              rows={rows ?? []}
              rowKey={(e) => e.id}
              loading={loading}
              error={error ? 'Could not load your events.' : null}
              onRetry={load}
              emptyTitle="No events yet"
              emptyBody="Create your first drop to start selling."
            />
          </section>
        </div>
      </CrShell>
    </>
  );
}
