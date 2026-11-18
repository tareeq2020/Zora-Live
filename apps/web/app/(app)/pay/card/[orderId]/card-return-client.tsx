'use client';

/* BS166 — /pay/card/[orderId]: the buyer is back from the card page.

   GET /api/orders/:id/status every few seconds. That read asks x-bridge about
   the open card attempt (so the page never waits on a webhook), and once the
   cart is paid it carries the passes. `card` is only there for the buyer (the
   checkout cookie): the attempt's state and, while it is still open, the card
   page to go back to.

   We stop asking after 15 minutes. The payment can still clear later; the
   worker and x-bridge's webhook settle it, and the pass goes out by SMS and
   email, which is what the page says. */

import { useEffect, useRef, useState } from 'react';

type Credential = { publicRef: string; state: string; code: string };
type CardInfo = { transactionId: string; attempt: string; paymentUrl?: string; expiresAt?: string };
type Status = { status: string; credentials?: Credential[]; eventId?: string; card?: CardInfo };

const FAST_MS = 3000;
const SLOW_MS = 10_000;
const FAST_FOR_MS = 2 * 60_000;
const GIVE_UP_MS = 15 * 60_000;

type View =
  | 'loading' | 'confirming' | 'left' | 'paid' | 'money_issue' | 'declined' | 'timed_out' | 'ended' | 'still_waiting' | 'error';

function viewFor(s: Status | null, cancelled: boolean, waitedMs: number): View {
  if (!s) return 'loading';
  if (s.status === 'paid') return 'paid';
  if (s.status === 'paid_unseatable' || s.status === 'payment_short') return 'money_issue';
  if (s.status !== 'pending') return 'ended';
  const a = s.card?.attempt;
  if (a === 'failed') return 'declined';
  if (a === 'expired') return 'timed_out';
  if (cancelled && s.card?.paymentUrl) return 'left';
  return waitedMs >= GIVE_UP_MS ? 'still_waiting' : 'confirming';
}

