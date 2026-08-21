'use client';

/* PR-BS89 · Control-Room console — ACCESS, ported from the legacy
   dashboard/sections/access-section.tsx onto the CR primitives.

   Re-skin, NOT new logic. Same endpoint:
     POST /api/password { current, next }
   Minimum 8 characters, enforced client-side (as before) and by the API. */

import { useState, type FormEvent } from 'react';
import { adminApi, errText } from '../../dashboard/admin-kit';
import { AdminConsoleShell } from '../console-shell';
import { ConsoleToastProvider, CrField, CrSectionHead, crPrimaryBtn, useConsoleToast } from '../console-kit';

export default function AdminAccessClient() {
  return (
    <ConsoleToastProvider>
      <AccessInner />
    </ConsoleToastProvider>
  );
}

function AccessInner() {
  const toast = useConsoleToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await adminApi('/api/password', { method: 'POST', body: JSON.stringify({ current, next }) });
      toast('Password updated');
      setCurrent('');
      setNext('');
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminConsoleShell title="Access">
      <div className="cr-stack">
        <CrSectionHead title="Access" hint="Change the control room password. Minimum 8 characters." />
        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Control room password
            </h2>
          </div>
          <form onSubmit={submit} style={{ maxWidth: 420, display: 'grid', gap: 14 }}>
            <CrField label="Current password" htmlFor="p-current">
              <input
                id="p-current"
                className="cr-input"
                type="password"
                autoComplete="current-password"
                required
                value={current}
                disabled={busy}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </CrField>
            <CrField label="New password" htmlFor="p-next">
              <input
                id="p-next"
                className="cr-input"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={next}
                disabled={busy}
                onChange={(e) => setNext(e.target.value)}
              />
            </CrField>
            <button className="cr-btn" style={{ ...crPrimaryBtn, width: 'fit-content' }} type="submit" disabled={busy}>
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </section>
      </div>
    </AdminConsoleShell>
  );
}
