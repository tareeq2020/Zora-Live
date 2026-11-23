'use client';

/* BS168: Admin → Cities. The one city list (the `city` table).

   - Requests: organizers asked for a city that isn't listed. Approve it (after
     checking country, currency, time zone), match it to a listed city (its
     events move there), or decline it.
   - Cities: edit name, country, currency, time zone, other spellings, order;
     hide a city to stop new events there (existing events keep it).
   - Add a city.
   Buyers only ever see a city once it has upcoming events. */

import { useCallback, useEffect, useState } from 'react';
import { AdminConsoleShell } from '../console-shell';
import { CrField, CrSectionHead, crDangerBtn, crPrimaryBtn } from '../console-kit';
import { DataTable, StatusPill, type Column } from '@/app/components/cr';

type City = {
  id: string; name: string; country: string; currency: string; timezone: string; aliases: string[];
  status: 'active' | 'hidden' | 'requested' | 'merged' | 'declined'; sort: number; mergedInto: string | null;
  requestedBy: string | null; requestedAt: string | null; events: number; upcoming: number;
};
type Data = { cities: City[]; unknown: { value: string; events: number }[] };

const ZONES = [
  'Africa/Dar_es_Salaam', 'Africa/Nairobi', 'Africa/Kampala', 'Africa/Kigali', 'Africa/Lagos', 'Africa/Accra',
  'Africa/Johannesburg', 'Africa/Cairo', 'Africa/Addis_Ababa', 'Africa/Lusaka', 'Europe/London', 'Asia/Dubai',
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...(init?.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d && (d.message || d.error)) || `Request failed (${r.status})`);
  return d as T;
}

