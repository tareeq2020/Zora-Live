'use client';

/* PR-BS36 — PAYMENTS section: currency rate + which methods checkout offers.
   BS150: no provider routing. x-bridge picks the network and credentials behind
   each method, so there is nothing to choose here. */

import { useEffect, useState, type FormEvent } from 'react';
import { AdminCard, AdminError, AdminSkeleton, adminApi, errText, useAdminResource, useJsonLoader, useToast } from '../admin-kit';

const METHODS = [
  ['mobile', 'Mobile money'],
  ['billpay', 'Bill pay'],
  ['card', 'Card'],
] as const;

type MethodsEnabled = Partial<Record<'mobile' | 'billpay' | 'card', boolean>>;
type Settings = { methodsEnabled?: MethodsEnabled; usdRate?: number };

export function PaymentsSection() {
  const toast = useToast();
  const loader = useJsonLoader<Settings>('/api/settings');
  const res = useAdminResource(loader);
  const [methodsEnabled, setMethodsEnabled] = useState<Record<'mobile' | 'billpay' | 'card', boolean>>({
    mobile: true,
    billpay: true,
    card: true,
  });
  const [savingMethods, setSavingMethods] = useState(false);
  const [usdRate, setUsdRate] = useState<string>(''); // BS87: global USD→TZS rate
  const [savingRate, setSavingRate] = useState(false);

  useEffect(() => {
    if (res.status !== 'ready' || !res.data) return;
    const me = res.data.methodsEnabled || {};
    setMethodsEnabled({ mobile: me.mobile !== false, billpay: me.billpay !== false, card: me.card !== false });
    if (res.data.usdRate != null) setUsdRate(String(res.data.usdRate));
  }, [res.status, res.data]);

  // BS87: the global USD→TZS rate (Option B). Organizers price in USD; buyers are
  // charged TZS = round(usd * this rate). Zora admin owns it.
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

  // BS47: one toggle -> one PUT, merged server-side onto the existing map, so
  // flipping "card" off doesn't require resubmitting mobile/billpay's state.
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

  return (
    <>
      <div className="sec-h">
        <h2>Currency</h2>
        <p className="hint">
          The global USD → TZS rate. Organizers price tiers in USD; buyers are charged
          TZS = price × this rate. New/edited drops use the current rate; live drops keep
          their price until re-saved.
        </p>
      </div>
      <form onSubmit={saveRate} style={{ marginBottom: 28 }}>
        <div className="grid3">
          <div className="field">
            <label>USD → TZS RATE</label>
            <input className="in" type="number" min={1} value={usdRate} onChange={(e) => setUsdRate(e.target.value)} placeholder="2700" />
          </div>
        </div>
        <button className="btn" type="submit" disabled={savingRate}>{savingRate ? 'Saving…' : 'Save rate'}</button>
      </form>

      <div className="sec-h">
        <h2>Payment methods</h2>
        <p className="hint">
          x-bridge picks the network and credentials behind each method. Here you only choose which methods
          checkout offers.
        </p>
      </div>

      <AdminCard title="ACTIVE PAYMENT METHODS">
        {res.status === 'loading' && !res.loaded ? <AdminSkeleton rows={2} /> : null}
        {res.status === 'error' && !res.loaded ? <AdminError message={res.error} onRetry={res.reload} /> : null}
        {res.loaded ? (
          <>
            <p className="hint" style={{ margin: '0 0 14px' }}>
              Which methods the customer-facing checkout offers. Turning one off pulls it off the storefront. At
              least one method must stay on.
            </p>
            <div className="grid3">
              {METHODS.map(([m, label]) => (
                <label className="field" key={m} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    checked={methodsEnabled[m]}
                    disabled={savingMethods}
                    onChange={(e) => toggleMethod(m, e.target.checked)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </>
        ) : null}
      </AdminCard>

    </>
  );
}
