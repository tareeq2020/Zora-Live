'use client';

/* PR-BS36 — EVENTS section. Ports three legacy panels behind the SAME endpoints:
     THE DROP  GET/PUT  /api/settings
     TIERS     GET      /api/tiers · POST /api/tiers · PUT/DELETE /api/tiers/:id
     CREWS     GET      /api/registrations · DELETE /api/registrations/:id
               (+ the CSV download at /api/registrations.csv)
   Behaviour is 1:1 with the legacy SCRIPT — same fields, same validation
   (invalid dropAt is rejected client-side, a tier needs a name), same confirms
   on destructive actions — only now it is typed React with real states. */

import { useCallback, useState, type FormEvent } from 'react';
import {
  AdminCard,
  AdminError,
  AdminSkeleton,
  AdminTable,
  adminApi,
  errText,
  useAdminResource,
  useJsonLoader,
  useToast,
  whenLocal,
  type AdminColumn,
} from '../admin-kit';

// ── THE DROP ────────────────────────────────────────────────────────────────

const DROP_FIELDS = [
  ['dropTitle', 'DROP TITLE'],
  ['dropName', 'DROP NAME'],
  ['status', 'STATUS'],
  ['dropAt', 'DROP TIME (ISO, e.g. 2026-07-30T20:00:00+03:00)'],
  ['eventDateLabel', 'EVENT DATE LABEL'],
  ['port', 'PORT'],
  ['coordinates', 'COORDINATES'],
  ['capacityLabel', 'CAPACITY LABEL'],
  ['venue', 'VENUE LINE'],
  ['tagline', 'TAGLINE'],
  ['appNote', 'APP NOTE'],
  ['contactEmail', 'CONTACT EMAIL'],
] as const;

type DropField = (typeof DROP_FIELDS)[number][0];
type Settings = Partial<Record<DropField, string>> & Record<string, unknown>;

const DROP_STATUSES = [
  ['countdown', 'countdown — pre-drop'],
  ['live', 'live — boarding open'],
  ['soldout', 'sold out'],
] as const;

function label(key: DropField): string {
  return DROP_FIELDS.find(([k]) => k === key)![1];
}