// The codes the cities API sends without its own message.
const ERR: Record<string, string> = {
  name_invalid: 'Use letters for the name (2–60 characters).',
  country_invalid: 'Country is up to 60 characters, no special symbols.',
  currency_invalid: 'Currency is a 3-letter code, e.g. TZS.',
  timezone_invalid: 'Pick a time zone from the list, e.g. Africa/Nairobi.',
  sort_invalid: 'Order is a whole number from 0 to 10000.',
  status_invalid: 'A city is either active or hidden.',
  id_invalid: 'The id is 2–40 lowercase letters, numbers or dashes.',
  target_not_active: 'You can only match to an active city.',
  same_city: "You can't match a city to itself.",
  not_requested: 'This request was already handled. Reload the page.',
  city_closed: 'This city was matched or declined and can no longer be edited.',
  use_approve: 'Approve or decline this request first.',
  cities_unavailable: "Cities couldn't be loaded. Try again in a moment.",
};
const say = (e: unknown) => {
  const m = (e as Error)?.message || 'Something went wrong.';
  return ERR[m] || m;
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—');

export default function CitiesPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [addKey, setAddKey] = useState(0); // remounts the add form after a city is added

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      setData(await api<Data>('/api/admin/cities'));
    } catch (e) {
      setLoadErr(say(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<boolean> => {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'ok', text: ok });
      setEditing(null);
      await load();
      return true;
    } catch (e) {
      setMsg({ tone: 'err', text: say(e) });
      return false;
    } finally {
      // The message shows at the top of the page; bring it into view.
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const all = data?.cities ?? [];
  const requests = all.filter((c) => c.status === 'requested');
  const listed = all.filter((c) => c.status === 'active' || c.status === 'hidden');
  const closed = all.filter((c) => c.status === 'merged' || c.status === 'declined');
  const active = all.filter((c) => c.status === 'active');

  const columns: Column<City>[] = [
    { key: 'name', header: 'City', primary: true, render: (c) => <strong>{c.name}</strong> },
    { key: 'country', header: 'Country', render: (c) => c.country || '—' },
    { key: 'currency', header: 'Currency', render: (c) => <span style={{ fontFamily: 'var(--cr-mono)' }}>{c.currency}</span> },
    { key: 'upcoming', header: 'Upcoming', numeric: true, render: (c) => c.upcoming },
    { key: 'events', header: 'All events', numeric: true, render: (c) => c.events },
    {
      key: 'status', header: 'Status',
      render: (c) => <StatusPill tone={c.status === 'active' ? (c.upcoming ? 'live' : 'neutral') : 'draft'} label={c.status === 'active' ? (c.upcoming ? 'On Discover' : 'No events yet') : 'Hidden'} />,
    },
    {
      key: 'edit', header: '',
      render: (c) => (
        <button type="button" className="cr-linkbtn" onClick={() => setEditing(editing === c.id ? null : c.id)} aria-expanded={editing === c.id}>
          {editing === c.id ? 'Close' : 'Edit'}
        </button>
      ),
    },
  ];

  return (
    <AdminConsoleShell title="Cities">
      {msg ? (
        <p role={msg.tone === 'err' ? 'alert' : 'status'} style={{ margin: '0 0 16px', color: msg.tone === 'err' ? 'var(--cr-red)' : 'var(--cr-ink)' }}>{msg.text}</p>
      ) : null}
      {loadErr ? (
        <p role="alert" style={{ color: 'var(--cr-red)' }}>
          Couldn&apos;t load cities ({loadErr}). <button type="button" className="cr-linkbtn" onClick={load}>Try again</button>
        </p>
      ) : null}

      {requests.length ? (
        <section className="cr-panel" style={{ marginBottom: 24 }}>
          <CrSectionHead
            title={`Requests (${requests.length})`}
            hint="Organizers asked for these. Their events can already sell; approving puts the city on Discover once it has events. If it's another name for a listed city, match it instead."
          />
          <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
            {requests.map((c) => (
              <RequestCard
                key={c.id}
                city={c}
                active={active}
                onApprove={(body) => run(() => api(`/api/admin/cities/${c.id}/approve`, { method: 'POST', body: JSON.stringify(body) }), `Approved ${body.name || c.name}. It shows on Discover once it has an upcoming event.`)}
                onMerge={(into) => run(() => api(`/api/admin/cities/${c.id}/merge`, { method: 'POST', body: JSON.stringify({ into }) }), `Matched ${c.name} to ${active.find((a) => a.id === into)?.name}. Its events moved.`)}
                onDecline={() => run(() => api(`/api/admin/cities/${c.id}/decline`, { method: 'POST' }), `Declined ${c.name}.`)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="cr-panel" style={{ marginBottom: 24 }}>
        <CrSectionHead
          title="Cities"
          hint="Organizers pick from the active cities. Buyers only see a city once it has upcoming events, busiest first. Hide a city to stop new events there; its existing events keep it."
        />
        <div style={{ marginTop: 16 }}>
          <DataTable
            columns={columns}
            rows={listed}
            rowKey={(c) => c.id}
            loading={!data && !loadErr}
            emptyTitle="No cities yet"
            emptyBody="Add the first city below."
            caption="Cities"
          />
        </div>
        {editing && listed.some((c) => c.id === editing) ? (
          <CityForm
            key={editing}
            city={listed.find((c) => c.id === editing)!}
            submitLabel="Save changes"
            onCancel={() => setEditing(null)}
            onSubmit={(body) => run(() => api(`/api/admin/cities/${editing}`, { method: 'PUT', body: JSON.stringify(body) }), 'Saved. Buyers see the change within a minute.')}
          />
        ) : null}
      </section>

      <section className="cr-panel" style={{ marginBottom: 24 }}>
        <CrSectionHead title="Add a city" hint="It appears in the organizer city list straight away, and on Discover once it has an upcoming event." />
        <CityForm
          key={addKey}
          submitLabel="Add city"
          withStatus={false}
          onSubmit={async (body) => {
            if (await run(() => api('/api/admin/cities', { method: 'POST', body: JSON.stringify(body) }), `Added ${body.name}.`)) setAddKey((k) => k + 1);
          }}
        />
      </section>

      {data?.unknown.length ? (
        <section className="cr-panel" style={{ marginBottom: 24 }}>
          <CrSectionHead title="Events with an unlisted city" hint="Old events whose city matches nothing on the list. Add the value as another spelling of the right city to fix them." />
          <ul style={{ margin: '12px 0 0', paddingLeft: 18 }}>
            {data.unknown.map((u) => <li key={u.value}><code>{u.value}</code> · {u.events} event{u.events === 1 ? '' : 's'}</li>)}
          </ul>
        </section>
      ) : null}

      {closed.length ? (
        <details className="cr-panel">
          <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center', fontWeight: 600 }}>Matched and declined ({closed.length})</summary>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {closed.map((c) => (
              <li key={c.id}>
                {c.name} · {c.status === 'merged' ? `matched to ${all.find((x) => x.id === c.mergedInto)?.name ?? c.mergedInto}` : 'declined'}
                {c.requestedBy ? ` · asked for by @${c.requestedBy}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </AdminConsoleShell>
  );
}

type FormBody = { name: string; country: string; currency: string; timezone: string; aliases: string; sort: number; status?: 'active' | 'hidden' };

function CityForm({
  city, submitLabel, onSubmit, onCancel, withStatus = true, compact = false,
}: {
  city?: Partial<City>; submitLabel: string; onSubmit: (b: FormBody) => Promise<unknown>; onCancel?: () => void; withStatus?: boolean;
  /** Request cards: name, country, currency, time zone only. */
  compact?: boolean;
}) {
  const [f, setF] = useState<FormBody>({
    name: city?.name ?? '', country: city?.country ?? '', currency: city?.currency ?? 'TZS',
    timezone: city?.timezone ?? 'Africa/Dar_es_Salaam', aliases: (city?.aliases ?? []).join(', '), sort: city?.sort ?? 100,
    status: city?.status === 'hidden' ? 'hidden' : 'active',
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormBody>(k: K, v: FormBody[K]) => setF((x) => ({ ...x, [k]: v }));
  const id = city?.id ?? 'new';
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const body: FormBody = { ...f, currency: f.currency.toUpperCase() };
        if (!withStatus) delete body.status;
        await onSubmit(body);
        setBusy(false);
      }}
      style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginTop: 16, alignItems: 'end' }}
    >
      <CrField label="Name" htmlFor={`cf-${id}-name`}><input id={`cf-${id}-name`} className="cr-input" required value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Arusha" /></CrField>
      <CrField label="Country" htmlFor={`cf-${id}-country`}><input id={`cf-${id}-country`} className="cr-input" value={f.country} onChange={(e) => set('country', e.target.value)} placeholder="e.g. Tanzania" /></CrField>
      <CrField label="Currency" htmlFor={`cf-${id}-cur`}><input id={`cf-${id}-cur`} className="cr-input" value={f.currency} maxLength={3} onChange={(e) => set('currency', e.target.value)} placeholder="TZS" style={{ textTransform: 'uppercase' }} /></CrField>
      <CrField label="Time zone" htmlFor={`cf-${id}-tz`}>
        <input id={`cf-${id}-tz`} className="cr-input" list={`cf-${id}-zones`} value={f.timezone} onChange={(e) => set('timezone', e.target.value)} />
        <datalist id={`cf-${id}-zones`}>{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
      </CrField>
      {!compact ? (
        <>
          <CrField label="Other spellings (comma separated)" htmlFor={`cf-${id}-al`} style={{ gridColumn: '1 / -1' }}>
            <input id={`cf-${id}-al`} className="cr-input" value={f.aliases} onChange={(e) => set('aliases', e.target.value)} placeholder="e.g. dsm, dar es salaam" />
          </CrField>
          <CrField label="Order" htmlFor={`cf-${id}-sort`}>
            <input id={`cf-${id}-sort`} className="cr-input" type="number" min={0} max={10000} value={f.sort} onChange={(e) => set('sort', Number(e.target.value))} aria-describedby={`cf-${id}-sorth`} />
            <span id={`cf-${id}-sorth`} style={{ fontSize: 13, color: 'var(--cr-ink2)' }}>Lower comes first when two cities have the same number of events.</span>
          </CrField>
        </>
      ) : null}
      {withStatus ? (
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44 }}>
          <input type="checkbox" checked={f.status === 'hidden'} onChange={(e) => set('status', e.target.checked ? 'hidden' : 'active')} style={{ width: 20, height: 20 }} />
          Hidden (no new events)
        </label>
      ) : null}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', gridColumn: '1 / -1' }}>
        <button type="submit" className="cr-btn" style={crPrimaryBtn} disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel ? <button type="button" className="cr-btn" onClick={onCancel}>Cancel</button> : null}
      </div>
    </form>
  );
}

function RequestCard({
  city, active, onApprove, onMerge, onDecline,
}: {
  city: City; active: City[];
  onApprove: (b: Omit<FormBody, 'status'>) => Promise<unknown>; onMerge: (into: string) => Promise<unknown>; onDecline: () => Promise<unknown>;
}) {
  const [into, setInto] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };
  return (
    <div style={{ border: '1px solid var(--cr-hair)', borderRadius: 12, padding: 16 }}>
      <p style={{ margin: 0, fontWeight: 700, fontSize: 17 }}>{city.name}</p>
      <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--cr-ink2)' }}>
        Asked for by {city.requestedBy ? `@${city.requestedBy}` : 'an organizer'} on {when(city.requestedAt)} · {city.events === 0 ? 'no events use it yet' : `${city.events} event${city.events === 1 ? ' uses' : 's use'} it`}
      </p>
      <CityForm city={city} submitLabel="Approve" withStatus={false} compact onSubmit={(b) => go(() => onApprove(b))} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end', marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--cr-hair)' }}>
        <CrField label="Or match to a listed city" htmlFor={`mg-${city.id}`}>
          <select id={`mg-${city.id}`} className="cr-input" value={into} onChange={(e) => setInto(e.target.value)} style={{ minWidth: 220 }}>
            <option value="">Choose a city</option>
            {active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </CrField>
        <button type="button" className="cr-btn" disabled={!into || busy} onClick={() => {
          const target = active.find((a) => a.id === into)?.name ?? into;
          const what = city.events ? `Move ${city.events} event${city.events === 1 ? '' : 's'} from ${city.name} to ${target}` : `Match ${city.name} to ${target}`;
          if (window.confirm(`${what}? ${city.name} becomes another spelling of ${target}. This can't be undone from this page.`)) void go(() => onMerge(into));
        }}>Match and move events</button>
        <button type="button" className="cr-btn" style={{ ...crDangerBtn, marginLeft: 'auto' }} disabled={busy} onClick={() => {
          if (window.confirm(`Decline ${city.name}? The organizer won't be able to ask for it again.`)) void go(onDecline);
        }}>Decline</button>
      </div>
    </div>
  );
}
