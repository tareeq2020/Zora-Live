'use client';

/* BS7 — the cold WhatsApp invitee landing (no session). A stranger taps a link
   and is asked to send money, so this is trust-first (see the invitee storyboard):
   who invited me, which real event, my exact share, how many already paid, and
   what happens to my money if the table doesn't fill. Reads the token preview,
   then claim → SharePayFlow → receipt. Distinct dead-ends for full / expired /
   already-paid (double-charge guard). BS119: ZoraPass flow primitives (zp-flow-css). */

import { useEffect, useState } from 'react';
import SharePayFlow from '../../../components/share-pay-flow';
import { ZP_FLOW_CSS } from '../../../components/zp-flow-css';

const fmt = (n: number) => n.toLocaleString('en-US');

type Preview = {
  splitId: string; shareIndex: number; amount: number; splitStatus: string;
  capacityN: number; paidCount: number; alreadyPaid: boolean;
  hostName: string | null; eventName: string; venue: string | null; dateLabel: string | null;
};

export default function JoinInvitee({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [order, setOrder] = useState<{ orderId: string; amount: number } | null>(null);
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/splits/by-token/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(d.error || 'bad_token'))))
      .then((d: Preview) => setPreview(d))
      .catch((e) => setLoadErr(String(e)));
  }, [token]);

  async function claimAndPay() {
    if (!phone.trim() || phone.replace(/\D/g, '').length < 9) { setNotice('Enter the phone you pay with.'); return; }
    setNotice(null); setBusy(true);
    try {
      const res = await fetch('/api/splits/claim', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, phone: phone.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 200 && d.alreadyPaid) { setPaid(true); return; }
      if (res.status === 200 && d.orderId) { setOrder({ orderId: d.orderId, amount: d.amount }); return; }
      if (res.status === 409 && d.error === 'table_full') { setPreview((p) => p && { ...p, splitStatus: 'complete' }); return; }
      if (res.status === 409 && d.error === 'expired') { setPreview((p) => p && { ...p, splitStatus: 'expired' }); return; }
      setNotice('Could not join this table. The link may be invalid.');
    } catch { setNotice('No connection. Try again.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="zpf zpf-page ji">
      <style dangerouslySetInnerHTML={{ __html: ZP_FLOW_CSS + CSS }} />
      <div className="zpf-card">
        <div className="zpf-nav">
          <a className="zpf-wm" href="/discover" aria-label="ZoraPass — see what's on">
            <img src="/brand/logo/svg/zorapass-wordmark-black.svg" alt="ZoraPass" />
          </a>
        </div>

        {loadErr ? (
          <Dead title="This invite isn't valid." body="The link may be broken or the table was cancelled. Ask your host to send it again." />
        ) : !preview ? (
          <div className="ji-load"><div className="zpf-spinner" /></div>
        ) : paid ? (
          <Receipt preview={preview} />
        ) : preview.splitStatus === 'complete' ? (
          <Dead title="This table's full." body={`All ${preview.capacityN} shares are taken — nothing owed.`} cta="FIND EVENTS" href="/discover" />
        ) : preview.splitStatus === 'expired' || preview.splitStatus === 'refund_pending' ? (
          <Dead title="This table didn't come together." body="It was released before it filled. If you'd paid, your share is refunded within 24 hours." cta="FIND EVENTS" href="/discover" />
        ) : preview.alreadyPaid ? (
          <Receipt preview={preview} />
        ) : order ? (
          <SharePayFlow orderId={order.orderId} amount={order.amount} phone={phone.trim()} eventName={preview.eventName} onPaid={() => setPaid(true)} />
        ) : (
          <>
            <div className="ji-invite"><span className="zpf-av host">{(preview.hostName || 'A')[0].toUpperCase()}</span>
              <div><div className="n">{preview.hostName || 'Someone'} invited you</div><div className="s">to split a table</div></div></div>
            <div className="ji-ev">
              <div className="nm">{preview.eventName}</div>
              {preview.dateLabel || preview.venue ? <div className="meta">{[preview.dateLabel, preview.venue].filter(Boolean).join(' · ')}</div> : null}
            </div>
            <div className="zpf-amt" style={{ marginTop: 16 }}><span className="k">YOUR SHARE</span><span className="v">TSh {fmt(preview.amount)}</span></div>
            <p className="ji-proof">{preview.paidCount} OF {preview.capacityN} ALREADY PAID</p>
            <p className="ji-trust">You only pay <b>your share</b> — it goes straight to the table, not to the host. Card or mobile money. If the table doesn&apos;t fill, your share is refunded <b>within 24 hours</b>. Nobody plays banker.</p>
            {notice ? <div className="zpf-err" role="alert">{notice}</div> : null}
            <label className="zpf-lab" htmlFor="ji-phone">Your mobile-money number</label>
            <div className="zpf-field"><span className="pfx">+255</span>
              <input id="ji-phone" inputMode="tel" placeholder="712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <button className="zpf-btn" disabled={busy} onClick={claimAndPay}>PAY MY SHARE{busy ? <span className="spin" aria-label="Joining" /> : <span aria-hidden="true">→</span>}</button>
            <p className="zpf-foot">ZORAPASS · SECURE CHECKOUT</p>
          </>
        )}
      </div>
    </div>
  );
}

function Receipt({ preview }: { preview: Preview }) {
  return (
    <div className="ji-done">
      <h3 className="ji-in">YOU&apos;RE IN.</h3>
      <p>Your <span className="mono">TSh {fmt(preview.amount)}</span> is paid. We&apos;re waiting on the rest of the table — the second everyone&apos;s paid, your pass lands in your passes and we text you.</p>
      <a className="zpf-btn2" href={`/split/${preview.splitId}`}>See the tracker</a>
      <a className="zpf-btn2" href="/account/tickets">My passes</a>
    </div>
  );
}
function Dead({ title, body, cta, href }: { title: string; body: string; cta?: string; href?: string }) {
  return (
    <div className="ji-done">
      <h3>{title}</h3>
      <p>{body}</p>
      {cta && href ? <a className="zpf-btn" href={href}>{cta}<span aria-hidden="true">→</span></a> : null}
    </div>
  );
}

const CSS = `
.ji .mono{font-family:var(--zp-font-family-mono)}
.ji-load{display:flex;justify-content:center;padding:48px 0}
.ji-invite{display:flex;align-items:center;gap:12px}
.ji-invite .zpf-av{width:44px;height:44px;font-size:16px}
.ji-invite .n{font-weight:700;font-size:18px}
.ji-invite .s{color:var(--mut);font-size:14px}
.ji-ev{border:2px solid var(--ink);border-radius:16px;padding:16px;margin-top:16px}
.ji-ev .nm{font-weight:800;font-size:20px;line-height:1.15;letter-spacing:-.02em}
.ji-ev .meta{font-family:var(--zp-font-family-mono);font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin-top:6px}
.ji-proof{font-family:var(--zp-font-family-mono);font-size:13px;letter-spacing:.08em;color:var(--mut);margin:12px 0 0}
.ji-trust{font-size:14px;color:var(--mut);line-height:1.5;margin:12px 0 0;border-left:4px solid var(--yellow);padding:4px 0 4px 12px}
.ji-trust b{color:var(--ink)}
.ji-done{text-align:center;padding:8px 0}
.ji-done h3{font-weight:800;font-size:24px;letter-spacing:-.02em;margin:8px 0 8px}
.ji-done h3.ji-in{font-family:var(--zp-font-family-display);font-weight:400;font-size:40px;line-height:.95;letter-spacing:0}
.ji-done p{color:var(--mut);font-size:16px;line-height:1.5;margin:0}
`;
