'use client';

/* BS8 — the HOST split flow: configure N → sign in (OTP) → create → invite the
   crew (WhatsApp) + pay your own share. N picker is bound to the table capacity
   (preset chips + stepper for any 2..cap; server computes the authoritative
   shares). See the host storyboard. */

import { useMemo, useState } from 'react';
import OtpLogin from '../../../components/otp-login';
import SharePayFlow from '../../../components/share-pay-flow';

const fmt = (n: number) => n.toLocaleString('en-US');

type CreatedShare = { index: number; amount: number; isHost: boolean; token: string | null };
type Created = { splitId: string; target: number; hostShare: number; inviteeShare: number; shares: CreatedShare[] };

export default function ConfigureClient({ tierId, eventName, unitPrice, capMax }: {
  tierId: string; eventName: string; unitPrice: number; capMax: number;
}) {
  const [n, setN] = useState(Math.min(5, capMax));
  const [step, setStep] = useState<'configure' | 'signin' | 'invite' | 'paymine'>('configure');
  const [created, setCreated] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [payOrder, setPayOrder] = useState<{ orderId: string; amount: number } | null>(null);
  const [hostPhone, setHostPhone] = useState('');
  const [copied, setCopied] = useState(false);

  const presets = [2, 4, 5, 6, 8].filter((x) => x <= capMax);
  const preview = useMemo(() => {
    const invitee = Math.floor(unitPrice / n);
    return { invitee, host: unitPrice - invitee * (n - 1) };
  }, [unitPrice, n]);

  async function createSplit() {
    setNotice(null); setBusy(true);
    try {
      const res = await fetch('/api/splits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tierId, capacityN: n }),
      });
      if (res.status === 401) { setStep('signin'); return; }
      const d = await res.json().catch(() => ({}));
      if (res.status === 200 && d.splitId) { setCreated(d); setStep('invite'); return; }
      if (d.error === 'sold_out') { setNotice('This table just sold out.'); return; }
      if (d.error === 'not_split_enabled') { setNotice("This tier can't be split."); return; }
      setNotice('Could not hold the table. Try again.');
    } catch { setNotice('Network error — try again.'); }
    finally { setBusy(false); }
  }

  async function payMyShare() {
    if (!created) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/splits/${encodeURIComponent(created.splitId)}/pay-mine`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (res.status === 200 && d.orderId) { setPayOrder({ orderId: d.orderId, amount: d.amount }); setStep('paymine'); return; }
      setNotice('Could not start your payment.');
    } catch { setNotice('Network error — try again.'); }
    finally { setBusy(false); }
  }

  function inviteUrl(token: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/join/${token}`;
  }
  function whatsappHref(share: CreatedShare): string {
    const url = inviteUrl(share.token!);
    const text = `I booked a table at ${eventName}. Your share is ${fmt(share.amount)} TZS — pay it here, nobody plays banker: ${url}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }

  return (
    <div className="cf">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="cf-card">
        <div className="wm">Z<span className="o" />RA</div>

        {step === 'configure' ? (
          <>
            <div className="eyebrow">{eventName}</div>
            <h2 className="t">Split the table</h2>
            <div className="tbl"><span className="nm">VIP Table</span><span className="pr">{fmt(unitPrice)} TZS</span></div>
            <p className="q">How many of you are splitting it?</p>
            <div className="chips">{presets.map((x) => <button key={x} className={'chip' + (n === x ? ' on' : '')} onClick={() => setN(x)}>{x}</button>)}</div>
            <div className="stepper"><span className="l">OR SET YOUR OWN</span><div className="ctrl">
              <button className="sb" onClick={() => setN((v) => Math.max(2, v - 1))}>−</button>
              <span className="nv">{n} {n === 1 ? 'person' : 'people'}</span>
              <button className="sb" onClick={() => setN((v) => Math.min(capMax, v + 1))}>+</button></div></div>
            <div className="share"><span className="k">EACH GUEST PAYS</span><span className="v">{fmt(preview.invitee)}</span></div>
            <p className="hostnote">{preview.host === preview.invitee
              ? `Splits clean — everyone pays ${fmt(preview.invitee)}.`
              : `You cover the odd ${fmt(preview.host - preview.invitee)} so it lands exactly on ${fmt(unitPrice)}.`}</p>
            {notice ? <div className="err">{notice}</div> : null}
            <button className="btn" disabled={busy} onClick={createSplit}>{busy ? 'Holding…' : 'Hold the table & invite'}</button>
            <p className="foot">Held for your crew the moment you invite. If it doesn't fill in time, anyone who paid is refunded.</p>
          </>
        ) : null}

        {step === 'signin' ? (
          <OtpLogin lead="Sign in to hold your table and see who's paid." onSignedIn={() => { setStep('configure'); createSplit(); }} />
        ) : null}

        {step === 'invite' && created ? (
          <>
            <div className="eyebrow">Table held · {created.shares.filter((s) => !s.isHost).length} shares to fill</div>
            <h2 className="t">Pull your crew in</h2>
            <p className="q">Send each person their link. They pay their share in the app — nobody plays banker.</p>
            <div className="rows">
              {created.shares.map((s) => s.isHost ? (
                <div className="row" key={s.index}><span className="av host">You</span>
                  <div className="who"><div className="n">Your share</div><div className="p">{fmt(s.amount)} TZS</div></div></div>
              ) : (
                <div className="row" key={s.index}><span className="av">{s.index}</span>
                  <div className="who"><div className="n">Share {s.index + 1}</div><div className="p">{fmt(s.amount)} TZS</div></div>
                  <a className="wa" href={whatsappHref(s)} target="_blank" rel="noopener">WhatsApp</a>
                  <button className="cp" onClick={() => { navigator.clipboard?.writeText(inviteUrl(s.token!)); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>Copy</button>
                </div>
              ))}
            </div>
            {copied ? <p className="copied mono">Link copied</p> : null}
            <button className="btn" disabled={busy} onClick={payMyShare}>{busy ? 'One sec…' : 'Pay my share now'}</button>
            <a className="btn2" href={`/split/${created.splitId}`}>I'll pay later — go to tracker</a>
          </>
        ) : null}

        {step === 'paymine' && payOrder && created ? (
          <>
            <div className="eyebrow">Your share</div>
            <SharePayFlow orderId={payOrder.orderId} amount={payOrder.amount} phone={hostPhone} eventName={eventName}
              onPaid={() => { window.location.href = `/split/${created.splitId}`; }} />
            <a className="btn2" href={`/split/${created.splitId}`}>Skip to tracker</a>
          </>
        ) : null}
      </div>
    </div>
  );
}

const CSS = `
.cf{--c-bg:#06070B;--c-surface:#11131E;--c-surface2:#171A28;--c-text:#EDEFF7;--c-text2:#9BA3C4;--c-text3:#5C6488;
  --c-line:rgba(124,160,255,.12);--c-line2:rgba(124,160,255,.22);--c-blue:#4C6FFF;--c-ice:#7CA0FF;--c-cyan:#3FE0FF;--c-indigo:#151A3A;
  --c-aura:linear-gradient(130deg,#D53AD8 0%,#FF4D7D 48%,#FF9145 100%);--sans:'Inter',system-ui,sans-serif;--disp:'Space Grotesk',var(--sans);--mono:'IBM Plex Mono',monospace;
  background:var(--c-bg);color:var(--c-text);font-family:var(--sans);min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:32px 18px}
.cf-card{width:100%;max-width:400px;background:var(--c-surface);border:1px solid var(--c-line);border-radius:20px;padding:24px 22px}
.wm{font-family:var(--disp);font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:18px;display:inline-flex;align-items:center;color:var(--c-text2);margin-bottom:6px}
.wm .o{width:.62em;height:.62em;margin:0 .05em;border-radius:50%;background:var(--c-aura);display:inline-block;box-shadow:0 0 10px rgba(255,90,120,.4)}
.eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.24em;color:var(--c-text3);text-transform:uppercase}
.t{font-family:var(--disp);font-weight:600;font-size:23px;letter-spacing:-.01em;margin:8px 0 10px}
.tbl{display:flex;justify-content:space-between;align-items:baseline;background:var(--c-surface2);border:1px solid var(--c-line);border-radius:14px;padding:14px 15px}
.tbl .nm{font-family:var(--disp);font-weight:600;font-size:15px}.tbl .pr{font-family:var(--mono);font-size:14px}
.q{color:var(--c-text2);font-size:13px;margin:16px 0 8px}
.chips{display:flex;gap:8px}
.chip{flex:1;background:var(--c-surface2);border:1px solid var(--c-line);color:var(--c-text2);border-radius:10px;padding:11px 0;font-family:var(--mono);font-size:14px;cursor:pointer}
.chip.on{border-color:var(--c-blue);color:var(--c-ice);background:rgba(76,111,255,.1)}
.stepper{display:flex;align-items:center;justify-content:space-between;background:var(--c-surface2);border:1px solid var(--c-line);border-radius:12px;padding:10px 12px;margin-top:10px}
.stepper .l{font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--c-text3)}
.stepper .ctrl{display:flex;align-items:center;gap:14px}
.stepper .sb{width:34px;height:34px;border-radius:9px;border:1px solid var(--c-line2);background:var(--c-bg);color:var(--c-text);font-size:19px;cursor:pointer}
.stepper .nv{font-family:var(--mono);font-size:14px;min-width:82px;text-align:center}
.share{display:flex;justify-content:space-between;align-items:baseline;background:var(--c-surface2);border:1px solid var(--c-line);border-radius:12px;padding:15px 16px;margin-top:16px}
.share .k{font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;color:var(--c-text2)}
.share .v{font-family:var(--mono);font-size:22px;color:var(--c-ice)}
.hostnote{font-family:var(--mono);font-size:11px;color:var(--c-text2);letter-spacing:.03em;margin-top:9px;line-height:1.7}
.err{background:rgba(255,145,69,.1);border:1px solid rgba(255,145,69,.35);color:#FF9145;border-radius:10px;padding:10px 12px;font-size:12.5px;margin-top:12px}
.btn{display:block;width:100%;text-align:center;font-family:var(--disp);font-weight:600;font-size:14.5px;padding:15px;border-radius:13px;border:none;cursor:pointer;background:var(--c-aura);color:#fff;box-shadow:0 8px 26px rgba(255,77,125,.28);margin-top:16px}
.btn:disabled{opacity:.6}
.btn2{display:block;text-align:center;background:transparent;color:var(--c-text2);border:1px solid var(--c-line2);border-radius:13px;padding:13px;margin-top:10px;font-family:var(--mono);font-size:12px;cursor:pointer;text-decoration:none}
.foot{text-align:center;color:var(--c-text3);font-family:var(--mono);font-size:10px;margin-top:12px;line-height:1.7}
.rows{margin-top:14px;display:flex;flex-direction:column;gap:1px;border:1px solid var(--c-line);border-radius:14px;overflow:hidden}
.row{display:flex;align-items:center;gap:10px;padding:12px 13px;background:var(--c-surface)}
.av{width:30px;height:30px;border-radius:50%;background:var(--c-surface2);color:var(--c-text3);display:flex;align-items:center;justify-content:center;font-family:var(--disp);font-weight:600;font-size:12px;flex:0 0 auto}
.av.host{background:var(--c-aura);color:#fff;font-size:11px}
.who{flex:1;min-width:0}.who .n{font-size:13.5px;font-weight:500}.who .p{font-family:var(--mono);font-size:11px;color:var(--c-text3)}
.wa{background:#1FA855;color:#fff;font-family:var(--disp);font-weight:600;font-size:11px;padding:7px 11px;border-radius:9px;text-decoration:none}
.cp{background:none;border:1px solid var(--c-line2);color:var(--c-ice);border-radius:9px;padding:7px 10px;font-family:var(--mono);font-size:10.5px;cursor:pointer}
.copied{text-align:center;color:var(--c-ice);font-size:11px;margin-top:8px}
`;
