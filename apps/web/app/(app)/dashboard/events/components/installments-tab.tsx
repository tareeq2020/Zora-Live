'use client';

/* BS136 (F7) — the organizer "Installments" tab (OrgInstallSettings mockup).

   GET /api/org/events/:id/installments → the offer (or defaults), the event's
       tiers + date + fee rate, and `enabled` (zp_installments for this org/event)
   PUT /api/org/events/:id/installments → save; the server validates exactly
       what the DB CHECKs allow (2–6 payments, one of % | TSh, grace 0–30 …)

   The buyer preview runs the SAME schedule maths the checkout uses
   (@zora/core/installments — pure, no I/O), so what the organizer sees here is
   what a buyer buying one pass today would be offered. The missed-payment rule
   is the ZoraPass default (release + refund minus the service fee) and is shown
   read-only: it is the only rule the backend implements. */

import { useEffect, useMemo, useState } from 'react';
import {
  buildSchedule, finalDueFor, eatToday, addDays, addMonths,
  INSTALLMENT_MIN_COUNT, INSTALLMENT_MAX_COUNT, type InstallmentFrequency,
} from '@zora/core/installments';

type Tier = { id: string; name: string; price: number | null; currency: string; feePassed: boolean };
type Config = {
  enabled: boolean; tiers: string[]; depositPct: number | null; depositAmount: number | null;
  count: number; frequency: InstallmentFrequency; finalDueDaysBeforeEvent: number; graceDays: number;
};
type Loaded = { enabled: boolean; eventDate: string | null; feeRate: number; tiers: Tier[]; config: Config };

