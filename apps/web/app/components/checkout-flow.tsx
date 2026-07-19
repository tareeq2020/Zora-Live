'use client';

/* PR-11 — the reusable WEB CHECKOUT FLOW.

   One self-contained client component that drives the real payments contract end
   to end and replaces the old "claim in the app" dead-end. Surfaced from the
   tenant storefront sheet (storefront-client.tsx) and the single-event ticket CTA
   (events/[id]/event-cta.tsx). Visual language is faithful to the storefront
   checkout sheet — the dark z-black card, IBM Plex Mono labels, the electric-blue
   pay button — ported here so both surfaces open the exact same transaction.

   Steps (a..e), each mapped to a backend endpoint:
     cart   — tiers + qty, availability from GET /api/inventory (sold-out disabled)
     buyer  — phone / email / age attestation / method + network
              → POST /api/checkout  (409 sold_out · 503 busy|sales_paused · 200 {orderId,total})
     pay    — method-specific collection
              → POST /api/checkout/:orderId/pay  (mobile PIN · billpay control no. · card redirect)
     poll   — GET /api/orders/:orderId/status every ~3s until terminal
     done   — paid → scannable QR credentials · short/unseatable → apology · failed → retry

   The amount the buyer pays is ALWAYS the server-authoritative `total` from the
   checkout response (fee already folded in) — never recomputed on the client. The
   per-line prices in the cart are a pre-checkout reference only. All fetches are
   relative /api/* (next.config proxies to the API on the same origin, so the
   httpOnly zora_checkout cookie set by POST /checkout rides along to the status
   read that promotes the buyer session). */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export type CheckoutTier = {
  tierId: string;
  name: string;
  unitPrice: number;
  currency?: string;
};

export type CheckoutFlowProps = {
  open: boolean;
  onClose: () => void;
  eventName: string;
  when?: string; // "SAT 08 AUG · 12:00 · THE VENUE"
  tiers: CheckoutTier[];
};

type Step = 'cart' | 'buyer' | 'pay' | 'poll' | 'done';
type Method = 'mobile' | 'billpay' | 'card';

type PoolSnapshot = { tierId: string; available: number };
type Order = { orderId: string; total: number };
type Credential = { qr: string; code: string; publicRef: string; tier: string; state: string };

const NETWORKS = [
  { id: 'VODACOM', label: 'M-PESA' },
  { id: 'TIGO', label: 'MIXX BY YAS' },
  { id: 'AIRTEL', label: 'AIRTEL MONEY' },
  { id: 'HALOTEL', label: 'HALOPESA' },
];

const POLL_MS = 3000;
const POLL_MAX = 60; // ~3 min ceiling before we tell the buyer to check back

const TERMINAL = new Set(['paid', 'payment_short', 'paid_unseatable', 'failed', 'expired']);

const fmt = (n: number) => n.toLocaleString('en-US');

