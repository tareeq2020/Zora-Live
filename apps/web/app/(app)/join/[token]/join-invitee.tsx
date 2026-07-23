'use client';

/* BS7 — the cold WhatsApp invitee landing (no session). A stranger taps a link
   and is asked to send money, so this is trust-first (see the invitee storyboard):
   who invited me, which real event, my exact share, how many already paid, and
   what happens to my money if the table doesn't fill. Reads the token preview,
   then claim → SharePayFlow → receipt. Distinct dead-ends for full / expired /
   already-paid (double-charge guard). */

import { useEffect, useState } from 'react';
import SharePayFlow from '../../../components/share-pay-flow';

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
    } catch { setNotice('Network error — try again.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="ji">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ji-card">
        <div className="wm">Z<span className="o" />RA</div>

        {loadErr ? (
          <Dead title="This invite isn't valid." body="The link may be broken or the table was cancelled. Ask your host to send it again." />
        ) : !preview ? (
          <div className="ji-load"><div className="spin" /></div>
        ) : paid ? (
          <Receipt preview={preview} />
        ) : preview.splitStatus === 'complete' ? (
          <Dead title="This table's full." body={`All ${preview.capacityN} shares are taken — nothing owed.`} cta="Start your own table" href="/discover" />
        ) : preview.splitStatus === 'expired' || preview.splitStatus === 'refund_pending' ? (
          <Dead title="This table didn't come together." body="It was released before it filled. If you'd paid, your share is refunded within 24 hours." cta="Start your own table" href="/discover" />
        ) : preview.alreadyPaid ? (
          <Receipt preview={preview} />
        ) : order ? (
          <SharePayFlow orderId={order.orderId} amount={order.amount} phone={phone.trim()} eventName={preview.eventName} onPaid={() => setPaid(true)} />
        ) : (
          <>
            <div className="ji-invite"><span className="av">{(preview.hostName || 'A')[0].toUpperCase()}</span>
              <div><div className="n">{preview.hostName || 'Someone'} invited you</div><div className="s">to split a table</div></div></div>
            <div className="ji-ev">
              <div className="nm">{preview.eventName}</div>
              <div className="meta">{[preview.dateLabel, preview.venue].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="ji-share"><span className="k">YOUR SHARE</span><span className="v">{fmt(preview.amount)} <small>TZS</small></span></div>
            <p className="ji-proof">{preview.paidCount} of {preview.capacityN} already in</p>
            <div className="ji-trust"><span className="ic">◈</span><p>You only pay <b>your share</b> — it goes straight to the table, not to the host. Card or mobile money. If the table doesn't fill, your share is refunded <b>within 24 hours</b>. Nobody plays banker.</p></div>
            {notice ? <div className="ji-notice">{notice}</div> : null}
            <label className="ji-lab">YOUR MOBILE-MONEY NUMBER</label>
            <div className="ji-field"><span className="pfx">+255</span>
              <input inputMode="tel" placeholder="712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <button className="ji-btn" disabled={busy} onClick={claimAndPay}>{busy ? 'One sec…' : `Pay my ${fmt(preview.amount)}`}</button>
            <p className="ji-foot">Powered by Zora · secure checkout</p>
          </>
        )}
      </div>
    </div>
  );
}

function Receipt({ preview }: { preview: Preview }) {
  return (
    <div className="ji-done">
      <div className="tick">✓</div>
      <h3>You're in.</h3>
      <p>Your {fmt(preview.amount)} TZS is paid. We're waiting on the rest of the table — the second everyone's paid, your pass lands in your tickets and we text you.</p>
      <a className="ji-btn2" href={`/split/${preview.splitId}`}>See the tracker</a>
      <a className="ji-link" href="/account/tickets">My tickets</a>
    </div>
  );
}
function Dead({ title, body, cta, href }: { title: string; body: string; cta?: string; href?: string }) {
  return (
    <div className="ji-done">
      <h3>{title}</h3>
      <p>{body}</p>
      {cta && href ? <a className="ji-btn2" href={href}>{cta}</a> : null}
    </div>
  );
}

const CSS = `
.ji{--c-bg:#06070B;--c-surface:#11131E;--c-surface2:#171A28;--c-text:#EDEFF7;--c-text2:#9BA3C4;--c-text3:#5C6488;
  --c-line:rgba(124,160,255,.12);--c-line2:rgba(124,160,255,.22);--c-blue:#4C6FFF;--c-ice:#7CA0FF;--c-cyan:#3FE0FF;--c-indigo:#151A3A;
  --c-aura:linear-gradient(130deg,#D53AD8 0%,#FF4D7D 48%,#FF9145 100%);
  --sans:'Inter',system-ui,sans-serif;--disp:'Space Grotesk',var(--sans);--mono:'IBM Plex Mono',monospace;
  background:var(--c-bg);color:var(--c-text);font-family:var(--sans);min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:32px 18px}
.ji-card{width:100%;max-width:400px;background:var(--c-surface);border:1px solid var(--c-line);border-radius:20px;padding:24px 22px}
.wm{font-family:var(--disp);font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:18px;display:inline-flex;align-items:center;color:var(--c-text2);margin-bottom:6px}
.wm .o{width:.62em;height:.62em;margin:0 .05em;border-radius:50%;background:var(--c-aura);display:inline-block;box-shadow:0 0 10px rgba(255,90,120,.4)}
.ji-load{display:flex;justify-content:center;padding:48px 0}
.spin{width:32px;height:32px;border-radius:50%;border:3px solid var(--c-line2);border-top-color:var(--c-ice);animation:jir .8s linear infinite}
@keyframes jir{to{transform:rotate(360deg)}}
.ji-invite{display:flex;align-items:center;gap:12px;margin-top:14px}
.ji-invite .av{width:42px;height:42px;border-radius:50%;background:var(--c-aura);color:#fff;display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:600;font-size:17px;flex:0 0 auto}
.ji-invite .n{font-family:var(--disp);font-weight:600;font-size:15px}
.ji-invite .s{color:var(--c-text2);font-size:12px}
.ji-ev{background:var(--c-surface2);border:1px solid var(--c-line);border-radius:14px;padding:14px;margin-top:14px}
.ji-ev .nm{font-family:var(--disp);font-weight:600;font-size:16px;line-height:1.25}
.ji-ev .meta{color:var(--c-text2);font-size:12px;margin-top:4px}
.ji-share{display:flex;justify-content:space-between;align-items:baseline;background:var(--c-surface2);border:1px solid var(--c-line2);border-radius:14px;padding:16px;margin-top:14px}
.ji-share .k{font-family:var(--mono);font-size:10px;letter-spacing:.16em;color:var(--c-text2)}
.ji-share .v{font-family:var(--disp);font-weight:700;font-size:28px}
.ji-share .v small{font-size:14px;color:var(--c-text2);font-weight:500}
.ji-proof{color:var(--c-text2);font-size:12.5px;margin-top:12px;font-family:var(--mono)}
.ji-trust{display:flex;gap:9px;align-items:flex-start;margin-top:14px;background:rgba(76,111,255,.07);border:1px solid var(--c-line);border-radius:12px;padding:12px 14px}
.ji-trust .ic{color:var(--c-ice);font-size:15px}
.ji-trust p{font-size:12px;color:var(--c-text2);line-height:1.6}
.ji-trust b{color:var(--c-text)}
.ji-notice{background:rgba(255,145,69,.1);border:1px solid rgba(255,145,69,.35);color:#FF9145;border-radius:10px;padding:10px 12px;font-size:12.5px;margin-top:12px}
.ji-lab{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--c-text3);margin:16px 0 8px}
.ji-field{background:var(--c-surface2);border:1px solid var(--c-line);border-radius:12px;padding:14px 15px;display:flex;align-items:center;gap:10px}
.ji-field:focus-within{border-color:var(--c-blue);box-shadow:0 0 0 3px rgba(76,111,255,.16)}
.ji-field .pfx{font-family:var(--mono);color:var(--c-text2);font-size:15px}
.ji-field input{background:none;border:none;outline:none;color:var(--c-text);font-family:var(--mono);font-size:16px;width:100%}
.ji-btn{display:block;width:100%;text-align:center;font-family:var(--disp);font-weight:600;font-size:15px;padding:15px;border-radius:13px;border:none;cursor:pointer;background:var(--c-aura);color:#fff;box-shadow:0 8px 26px rgba(255,77,125,.28);margin-top:16px}
.ji-btn:disabled{opacity:.6}
.ji-foot{text-align:center;color:var(--c-text2);font-family:var(--mono);font-size:10.5px;margin-top:14px}
.ji-done{text-align:center;padding:8px 0}
.ji-done .tick{width:60px;height:60px;border-radius:50%;background:var(--c-aura);display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff;margin:8px auto 4px;box-shadow:0 0 30px rgba(255,90,120,.4)}
.ji-done h3{font-family:var(--disp);font-weight:600;font-size:22px;margin:10px 0 8px}
.ji-done p{color:var(--c-text2);font-size:13.5px;line-height:1.6}
.ji-btn2{display:block;text-align:center;font-family:var(--disp);font-weight:600;font-size:14px;padding:14px;border-radius:13px;background:var(--c-aura);color:#fff;text-decoration:none;margin-top:18px}
.ji-link{display:block;text-align:center;color:var(--c-ice);font-family:var(--mono);font-size:12px;margin-top:12px;text-decoration:none}
`;