const FREQ: { id: InstallmentFrequency; label: string }[] = [
  { id: 'biweekly', label: 'Every 2 weeks' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

const ERR: Record<string, string> = {
  count_range: `Choose ${INSTALLMENT_MIN_COUNT} to ${INSTALLMENT_MAX_COUNT} payments.`,
  deposit_one_of_pct_or_amount: 'Set the deposit as a percentage or a TSh amount.',
  deposit_pct_range: 'The deposit must be more than 0% and less than 100%.',
  deposit_amount_invalid: 'The deposit must be a whole TSh amount above 0.',
  frequency_invalid: 'Pick how often buyers pay.',
  final_due_days_range: 'The last payment must be 0 to 365 days before the event.',
  grace_days_range: 'Grace must be 0 to 30 days.',
  unknown_tier: 'One of those passes no longer exists. Reload and try again.',
  feature_off: 'Installments are not switched on for this event yet.',
};

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const parts = (d: string) => { const t = new Date(d + 'T00:00:00Z'); return { dow: DOW[t.getUTCDay()], day: t.getUTCDate(), mon: MON[t.getUTCMonth()] }; };
/** Mono label: SAT 31 OCT */
export const monoDate = (d: string) => { const p = parts(d); return `${p.dow} ${p.day} ${p.mon}`; };
/** Prose: 31 Oct */
const proseDate = (d: string) => { const p = parts(d); return `${p.day} ${p.mon[0]}${p.mon.slice(1).toLowerCase()}`; };
const money = (n: number, cur = 'TZS') => `${cur === 'TZS' ? 'TSh' : cur} ${Math.round(n).toLocaleString('en-US')}`;
const int = (s: string) => (s.trim() === '' ? NaN : Number(s));

/** The last purchase date whose schedule still ends on or before finalDue. */
function lastFittingStart(finalDue: string, count: number, f: InstallmentFrequency): string {
  const k = count - 1;
  if (f === 'weekly') return addDays(finalDue, -7 * k);
  if (f === 'biweekly') return addDays(finalDue, -14 * k);
  return addMonths(finalDue, -k);
}

export default function InstallmentsTab({ eventId, eventName }: { eventId: string; eventName: string }) {
  const base = `/api/org/events/${encodeURIComponent(eventId)}/installments`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [tiers, setTiers] = useState<string[]>([]);
  const [mode, setMode] = useState<'pct' | 'amount'>('pct');
  const [deposit, setDeposit] = useState('33');
  const [count, setCount] = useState(3);
  const [frequency, setFrequency] = useState<InstallmentFrequency>('biweekly');
  const [finalDays, setFinalDays] = useState('7');
  const [grace, setGrace] = useState('2');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(base, { cache: 'no-store' })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as Loaded | null;
        if (!alive) return;
        if (!r.ok || !d) { setErr('Could not load installments. Try again.'); return; }
        setLoaded(d);
        const c = d.config;
        setEnabled(c.enabled);
        // An empty list means every pass — show them all ticked.
        setTiers(c.tiers.length ? c.tiers : d.tiers.map((t) => t.id));
        setMode(c.depositAmount != null ? 'amount' : 'pct');
        setDeposit(String(c.depositAmount ?? c.depositPct ?? 33));
        setCount(c.count);
        setFrequency(c.frequency);
        setFinalDays(String(c.finalDueDaysBeforeEvent));
        setGrace(String(c.graceDays));
      })
      .catch(() => alive && setErr('Could not load installments. Try again.'));
    return () => { alive = false; };
  }, [base]);

  const touch = () => { setMsg(''); setErr(''); };

  const sample = useMemo(() => {
    if (!loaded) return null;
    const t = loaded.tiers.find((x) => tiers.includes(x.id) && x.price != null) ?? null;
    if (!t || t.price == null) return null;
    const fee = t.feePassed ? Math.round(t.price * (loaded.feeRate || 0)) : 0;
    return { tier: t, total: t.price + fee };
  }, [loaded, tiers]);

  const finalDue = loaded?.eventDate ? finalDueFor(loaded.eventDate, int(finalDays)) : null;
  const today = eatToday();
  const schedule = useMemo(() => {
    if (!sample || !finalDue) return null;
    const dep = int(deposit);
    return buildSchedule({
      total: sample.total,
      depositPct: mode === 'pct' ? dep : null,
      depositAmount: mode === 'amount' ? dep : null,
      count, frequency, today, finalDue,
    });
  }, [sample, finalDue, deposit, mode, count, frequency, today]);

  const cutoff = finalDue ? lastFittingStart(finalDue, count, frequency) : null;
  const firstLate = cutoff ? addDays(cutoff, 1) : null;

  async function save() {
    if (!loaded) return;
    touch();
    const dep = int(deposit);
    const allTiers = loaded.tiers.map((t) => t.id);
    const body = {
      enabled,
      // Every pass ticked = an empty list, so passes added later are covered too.
      tiers: tiers.length === allTiers.length ? [] : tiers,
      depositPct: mode === 'pct' ? dep : null,
      depositAmount: mode === 'amount' ? dep : null,
      count, frequency,
      finalDueDaysBeforeEvent: int(finalDays),
      graceDays: int(grace),
      defaultRule: 'refund_minus_service_fee',
    };
    if (enabled && !tiers.length) { setErr('Pick at least one pass.'); return; }
    setBusy(true);
    try {
      const r = await fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const first = Array.isArray(d.errors) ? d.errors[0] : d.error;
        setErr(ERR[first] || 'That didn’t save. Try again.');
        return;
      }
      setMsg(enabled ? 'Saved. Buyers see installments for the passes you picked.' : 'Saved. Installments are off for this event.');
    } catch {
      setErr('That didn’t save. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <div className="zp-inst">
        <style dangerouslySetInnerHTML={{ __html: STYLE }} />
        <p className="in-note">{err || 'Loading…'}</p>
      </div>
    );
  }

  const cur = sample?.tier.currency || 'TZS';
  const toggleTier = (id: string) => { touch(); setTiers((ts) => (ts.includes(id) ? ts.filter((x) => x !== id) : [...ts, id])); };

  return (
    <div className="zp-inst">
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <header className="in-head">
        <h2>{eventName || 'Installments'}</h2>
        <button type="button" className="in-save" onClick={save} disabled={busy || !loaded.enabled}>
          {busy ? 'SAVING…' : 'SAVE'}
        </button>
      </header>
      {!loaded.enabled ? <p className="in-err" role="status">{ERR.feature_off}</p> : null}
      {err ? <p className="in-err" role="alert">{err}</p> : null}
      {msg ? <p className="in-ok" role="status">{msg}</p> : null}

      <div className="in-grid">
        <section className="in-form">
          <label className="in-toggle">
            <input type="checkbox" role="switch" checked={enabled} onChange={(e) => { touch(); setEnabled(e.target.checked); }} />
            <span className="in-track" aria-hidden="true"><span /></span>
            <span className="in-tt">
              <span className="in-tt-h">Let buyers pay in installments</span>
              <span>Buyers pay a deposit now and the rest before the event. Passes are issued when fully paid.</span>
            </span>
          </label>

          <div className="in-sec">
            <span className="in-label">WHICH PASSES</span>
            <div className="in-tiers">
              {loaded.tiers.length ? loaded.tiers.map((t) => (
                <label key={t.id} className={tiers.includes(t.id) ? '' : 'off'}>
                  <input type="checkbox" checked={tiers.includes(t.id)} onChange={() => toggleTier(t.id)} />
                  {t.name}
                </label>
              )) : <span className="in-note">Add passes on the Details tab first.</span>}
            </div>
          </div>

          <div className="in-row3">
            <label className="in-field">
              <span className="in-label">DEPOSIT</span>
              <span className="in-inline">
                <input className="in-num" inputMode="numeric" value={deposit} aria-label="Deposit" onChange={(e) => { touch(); setDeposit(e.target.value.replace(/[^\d.]/g, '')); }} />
                <select value={mode} aria-label="Deposit type" onChange={(e) => { touch(); setMode(e.target.value as 'pct' | 'amount'); }}>
                  <option value="pct">% of total</option>
                  <option value="amount">TSh amount</option>
                </select>
              </span>
            </label>
            <div className="in-field">
              <span className="in-label" id="in-count-l">NUMBER OF PAYMENTS</span>
              <div className="in-step" role="group" aria-labelledby="in-count-l">
                <button type="button" aria-label="Fewer payments" disabled={count <= INSTALLMENT_MIN_COUNT} onClick={() => { touch(); setCount((c) => Math.max(INSTALLMENT_MIN_COUNT, c - 1)); }}>−</button>
                <span aria-live="polite">{count}</span>
                <button type="button" aria-label="More payments" disabled={count >= INSTALLMENT_MAX_COUNT} onClick={() => { touch(); setCount((c) => Math.min(INSTALLMENT_MAX_COUNT, c + 1)); }}>+</button>
              </div>
            </div>
            <label className="in-field">
              <span className="in-label">HOW OFTEN</span>
              <select value={frequency} onChange={(e) => { touch(); setFrequency(e.target.value as InstallmentFrequency); }}>
                {FREQ.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
          </div>

          <div className="in-row2">
            <label className="in-field">
              <span className="in-label">LAST PAYMENT DUE</span>
              <span className="in-inline">
                <input className="in-num sm" inputMode="numeric" value={finalDays} aria-label="Days before the event" onChange={(e) => { touch(); setFinalDays(e.target.value.replace(/\D/g, '')); }} />
                <span>days before the event{finalDue ? <> · <span className="in-mono">{monoDate(finalDue)}</span></> : null}</span>
              </span>
            </label>
            <label className="in-field">
              <span className="in-label">GRACE AFTER A MISSED DATE</span>
              <span className="in-inline">
                <input className="in-num sm" inputMode="numeric" value={grace} aria-label="Grace days" onChange={(e) => { touch(); setGrace(e.target.value.replace(/\D/g, '')); }} />
                <span>days</span>
              </span>
            </label>
          </div>

          <fieldset className="in-rule">
            <legend>IF A BUYER DOESN&apos;T FINISH PAYING</legend>
            <label>
              <input type="radio" checked readOnly disabled />
              <span>Release their passes and refund what they paid, minus the service fee</span>
            </label>
            <span className="in-fine">Buyers see this rule before they pay. ZoraPass default: refund minus the service fee.</span>
          </fieldset>
          <span className="in-note">Reminders go by SMS and email 3 days before each date, on the day, and if a date is missed. Money is available to withdraw as each payment clears.</span>
        </section>

        <aside className="in-aside">
          <span className="in-label">WHAT A BUYER SEES{sample ? ` · ${sample.tier.name.toUpperCase()} × 1` : ''}</span>
          <div className="in-card">
            <span className="in-card-h">Pay in installments</span>
            {!loaded.eventDate ? (
              <span className="in-note">Set the event date on the Details tab to see the schedule.</span>
            ) : !sample ? (
              <span className="in-note">Pick a pass with a price to see the schedule.</span>
            ) : schedule && schedule.ok ? (
              <>
                {schedule.rows.map((r) => (
                  <div key={r.n} className={'in-srow' + (r.n === 1 ? ' now' : '')}>
                    <span>{r.n === 1 ? 'TODAY' : monoDate(r.dueDate)}</span>
                    <span>{money(r.amount, cur)}</span>
                  </div>
                ))}
                <span className="in-note">
                  Total {money(sample.total, cur)} incl. fees. Last payment {int(finalDays)} day{int(finalDays) === 1 ? '' : 's'} before the event.
                </span>
              </>
            ) : (
              <span className="in-note">{schedule?.message || 'Check the numbers on the left.'}</span>
            )}
          </div>
          {finalDue && cutoff && firstLate && loaded.eventDate && firstLate <= loaded.eventDate ? (
            <div className="in-heads" role="status">
              <strong>Heads up:</strong>{' '}
              {cutoff < today
                ? `no buyer can fit ${count} payments before ${proseDate(finalDue)} any more. They'll be offered pay in full only.`
                : `buyers from ${proseDate(firstLate)} onward won't fit ${count} payments before ${proseDate(finalDue)}. They'll be offered pay in full only.`}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

const STYLE = `
.zp-inst{--in-ink:#111111;--in-paper:#F7F5EE;--in-card:#FFFFFF;--in-line:#D9D6CC;--in-mut:#4A4A4A;
  max-width:1200px;margin:16px auto 40px;background:var(--in-paper);color:var(--in-ink);border-radius:16px;padding:24px 28px;
  font-family:var(--zp-font-sans);box-sizing:border-box}
.zp-inst *{box-sizing:border-box}
.zp-inst .in-head{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.zp-inst .in-head h2{margin:0;font-size:28px;font-weight:800;letter-spacing:-.02em;flex:1 1 240px;min-width:0}
.zp-inst .in-save{height:48px;padding:0 20px;border-radius:16px;border:none;background:var(--in-ink);color:#FFD21F;font-family:var(--zp-font-display);font-size:20px;cursor:pointer}
.zp-inst button:disabled{opacity:.5;cursor:default}
.zp-inst button:focus-visible,.zp-inst input:focus-visible,.zp-inst select:focus-visible{outline:3px solid #1597D4;outline-offset:2px}
.zp-inst .in-err,.zp-inst .in-ok{margin:14px 0 0;padding:10px 14px;border-radius:12px;font-size:14px;background:var(--in-card);border-left:4px solid #B42318}
.zp-inst .in-ok{border-left-color:#0F7B3F}
.zp-inst .in-grid{display:flex;gap:40px;align-items:flex-start;margin-top:28px}
.zp-inst .in-form{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:18px}
.zp-inst .in-label{font-family:var(--zp-font-mono);font-size:12px;letter-spacing:.12em}
.zp-inst .in-note{font-size:13px;color:var(--in-mut)}
.zp-inst .in-fine{font-size:13px;color:#3A3A3A}
.zp-inst .in-mono{font-family:var(--zp-font-mono)}
.zp-inst .in-toggle{display:flex;gap:14px;align-items:center;background:var(--in-card);border:2px solid var(--in-ink);border-radius:16px;padding:16px 18px;cursor:pointer;position:relative}
.zp-inst .in-toggle input{position:absolute;opacity:0;width:1px;height:1px}
.zp-inst .in-track{width:52px;height:30px;border-radius:999px;background:var(--in-line);position:relative;flex:none;transition:background .15s}
.zp-inst .in-track span{position:absolute;left:3px;top:3px;width:24px;height:24px;border-radius:999px;background:var(--in-card);transition:left .15s}
.zp-inst .in-toggle input:checked + .in-track{background:var(--in-ink)}
.zp-inst .in-toggle input:checked + .in-track span{left:25px;background:#FFD21F}
.zp-inst .in-toggle input:focus-visible + .in-track{outline:3px solid #1597D4;outline-offset:2px}
.zp-inst .in-tt{flex:1;display:flex;flex-direction:column}
.zp-inst .in-tt-h{font-weight:700;font-size:18px}
.zp-inst .in-tt>span:last-child{font-size:14px;color:var(--in-mut)}
.zp-inst .in-sec{display:flex;flex-direction:column;gap:8px}
.zp-inst .in-tiers{display:flex;gap:18px;flex-wrap:wrap;font-size:15px}
.zp-inst .in-tiers label{display:flex;gap:8px;align-items:center;min-height:44px;cursor:pointer}
.zp-inst .in-tiers label.off{color:var(--in-mut)}
.zp-inst .in-tiers input{width:20px;height:20px;accent-color:var(--in-ink)}
.zp-inst .in-row3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.zp-inst .in-row2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.zp-inst .in-field{display:flex;flex-direction:column;gap:6px}
.zp-inst .in-inline{display:flex;gap:8px;align-items:center;font-size:15px;flex-wrap:wrap}
.zp-inst .in-num{height:48px;width:90px;border-radius:12px;border:2px solid var(--in-line);padding:0 12px;font-size:16px;font-family:var(--zp-font-mono);background:var(--in-card);color:var(--in-ink)}
.zp-inst .in-num.sm{width:70px}
.zp-inst select{height:48px;border-radius:12px;border:2px solid var(--in-line);padding:0 10px;font-size:16px;font-family:var(--zp-font-sans);background:var(--in-card);color:var(--in-ink)}
.zp-inst .in-step{display:flex;align-items:center;border:2px solid var(--in-ink);border-radius:12px;overflow:hidden;width:max-content;background:var(--in-card)}
.zp-inst .in-step button{width:48px;height:44px;border:none;background:var(--in-card);color:var(--in-ink);font-size:20px;cursor:pointer}
.zp-inst .in-step span{width:48px;text-align:center;font-family:var(--zp-font-mono);font-size:18px;font-weight:600}
.zp-inst .in-rule{margin:0;padding:16px 18px;border:1px solid var(--in-line);border-radius:16px;background:var(--in-card);display:flex;flex-direction:column;gap:10px}
.zp-inst .in-rule legend{font-family:var(--zp-font-mono);font-size:12px;letter-spacing:.12em;padding:0 6px}
.zp-inst .in-rule label{display:flex;gap:10px;align-items:flex-start;font-size:15px}
.zp-inst .in-rule input{accent-color:var(--in-ink);width:18px;height:18px;margin-top:2px}
.zp-inst .in-aside{width:380px;flex:none;display:flex;flex-direction:column;gap:12px;position:sticky;top:16px}
.zp-inst .in-card{background:var(--in-card);border:2px solid var(--in-ink);border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:10px}
.zp-inst .in-card-h{font-weight:700;font-size:18px}
.zp-inst .in-srow{display:flex;justify-content:space-between;font-family:var(--zp-font-mono);font-size:15px;background:var(--in-paper);border-radius:10px;padding:10px 12px}
.zp-inst .in-srow.now{background:#FFD21F}
.zp-inst .in-heads{background:var(--in-paper);border:2px solid var(--in-ink);border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.4}
@media (max-width:960px){
  .zp-inst{padding:20px 16px;margin:12px 0 32px}
  .zp-inst .in-grid{flex-direction:column}
  .zp-inst .in-aside{width:100%;position:static}
  .zp-inst .in-row3,.zp-inst .in-row2{grid-template-columns:1fr}
}
`;
