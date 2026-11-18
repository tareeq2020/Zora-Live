'use client';

/* PR-BS89 · Control-Room console — PAYMENTS.
     · Currency USD→TZS rate  GET /api/settings.usdRate · PUT /api/settings/usd-rate { usdRate }
     · Methods-enabled toggles GET /api/settings.methodsEnabled · PUT /api/settings/methods-enabled { methodsEnabled:{ [m]:bool } }

   BS150: no provider routing. x-bridge picks the network and credentials behind
   each method, so there is nothing to choose here. */

import { useEffect, useState, type FormEvent } from 'react';
import { adminApi, errText, useAdminResource, useJsonLoader } from '../admin-kit';
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

        <CrossCheckPanel cardOn={methodsEnabled.card} />
      </div>
    </AdminConsoleShell>
  );
}

/* ── BS166: payment cross-check ─────────────────────────────────────────── */

type CrossRun = { id: number; kind: string; startedAt: string; finishedAt: string | null; checked: number; settled: number; flagged: number; errors: number; complete: boolean };
type CrossAlert = { kind: string; orderId: string | null; detail: string; at: string };
type CrossCheck = {
  runs: CrossRun[];
  lastRecheckAt: string | null;
  lastListAt: string | null;
  v1: boolean;
  card: { available: boolean; billingRequired: boolean; source: string };
  alerts: CrossAlert[];
};

const ALERT_LABEL: Record<string, string> = {
  gateway_mismatch: 'x-bridge disagrees',
  gateway_unknown_payment: 'Payment we have no record of',
  late_collection: 'Paid after the cart moved on',
  duplicate_collection: 'Paid twice',
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

function CrossCheckPanel({ cardOn }: { cardOn: boolean }) {
  const toast = useConsoleToast();
  const loader = useJsonLoader<CrossCheck>('/api/admin/payments/crosscheck');
  const res = useAdminResource(loader);
  const [running, setRunning] = useState<'recheck' | 'list' | null>(null);

  async function run(kind: 'recheck' | 'list') {
    setRunning(kind);
    try {
      const r = await adminApi<{ checked: number; settled: number; flagged: number; errors: number }>(
        '/api/admin/payments/crosscheck/run', { method: 'POST', body: JSON.stringify({ kind }) },
      );
      toast(`Checked ${r.checked} · fixed ${r.settled} · flagged ${r.flagged}${r.errors ? ` · ${r.errors} errors` : ''}`);
      res.reload();
    } catch (ex) {
      toast(errText(ex), true);
    } finally {
      setRunning(null);
    }
  }

  const d = res.data;
  return (
    <>
      <CrSectionHead
        title="Payment cross-check"
        hint="Finds payments x-bridge took that our records don't show as paid, and the reverse. Runs on its own: unpaid attempts are re-checked every 5 minutes for 7 days, and x-bridge's list of the last 72 hours is compared hourly."
      />
      <section className="cr-panel">
        {res.status === 'loading' && !res.loaded ? <span className="cr-skel" style={{ height: 48, borderRadius: 12 }} /> : null}
        {res.status === 'error' && !res.loaded ? (
          <div className="cr-error" role="alert">
            <strong>Couldn&apos;t load</strong>
            <span>{res.error}</span>
          </div>
        ) : null}
        {d ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <dl className="xc-kv">
              <div><dt>Card on x-bridge</dt><dd>{d.card.available ? `Available${d.card.billingRequired ? ' · billing address required' : ''}` : 'Not available'}{cardOn ? '' : ' · switched off here'}</dd></div>
              <div><dt>Re-check of unpaid attempts</dt><dd>{when(d.lastRecheckAt)}</dd></div>
              <div><dt>x-bridge list compared</dt><dd>{d.v1 ? when(d.lastListAt) : 'Needs a live x-bridge key'}</dd></div>
            </dl>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button className="cr-btn" type="button" disabled={!!running} onClick={() => run('recheck')}>
                {running === 'recheck' ? 'Checking…' : 'Re-check unpaid now'}
              </button>
              <button className="cr-btn" type="button" disabled={!!running || !d.v1} onClick={() => run('list')}>
                {running === 'list' ? 'Comparing…' : 'Compare x-bridge list now'}
              </button>
            </div>

            <div>
              <h3 className="xc-h">Needs a person (last 7 days)</h3>
              {d.alerts.length ? (
                <ul className="xc-list">
                  {d.alerts.map((a, i) => (
                    <li key={i}>
                      <span className="xc-kind">{ALERT_LABEL[a.kind] ?? a.kind}</span>
                      <span className="xc-detail">{a.detail}</span>
                      <span className="xc-at">{when(a.at)}</span>
                      {a.orderId ? <a className="xc-open" href={`/admin/console/orders/${a.orderId}`}>Open cart</a> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="xc-empty">Nothing to look at. x-bridge and our records agree.</p>
              )}
            </div>

            <div>
              <h3 className="xc-h">Recent runs</h3>
              {d.runs.length ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="xc-table">
                    <thead><tr><th>When</th><th>Pass</th><th>Checked</th><th>Fixed</th><th>Flagged</th><th>Errors</th></tr></thead>
                    <tbody>
                      {d.runs.slice(0, 12).map((r) => (
                        <tr key={r.id}>
                          <td>{when(r.startedAt)}</td>
                          <td>{r.kind === 'list' ? 'x-bridge list' : 'Re-check'}{r.complete ? '' : ' (cut short)'}</td>
                          <td>{r.checked}</td><td>{r.settled}</td><td>{r.flagged}</td><td>{r.errors}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="xc-empty">No runs yet.</p>
              )}
            </div>
          </div>
        ) : null}
        <style>{`
.xc-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:12px;margin:0}
.xc-kv dt{font-family:var(--cr-mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--cr-mut);margin:0 0 4px}
.xc-kv dd{margin:0;font-size:14px;color:var(--cr-ink)}
.xc-h{font-family:var(--cr-mono);font-size:12px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--cr-mut);margin:0 0 8px}
.xc-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.xc-list li{display:grid;grid-template-columns:minmax(0,180px) minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--cr-hair);font-size:14px}
.xc-list li:last-child{border-bottom:none}
@media(max-width:760px){.xc-list li{grid-template-columns:1fr}}
.xc-kind{font-weight:600;color:var(--cr-ink)}
.xc-detail{font-family:var(--cr-mono);font-size:12px;color:var(--cr-ink2);overflow-wrap:anywhere}
.xc-at{font-family:var(--cr-mono);font-size:12px;color:var(--cr-mut);white-space:nowrap}
.xc-open{display:inline-flex;align-items:center;min-height:44px;color:var(--cr-ink);text-decoration:underline;text-underline-offset:3px;white-space:nowrap}
.xc-empty{margin:0;font-size:14px;color:var(--cr-ink2)}
.xc-table{width:100%;border-collapse:collapse;font-size:13px}
.xc-table th{font-family:var(--cr-mono);font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--cr-mut);text-align:left;padding:6px 8px;border-bottom:1px solid var(--cr-hair)}
.xc-table td{padding:6px 8px;border-bottom:1px solid var(--cr-hair);font-family:var(--cr-mono);font-variant-numeric:tabular-nums;color:var(--cr-ink);white-space:nowrap}
`}</style>
      </section>
    </>
  );
}