function DropPanel() {
  const toast = useToast();
  const loader = useJsonLoader<Settings>('/api/settings');
  const res = useAdminResource(loader);
  const [draft, setDraft] = useState<Partial<Record<DropField, string>> | null>(null);
  const [saving, setSaving] = useState(false);

  const value = (k: DropField): string => {
    if (draft && k in draft) return draft[k] ?? '';
    const v = res.data?.[k];
    return typeof v === 'string' ? v : '';
  };
  const setValue = (k: DropField, v: string) => setDraft((d) => ({ ...(d || {}), [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, string> = {};
    DROP_FIELDS.forEach(([k]) => (body[k] = value(k)));
    if (body.dropAt && Number.isNaN(new Date(body.dropAt).getTime())) {
      toast('Drop time is not a valid date', true);
      return;
    }
    setSaving(true);
    try {
      await adminApi('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
      toast('Drop saved');
      setDraft(null);
      res.reload();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setSaving(false);
    }
  }

  if (res.status === 'loading' && !res.loaded) return <AdminSkeleton rows={6} />;
  if (res.status === 'error' && !res.loaded) return <AdminError message={res.error} onRetry={res.reload} />;

  const text = (k: DropField) => (
    <div className="field" key={k}>
      <label htmlFor={'d-' + k}>{label(k)}</label>
      <input id={'d-' + k} value={value(k)} onChange={(e) => setValue(k, e.target.value)} disabled={saving} />
    </div>
  );

  return (
    <form onSubmit={save}>
      <div className="grid3">
        {text('dropTitle')}
        {text('dropName')}
        <div className="field">
          <label htmlFor="d-status">STATUS</label>
          <select id="d-status" value={value('status')} onChange={(e) => setValue('status', e.target.value)} disabled={saving}>
            {DROP_STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid2">
        {text('dropAt')}
        {text('eventDateLabel')}
      </div>
      <div className="grid3">
        {text('port')}
        {text('coordinates')}
        {text('capacityLabel')}
      </div>
      {text('venue')}
      <div className="grid3">
        {text('tagline')}
        {text('appNote')}
        {text('contactEmail')}
      </div>
      <button className="btn" type="submit" disabled={saving}>
        {saving ? 'SAVING…' : 'SAVE THE DROP'}
      </button>
    </form>
  );
}

// ── TIERS ───────────────────────────────────────────────────────────────────

type Tier = {
  id: string;
  event: string;
  name: string;
  order?: number | string;
  priceLabel?: string;
  status?: string;
  detail?: string;
  splitNote?: string;
};

const EMPTY_TIER = { event: 'shore', name: '', order: '1', priceLabel: '', status: 'locked', detail: '', splitNote: '' };
type TierDraft = typeof EMPTY_TIER;

function TiersPanel() {
  const toast = useToast();
  const loader = useJsonLoader<Tier[]>('/api/tiers');
  const res = useAdminResource(loader);
  const [editing, setEditing] = useState<{ id: string | null; draft: TierDraft } | null>(null);
  const [busy, setBusy] = useState(false);

  const openNew = () => setEditing({ id: null, draft: { ...EMPTY_TIER } });
  const openEdit = (t: Tier) =>
    setEditing({
      id: t.id,
      draft: {
        event: t.event || 'shore',
        name: t.name || '',
        order: t.order != null ? String(t.order) : '',
        priceLabel: t.priceLabel || '',
        status: t.status || 'locked',
        detail: t.detail || '',
        splitNote: t.splitNote || '',
      },
    });

  async function saveTier() {
    if (!editing) return;
    const d = editing.draft;
    if (!d.name.trim()) {
      toast('Tier needs a name', true);
      return;
    }
    const body = { ...d, order: parseInt(d.order, 10) || 0 };
    setBusy(true);
    try {
      if (editing.id) await adminApi(`/api/tiers/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await adminApi('/api/tiers', { method: 'POST', body: JSON.stringify(body) });
      toast('Tier saved');
      setEditing(null);
      res.reload();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setBusy(false);
    }
  }

  async function removeTier(id: string) {
    if (!window.confirm('Delete this tier?')) return;
    try {
      await adminApi(`/api/tiers/${id}`, { method: 'DELETE' });
      toast('Tier deleted');
      res.reload();
    } catch (ex) {
      toast(errText(ex), true);
    }
  }

  const cols: AdminColumn<Tier>[] = [
    { key: 'event', label: 'EVENT', render: (t) => <span className={'pill ' + (t.event || '')}>{t.event}</span> },
    {
      key: 'name',
      label: 'NAME',
      render: (t) => (
        <div>
          <b>{t.name}</b>
          {t.detail ? (
            <>
              <br />
              <span className="mono" style={{ color: 'var(--mut)' }}>
                {t.detail}
              </span>
            </>
          ) : null}
        </div>
      ),
    },
    { key: 'price', label: 'PRICE', render: (t) => <span className="mono">{t.priceLabel || '—'}</span> },
    { key: 'status', label: 'STATUS', render: (t) => <span className={'pill ' + (t.status || '')}>{t.status}</span> },
    { key: 'order', label: 'ORDER', render: (t) => <span className="mono">{t.order ?? ''}</span> },
    {
      key: 'act',
      label: '',
      actions: true,
      render: (t) => (
        <div className="row-actions">
          <button type="button" className="btn small ghost" onClick={() => openEdit(t)}>
            EDIT
          </button>
          <button type="button" className="btn danger small" onClick={() => removeTier(t.id)}>
            DELETE
          </button>
        </div>
      ),
    },
  ];

  const d = editing?.draft;
  const patch = (k: keyof TierDraft, v: string) =>
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, [k]: v } } : e));

  return (
    <div className="stack">
      {editing && d ? (
        <AdminCard title={editing.id ? `EDIT TIER — ${d.name || '—'}` : 'NEW TIER'}>
          <div className="grid3">
            <div className="field">
              <label htmlFor="t-event">EVENT</label>
              <select id="t-event" value={d.event} onChange={(e) => patch('event', e.target.value)}>
                <option value="shore">shore</option>
                <option value="vessel">vessel</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="t-name">NAME</label>
              <input id="t-name" value={d.name} placeholder="WAVE 04" onChange={(e) => patch('name', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="t-order">ORDER</label>
              <input id="t-order" type="number" value={d.order} onChange={(e) => patch('order', e.target.value)} />
            </div>
          </div>
          <div className="grid2">
            <div className="field">
              <label htmlFor="t-price">PRICE LABEL</label>
              <input id="t-price" value={d.priceLabel} placeholder="65,000 TZS" onChange={(e) => patch('priceLabel', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="t-status">STATUS</label>
              <select id="t-status" value={d.status} onChange={(e) => patch('status', e.target.value)}>
                <option value="locked">locked</option>
                <option value="open">open at drop</option>
                <option value="soldout">sold out</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="t-detail">DETAIL</label>
            <input id="t-detail" value={d.detail} placeholder="First 1,000 shore passes." onChange={(e) => patch('detail', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="t-split">SPLIT NOTE (OPTIONAL)</label>
            <input
              id="t-split"
              value={d.splitNote}
              placeholder="Crew split in-app: 150,000 TZS each."
              onChange={(e) => patch('splitNote', e.target.value)}
            />
          </div>
          <div className="row-actions">
            <button type="button" className="btn" onClick={saveTier} disabled={busy}>
              {busy ? 'SAVING…' : 'SAVE TIER'}
            </button>
            <button type="button" className="btn ghost" onClick={() => setEditing(null)} disabled={busy}>
              CANCEL
            </button>
          </div>
        </AdminCard>
      ) : null}

      <AdminCard
        title="TIERS"
        subtitle="Vessel tiers show in the vessel card, shore tiers in the list. Order controls sorting within each card."
        actions={
          <button type="button" className="btn small" onClick={openNew}>
            NEW TIER
          </button>
        }
        flush
      >
        <AdminTable
          columns={cols}
          rows={res.data}
          rowKey={(t) => t.id}
          resource={res}
          empty="No tiers yet — add the first one and it shows on the drop page."
          emptyAction={
            <button type="button" className="btn small" onClick={openNew}>
              NEW TIER
            </button>
          }
        />
      </AdminCard>
    </div>
  );
}

// ── MEGA EVENT (BS50) ─────────────────────────────────────────────────────
// discover-app.tsx already reads `e.mega` and pins whichever event in the
// viewer's OWN city has it set (see the `feat` memo there) — this panel is
// the only thing that was missing: a way to actually set it. Reads the SAME
// public /api/events list discover renders (events already carry `mega`
// once set — no separate admin read path needed). Only the write
// (PUT /api/events/:id/mega) is admin-gated; the server enforces at most one
// mega event PER CITY (matching discover's own per-city scoping — a city can
// have its own mega pin without clearing another city's), so this UI just
// reflects whatever comes back.

type MarketplaceEvent = {
  id: string;
  name: string;
  organizer?: string | null;
  organizerHandle?: string | null;
  city?: string;
  dateLabel?: string;
  date?: string;
  mega?: boolean;
};

function FeaturedPanel() {
  const toast = useToast();
  const loader = useJsonLoader<MarketplaceEvent[]>('/api/events');
  const res = useAdminResource(loader);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggle(ev: MarketplaceEvent) {
    setBusyId(ev.id);
    try {
      await adminApi(`/api/events/${encodeURIComponent(ev.id)}/mega`, {
        method: 'PUT',
        body: JSON.stringify({ mega: !ev.mega }),
      });
      toast(ev.mega ? `Unpinned ${ev.name}` : `${ev.name} is now the mega event for ${ev.city || 'its city'}`);
      res.reload();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setBusyId(null);
    }
  }

  const rows = res.data ? res.data.slice().sort((a, b) => (b.mega ? 1 : 0) - (a.mega ? 1 : 0)) : null;

  const cols: AdminColumn<MarketplaceEvent>[] = [
    {
      key: 'name',
      label: 'EVENT',
      render: (e) => (
        <div>
          <b>{e.name}</b>
          <br />
          <span className="mono" style={{ color: 'var(--mut)' }}>
            {e.organizer || e.organizerHandle || '—'}
          </span>
        </div>
      ),
    },
    { key: 'city', label: 'CITY', render: (e) => e.city || '—' },
    { key: 'date', label: 'DATE', render: (e) => <span className="mono">{e.dateLabel || e.date || '—'}</span> },
    { key: 'mega', label: 'STATUS', render: (e) => (e.mega ? <span className="pill active">MEGA — {e.city}</span> : null) },
    {
      key: 'act',
      label: '',
      actions: true,
      render: (e) => (
        <button
          type="button"
          className={'btn small' + (e.mega ? ' ghost' : '')}
          disabled={busyId === e.id}
          onClick={() => toggle(e)}
        >
          {busyId === e.id ? 'SAVING…' : e.mega ? 'UNPIN' : 'SET AS MEGA EVENT'}
        </button>
      ),
    },
  ];

  return (
    <AdminCard
      title="MEGA EVENT"
      subtitle="Pin one event above the grid for its city on Discover. At most one mega event per city — setting a new one for a city un-pins that city's previous pick, but leaves other cities' picks alone."
      flush
    >
      <AdminTable
        columns={cols}
        rows={rows}
        rowKey={(e) => e.id}
        resource={res}
        empty="No published events yet."
      />
    </AdminCard>
  );
}

// ── CREWS ───────────────────────────────────────────────────────────────────

type Crew = {
  id: string;
  code: string;
  crewName: string;
  leadName: string;
  phone: string;
  email?: string;
  size?: number | string;
  at: string;
};

function CrewsPanel() {
  const toast = useToast();
  const loader = useJsonLoader<Crew[]>('/api/registrations');
  const res = useAdminResource(loader);

  const remove = useCallback(
    async (id: string) => {
      if (!window.confirm('Remove this crew from the manifest?')) return;
      try {
        await adminApi(`/api/registrations/${id}`, { method: 'DELETE' });
        toast('Crew removed');
        res.reload();
      } catch (ex) {
        toast(errText(ex), true);
      }
    },
    [res, toast],
  );

  const rows = res.data ? res.data.slice().reverse() : null;
  const crews = res.data?.length ?? 0;
  const heads = (res.data || []).reduce((n, r) => n + (parseInt(String(r.size), 10) || 0), 0);

  const cols: AdminColumn<Crew>[] = [
    { key: 'code', label: 'CODE', render: (r) => <span className="mono" style={{ color: 'var(--blue)' }}>{r.code}</span> },
    { key: 'crew', label: 'CREW', render: (r) => <b>{r.crewName}</b> },
    { key: 'lead', label: 'LEAD', render: (r) => r.leadName },
    { key: 'phone', label: 'PHONE', render: (r) => <span className="mono">{r.phone}</span> },
    { key: 'email', label: 'EMAIL', render: (r) => <span className="mono">{r.email || '—'}</span> },
    { key: 'size', label: 'SIZE', render: (r) => <span className="mono">{r.size}</span> },
    { key: 'at', label: 'REGISTERED', render: (r) => <span className="mono">{whenLocal(r.at)}</span> },
    {
      key: 'act',
      label: '',
      actions: true,
      render: (r) => (
        <button type="button" className="btn danger small" onClick={() => remove(r.id)}>
          REMOVE
        </button>
      ),
    },
  ];

  return (
    <div className="stack">
      <div className="stat-row">
        <div className="stat">
          <p className="sv">{res.loaded ? crews : '—'}</p>
          <p className="sk">CREWS</p>
        </div>
        <div className="stat">
          <p className="sv">{res.loaded ? heads : '—'}</p>
          <p className="sk">HEADS</p>
        </div>
      </div>
      <AdminCard
        title="CREWS ON THE MANIFEST"
        subtitle="Every crew registered from the drop page. Export the CSV for the drop-signal blast."
        actions={
          <a className="btn small ghost" href="/api/registrations.csv">
            DOWNLOAD CSV
          </a>
        }
        flush
      >
        <AdminTable
          columns={cols}
          rows={rows}
          rowKey={(r) => r.id}
          resource={res}
          empty="No crews on the manifest yet."
          emptySub="Registrations from the drop page land here the moment someone signs up."
        />
      </AdminCard>
    </div>
  );
}

// ── section ─────────────────────────────────────────────────────────────────

const TABS = [
  ['featured', 'FEATURED'],
  ['drop', 'THE DROP'],
  ['tiers', 'TIERS'],
  ['crews', 'CREWS'],
] as const;

export function EventsSection() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('featured');
  return (
    <>
      <div className="sec-h">
        <h2>Events</h2>
        <p className="hint">
          The flagship drop, its tiers and the crews on the manifest. Everything on both public pages reads from here —
          save, then refresh the site to see it live.
        </p>
      </div>
      <div className="subtabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={'subtab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'featured' ? <FeaturedPanel /> : null}
      {tab === 'drop' ? (
        <AdminCard title="THE DROP" subtitle="Everything on both pages reads from here.">
          <DropPanel />
        </AdminCard>
      ) : null}
      {tab === 'tiers' ? <TiersPanel /> : null}
      {tab === 'crews' ? <CrewsPanel /> : null}
    </>
  );
}
