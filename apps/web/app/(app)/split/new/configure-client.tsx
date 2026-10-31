'use client';

/* BS8 — the HOST split flow: configure N → sign in (OTP) → create → invite the
   crew (WhatsApp) + pay your own share. N picker is bound to the table capacity
   (preset chips + stepper for any 2..cap; server computes the authoritative
   shares). See the host storyboard. BS119: ZoraPass flow primitives (zp-flow-css). */

import { useMemo, useState } from 'react';
import OtpLogin from '../../../components/otp-login';
import SharePayFlow from '../../../components/share-pay-flow';
import { ZP_FLOW_CSS } from '../../../components/zp-flow-css';

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
    } catch { setNotice('No connection. Try again.'); }
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
    } catch { setNotice('No connection. Try again.'); }
    finally { setBusy(false); }
  }

  function inviteUrl(token: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/join/${token}`;
  }
  function whatsappHref(share: CreatedShare): string {
    const url = inviteUrl(share.token!);
    const text = `I booked a table at ${eventName}. Your share is TSh ${fmt(share.amount)} — pay it here, nobody plays banker: ${url}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }

  // Contextual back: step within the flow where reversible, else out to discovery.
  function goBack() {
    if (step === 'paymine') return setStep('invite');
    if (step === 'signin') return setStep('configure');
    if (step === 'invite') { window.location.href = created ? `/split/${created.splitId}` : '/discover'; return; }
    if (typeof window !== 'undefined' && window.history.length > 1) window.history.back();
    else window.location.href = '/discover';
  }
  const backLabel = step === 'paymine' ? 'Back to invites' : step === 'invite' ? 'Tracker' : 'Back';

  const arrow = (label: string) => (busy ? <span className="spin" aria-label={label} /> : <span aria-hidden="true">→</span>);

  return (
    <div className="zpf zpf-page cf">
      <style dangerouslySetInnerHTML={{ __html: ZP_FLOW_CSS + CSS }} />
      <div className="zpf-card">
        <div className="zpf-nav">
          <button className="zpf-back" onClick={goBack}>← {backLabel}</button>
          <a className="zpf-wm" href="/discover" aria-label="ZoraPass — see what's on">
            <img src="/brand/logo/svg/zorapass-wordmark-black.svg" alt="ZoraPass" />
          </a>
        </div>

        {step === 'configure' ? (
          <>
            <div className="zpf-eyebrow">{eventName}</div>
            <h2 className="zpf-t">Split the table</h2>
            <div className="tbl"><span className="nm">VIP Table</span><span className="pr">TSh {fmt(unitPrice)}</span></div>
            <p className="q" id="cf-n">How many of you are splitting it?</p>
            <div className="chips" role="radiogroup" aria-labelledby="cf-n">{presets.map((x) => <button key={x} type="button" role="radio" aria-checked={n === x} className={'chip' + (n === x ? ' on' : '')} onClick={() => setN(x)}>{x}</button>)}</div>
            <div className="stepper"><span className="l">OR SET YOUR OWN</span><div className="ctrl">
              <button className="sb" aria-label="One fewer" onClick={() => setN((v) => Math.max(2, v - 1))}>−</button>
              <span className="nv" aria-live="polite">{n} {n === 1 ? 'person' : 'people'}</span>
              <button className="sb" aria-label="One more" onClick={() => setN((v) => Math.min(capMax, v + 1))}>+</button></div></div>
            <div className="zpf-amt" style={{ marginTop: 16 }}><span className="k">EACH GUEST PAYS</span><span className="v">TSh {fmt(preview.invitee)}</span></div>
            <p className="hostnote">{preview.host === preview.invitee
              ? `Splits clean — everyone pays TSh ${fmt(preview.invitee)}.`
              : `You cover the odd TSh ${fmt(preview.host - preview.invitee)} so it lands exactly on TSh ${fmt(unitPrice)}.`}</p>
            {notice ? <div className="zpf-err" role="alert">{notice}</div> : null}
            <button className="zpf-btn" disabled={busy} onClick={createSplit}>HOLD THE TABLE{arrow('Holding')}</button>
            <p className="zpf-foot">Held for everyone going the moment you invite. If it doesn&apos;t fill in time, anyone who paid is refunded.</p>
          </>
        ) : null}

        {step === 'signin' ? (
          <OtpLogin lead="Sign in to hold your table and see who's paid." onSignedIn={() => { setStep('configure'); createSplit(); }} />
        ) : null}

        {step === 'invite' && created ? (
          <>
            <div className="zpf-eyebrow">Table held · {created.shares.filter((s) => !s.isHost).length} shares to fill</div>
            <h2 className="zpf-t">Everyone pays their share.</h2>
            <p className="zpf-sub">Send each person their link. They pay their own share from their phone — nobody plays banker.</p>
            <div className="zpf-rows">
              {created.shares.map((s) => s.isHost ? (
                <div className="zpf-row" key={s.index}><span className="zpf-av host">You</span>
                  <div className="zpf-who"><div className="n">Your share</div><div className="p">TSh {fmt(s.amount)}</div></div></div>
              ) : (
                <div className="zpf-row" key={s.index}><span className="zpf-av">{s.index}</span>
                  <div className="zpf-who"><div className="n">Share {s.index + 1}</div><div className="p">TSh {fmt(s.amount)}</div></div>
                  <a className="wa" href={whatsappHref(s)} target="_blank" rel="noopener">WhatsApp</a>
                  <button className="cp" onClick={() => { navigator.clipboard?.writeText(inviteUrl(s.token!)); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>Copy link</button>
                </div>
              ))}
            </div>
            {copied ? <p className="copied" role="status">LINK COPIED</p> : null}
            <button className="zpf-btn" disabled={busy} onClick={payMyShare}>PAY MY SHARE{arrow('Starting payment')}</button>
            <a className="zpf-btn2" href={`/split/${created.splitId}`}>I&apos;ll pay later — go to tracker</a>
          </>
        ) : null}

        {step === 'paymine' && payOrder && created ? (
          <>
            <div className="zpf-eyebrow" style={{ marginBottom: 12 }}>Your share</div>
            <SharePayFlow orderId={payOrder.orderId} amount={payOrder.amount} phone={hostPhone} eventName={eventName}
              onPaid={() => { window.location.href = `/split/${created.splitId}`; }} />
            <a className="zpf-btn2" href={`/split/${created.splitId}`}>Skip to tracker</a>
          </>
        ) : null}
      </div>
    </div>
  );
}

const CSS = `
.cf .tbl{display:flex;justify-content:space-between;align-items:baseline;gap:12px;border:2px solid var(--ink);border-radius:16px;padding:14px 16px}
.cf .tbl .nm{font-weight:700;font-size:18px}
.cf .tbl .pr{font-family:var(--zp-font-family-mono);font-weight:600;font-size:16px}
.cf .q{color:var(--mut);font-size:16px;margin:16px 0 8px}
.cf .chips{display:flex;gap:8px}
.cf .chip{flex:1;min-height:44px;border-radius:999px;border:2px solid var(--ink);background:transparent;color:var(--ink);font-family:var(--zp-font-family-mono);font-size:16px;cursor:pointer}
.cf .chip:hover{background:var(--sunken)}
.cf .chip.on{background:var(--zp-color-board-black);color:var(--yellow)}
.cf .stepper{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:8px 0;margin-top:12px}
.cf .stepper .l{font-family:var(--zp-font-family-mono);font-size:12px;letter-spacing:.12em;color:var(--mut)}
.cf .stepper .ctrl{display:flex;align-items:center;gap:8px}
.cf .stepper .sb{width:48px;height:48px;border-radius:12px;border:2px solid var(--ink);background:transparent;color:var(--ink);font-size:20px;cursor:pointer}
.cf .stepper .sb:hover{background:var(--sunken)}
.cf .stepper .nv{font-family:var(--zp-font-family-mono);font-size:16px;min-width:88px;text-align:center}
.cf .hostnote{font-size:14px;color:var(--mut);margin:8px 0 0;line-height:1.5}
.cf .wa,.cf .cp{min-height:44px;padding:0 12px;border-radius:12px;display:inline-flex;align-items:center;font-weight:700;font-size:14px;cursor:pointer;text-decoration:none;font-family:var(--zp-font-family-sans)}
.cf .wa{background:var(--zp-color-board-black);color:var(--yellow);border:2px solid var(--zp-color-board-black)}
.cf .wa:hover{background:var(--zp-color-ink-600)}
.cf .cp{background:transparent;color:var(--ink);border:2px solid var(--ink)}
.cf .cp:hover{background:var(--sunken)}
.cf .copied{text-align:center;font-family:var(--zp-font-family-mono);font-size:12px;letter-spacing:.12em;color:var(--ink);margin:12px 0 0}
`;
