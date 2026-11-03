'use client';

/* PR-BS89 · Control-Room console — PAYMENTS.
     · Currency USD→TZS rate  GET /api/settings.usdRate · PUT /api/settings/usd-rate { usdRate }
     · Methods-enabled toggles GET /api/settings.methodsEnabled · PUT /api/settings/methods-enabled { methodsEnabled:{ [m]:bool } }

   BS150: no provider routing. x-bridge picks the network and credentials behind
   each method, so there is nothing to choose here. */

import { useEffect, useState, type FormEvent } from 'react';
import { adminApi, errText, useAdminResource, useJsonLoader } from '../../dashboard/admin-kit';
import { AdminConsoleShell } from '../console-shell';
import { ConsoleToastProvider, CrField, CrSectionHead, crPrimaryBtn, useConsoleToast } from '../console-kit';

const METHODS = [
  ['mobile', 'Mobile money'],
  ['billpay', 'Bill pay'],
  ['card', 'Card'],
] as const;

type MethodsEnabled = Partial<Record<'mobile' | 'billpay' | 'card', boolean>>;
type Settings = { methodsEnabled?: MethodsEnabled; usdRate?: number };

export default function AdminPaymentsClient() {
  return (
    <ConsoleToastProvider>
      <PaymentsInner />
    </ConsoleToastProvider>
  );
}

function PaymentsInner() {
  const toast = useConsoleToast();
  const loader = useJsonLoader<Settings>('/api/settings');
  const res = useAdminResource(loader);
  const [methodsEnabled, setMethodsEnabled] = useState<Record<'mobile' | 'billpay' | 'card', boolean>>({ mobile: true, billpay: true, card: true });
  const [savingMethods, setSavingMethods] = useState(false);
  const [usdRate, setUsdRate] = useState<string>('');
  const [savingRate, setSavingRate] = useState(false);

  useEffect(() => {
    if (res.status !== 'ready' || !res.data) return;
    const me = res.data.methodsEnabled || {};
    setMethodsEnabled({ mobile: me.mobile !== false, billpay: me.billpay !== false, card: me.card !== false });
    if (res.data.usdRate != null) setUsdRate(String(res.data.usdRate));
  }, [res.status, res.data]);

  async function saveRate(e: FormEvent) {
    e.preventDefault();
    const n = Number(usdRate);
    if (!Number.isFinite(n) || n <= 0) {
      toast('Enter a positive rate', true);
      return;
    }
    setSavingRate(true);
    try {
      await adminApi('/api/settings/usd-rate', { method: 'PUT', body: JSON.stringify({ usdRate: n }) });
      toast('USD rate saved — new saves price at ' + Math.round(n) + ' TZS/$');
      res.reload();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setSavingRate(false);
    }
  }

  async function toggleMethod(method: 'mobile' | 'billpay' | 'card', next: boolean) {
    const prev = methodsEnabled;
    setMethodsEnabled({ ...prev, [method]: next }); // optimistic
    setSavingMethods(true);
    try {
      await adminApi('/api/settings/methods-enabled', { method: 'PUT', body: JSON.stringify({ methodsEnabled: { [method]: next } }) });
      toast((next ? 'Enabled ' : 'Disabled ') + method);
    } catch (ex) {
      setMethodsEnabled(prev); // revert — the server refused (e.g. would disable every method)
      toast(errText(ex), true);
    } finally {
      setSavingMethods(false);
    }
  }

  const loading = res.status === 'loading' && !res.loaded;
  const errored = res.status === 'error' && !res.loaded;

  return (
    <AdminConsoleShell title="Payments">
      <div className="cr-stack">
        {/* ── Currency ── */}
        <section className="cr-panel">
          <CrSectionHead
            title="Currency"
            hint="The global USD → TZS rate. Organizers price tiers in USD; buyers are charged TZS = price × this rate. New/edited drops use the current rate; live drops keep their price until re-saved."
          />
          <form onSubmit={saveRate} style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <CrField label="USD → TZS rate" htmlFor="usd-rate" style={{ maxWidth: 220 }}>
              <input id="usd-rate" className="cr-input" type="number" min={1} value={usdRate} onChange={(e) => setUsdRate(e.target.value)} placeholder="2700" />
            </CrField>
            <button className="cr-btn" style={crPrimaryBtn} type="submit" disabled={savingRate}>
              {savingRate ? 'Saving…' : 'Save rate'}
            </button>
          </form>
        </section>

        <CrSectionHead
          title="Payment methods"
          hint="x-bridge picks the network and credentials behind each method. Here you only choose which methods checkout offers."
        />

        {/* ── Active payment methods ── */}
        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              Active payment methods
            </h2>
          </div>
          {loading ? <div className="cr-cards" aria-busy="true"><span className="cr-skel" style={{ height: 48, borderRadius: 12 }} /></div> : null}
          {errored ? (
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
          {res.loaded ? (
            <>
              <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--cr-ink2)' }}>
                Which methods the customer-facing checkout offers. Turning one off pulls it off the storefront. At least one method must stay on.
              </p>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {METHODS.map(([m, label]) => (
                  <label key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--cr-ink)' }}>
                    <input type="checkbox" checked={methodsEnabled[m]} disabled={savingMethods} onChange={(e) => toggleMethod(m, e.target.checked)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </>
          ) : null}
        </section>

      </div>
    </AdminConsoleShell>
  );
}
