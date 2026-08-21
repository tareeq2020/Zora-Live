'use client';

/* PR-BS89 · Control-Room console — PAYMENTS ROUTING, ported from the legacy
   dashboard/sections/payments-section.tsx onto the CR primitives.

   Re-skin, NOT new logic. All three controls the legacy section owned, same
   endpoints:
     · Currency USD→TZS rate  GET /api/settings.usdRate · PUT /api/settings/usd-rate { usdRate }
     · Methods-enabled toggles GET /api/settings.methodsEnabled · PUT /api/settings/methods-enabled { methodsEnabled:{ [m]:bool } }
     · FSP routing map         GET /api/settings.fspRouteMap · PUT /api/settings/fsp-routing { fspRouteMap }

   Rules preserved (and enforced again server-side): methods mobile/billpay/card
   each with a default FSP; mobile takes per-network overrides (blank = mobile
   default, omitted from the payload); GODIGITAL is MOBILE-ONLY. Defaults when
   unset: mobile CLICKPESA, billpay CLICKPESA, card SELCOM. The routing form
   always submits the complete intended map (the API replaces it wholesale). */

import { useEffect, useState, type FormEvent } from 'react';
import { adminApi, errText, useAdminResource, useJsonLoader } from '../../dashboard/admin-kit';
import { AdminConsoleShell } from '../console-shell';
import { ConsoleToastProvider, CrField, CrSectionHead, crPrimaryBtn, useConsoleToast } from '../console-kit';

const MNOS = [
  ['VODACOM', 'M-PESA (VODACOM)'],
  ['TIGO', 'MIXX BY YAS (TIGO)'],
  ['AIRTEL', 'AIRTEL MONEY (AIRTEL)'],
  ['HALOTEL', 'HALOPESA (HALOTEL)'],
] as const;

const MOBILE_FSPS = ['CLICKPESA', 'SELCOM', 'GODIGITAL'] as const; // GODIGITAL: mobile only
const CARD_FSPS = ['CLICKPESA', 'SELCOM'] as const;

const METHODS = [
  ['mobile', 'Mobile money'],
  ['billpay', 'Bill pay'],
  ['card', 'Card'],
] as const;

type RouteMap = Record<string, Record<string, string>>;
type MethodsEnabled = Partial<Record<'mobile' | 'billpay' | 'card', boolean>>;
type Settings = { fspRouteMap?: RouteMap; methodsEnabled?: MethodsEnabled; usdRate?: number };

type FormState = {
  mobileDefault: string;
  billpayDefault: string;
  cardDefault: string;
  overrides: Record<string, string>;
};

const EMPTY: FormState = { mobileDefault: 'CLICKPESA', billpayDefault: 'CLICKPESA', cardDefault: 'SELCOM', overrides: {} };

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
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [methodsEnabled, setMethodsEnabled] = useState<Record<'mobile' | 'billpay' | 'card', boolean>>({ mobile: true, billpay: true, card: true });
  const [savingMethods, setSavingMethods] = useState(false);
  const [usdRate, setUsdRate] = useState<string>('');
  const [savingRate, setSavingRate] = useState(false);

  useEffect(() => {
    if (res.status !== 'ready' || !res.data) return;
    const m = res.data.fspRouteMap || {};
    const overrides: Record<string, string> = {};
    MNOS.forEach(([n]) => (overrides[n] = m.mobile?.[n] || ''));
    setForm({
      mobileDefault: m.mobile?.default || 'CLICKPESA',
      billpayDefault: m.billpay?.default || 'CLICKPESA',
      cardDefault: m.card?.default || 'SELCOM',
      overrides,
    });
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

  async function save(e: FormEvent) {
    e.preventDefault();
    const mobile: Record<string, string> = { default: form.mobileDefault };
    MNOS.forEach(([n]) => {
      const v = form.overrides[n];
      if (v) mobile[n] = v;
    });
    const fspRouteMap: RouteMap = {
      mobile,
      billpay: { default: form.billpayDefault },
      card: { default: form.cardDefault },
    };
    setSaving(true);
    try {
      await adminApi('/api/settings/fsp-routing', { method: 'PUT', body: JSON.stringify({ fspRouteMap }) });
      toast('Payment routing saved');
      res.reload();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setSaving(false);
    }
  }

  const loading = res.status === 'loading' && !res.loaded;
  const errored = res.status === 'error' && !res.loaded;

  return (
    <AdminConsoleShell title="Payments routing">
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
          title="Payments routing"
          hint="Which financial-service-provider the x-bridge gateway uses per method. Mobile money can be overridden per network (blank = use the mobile default). Card & bill-pay support CLICKPESA / SELCOM. GODIGITAL is mobile-only."
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
                Which methods the customer-facing checkout offers. Turning one off doesn&apos;t touch its FSP routing below — it just pulls it off the
                storefront. At least one method must stay on.
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

        {/* ── FSP routing ── */}
        <section className="cr-panel">
          <div className="cr-panel-head">
            <h2 className="cr-section-h" style={{ margin: 0 }}>
              FSP routing
            </h2>
          </div>
          {loading ? <div className="cr-cards" aria-busy="true"><span className="cr-skel" style={{ height: 120, borderRadius: 12 }} /></div> : null}
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
            <form onSubmit={save}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <CrField label="Mobile money — default" htmlFor="fsp-mobile">
                  <select id="fsp-mobile" className="cr-select" value={form.mobileDefault} disabled={saving} onChange={(e) => setForm({ ...form, mobileDefault: e.target.value })}>
                    {MOBILE_FSPS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </CrField>
                <CrField label="Bill pay — default" htmlFor="fsp-billpay">
                  <select id="fsp-billpay" className="cr-select" value={form.billpayDefault} disabled={saving} onChange={(e) => setForm({ ...form, billpayDefault: e.target.value })}>
                    {CARD_FSPS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </CrField>
                <CrField label="Card — default" htmlFor="fsp-card">
                  <select id="fsp-card" className="cr-select" value={form.cardDefault} disabled={saving} onChange={(e) => setForm({ ...form, cardDefault: e.target.value })}>
                    {CARD_FSPS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </CrField>
              </div>

              <p style={{ margin: '18px 0 12px', fontFamily: 'var(--cr-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--cr-mut)' }}>
                PER-NETWORK MOBILE OVERRIDES (OPTIONAL)
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                {MNOS.map(([n, l]) => (
                  <CrField key={n} label={l} htmlFor={'fsp-mno-' + n}>
                    <select
                      id={'fsp-mno-' + n}
                      className="cr-select"
                      value={form.overrides[n] || ''}
                      disabled={saving}
                      onChange={(e) => setForm({ ...form, overrides: { ...form.overrides, [n]: e.target.value } })}
                    >
                      <option value="">Use mobile default</option>
                      {MOBILE_FSPS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </CrField>
                ))}
              </div>

              <button className="cr-btn" style={{ ...crPrimaryBtn, marginTop: 18 }} type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save routing'}
              </button>
            </form>
          ) : null}
        </section>
      </div>
    </AdminConsoleShell>
  );
}