export default function CheckoutFlow({ open, onClose, eventName, when, tiers }: CheckoutFlowProps) {
  const currency = tiers[0]?.currency || 'TZS';

  const [step, setStep] = useState<Step>('cart');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [avail, setAvail] = useState<Record<string, number> | null>(null);
  const [invError, setInvError] = useState(false);

  // buyer
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [ageAttested, setAgeAttested] = useState(false);
  const [method, setMethod] = useState<Method>('mobile');
  const [network, setNetwork] = useState('VODACOM');

  // checkout / pay
  const [order, setOrder] = useState<Order | null>(null);
  const [payerName, setPayerName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [billPayNumber, setBillPayNumber] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  // poll / result
  const [statusVal, setStatusVal] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCount = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // ── reset every time the sheet opens ──
  useEffect(() => {
    if (!open) return;
    setStep('cart');
    setQty(tiers.length === 1 ? { [tiers[0].tierId]: 1 } : {});
    setOrder(null);
    setNotice(null);
    setBillPayNumber(null);
    setRedirectUrl(null);
    setStatusVal(null);
    setCredentials([]);
    setBusy(false);
    pollCount.current = 0;
    // Live availability for the cart step.
    setAvail(null);
    setInvError(false);
    fetch('/api/inventory', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { pools?: PoolSnapshot[] }) => {
        const map: Record<string, number> = {};
        for (const p of d.pools || []) map[p.tierId] = Number(p.available) || 0;
        setAvail(map);
      })
      .catch(() => setInvError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // lock scroll while open; clean up any poll on unmount/close
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);
  useEffect(() => () => stopPolling(), [stopPolling]);

  const availOf = (tierId: string) => (avail == null ? Infinity : avail[tierId] ?? 0);
  const cartLines = useMemo(
    () => tiers.map((t) => ({ tier: t, q: qty[t.tierId] || 0 })).filter((l) => l.q > 0),
    [tiers, qty],
  );
  const anyInCart = cartLines.length > 0;
  const estSubtotal = cartLines.reduce((s, l) => s + l.tier.unitPrice * l.q, 0);

  function setTierQty(tierId: string, next: number) {
    const cap = Math.min(10, availOf(tierId));
    const clamped = Math.max(0, Math.min(cap, next));
    setQty((prev) => ({ ...prev, [tierId]: clamped }));
  }

  // ── (c) POST /api/checkout ──────────────────────────────────────────────
  async function submitCheckout() {
    setNotice(null);
    if (!phone.trim()) return setNotice({ kind: 'error', text: 'Enter your phone number.' });
    if (!email.trim()) return setNotice({ kind: 'error', text: 'Enter your email.' });
    if (!ageAttested) return setNotice({ kind: 'error', text: 'Please confirm you are 18 or older.' });
    if (!anyInCart) return setNotice({ kind: 'error', text: 'Add at least one pass.' });

    setBusy(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.trim(),
          email: email.trim(),
          ageAttested,
          cart: cartLines.map((l) => ({ tier: l.tier.tierId, quantity: l.q })),
          method,
          network: method === 'mobile' ? network : undefined,
        }),
      });

      if (res.status === 200) {
        const d = (await res.json()) as Order;
        setOrder({ orderId: d.orderId, total: d.total });
        setPayerName('');
        setStep('pay');
        return;
      }
      if (res.status === 409) {
        const d = await res.json().catch(() => ({}));
        const gone = tiers.find((t) => t.tierId === d.tier);
        setStep('cart');
        setAvail((prev) => ({ ...(prev || {}), [d.tier]: 0 }));
        setQty((prev) => ({ ...prev, [d.tier]: 0 }));
        setNotice({
          kind: 'error',
          text: `${gone ? gone.name : 'That tier'} just sold out. Adjust your cart and try again.`,
        });
        return;
      }
      if (res.status === 503) {
        const retry = Number(res.headers.get('Retry-After')) || 0;
        const d = await res.json().catch(() => ({}));
        const paused = d.error === 'sales_paused';
        setNotice({
          kind: 'error',
          text: paused
            ? `Sales are briefly paused. Please try again${retry ? ` in about ${retryLabel(retry)}` : ' shortly'}.`
            : `We're at capacity for a moment${retry ? ` — retry in ${retry}s` : ''}. Hang tight and try again.`,
        });
        return;
      }
      const d = await res.json().catch(() => ({}));
      setNotice({ kind: 'error', text: validationMessage(d.error) });
    } catch {
      setNotice({ kind: 'error', text: 'Network error — please try again.' });
    } finally {
      setBusy(false);
    }
  }

  // ── (d) POST /api/checkout/:orderId/pay ─────────────────────────────────
  async function submitPay() {
    if (!order) return;
    setNotice(null);
    const payerPhone = phone.trim();
    if (!payerPhone) return setNotice({ kind: 'error', text: 'Enter the phone paying.' });
    if ((method === 'billpay' || method === 'card') && !payerName.trim()) {
      return setNotice({ kind: 'error', text: 'Enter the payer name.' });
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/checkout/${encodeURIComponent(order.orderId)}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method,
          payerPhone,
          payerName: payerName.trim() || undefined,
          mno: method === 'mobile' ? network : undefined,
        }),
      });
      if (res.status !== 200) {
        const d = await res.json().catch(() => ({}));
        setNotice({ kind: 'error', text: payErrorMessage(d.error) });
        return;
      }
      const d = await res.json();
      setBillPayNumber(d.billPayNumber || null);
      setRedirectUrl(d.redirectUrl || null);
      if (method === 'card' && d.redirectUrl) {
        // Open the hosted card page; keep polling here so the buyer lands back on
        // credentials without losing this session.
        window.open(d.redirectUrl, '_blank', 'noopener');
      }
      setStatusVal('pending');
      setStep('poll');
      startPolling(order.orderId);
    } catch {
      setNotice({ kind: 'error', text: 'Network error — please try again.' });
    } finally {
      setBusy(false);
    }
  }

  // ── (e) GET /api/orders/:orderId/status poll ────────────────────────────
  function startPolling(orderId: string) {
    stopPolling();
    pollCount.current = 0;
    const tick = async () => {
      pollCount.current += 1;
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, { cache: 'no-store' });
        if (res.ok) {
          const d = (await res.json()) as { status: string; credentials?: Credential[] };
          setStatusVal(d.status);
          if (TERMINAL.has(d.status)) {
            stopPolling();
            setCredentials(d.credentials || []);
            setStep('done');
            return;
          }
        }
      } catch {
        /* transient — keep polling */
      }
      if (pollCount.current >= POLL_MAX) {
        stopPolling();
        setStatusVal('slow');
        setStep('done');
      }
    };
    tick();
    pollRef.current = setInterval(tick, POLL_MS);
  }

  function retryPayment() {
    stopPolling();
    setNotice(null);
    setBillPayNumber(null);
    setRedirectUrl(null);
    setStatusVal(null);
    setStep('pay');
  }

  if (!open) return null;

  return (
    <div className="zco" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div className="zco-card" role="dialog" aria-modal="true" aria-label="Checkout">
        <div className="zco-head">
          <span className="zco-secure">
            SECURE CHECKOUT · <b>ZORA</b>
          </span>
          <button className="zco-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="zco-body">
          {notice ? <div className={'zco-notice ' + notice.kind}>{notice.text}</div> : null}

          {/* ── (a) CART ── */}
          {step === 'cart' ? (
            <>
              <div className="zco-welcome">The price is the price — this is a real Zora pass, issued on payment.</div>
              <p className="zco-event">{eventName}</p>
              {when ? <p className="zco-when">{when}</p> : null}
              {invError ? <p className="zco-muted">Live availability is unavailable right now — you can still try.</p> : null}

              <div className="zco-tiers">
                {tiers.map((t) => {
                  const a = availOf(t.tierId);
                  const soldOut = a <= 0;
                  const q = qty[t.tierId] || 0;
                  return (
                    <div className={'zco-tier' + (soldOut ? ' out' : '')} key={t.tierId}>
                      <div className="zco-tier-info">
                        <p className="zco-tier-name">{t.name}</p>
                        <p className="zco-tier-price">
                          {soldOut ? 'SOLD OUT' : `${fmt(t.unitPrice)} ${t.currency || currency}`}
                          {!soldOut && avail && a <= 5 ? <span className="zco-low"> · {a} left</span> : null}
                        </p>
                      </div>
                      <div className="zco-ctrl">
                        <button aria-label="Fewer" disabled={soldOut || q <= 0} onClick={() => setTierQty(t.tierId, q - 1)}>
                          −
                        </button>
                        <span className="zco-n">{q}</span>
                        <button aria-label="More" disabled={soldOut || q >= Math.min(10, a)} onClick={() => setTierQty(t.tierId, q + 1)}>
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {anyInCart ? (
                <div className="zco-honest">
                  {cartLines.map((l) => (
                    <div className="zco-line" key={l.tier.tierId}>
                      <span className="zco-lbl">
                        {l.q} × {l.tier.name}
                      </span>
                      <span className="zco-val">
                        {fmt(l.tier.unitPrice * l.q)} {currency}
                      </span>
                    </div>
                  ))}
                  <div className="zco-line zco-est">
                    <span className="zco-lbl">Subtotal</span>
                    <span className="zco-val">
                      {fmt(estSubtotal)} {currency}
                    </span>
                  </div>
                  <p className="zco-fineprint">Your final total is confirmed on the next step.</p>
                </div>
              ) : null}

              <button className="zco-pay" disabled={!anyInCart} onClick={() => (setNotice(null), setStep('buyer'))}>
                CONTINUE
              </button>
            </>
          ) : null}

          {/* ── (b) BUYER ── */}
          {step === 'buyer' ? (
            <>
              <button className="zco-back" onClick={() => (setNotice(null), setStep('cart'))}>
                ← Cart
              </button>
              <p className="zco-event">Who&apos;s this for?</p>
              <p className="zco-when">We&apos;ll send your pass here — and it lives in your Zora wallet.</p>

              <label className="zco-field">
                <span>Phone</span>
                <input inputMode="tel" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
              <label className="zco-field">
                <span>Email</span>
                <input type="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>

              <div className="zco-method">
                <span className="zco-method-lab">Pay with</span>
                <div className="zco-seg">
                  {(['mobile', 'billpay', 'card'] as Method[]).map((m) => (
                    <button key={m} className={'zco-seg-btn' + (method === m ? ' on' : '')} onClick={() => setMethod(m)}>
                      {m === 'mobile' ? 'Mobile money' : m === 'billpay' ? 'Bill pay' : 'Card'}
                    </button>
                  ))}
                </div>
              </div>
              {method === 'mobile' ? (
                <div className="zco-networks">
                  {NETWORKS.map((n) => (
                    <button key={n.id} className={'zco-net' + (network === n.id ? ' on' : '')} onClick={() => setNetwork(n.id)}>
                      {n.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <label className="zco-check">
                <input type="checkbox" checked={ageAttested} onChange={(e) => setAgeAttested(e.target.checked)} />
                <span>I confirm I am 18 or older.</span>
              </label>

              <button className="zco-pay" disabled={busy} onClick={submitCheckout}>
                {busy ? 'HOLDING YOUR PASSES…' : 'CONTINUE TO PAYMENT'}
              </button>
            </>
          ) : null}

          {/* ── (d) PAY ── */}
          {step === 'pay' && order ? (
            <>
              <p className="zco-event">Confirm payment</p>
              <div className="zco-honest">
                <div className="zco-line zco-total">
                  <span className="zco-lbl">Total to pay</span>
                  <span className="zco-val big">
                    {fmt(order.total)} {currency}
                  </span>
                </div>
                <p className="zco-fineprint">This is the price. Nothing is added after this screen.</p>
              </div>

              <label className="zco-field">
                <span>{method === 'mobile' ? 'Mobile money number' : 'Payer phone'}</span>
                <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
              {method === 'billpay' || method === 'card' ? (
                <label className="zco-field">
                  <span>Payer name</span>
                  <input placeholder="Full name" value={payerName} onChange={(e) => setPayerName(e.target.value)} />
                </label>
              ) : null}
              {method === 'mobile' ? (
                <p className="zco-muted">Charging {NETWORKS.find((n) => n.id === network)?.label || network}.</p>
              ) : null}

              <button className="zco-pay" disabled={busy} onClick={submitPay}>
                {busy ? 'STARTING…' : `PAY ${fmt(order.total)} ${currency}`}
              </button>
            </>
          ) : null}

          {/* ── (e) POLL ── */}
          {step === 'poll' ? (
            <div className="zco-wait">
              <div className="zco-spinner" />
              {method === 'mobile' ? (
                <>
                  <h3>Approve on your phone</h3>
                  <p>Enter your mobile-money PIN on the prompt we just sent to {phone || 'your phone'}.</p>
                </>
              ) : method === 'billpay' && billPayNumber ? (
                <>
                  <h3>Pay to this control number</h3>
                  <p className="zco-control">{billPayNumber}</p>
                  <p>Use your bank or mobile-money bill-pay to settle this number. We&apos;ll update the moment it clears.</p>
                </>
              ) : method === 'card' ? (
                <>
                  <h3>Complete your card payment</h3>
                  {redirectUrl ? (
                    <p>
                      A secure card page opened in a new tab.{' '}
                      <a href={redirectUrl} target="_blank" rel="noopener noreferrer" className="zco-link">
                        Reopen it
                      </a>{' '}
                      if you don&apos;t see it. We&apos;ll update here automatically.
                    </p>
                  ) : (
                    <p>Finish the payment on the secure card page. We&apos;ll update here automatically.</p>
                  )}
                </>
              ) : (
                <>
                  <h3>Confirming payment…</h3>
                  <p>Hang tight — this usually takes a few seconds.</p>
                </>
              )}
            </div>
          ) : null}

          {/* ── DONE — terminal states ── */}
          {step === 'done' ? <Result statusVal={statusVal} credentials={credentials} onClose={onClose} onRetry={retryPayment} /> : null}
        </div>
      </div>
    </div>
  );
}

function Result({
  statusVal,
  credentials,
  onClose,
  onRetry,
}: {
  statusVal: string | null;
  credentials: Credential[];
  onClose: () => void;
  onRetry: () => void;
}) {
  if (statusVal === 'paid') {
    const good = credentials.filter((c) => c.state !== 'revoked');
    return (
      <div className="zco-result">
        <div className="zco-tick">✓</div>
        <h3>Paid. Your passes are live.</h3>
        <p className="zco-muted">Scan at the door. Also sent to your phone &amp; email.</p>
        <div className="zco-qrs">
          {good.map((c) => (
            <div className="zco-qr" key={c.publicRef}>
              <div className="zco-qr-img">
                <QRCodeSVG value={c.qr} size={148} level="M" includeMargin bgColor="#F4F1EA" fgColor="#0A0A0B" />
              </div>
              <p className="zco-qr-tier">{c.tier}</p>
              <p className="zco-qr-ref">{c.publicRef}</p>
            </div>
          ))}
        </div>
        <button className="zco-web" onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  if (statusVal === 'payment_short') {
    return (
      <ApologyState
        title="Payment came up short"
        body="We received less than the ticket total, so no pass was issued. Any amount taken will be reconciled — our team is on it."
        onClose={onClose}
        onRetry={onRetry}
      />
    );
  }
  if (statusVal === 'paid_unseatable') {
    return (
      <ApologyState
        title="Paid — but we couldn't seat you"
        body="Your payment went through, but stock ran out before we could issue the pass. You will be refunded and our team has been alerted automatically."
        onClose={onClose}
      />
    );
  }
  if (statusVal === 'slow') {
    return (
      <ApologyState
        title="Still confirming"
        body="Your payment is taking longer than usual to settle. If money left your account, your pass will arrive by SMS and email shortly — no need to pay again."
        onClose={onClose}
      />
    );
  }

  // failed / expired
  return (
    <ApologyState
      title={statusVal === 'expired' ? 'Your hold expired' : 'Payment didn’t go through'}
      body={
        statusVal === 'expired'
          ? 'The pass hold timed out before payment completed. Start again to grab it.'
          : 'No money was taken. You can try again with the same or a different method.'
      }
      onClose={onClose}
      onRetry={onRetry}
    />
  );
}

function ApologyState({
  title,
  body,
  onClose,
  onRetry,
}: {
  title: string;
  body: string;
  onClose: () => void;
  onRetry?: () => void;
}) {
  return (
    <div className="zco-result">
      <div className="zco-cross">!</div>
      <h3>{title}</h3>
      <p className="zco-muted">{body}</p>
      <p className="zco-support">Need help? support@zora.live</p>
      {onRetry ? (
        <button className="zco-pay" onClick={onRetry}>
          TRY AGAIN
        </button>
      ) : null}
      <button className="zco-web" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

function retryLabel(secs: number): string {
  if (secs >= 60) return `${Math.round(secs / 60)} min`;
  return `${secs}s`;
}
function validationMessage(err?: string): string {
  switch (err) {
    case 'age_attestation_required':
      return 'Please confirm you are 18 or older.';
    case 'phone_required':
      return 'Enter your phone number.';
    case 'email_required':
      return 'Enter your email.';
    case 'cart_required':
    case 'invalid_cart_line':
      return 'Something is off with your cart — please re-check your passes.';
    default:
      return 'We couldn’t start checkout. Please try again.';
  }
}
function payErrorMessage(err?: string): string {
  switch (err) {
    case 'order_not_found':
      return 'This order expired. Please start again.';
    case 'not_payable':
      return 'This order can no longer be paid. Please start again.';
    case 'inventory_unavailable':
      return 'These passes sold out before payment. Please start again.';
    case 'invalid_method':
      return 'Pick a payment method.';
    case 'payer_phone_required':
      return 'Enter the phone that’s paying.';
    default:
      return 'We couldn’t start the payment. Please try again.';
  }
}

const STYLE = `
.zco{position:fixed;inset:0;background:rgba(10,10,11,.55);backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center;z-index:120;font-family:'Archivo',system-ui,sans-serif}
@media(min-width:680px){.zco{align-items:center}}
.zco *{margin:0;padding:0;box-sizing:border-box}
.zco-card{--z-black:#0A0A0B;--z-bone:#F4F1EA;--z-blue:#3D5AFE;--z-hair:#222226;--z-mut:#8A877E;--mono:'IBM Plex Mono',monospace;background:var(--z-black);color:var(--z-bone);width:100%;max-width:460px;border-radius:20px 20px 0 0;max-height:94vh;overflow-y:auto}
@media(min-width:680px){.zco-card{border-radius:18px}}
.zco-head{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--z-hair);position:sticky;top:0;background:var(--z-black);z-index:2}
.zco-secure{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;color:var(--z-mut)}
.zco-secure b{color:var(--z-bone);font-weight:500}
.zco-x{background:none;border:none;color:var(--z-mut);font-size:22px;cursor:pointer;line-height:1}
.zco-body{padding:24px}
.zco-notice{font-family:var(--mono);font-size:11.5px;letter-spacing:.03em;border-radius:8px;padding:11px 14px;margin-bottom:18px;line-height:1.5}
.zco-notice.error{color:#FF9DB0;border:1px solid rgba(255,77,109,.5);background:rgba(255,77,109,.08)}
.zco-notice.info{color:var(--z-blue);border:1px solid var(--z-blue)}
.zco-welcome{font-family:var(--mono);font-size:11px;letter-spacing:.06em;color:var(--z-blue);border:1px solid var(--z-blue);border-radius:8px;padding:11px 14px;margin-bottom:22px;line-height:1.5}
.zco-event{font-weight:600;font-size:19px;letter-spacing:-.01em}
.zco-when{font-family:var(--mono);font-size:11.5px;color:var(--z-mut);letter-spacing:.06em;margin-top:6px;line-height:1.6}
.zco-muted{font-family:var(--mono);font-size:11.5px;color:var(--z-mut);letter-spacing:.04em;margin-top:12px;line-height:1.7}
.zco-back{background:none;border:none;color:var(--z-mut);font-family:var(--mono);font-size:11px;letter-spacing:.08em;cursor:pointer;margin-bottom:14px}
.zco-back:hover{color:var(--z-bone)}
.zco-tiers{margin-top:22px;display:flex;flex-direction:column;gap:12px}
.zco-tier{display:flex;align-items:center;justify-content:space-between;gap:14px;border:1px solid var(--z-hair);border-radius:12px;padding:16px 18px}
.zco-tier.out{opacity:.5}
.zco-tier-name{font-size:14px;font-weight:500}
.zco-tier-price{font-family:var(--mono);font-size:12px;color:var(--z-mut);letter-spacing:.04em;margin-top:4px}
.zco-low{color:var(--z-blue)}
.zco-ctrl{display:flex;align-items:center;gap:14px;flex-shrink:0}
.zco-ctrl button{width:34px;height:34px;border-radius:50%;border:1px solid var(--z-hair);background:none;color:var(--z-bone);font-size:19px;cursor:pointer;line-height:1}
.zco-ctrl button:hover:not(:disabled){border-color:var(--z-bone)}
.zco-ctrl button:disabled{opacity:.35;cursor:not-allowed}
.zco-n{font-family:var(--mono);font-size:18px;min-width:22px;text-align:center}
.zco-honest{border-top:1px solid var(--z-hair);margin-top:22px;padding-top:18px}
.zco-line{display:flex;justify-content:space-between;font-family:var(--mono);font-size:13.5px;padding:6px 0}
.zco-line .zco-lbl{color:var(--z-mut)}
.zco-est{border-top:1px solid var(--z-hair);margin-top:8px;padding-top:14px}
.zco-total{align-items:baseline}
.zco-total .zco-lbl{font-size:15px;font-family:var(--body)}
.zco-val.big{font-family:var(--mono);font-size:26px;font-weight:500}
.zco-fineprint{font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;color:var(--z-mut);text-align:center;margin-top:12px}
.zco-field{display:block;margin-top:16px}
.zco-field span{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.08em;color:var(--z-mut);margin-bottom:7px}
.zco-field input{width:100%;background:#141416;border:1px solid var(--z-hair);border-radius:10px;color:var(--z-bone);font-size:15px;padding:13px 14px;font-family:var(--mono)}
.zco-field input:focus{outline:none;border-color:var(--z-blue)}
.zco-method{margin-top:20px}
.zco-method-lab{font-family:var(--mono);font-size:11px;letter-spacing:.08em;color:var(--z-mut)}
.zco-seg{display:flex;gap:8px;margin-top:9px}
.zco-seg-btn{flex:1;background:#141416;border:1px solid var(--z-hair);border-radius:10px;color:var(--z-mut);font-family:var(--mono);font-size:11.5px;letter-spacing:.03em;padding:12px 4px;cursor:pointer}
.zco-seg-btn.on{border-color:var(--z-blue);color:var(--z-bone);background:rgba(61,90,254,.12)}
.zco-networks{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.zco-net{background:none;border:1px solid var(--z-hair);border-radius:99px;color:var(--z-mut);font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;padding:9px 14px;cursor:pointer}
.zco-net.on{border-color:var(--z-blue);color:var(--z-bone)}
.zco-check{display:flex;align-items:center;gap:11px;margin-top:22px;font-size:13.5px;color:var(--z-bone);cursor:pointer}
.zco-check input{width:18px;height:18px;accent-color:var(--z-blue);flex-shrink:0}
.zco-pay{width:100%;background:var(--z-blue);color:var(--z-bone);border:none;font-family:var(--mono);font-size:13px;font-weight:500;letter-spacing:.14em;padding:17px;border-radius:12px;cursor:pointer;margin-top:24px;transition:background .2s}
.zco-pay:hover:not(:disabled){background:var(--z-bone);color:var(--z-black)}
.zco-pay:disabled{opacity:.5;cursor:not-allowed}
.zco-web{width:100%;background:none;border:none;color:var(--z-mut);font-family:var(--mono);font-size:11px;letter-spacing:.06em;margin-top:16px;text-decoration:underline;cursor:pointer}
.zco-link{color:var(--z-blue);text-decoration:underline}
.zco-wait{text-align:center;padding:26px 8px 12px}
.zco-wait h3{font-size:20px;font-weight:600;letter-spacing:-.01em;margin-top:20px}
.zco-wait p{font-family:var(--mono);font-size:12px;color:var(--z-mut);line-height:1.8;margin-top:12px;max-width:34ch;margin-left:auto;margin-right:auto}
.zco-control{font-family:var(--mono);font-size:26px;letter-spacing:.12em;color:var(--z-blue);margin-top:14px}
.zco-spinner{width:38px;height:38px;border-radius:50%;border:2px solid var(--z-hair);border-top-color:var(--z-blue);margin:0 auto;animation:zco-spin 0.9s linear infinite}
@keyframes zco-spin{to{transform:rotate(360deg)}}
.zco-result{text-align:center;padding:20px 4px 8px}
.zco-tick{width:54px;height:54px;border-radius:50%;border:2px solid var(--z-blue);color:var(--z-blue);display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 20px}
.zco-cross{width:54px;height:54px;border-radius:50%;border:2px solid #FF4D6D;color:#FF4D6D;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:600;margin:0 auto 20px}
.zco-result h3{font-size:21px;font-weight:600;letter-spacing:-.01em}
.zco-support{font-family:var(--mono);font-size:11px;color:var(--z-blue);letter-spacing:.04em;margin-top:14px}
.zco-qrs{display:flex;flex-wrap:wrap;gap:16px;justify-content:center;margin-top:24px}
.zco-qr{display:flex;flex-direction:column;align-items:center}
.zco-qr-img{background:#F4F1EA;border-radius:12px;padding:12px;line-height:0}
.zco-qr-tier{font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--z-bone);margin-top:10px;text-transform:uppercase}
.zco-qr-ref{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;color:var(--z-mut);margin-top:3px}
`;
