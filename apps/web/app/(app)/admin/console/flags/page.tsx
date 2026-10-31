'use client';

/* BS140: feature flags (Web Premium v1). Turns each release on globally or for
   pilot organizers / events. Reads the full rules from GET /api/settings/flags
   (admin) and saves through the validated PUT /api/settings/flags. */

import { useCallback, useEffect, useState } from 'react';
import { AdminConsoleShell } from '../console-shell';
import { crPrimaryBtn } from '../console-kit';

const FLAGS: { id: string; label: string; hint: string }[] = [
  { id: 'zp_look_v2', label: 'New look', hint: 'R1 · ZoraPass design on buyer pages' },
  { id: 'zp_checkout_v2', label: 'Checkout v2', hint: 'R2 · summary column, 2 steps, method groups' },
  { id: 'zp_seatmap', label: 'Seat maps', hint: 'R3 · buyer seat picking (needs a published seat map)' },
  { id: 'zp_analytics', label: 'Storefront analytics', hint: 'R4 · organizer analytics page' },
  { id: 'zp_pass_design', label: 'Branded passes', hint: 'R4 · pass design tab + branded passes' },
  { id: 'zp_installments', label: 'Installments', hint: 'R5 · keep OFF until x-bridge /v1 is live' },
];

type Rule = { on?: boolean; orgs?: string[]; events?: string[] };
type Rules = Record<string, Rule>;
const list = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

export default function FlagsPage() {
  const [rules, setRules] = useState<Rules>({});
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await fetch('/api/settings/flags', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      setRules(d?.flags && typeof d.flags === 'object' ? d.flags : {});
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (id: string, patch: Rule) => setRules((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));

  const save = async () => {
    setState('saving');
    try {
      const r = await fetch('/api/settings/flags', {
        method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ flags: rules }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setRules((await r.json()).flags ?? rules);
      setState('saved');
    } catch {
      setState('error');
    }
  };

  return (
    <AdminConsoleShell title="Feature flags">
      <section className="cr-panel">
        <div className="cr-panel-head"><h2 className="cr-section-h">Releases</h2></div>
        {state === 'error' && <p role="alert" style={{ color: 'var(--cr-red)' }}>Couldn&apos;t load or save flags. The API may need a redeploy. <button type="button" className="cr-linkbtn" onClick={load}>Try again</button></p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {FLAGS.map((f) => {
            const r = rules[f.id] ?? {};
            return (
              <fieldset key={f.id} style={{ border: '1px solid var(--cr-hair)', borderRadius: 12, padding: 16, margin: 0, display: 'grid', gap: 10 }}>
                <legend style={{ fontWeight: 700, padding: '0 6px' }}>{f.label}</legend>
                <span style={{ fontSize: 13, color: 'var(--cr-ink2)' }}>{f.hint}</span>
                <label style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 44 }}>
                  <input type="checkbox" checked={r.on === true} onChange={(e) => set(f.id, { on: e.target.checked })} style={{ width: 20, height: 20 }} />
                  On for everyone
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12 }}>PILOT ORGANIZERS (handles, comma separated)</span>
                  <input className="cr-input" defaultValue={(r.orgs ?? []).join(', ')} key={`${f.id}-o-${(r.orgs ?? []).join()}`} onBlur={(e) => set(f.id, { orgs: list(e.target.value) })} placeholder="thebrunchcity" />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontFamily: 'var(--cr-mono)', fontSize: 12 }}>PILOT EVENTS (event ids)</span>
                  <input className="cr-input" defaultValue={(r.events ?? []).join(', ')} key={`${f.id}-e-${(r.events ?? []).join()}`} onBlur={(e) => set(f.id, { events: list(e.target.value) })} placeholder="brunch-vol-09" />
                </label>
              </fieldset>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
          <button type="button" className="cr-btn" style={crPrimaryBtn} onClick={save} disabled={state === 'saving' || state === 'loading'}>
            {state === 'saving' ? 'Saving…' : 'Save flags'}
          </button>
          {state === 'saved' && <span role="status" style={{ fontSize: 14 }}>Saved. Changes reach buyers within a few seconds.</span>}
        </div>
      </section>
    </AdminConsoleShell>
  );
}
