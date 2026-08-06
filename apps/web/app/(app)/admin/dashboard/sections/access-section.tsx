'use client';

/* PR-BS36 — ACCESS section. The legacy password panel, same endpoint:
     POST /api/password { current, next }
   Minimum 8 characters, enforced client-side (as before) and by the API. */

import { useState, type FormEvent } from 'react';
import { AdminCard, adminApi, errText, useToast } from '../admin-kit';

export function AccessSection() {
  const toast = useToast();
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
    <>
      <div className="sec-h">
        <h2>Access</h2>
        <p className="hint">Change the control room password. Minimum 8 characters.</p>
      </div>
      <AdminCard title="CONTROL ROOM PASSWORD">
        <form onSubmit={submit} style={{ maxWidth: 420 }}>
          <div className="field">
            <label htmlFor="p-current">CURRENT PASSWORD</label>
            <input
              id="p-current"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              disabled={busy}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="p-next">NEW PASSWORD</label>
            <input
              id="p-next"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={next}
              disabled={busy}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'UPDATING…' : 'UPDATE PASSWORD'}
          </button>
        </form>
      </AdminCard>
    </>
  );
}