export default function CardReturnClient({ orderId, cancelled }: { orderId: string; cancelled: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [waited, setWaited] = useState(0);
  const started = useRef(Date.now());

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const elapsed = Date.now() - started.current;
      try {
        const r = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, { cache: 'no-store' });
        if (!live) return;
        if (r.status === 404) {
          setFailed(true);
          return;
        }
        if (r.ok) {
          const d = (await r.json()) as Status;
          setStatus(d);
          setFailed(false);
          setWaited(elapsed);
          const v = viewFor(d, cancelled, elapsed);
          if (v !== 'confirming' && v !== 'left') return; // a result: stop asking
        }
      } catch {
        /* a network blip: ask again */
      }
      if (!live || elapsed >= GIVE_UP_MS) {
        setWaited(Date.now() - started.current);
        return;
      }
      timer = setTimeout(tick, elapsed < FAST_FOR_MS ? FAST_MS : SLOW_MS);
    };
    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [orderId, cancelled]);

  const view: View = failed ? 'error' : viewFor(status, cancelled, waited);
  const pass = status?.credentials?.find((c) => c.state !== 'revoked');
  const eventHref = status?.eventId ? `/events/${encodeURIComponent(status.eventId)}` : '/';
  const backToCard = status?.card?.paymentUrl;

  return (
    <main className="zcr">
      <div className="zcr-card" role="status" aria-live="polite">
        <p className="zcr-k">CARD PAYMENT</p>

        {view === 'loading' || view === 'confirming' ? (
          <>
            <span className="zcr-spin" aria-hidden="true" />
            <h1>Confirming your payment</h1>
            <p>This usually takes a few seconds. Keep this page open.</p>
          </>
        ) : null}

        {view === 'left' ? (
          <>
            <h1>You left the card page</h1>
            <p>Nothing has been charged yet. Your passes are held while the card page is open.</p>
            <div className="zcr-actions">
              <a className="zcr-btn" href={backToCard}>BACK TO CARD PAGE</a>
              <a className="zcr-link" href={eventHref}>Pay another way</a>
            </div>
          </>
        ) : null}

        {view === 'paid' ? (
          <>
            <h1>You&apos;re in</h1>
            <p>Your card payment went through. We&apos;ve sent your pass by SMS and email.</p>
            <div className="zcr-actions">
              {pass ? <a className="zcr-btn" href={`/t/${encodeURIComponent(pass.publicRef)}`}>VIEW MY PASS</a> : null}
              <a className="zcr-link" href={eventHref}>Back to the event</a>
            </div>
          </>
        ) : null}

        {view === 'money_issue' ? (
          <>
            <h1>We got your payment</h1>
            <p>
              Something went wrong with your passes after you paid. You don&apos;t need to pay again. Our team has
              been alerted and will contact you, or reply to your receipt.
            </p>
          </>
        ) : null}

        {view === 'declined' ? (
          <>
            <h1>Your card payment didn&apos;t go through</h1>
            <p>Nothing was charged. Try again, or pay with mobile money.</p>
            <div className="zcr-actions">
              <a className="zcr-btn" href={eventHref}>TRY AGAIN</a>
            </div>
          </>
        ) : null}

        {view === 'timed_out' ? (
          <>
            <h1>The card page timed out</h1>
            <p>
              If you finished paying, you don&apos;t need to do anything: we&apos;ll send your pass by SMS and email
              as soon as the payment clears. If you didn&apos;t, start again.
            </p>
            <div className="zcr-actions">
              <a className="zcr-btn" href={eventHref}>START AGAIN</a>
            </div>
          </>
        ) : null}

        {view === 'still_waiting' ? (
          <>
            <h1>Still confirming</h1>
            <p>
              The card company hasn&apos;t confirmed yet. You can close this page: we&apos;ll send your pass by SMS
              and email as soon as the payment clears. Don&apos;t pay again.
            </p>
          </>
        ) : null}

        {view === 'ended' ? (
          <>
            <h1>This checkout has ended</h1>
            <p>Your hold ran out before the payment was confirmed. If you paid, we&apos;ll send your pass or a refund.</p>
            <div className="zcr-actions">
              <a className="zcr-btn" href={eventHref}>BACK TO THE EVENT</a>
            </div>
          </>
        ) : null}

        {view === 'error' ? (
          <>
            <h1>We can&apos;t find this checkout</h1>
            <p>Check the link, or go back to the event.</p>
            <div className="zcr-actions">
              <a className="zcr-btn" href="/">HOME</a>
            </div>
          </>
        ) : null}
      </div>

      <style>{`
.zcr{color-scheme:light;--bk:var(--zp-color-board-black,#111111);--bone:var(--zp-color-bone,#F7F5EE);--yl:var(--zp-color-signal-yellow,#FFD21F);--mut:var(--zp-color-ink-500,#5C5C5C);--line:var(--zp-color-line-light,#D9D6CC);--mono:var(--zp-font-family-mono);--sans:var(--zp-font-family-sans);min-height:100vh;background:var(--bone);color:var(--bk);font-family:var(--sans);font-size:16px;line-height:1.45;display:flex;justify-content:center;padding:48px 16px}
.zcr .zcr-card{width:100%;max-width:480px;display:flex;flex-direction:column;gap:12px;align-items:flex-start}
.zcr .zcr-k{margin:0;font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--mut)}
.zcr h1{margin:0;font-size:28px;line-height:1.15;font-weight:800}
.zcr p{margin:0;color:var(--bk)}
.zcr .zcr-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:8px}
.zcr .zcr-btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 20px;border-radius:12px;background:var(--bk);color:var(--yl);font-family:var(--mono);font-size:14px;font-weight:700;letter-spacing:.08em;text-decoration:none}
.zcr .zcr-btn:focus-visible,.zcr .zcr-link:focus-visible{outline:3px solid var(--bk);outline-offset:3px}
.zcr .zcr-link{display:inline-flex;align-items:center;min-height:44px;color:var(--bk);text-decoration:underline;text-underline-offset:3px}
.zcr .zcr-spin{width:32px;height:32px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--bk);animation:zcr-spin 0.9s linear infinite}
@keyframes zcr-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.zcr .zcr-spin{animation:none}}
`}</style>
    </main>
  );
}
