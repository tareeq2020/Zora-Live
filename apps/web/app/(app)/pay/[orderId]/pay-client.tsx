'use client';

/* BS134 — /pay/[orderId] (PassReserved mockup).

   Reads (all degrade: an API without these endpoints shows the "can't load" note):
     GET  /api/orders/:id/installments   plan + event + next due (buyer only; 401 → verify)
     POST /api/otp/request, /api/otp/verify   the existing consumer SMS-OTP sign-in
     POST /api/checkout/:id/pay          charges the NEXT unpaid row (server picks it)
     GET  /api/orders/:id/status         reconciles in-flight attempts; credentials once paid
   429 from pay (3 pushes / 10 min) → "Try again in N minutes".
   Copy: sentence-case states + mono labels, no chips, Bungee only on the 20px button. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { networkFromNumber } from '../../../components/checkout-flow-v2';
import { dayLabel, shortDay, daysUntil, moneyLabel, type ScheduleRow } from '../../../lib/installments';

type View = {
  orderId: string;
  orderStatus: string;
  eventId: string;
  eventName: string;
  venue: string | null;
  dateLabel: string | null;
  lines: { tier: string; name: string; quantity: number; seatLabels: string[] }[];
  passCount: number;
  serviceFee: number;
  refundDue: number;
  refundStatus: string;
  next: { n: number; dueDate: string; amount: number; status: string } | null;
  graceUntil: string | null;
  lastAttempt: { transactionId: string; n: number; status: string; createdAt: string } | null;
  plan: {
    status: string;
    total: number;
    currency: string;
    paid: number;
    outstanding: number;
    paidCount: number;
    count: number;
    finalDue: string;
    graceDays: number;
    schedule: ScheduleRow[];
  };
  phone: string | null;
};
type Method = 'mobile' | 'billpay' | 'card';
type Notice = { kind: 'error' | 'info'; text: string } | null;

const POLL_MS = 3000;
const POLL_MAX = 60;
const PAYABLE = new Set(['mobile', 'billpay', 'card']);

function localDigits(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('255')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 9);
}
const groupPhone = (d: string) => [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean).join(' ');

export default function PayClient({ orderId }: { orderId: string }) {
  const [state, setState] = useState<'loading' | 'verify' | 'ready' | 'error'>('loading');
  const [view, setView] = useState<View | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [passCode, setPassCode] = useState<string | null>(null);

  // verify (SMS-OTP)
  const [vPhone, setVPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [vBusy, setVBusy] = useState(false);

  // pay
  const [payer, setPayer] = useState('');
  const [editPayer, setEditPayer] = useState(false);
  const [methods, setMethods] = useState<{ id: Method; label: string }[]>([{ id: 'mobile', label: 'Mobile money' }]);
  const [method, setMethod] = useState<Method>('mobile');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<{ billPayNumber?: string; redirectUrl?: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCount = useRef(0);
  const baseline = useRef<{ paidCount: number; txn: string | null }>({ paidCount: 0, txn: null });

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);
  useEffect(() => () => stopPolling(), [stopPolling]);

  const load = useCallback(async (): Promise<View | null> => {
    try {
      const r = await fetch(`/api/orders/${encodeURIComponent(orderId)}/installments`, { cache: 'no-store' });
      if (r.status === 401) {
        setState('verify');
        return null;
      }
      if (!r.ok) {
        setState('error');
        return null;
      }
      const v = (await r.json()) as View;
      setView(v);
      setState('ready');
      if (v.phone && !payer) setPayer(localDigits(v.phone));
      return v;
    } catch {
      setState('error');
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  useEffect(() => {
    void load();
    fetch('/api/payment-methods', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { groups?: Array<{ id: string; label: string; enabled: boolean }> } | null) => {
        const g = (d?.groups || []).filter((x) => x && x.enabled && PAYABLE.has(x.id)).map((x) => ({ id: x.id as Method, label: x.label }));
        if (g.length) setMethods(g);
      })
      .catch(() => {});
  }, [load]);

  // Paid in full → find the pass link (credentials come with the status read).
  const done = !!view && (view.plan.status === 'completed' || view.orderStatus === 'paid');
  useEffect(() => {
    if (!done) return;
    fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { credentials?: { code: string; state: string }[] } | null) => {
        const c = (d?.credentials || []).find((x) => x.state !== 'revoked');
        if (c) setPassCode(c.code);
      })
      .catch(() => {});
  }, [done, orderId]);

  /* ── SMS-OTP ── */
  async function sendCode() {
    setNotice(null);
    if (vPhone.length !== 9) return setNotice({ kind: 'error', text: 'Enter your phone number.' });
    setVBusy(true);
    try {
      const r = await fetch('/api/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: `+255${vPhone}` }),
      });
      if (r.status === 429) {
        const d = await r.json().catch(() => ({}));
        const secs = Number(d.retryAfterSec) || 60;
        setNotice({ kind: 'error', text: `Too many codes. Try again in ${Math.max(1, Math.ceil(secs / 60))} min.` });
        return;
      }
      if (!r.ok) return setNotice({ kind: 'error', text: 'We couldn’t send a code. Check the number and try again.' });
      setCodeSent(true);
      setNotice({ kind: 'info', text: `We sent a code to +255 ${groupPhone(vPhone)}.` });
    } catch {
      setNotice({ kind: 'error', text: 'No connection. Check your signal and try again.' });
    } finally {
      setVBusy(false);
    }
  }
  async function verifyCode() {
    setNotice(null);
    if (!code.trim()) return setNotice({ kind: 'error', text: 'Enter the code we sent you.' });
    setVBusy(true);
    try {
      const r = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: `+255${vPhone}`, code: code.trim() }),
      });
      if (!r.ok) return setNotice({ kind: 'error', text: 'That code didn’t work. Check it and try again.' });
      const v = await load();
      if (!v) {
        setState('verify');
        setCodeSent(false);
        setCode('');
        setNotice({ kind: 'error', text: 'This booking isn’t on that number. Use the number you booked with.' });
      } else setNotice(null);
    } catch {
      setNotice({ kind: 'error', text: 'No connection. Check your signal and try again.' });
    } finally {
      setVBusy(false);
    }
  }

  /* ── pay the next installment ── */
  async function pay() {
    if (!view?.next) return;
    setNotice(null);
    if (payer.length !== 9) return setNotice({ kind: 'error', text: 'Enter the phone number to pay from.' });
    setBusy(true);
    try {
      const mno = networkFromNumber(payer);
      const res = await fetch(`/api/checkout/${encodeURIComponent(orderId)}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, payerPhone: `+255${payer}`, mno: method === 'mobile' ? mno?.id : undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const secs = Number(res.headers.get('Retry-After')) || Number(d.retryAfterSecs) || 600;
        const mins = Math.max(1, Math.ceil(secs / 60));
        setNotice({ kind: 'error', text: `Try again in ${mins} minute${mins === 1 ? '' : 's'}. You can only get 3 payment prompts every 10 minutes.` });
        return;
      }
      if (res.status !== 200) {
        if (d.error === 'installment_attempt_in_flight') {
          setNotice({ kind: 'info', text: 'A payment prompt is already on its way. Approve it on your phone.' });
          baseline.current = { paidCount: view.plan.paidCount, txn: null };
          startPolling();
          return;
        }
        if (d.error === 'plan_closing' || d.error === 'not_payable' || d.error === 'installment_fully_paid') {
          await load();
          setNotice({ kind: 'error', text: 'This payment can’t be made right now. Check your booking below.' });
          return;
        }
        if (d.error === 'inventory_unavailable') {
          setNotice({ kind: 'error', text: 'The passes went while you were away. Nothing was charged.' });
          return;
        }
        setNotice({ kind: 'error', text: 'That payment didn’t go through. Try again, or use another method.' });
        return;
      }
      if (method === 'card' && d.redirectUrl) window.open(d.redirectUrl, '_blank', 'noopener');
      setWaiting({ billPayNumber: d.billPayNumber, redirectUrl: d.redirectUrl });
      baseline.current = { paidCount: view.plan.paidCount, txn: d.transactionId || null };
      startPolling();
    } catch {
      setNotice({ kind: 'error', text: 'No connection. Check your signal and try again.' });
    } finally {
      setBusy(false);
    }
  }

  function startPolling() {
    stopPolling();
    pollCount.current = 0;
    if (!waiting) setWaiting((w) => w || {});
    const tick = async () => {
      pollCount.current += 1;
      try {
        // The status read reconciles in-flight attempts against the gateway.
        await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, { cache: 'no-store' });
        const v = await load();
        if (v) {
          const att = v.lastAttempt;
          if (v.plan.paidCount > baseline.current.paidCount || v.plan.status === 'completed') {
            stopPolling();
            setWaiting(null);
            setNotice({ kind: 'info', text: 'Payment received. Thank you.' });
            return;
          }
          if (att && (!baseline.current.txn || att.transactionId === baseline.current.txn) && ['failed', 'expired'].includes(att.status)) {
            stopPolling();
            setWaiting(null);
            setNotice({ kind: 'error', text: 'That payment didn’t go through. Try again, or use another method.' });
            return;
          }
        }
      } catch {
        /* transient — keep polling */
      }
      if (pollCount.current >= POLL_MAX) {
        stopPolling();
        setWaiting(null);
        setNotice({ kind: 'info', text: 'Still confirming. If money left your account, this page updates shortly — no need to pay again.' });
      }
    };
    void tick();
    pollRef.current = setInterval(tick, POLL_MS);
  }

  /* ── render ── */
  const header = (
    <div className="zpay-top">
      <a href="/" aria-label="Back" className="zpay-back">
        ←
      </a>
      <span className="zpay-brand">ZoraPass</span>
    </div>
  );

  let body: JSX.Element;
  if (state === 'loading') {
    body = (
      <div className="zpay-card" role="status" aria-live="polite">
        <span className="zpay-spin" aria-hidden="true" />
        <span className="zpay-muted">Loading your booking…</span>
      </div>
    );
  } else if (state === 'error') {
    body = (
      <div className="zpay-card">
        <span className="zpay-k">YOUR BOOKING</span>
        <p>We couldn&apos;t load this booking right now. Try again in a moment.</p>
      </div>
    );
  } else if (state === 'verify') {
    body = (
      <div className="zpay-card">
        <span className="zpay-k">YOUR BOOKING</span>
        <p>Enter the phone number you booked with. We&apos;ll text you a code so only you can see this booking.</p>
        <label className="zpay-field">
          <span>PHONE</span>
          <span className="zpay-tel">
            <span className="zpay-cc" aria-hidden="true">
              +255
            </span>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              aria-label="Phone number, after +255"
              placeholder="712 345 678"
              value={groupPhone(vPhone)}
              onChange={(e) => setVPhone(localDigits(e.target.value))}
            />
          </span>
        </label>
        {codeSent ? (
          <label className="zpay-field">
            <span>CODE</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
          </label>
        ) : null}
        {notice ? <p className={'zpay-notice ' + notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p> : null}
        <button type="button" className="zpay-primary" disabled={vBusy} onClick={codeSent ? verifyCode : sendCode}>
          <span>{codeSent ? 'CONFIRM' : 'SEND CODE'}</span>
          <span aria-hidden="true">→</span>
        </button>
        {codeSent ? (
          <button type="button" className="zpay-link" disabled={vBusy} onClick={sendCode}>
            Send a new code
          </button>
        ) : null}
      </div>
    );
  } else {
    const v = view!;
    const p = v.plan;
    const cur = p.currency;
    const pct = p.count ? Math.round((p.paidCount / p.count) * 100) : 0;
    const when = [(v.dateLabel || '').toUpperCase(), v.venue].filter(Boolean).join(' · ');
    const passes = v.lines.map((l) => `${l.quantity} × ${l.name.toUpperCase()}${l.seatLabels.length ? ` · ${l.seatLabels.join(', ')}` : ''}`).join(' · ');
    const released = p.status === 'defaulted' || v.orderStatus === 'installment_defaulted';
    const cancelled = p.status === 'cancelled';
    const closing = p.status === 'closing';
    const label = done
      ? 'PAID IN FULL'
      : released
        ? 'BOOKING RELEASED'
        : cancelled
          ? 'NOT BOOKED'
          : p.paidCount > 0
            ? `BOOKED · ${p.paidCount} OF ${p.count} PAID`
            : `INSTALLMENTS · 0 OF ${p.count} PAID`;
    const next = v.next;
    const dueIn = next ? daysUntil(next.dueDate) : 0;
    const graceLeft = v.graceUntil ? daysUntil(v.graceUntil) : 0;
    const dueLine = next
      ? dueIn > 0
        ? `Due in ${dueIn} day${dueIn === 1 ? '' : 's'}`
        : dueIn === 0
          ? 'Due today'
          : `${-dueIn} day${dueIn === -1 ? '' : 's'} late`
      : '';
    const graceLine =
      next && next.n === p.count && p.graceDays > 0
        ? ` · ${p.graceDays} day${p.graceDays === 1 ? '' : 's'} grace before the booking is released`
        : next && dueIn < 0 && v.graceUntil
          ? ` · pay by ${shortDay(v.graceUntil)} to keep your booking`
          : '';

    body = (
      <div className="zpay-card">
        <span className="zpay-k yl">{label}</span>
        <span className="zpay-name">{v.eventName}</span>
        {when ? <span className="zpay-mono">{when}</span> : null}
        {passes ? <span className="zpay-mono mut">{passes} · ADMIT {v.passCount}</span> : null}

        {!released && !cancelled ? (
          <div
            className="zpay-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={p.count}
            aria-valuenow={p.paidCount}
            aria-label={`${p.paidCount} of ${p.count} payments made`}
          >
            <div style={{ width: `${pct}%` }} />
          </div>
        ) : null}

        <div className="zpay-rows">
          {p.schedule.map((r) => {
            const isPaid = r.status === 'paid';
            const isNext = !!next && r.n === next.n;
            return (
              <div className={'zpay-row' + (isNext ? ' next' : '')} key={r.n}>
                <span>{isPaid ? `✓ PAID ${shortDay(r.paidAt || r.dueDate)}` : `DUE ${dayLabel(r.dueDate)}`}</span>
                <span>{moneyLabel(r.amount, cur)}</span>
              </div>
            );
          })}
        </div>

        {done ? (
          <div className="zpay-slot">
            <span className="zpay-slot-h">Your pass is ready</span>
            <span className="zpay-slot-p">It&apos;s on its way to your phone and email too.</span>
          </div>
        ) : released ? (
          <div className="zpay-slot">
            <span className="zpay-slot-h">This booking was released</span>
            <span className="zpay-slot-p">
              The last payment wasn&apos;t made in time.{' '}
              {v.refundDue > 0
                ? v.refundStatus === 'recorded'
                  ? `We sent back ${moneyLabel(v.refundDue, cur)} — what you paid, minus the service fee.`
                  : `${moneyLabel(v.refundDue, cur)} comes back to you — what you paid, minus the service fee.`
                : 'There is nothing to refund after the service fee.'}
            </span>
          </div>
        ) : cancelled ? (
          <div className="zpay-slot">
            <span className="zpay-slot-h">This booking wasn&apos;t confirmed</span>
            <span className="zpay-slot-p">The deposit wasn&apos;t paid, so nothing was booked or charged.</span>
          </div>
        ) : (
          <div className="zpay-slot">
            <span className="zpay-slot-h">Your pass is on the way</span>
            <span className="zpay-slot-p">Your QR code appears here when the last payment clears.</span>
          </div>
        )}

        {notice ? <p className={'zpay-notice ' + notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p> : null}

        {done && passCode ? (
          <a className="zpay-primary" href={`/t/${encodeURIComponent(passCode)}`}>
            <span>OPEN MY PASS</span>
            <span aria-hidden="true">→</span>
          </a>
        ) : null}

        {closing ? <p className="zpay-muted center">We&apos;re checking your last payment. This page updates on its own.</p> : null}

        {next && !waiting ? (
          <>
            {methods.length > 1 ? (
              <div className="zpay-methods" role="radiogroup" aria-label="Pay with">
                {methods.map((m) => (
                  <label className={'zpay-method' + (method === m.id ? ' on' : '')} key={m.id}>
                    <input type="radio" name="zpay-method" checked={method === m.id} onChange={() => setMethod(m.id)} />
                    <span>{m.label}</span>
                  </label>
                ))}
              </div>
            ) : null}
            {editPayer || !payer ? (
              <label className="zpay-field">
                <span>PAY FROM</span>
                <span className="zpay-tel">
                  <span className="zpay-cc" aria-hidden="true">
                    +255
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    aria-label="Phone number to pay from, after +255"
                    placeholder="712 345 678"
                    value={groupPhone(payer)}
                    onChange={(e) => setPayer(localDigits(e.target.value))}
                  />
                </span>
              </label>
            ) : null}
            <button type="button" className="zpay-primary" disabled={busy} aria-busy={busy} onClick={pay}>
              <span>PAY {cur === 'TZS' ? 'TSH' : cur} {Math.round(next.amount).toLocaleString('en-US')}</span>
              {busy ? <span className="zpay-spin sm" aria-hidden="true" /> : <span aria-hidden="true">→</span>}
            </button>
            <span className="zpay-muted center">
              {dueLine}
              {graceLine}
            </span>
            {method === 'mobile' && payer.length === 9 ? (
              <span className="zpay-muted center">
                A prompt goes to +255 {groupPhone(payer)}. Enter your PIN.{' '}
                {!editPayer ? (
                  <button type="button" className="zpay-link inline" onClick={() => setEditPayer(true)}>
                    Use another number
                  </button>
                ) : null}
              </span>
            ) : null}
          </>
        ) : null}

        {waiting ? (
          <div className="zpay-wait" role="status" aria-live="polite">
            <span className="zpay-spin" aria-hidden="true" />
            {method === 'billpay' && waiting.billPayNumber ? (
              <>
                <span className="zpay-slot-h">Pay to this control number</span>
                <span className="zpay-control">{waiting.billPayNumber}</span>
                <span className="zpay-slot-p">Pay it from your bank or mobile money. This page updates the moment it clears.</span>
              </>
            ) : method === 'card' ? (
              <span className="zpay-slot-p">
                Finish your card payment in the new tab.{' '}
                {waiting.redirectUrl ? (
                  <a href={waiting.redirectUrl} target="_blank" rel="noopener noreferrer">
                    Reopen it
                  </a>
                ) : null}
              </span>
            ) : (
              <>
                <span className="zpay-slot-h">Approve on your phone</span>
                <span className="zpay-slot-p">Enter your mobile-money PIN on the prompt we sent to +255 {groupPhone(payer)}.</span>
              </>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="zpay">
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <main className="zpay-wrap">
        {header}
        {body}
      </main>
    </div>
  );
}

/* Scoped to .zpay. Fixed dark (PassReserved mockup), primitive tokens only. */
const STYLE = `
.zpay{--bk:var(--zp-color-board-black,#111111);--bone:var(--zp-color-bone,#F7F5EE);--yl:var(--zp-color-signal-yellow,#FFD21F);--card:#1C1C1C;--rule:#333333;--dash:#4A4A4A;--mut:var(--zp-color-ink-300,#BDBDBD);--mono:var(--zp-font-family-mono);--disp:var(--zp-font-family-display);--sans:var(--zp-font-family-sans);min-height:100vh;background:var(--bk);color:var(--bone);font-family:var(--sans);font-size:16px;line-height:1.4;-webkit-font-smoothing:antialiased}
.zpay *{box-sizing:border-box;margin:0;padding:0}
.zpay :focus-visible{outline:3px solid var(--yl);outline-offset:2px}
:where(.zpay) button{font:inherit;color:inherit;background:none;border:none;cursor:pointer}
:where(.zpay) a{color:inherit}
.zpay .zpay-wrap{max-width:480px;margin:0 auto;padding:0 12px 48px}
.zpay .zpay-top{height:52px;display:flex;align-items:center;gap:12px;padding:0 4px}
.zpay .zpay-back{min-width:44px;height:44px;display:inline-flex;align-items:center;font-size:22px;text-decoration:none}
.zpay .zpay-brand{font-weight:700;font-size:17px;letter-spacing:-.02em}
.zpay .zpay-card{border-radius:16px;background:var(--card);border:2px dashed var(--dash);padding:20px 18px;display:flex;flex-direction:column;gap:12px}
.zpay .zpay-k{font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--mut)}
.zpay .zpay-k.yl{color:var(--yl)}
.zpay .zpay-name{font-size:26px;font-weight:800;letter-spacing:-.02em;line-height:1.05}
.zpay .zpay-mono{font-family:var(--mono);font-size:14px}
.zpay .zpay-mono.mut{color:var(--mut)}
.zpay .zpay-bar{height:12px;border-radius:999px;background:var(--rule);overflow:hidden;margin-top:4px}
.zpay .zpay-bar > div{height:100%;background:var(--yl)}
.zpay .zpay-rows{display:flex;flex-direction:column;border-top:1px solid var(--rule);margin-top:4px}
.zpay .zpay-row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--rule);font-family:var(--mono);font-size:14px;font-variant-numeric:tabular-nums}
.zpay .zpay-row:last-child{border-bottom:none}
.zpay .zpay-row.next{color:var(--yl)}
.zpay .zpay-slot{min-height:150px;border-radius:12px;background:var(--bk);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center;padding:16px 20px}
.zpay .zpay-slot-h{font-size:20px;font-weight:700;color:var(--bone)}
.zpay .zpay-slot-p{font-size:14px;color:var(--mut)}
.zpay .zpay-primary{width:100%;height:56px;border-radius:16px;background:var(--yl);color:var(--bk);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 22px;font-family:var(--disp);font-size:20px;line-height:1;text-decoration:none}
.zpay .zpay-primary:disabled{opacity:.6;cursor:not-allowed}
.zpay .zpay-primary:active:not(:disabled){transform:translateY(2px)}
.zpay .zpay-muted{font-size:13px;color:var(--mut)}
.zpay .zpay-muted.center{text-align:center}
.zpay .zpay-link{min-height:44px;font-weight:700;text-decoration:underline;align-self:center}
.zpay .zpay-link.inline{min-height:0;font-size:13px;color:var(--bone)}
.zpay .zpay-notice{font-size:15px;border-radius:12px;padding:10px 14px;border:2px solid var(--bone)}
.zpay .zpay-notice.error{border-color:#FF8A80;color:#FFB4AB}
.zpay .zpay-notice.info{border-color:var(--yl);color:var(--yl)}
.zpay .zpay-field{display:flex;flex-direction:column;gap:6px}
.zpay .zpay-field > span:first-child{font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--mut)}
.zpay .zpay-field input{height:48px;border-radius:12px;border:2px solid var(--dash);background:var(--bk);color:var(--bone);padding:0 14px;font-size:16px;font-family:var(--mono);width:100%}
.zpay .zpay-field input:focus{border-color:var(--yl);outline:none}
.zpay .zpay-tel{display:flex}
.zpay .zpay-cc{display:flex;align-items:center;padding:0 12px;border:2px solid var(--dash);border-right:none;border-radius:12px 0 0 12px;font-family:var(--mono)}
.zpay .zpay-tel input{border-radius:0 12px 12px 0}
.zpay .zpay-methods{display:flex;flex-wrap:wrap;gap:8px}
.zpay .zpay-method{flex:1;min-width:120px;min-height:48px;display:flex;align-items:center;gap:10px;padding:0 12px;border-radius:12px;border:2px solid var(--dash);font-weight:700;font-size:14px;cursor:pointer}
.zpay .zpay-method.on{border-color:var(--yl)}
.zpay .zpay-method input{appearance:none;-webkit-appearance:none;width:20px;height:20px;flex:none;border:2px solid var(--bone);border-radius:50%}
.zpay .zpay-method input:checked{background:var(--yl);border-color:var(--yl);box-shadow:inset 0 0 0 4px var(--card)}
.zpay .zpay-wait{display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;padding:8px 0}
.zpay .zpay-wait a{text-decoration:underline;font-weight:700}
.zpay .zpay-control{font-family:var(--mono);font-size:26px;letter-spacing:.12em;color:var(--yl)}
.zpay .zpay-spin{width:32px;height:32px;border-radius:50%;border:3px solid var(--yl);border-right-color:transparent;animation:zpayspin .8s linear infinite;align-self:center}
.zpay .zpay-spin.sm{width:20px;height:20px;border-color:currentColor;border-right-color:transparent;align-self:auto}
@keyframes zpayspin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.zpay .zpay-spin{animation-duration:2s}}
`;
