'use client';

/* PR-BS36 — PAYMENTS ROUTING section (the BS29 panel), same endpoints:
     GET /api/settings                 -> settings.fspRouteMap
     PUT /api/settings/fsp-routing     -> { fspRouteMap }
   Rules preserved from BS29 and enforced again server-side:
     · methods: mobile / billpay / card, each with a default FSP
     · mobile takes per-network overrides (VODACOM/TIGO/AIRTEL/HALOTEL);
       blank = fall back to the mobile default (omitted from the payload)
     · GODIGITAL is MOBILE-ONLY — never offered for billpay or card
   Defaults when unset match the legacy panel exactly: mobile CLICKPESA,
   billpay CLICKPESA, card SELCOM. This form moves real money, so it always
   submits the complete intended map (the API replaces it wholesale). */

import { useEffect, useState, type FormEvent } from 'react';
import { AdminCard, AdminError, AdminSkeleton, adminApi, errText, useAdminResource, useJsonLoader, useToast } from '../admin-kit';

const MNOS = [
  ['VODACOM', 'M-PESA (VODACOM)'],
  ['TIGO', 'MIXX BY YAS (TIGO)'],
  ['AIRTEL', 'AIRTEL MONEY (AIRTEL)'],
  ['HALOTEL', 'HALOPESA (HALOTEL)'],
] as const;

const MOBILE_FSPS = ['CLICKPESA', 'SELCOM', 'GODIGITAL'] as const; // GODIGITAL: mobile only
const CARD_FSPS = ['CLICKPESA', 'SELCOM'] as const;

type RouteMap = Record<string, Record<string, string>>;
type Settings = { fspRouteMap?: RouteMap };

type FormState = {
  mobileDefault: string;
  billpayDefault: string;
  cardDefault: string;
  overrides: Record<string, string>;
};

const EMPTY: FormState = { mobileDefault: 'CLICKPESA', billpayDefault: 'CLICKPESA', cardDefault: 'SELCOM', overrides: {} };

export function PaymentsSection() {
  const toast = useToast();
  const loader = useJsonLoader<Settings>('/api/settings');
  const res = useAdminResource(loader);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

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
  }, [res.status, res.data]);

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

  return (
    <>
      <div className="sec-h">
        <h2>Payments routing</h2>
        <p className="hint">
          Which financial-service-provider the x-bridge gateway uses per method. Mobile money can be overridden per
          network (blank = use the mobile default). Card &amp; bill-pay support CLICKPESA / SELCOM. GODIGITAL is
          mobile-only.
        </p>
      </div>

      <AdminCard title="FSP ROUTING">
        {res.status === 'loading' && !res.loaded ? <AdminSkeleton rows={5} /> : null}
        {res.status === 'error' && !res.loaded ? <AdminError message={res.error} onRetry={res.reload} /> : null}
        {res.loaded ? (
          <form onSubmit={save}>
            <div className="grid3">
              <div className="field">
                <label htmlFor="fsp-mobile">MOBILE MONEY — DEFAULT</label>
                <select id="fsp-mobile" value={form.mobileDefault} disabled={saving} onChange={(e) => setForm({ ...form, mobileDefault: e.target.value })}>
                  {MOBILE_FSPS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="fsp-billpay">BILL PAY — DEFAULT</label>
                <select id="fsp-billpay" value={form.billpayDefault} disabled={saving} onChange={(e) => setForm({ ...form, billpayDefault: e.target.value })}>
                  {CARD_FSPS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="fsp-card">CARD — DEFAULT</label>
                <select id="fsp-card" value={form.cardDefault} disabled={saving} onChange={(e) => setForm({ ...form, cardDefault: e.target.value })}>
                  {CARD_FSPS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="hint" style={{ margin: '2px 0 16px' }}>
              Per-network mobile overrides (optional)
            </p>
            <div className="grid2">
              {MNOS.map(([n, l]) => (
                <div className="field" key={n}>
                  <label htmlFor={'fsp-mno-' + n}>{l}</label>
                  <select
                    id={'fsp-mno-' + n}
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
                </div>
              ))}
            </div>

            <button className="btn" type="submit" disabled={saving}>
              {saving ? 'SAVING…' : 'SAVE ROUTING'}
            </button>
          </form>
        ) : null}
      </AdminCard>
    </>
  );
}
