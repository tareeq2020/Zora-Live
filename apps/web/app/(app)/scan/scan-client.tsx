'use client';

/* BS44 (#1) — the door scanner PWA.

   Two roles, one screen each:
     AGENT      scans a QR. The HMAC verify IS the gate (OV6) — a plain GA pass is
                done at "valid" and never waits on a second person.
     SUPERVISOR works a queue of the few passes that DO need a second pair of eyes
                (comp/flagged/table), and issues the wristband.

   Result states map to the takeover colour:
     valid            → solid GREEN   (go)
     needs_supervisor → the AURA      (the one place brand colour means "escalate")
     everything else  → solid RED     (stop) + the plain reason and who/when

   Offline: the amber dot. The agent's verify needs the server today, so we say so
   honestly rather than pretending a queued scan was accepted. Confirms are also
   server-side. What we never do is silently drop a scan. */

import { useCallback, useEffect, useRef, useState } from 'react';

type Role = 'agent' | 'supervisor';
type Scanner = { id: string; name: string; role: Role; eventScope: string | null; canSell?: boolean };
type SellTier = { tierId: string; name: string; price: number; available: number };
type Pass = {
  credentialId: string;
  publicRef: string | null;
  state: string;
  eventName: string | null;
  tierName: string | null;
  holderName: string | null;
  tableNo: string | null;
  requiresConfirm: boolean;
  scannedAt: string | null;
  scannedByName: string | null;
};
// The vocabulary the API actually emits (scan.controller verify): it collapses
// every failure code to `already_used` (already_scanned | already_confirmed) or
// `invalid` (not_found | wrong_event | revoked | bad signature), with the human
// reason in `message`. The takeover word must key off THESE, not the raw
// core codes — keying off `already_scanned` (which never arrives) is why a used
// pass rendered as "Not valid" instead of "Already used".
type Outcome = 'valid' | 'needs_supervisor' | 'already_used' | 'invalid';
type Shot = { outcome: Outcome; pass: Pass | null; why: string; priorActor?: string | null; priorAt?: string | null };

const TAKE: Record<Outcome, { cls: 'go' | 'stop' | 'esc'; glyph: string; word: string }> = {
  valid:            { cls: 'go',   glyph: '✓', word: 'Let them in' },
  needs_supervisor: { cls: 'esc',  glyph: '!', word: 'Get a supervisor' },
  already_used:     { cls: 'stop', glyph: '✕', word: 'Already used' },
  invalid:          { cls: 'stop', glyph: '✕', word: 'Not valid' },
};

const clock = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

async function api(path: string, body?: unknown, token?: string | null) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data } as { ok: boolean; status: number; data: Record<string, unknown> };
}

export function ScanClient() {
  const [token, setToken] = useState<string | null>(null);
  const [scanner, setScanner] = useState<Scanner | null>(null);
  const [online, setOnline] = useState(true);
  const [mode, setMode] = useState<'scan' | 'sell'>('scan');

  // restore a shift already in progress (a door phone gets locked and re-opened)
  useEffect(() => {
    const t = typeof window !== 'undefined' ? window.localStorage.getItem('zora.scan.token') : null;
    if (!t) return;
    api('/api/scan/me', undefined, t).then((r) => {
      if (r.ok && r.data.scanner) {
        setToken(t);
        setScanner(r.data.scanner as Scanner);
      } else {
        window.localStorage.removeItem('zora.scan.token');
      }
    });
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const signOut = useCallback(() => {
    window.localStorage.removeItem('zora.scan.token');
    setToken(null);
    setScanner(null);
  }, []);

  return (
    <div className="zscan">
      <div className="strip">
        <span className="brand">
          z<i />ra
        </span>
        <span className="strip-mid">
          <span>{scanner ? scanner.eventScope || 'All events' : 'Door'}</span>
        </span>
        <span className={'net' + (online ? '' : ' off')}>
          <i />
          {online ? (scanner ? scanner.role : 'ready') : 'offline'}
        </span>
      </div>

      {!token || !scanner ? (
        <SignIn
          onIn={(t, s) => {
            window.localStorage.setItem('zora.scan.token', t);
            setToken(t);
            setScanner(s);
          }}
        />
      ) : (
        <>
          {scanner.canSell ? (
            <div className="sell-modebar" role="tablist" aria-label="Door mode">
              <button type="button" role="tab" aria-selected={mode === 'scan'} className={'sell-modebtn' + (mode === 'scan' ? ' on' : '')} onClick={() => setMode('scan')}>Scan</button>
              <button type="button" role="tab" aria-selected={mode === 'sell'} className={'sell-modebtn' + (mode === 'sell' ? ' on' : '')} onClick={() => setMode('sell')}>Sell</button>
            </div>
          ) : null}
          {mode === 'sell' && scanner.canSell ? (
            <SellView token={token} onOut={signOut} />
          ) : scanner.role === 'supervisor' ? (
            <SupervisorQueue token={token} onOut={signOut} />
          ) : (
            <AgentScan token={token} online={online} onOut={signOut} />
          )}
        </>
      )}
    </div>
  );
}

/* ── seller: on-site cash / mobile selling (BS107 #184) ─────────────────────── */
function SellView({ token, onOut }: { token: string; onOut: () => void }) {
  const [tiers, setTiers] = useState<SellTier[]>([]);
  const [tier, setTier] = useState<SellTier | null>(null);
  const [qty, setQty] = useState(1);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'err' | 'wait'; text: string } | null>(null);
  const [lastCash, setLastCash] = useState<{ orderId: string; label: string } | null>(null);

  const loadCatalog = useCallback(async () => {
    const r = await api('/api/scan/sell/catalog', undefined, token);
    const d = r.data as { tiers?: SellTier[] };
    if (r.ok && Array.isArray(d?.tiers)) {
      const list = d.tiers;
      setTiers(list);
      setTier((prev) => prev ?? list[0] ?? null);
    }
  }, [token]);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  const total = tier ? tier.price * qty : 0;

  async function sell(method: 'cash' | 'mobile') {
    if (!tier || busy) return;
    if (method === 'mobile' && !phone.trim()) { setNote({ kind: 'err', text: 'Enter the buyer’s phone for the mobile prompt.' }); return; }
    setBusy(true); setNote(null);
    const r = await api('/api/scan/sell', { tier: tier.tierId, qty, method, buyerPhone: phone.trim() || undefined }, token);
    setBusy(false);
    const d = r.data as { orderId?: string; amount?: number; message?: string };
    if (!r.ok) { setNote({ kind: 'err', text: d?.message || 'That sale did not go through.' }); return; }
    if (method === 'cash') {
      setLastCash({ orderId: String(d.orderId), label: `${qty}× ${tier.name}` });
      setNote({ kind: 'ok', text: `Collect ${fmtN(total)} TZS cash — ${qty}× ${tier.name} issued.` });
      setPhone('');
      await loadCatalog();
    } else {
      setNote({ kind: 'wait', text: `STK sent to ${phone.trim()} for ${fmtN(d.amount ?? total)} TZS. They approve on their phone; the ticket sends automatically.` });
      setLastCash(null);
      setPhone('');
      await loadCatalog();
    }
  }

  async function voidLast() {
    if (!lastCash || busy) return;
    setBusy(true);
    const r = await api(`/api/scan/sell/${encodeURIComponent(lastCash.orderId)}/void`, {}, token);
    setBusy(false);
    if (!r.ok) { setNote({ kind: 'err', text: (r.data as { message?: string })?.message || 'Could not void that sale.' }); return; }
    setNote({ kind: 'ok', text: `Voided ${lastCash.label} — seat returned.` });
    setLastCash(null);
    await loadCatalog();
  }

  return (
    <div className="view sell">
      <div className="sell-tiers">
        {tiers.map((t) => (
          <button key={t.tierId} type="button" className={'sell-tier' + (tier?.tierId === t.tierId ? ' on' : '')} onClick={() => setTier(t)} disabled={t.available <= 0}>
            <span className="sell-tier-n">{t.name}</span>
            <span className="sell-tier-p">{fmtN(t.price)} TZS</span>
            <span className="sell-tier-a">{t.available > 0 ? `${fmtN(t.available)} left` : 'Sold out'}</span>
          </button>
        ))}
        {tiers.length === 0 ? <p className="sell-empty">No tiers on sale for this event.</p> : null}
      </div>

      <div className="sell-qty">
        <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={busy}>−</button>
        <span>{qty}</span>
        <button type="button" onClick={() => setQty((q) => Math.min(50, q + 1))} disabled={busy}>+</button>
        <span className="sell-total">{fmtN(total)} TZS</span>
      </div>

      <input className="sell-phone" inputMode="tel" placeholder="Buyer phone (required for mobile, optional for cash)" value={phone} onChange={(e) => setPhone(e.target.value)} />

      <div className="sell-actions">
        <button type="button" className="btn" onClick={() => sell('cash')} disabled={busy || !tier}>Cash</button>
        <button type="button" className="btn aura" onClick={() => sell('mobile')} disabled={busy || !tier}>Mobile (STK)</button>
      </div>

      {note ? <p className={'sell-note ' + note.kind}>{note.text}</p> : null}
      {lastCash ? <button type="button" className="sell-void" onClick={voidLast} disabled={busy}>Void last sale ({lastCash.label})</button> : null}

      <button type="button" className="sell-signout" onClick={onOut}>Sign out</button>
    </div>
  );
}

const fmtN = (n: number) => (Number(n) || 0).toLocaleString('en-US');

/* ── sign-in: the 6-digit code the admin panel issued ───────────────────────── */
function SignIn({ onIn }: { onIn: (t: string, s: Scanner) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ title: string; body: string } | null>(null);

  const go = async () => {
    if (busy || code.trim().length < 4) return;
    setBusy(true);
    setErr(null);
    const r = await api('/api/scan/session', { code: code.trim() });
    setBusy(false);
    if (r.ok && r.data.token) {
      onIn(String(r.data.token), r.data.scanner as Scanner);
      return;
    }
    // 429 is the lockout — say so plainly, it is not a "wrong code" loop.
    setErr(
      r.status === 429
        ? { title: 'Too many tries', body: 'This code is locked for a few minutes. Ask your manager to rotate it.' }
        : { title: 'That code did not work', body: String(r.data.message || 'Check the code and try again.') },
    );
    setCode('');
  };

  return (
    <>
      <div className="body">
        <div className="pad">
          <h1>Door scanner</h1>
          <p className="lede">Enter the 6-digit code from your manager. It lasts for this shift.</p>
          <div style={{ marginTop: 26 }}>
            <label className="label" htmlFor="sc">Shift code</label>
            <input
              id="sc"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && go()}
            />
          </div>
          {err ? (
            <p className="note bad">
              <b>{err.title}</b>
              {err.body}
            </p>
          ) : null}
        </div>
      </div>
      <div className="foot">
        <button className="btn aura" onClick={go} disabled={busy || code.length < 4}>
          {busy ? 'Checking…' : 'Start shift'}
        </button>
      </div>
    </>
  );
}

/* ── agent: viewfinder + the takeover ───────────────────────────────────────── */
function AgentScan({ token, online, onOut }: { token: string; online: boolean; onOut: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const busyRef = useRef(false);
  const lastRef = useRef<{ qr: string; at: number }>({ qr: '', at: 0 });
  // Mirrors `shot` for the decode loop: while a result is on screen the scanner
  // must acknowledge it (tap Done, XBR-344), so we PAUSE scanning — a lingering
  // QR in frame must not silently overwrite the result the operator is reading.
  const shotRef = useRef<Shot | null>(null);

  const [cam, setCam] = useState<'boot' | 'live' | 'denied' | 'nocam'>('boot');
  const [shot, setShot] = useState<Shot | null>(null);
  const [manual, setManual] = useState('');
  const [tally, setTally] = useState<{ scanned: number; wristbands: number; pending: number } | null>(null);

  // Show a result and hold it until acknowledged (no auto-dismiss).
  const show = useCallback((s: Shot) => { shotRef.current = s; setShot(s); }, []);
  const dismiss = useCallback(() => {
    // Refresh the debounce so the pass just handled — if it's still sitting in
    // frame — doesn't instantly re-scan the moment the result clears.
    lastRef.current.at = Date.now();
    shotRef.current = null;
    setShot(null);
  }, []);

  const verify = useCallback(
    async (body: { qr: string } | { ref: string }) => {
      if (busyRef.current || shotRef.current) return;
      busyRef.current = true;
      const r = await api('/api/scan/verify', body, token);
      busyRef.current = false;
      if (!online && !r.ok) {
        show({ outcome: 'invalid', pass: null, why: 'No signal — the pass could not be checked. Try again in a moment.' });
        return;
      }
      const outcome = (r.data.outcome as Outcome) || (r.ok ? 'valid' : 'invalid');
      show({
        outcome,
        pass: (r.data.pass as Pass) ?? null,
        why: String(r.data.message || ''),
        priorActor: (r.data.priorActor as string) ?? null,
        priorAt: (r.data.priorAt as string) ?? null,
      });
      if (navigator.vibrate) navigator.vibrate(outcome === 'valid' ? 32 : [24, 60, 24]);
      api('/api/scan/me', undefined, token).then((m) => {
        if (m.ok && m.data.totals) setTally(m.data.totals as { scanned: number; wristbands: number; pending: number });
      });
    },
    [token, online, show],
  );
  // Camera decode sends the signed QR payload (`zora:code:sig`). Manual entry
  // sends the printed HUMAN ref — the camera-denied fallback the API verifies by
  // public_ref without a signature. Sending a typed ref as `qr` (the old bug)
  // never parsed → "Not valid", so the input field was effectively dead (XBR-345).
  const submit = useCallback((qr: string) => { if (qr) verify({ qr }); }, [verify]);
  const submitRef = useCallback((ref: string) => { if (ref) verify({ ref }); }, [verify]);

  // camera + decode loop (jsQR — one predictable path on every phone)
  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let dead = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCam('nocam');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch {
        setCam('denied');
        return;
      }
      if (dead) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      await v.play().catch(() => {});
      setCam('live');

      const { default: jsQR } = await import('jsqr');
      const tick = () => {
        if (dead) return;
        const c = canvasRef.current;
        if (v.readyState === v.HAVE_ENOUGH_DATA && c) {
          const w = 320;
          const h = Math.round((v.videoHeight / v.videoWidth) * w) || 320;
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(v, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const found = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
            // debounce the same QR sitting in frame
            const now = Date.now();
            if (found?.data && !(found.data === lastRef.current.qr && now - lastRef.current.at < 2500)) {
              lastRef.current = { qr: found.data, at: now };
              submit(found.data);
            }
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [submit]);

  return (
    <>
      {tally ? (
        <div className="tally">
          <div><b>{tally.scanned}</b><span>Scanned</span></div>
          <div><b>{tally.wristbands}</b><span>Wristbands</span></div>
          <div><b>{tally.pending}</b><span>Waiting</span></div>
        </div>
      ) : null}

      {/* Camera occupies the TOP (bounded, below the tally) with the manual ref
          field always visible right below it (XBR-345). The <video> + offscreen
          <canvas> stay mounted from the first render: the camera effect reads
          videoRef.current and only THEN flips cam→'live', so a conditional mount
          would strand the effect (null ref → stuck on boot); the decode loop
          needs canvasRef too. The video is just hidden until the stream is live. */}
      <div className="view">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted style={cam === 'live' ? undefined : { display: 'none' }} />
        <canvas ref={canvasRef} hidden />
        {cam === 'live' ? (
          <>
            <div className="reticle"><i /><i /><i /><i /></div>
            <p className="hint">Point at the pass</p>
          </>
        ) : (
          <div className="camidle">
            {cam === 'boot' ? (
              <p className="lede">Starting the camera…</p>
            ) : (
              <>
                <p className="camidle-h">{cam === 'denied' ? 'Camera blocked' : 'No camera'}</p>
                <p className="lede">
                  {cam === 'denied'
                    ? 'Allow camera access, or type the pass reference below.'
                    : 'Type the pass reference below.'}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Always-on manual entry — the QR fallback for a damaged / screenshot /
          glare-blocked pass, available even while the camera is live (XBR-345). */}
      <div className="manual">
        <label className="label" htmlFor="mr">Pass reference</label>
        <input
          id="mr"
          className="wide"
          placeholder="ZORA-…"
          autoComplete="off"
          autoCapitalize="characters"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitRef(manual.trim())}
        />
        <button className="btn aura" onClick={() => submitRef(manual.trim())} disabled={!manual.trim()}>
          Check pass
        </button>
      </div>

      <div className="foot">
        <button className="btn ghost tiny" onClick={onOut}>End shift</button>
      </div>

      {shot ? <Takeover shot={shot} onClose={dismiss} /> : null}
    </>
  );
}

/* ── the full-screen result: readable across a crowd, held until acknowledged ──
   XBR-344: this used to auto-dismiss after ~2s, so at a busy gate the operator
   saw nothing but the counter tick up (and the "already used" flash was too fast
   to read). It now STAYS until they tap Done — one deliberate acknowledgement per
   scan, for both "let them in" and "already used". */
function Takeover({ shot, onClose }: { shot: Shot; onClose: () => void }) {
  const t = TAKE[shot.outcome] ?? TAKE.invalid;
  const p = shot.pass;
  return (
    <div className={'take ' + t.cls}>
      <span className="glyph">{t.glyph}</span>
      <span className="word">{t.word}</span>
      {shot.why ? <p className="why">{shot.why}</p> : null}
      {p ? (
        <div className="meta">
          {p.holderName ? <b>{p.holderName}</b> : null}
          {p.tierName ? <span>{p.tierName}{p.tableNo ? ` · Table ${p.tableNo}` : ''}</span> : null}
          {p.publicRef ? <span>{p.publicRef}</span> : null}
        </div>
      ) : null}
      {shot.outcome === 'already_used' && (shot.priorAt || shot.priorActor) ? (
        <p className="prior">
          Scanned {clock(shot.priorAt)}{shot.priorActor ? ` · ${shot.priorActor}` : ''}
        </p>
      ) : null}
      <button type="button" className="act" autoFocus onClick={onClose}>Done</button>
    </div>
  );
}

/* ── supervisor: the calm queue ─────────────────────────────────────────────── */
function SupervisorQueue({ token, onOut }: { token: string; onOut: () => void }) {
  const [rows, setRows] = useState<Pass[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api('/api/scan/pending', undefined, token);
    if (r.ok) {
      setRows((r.data.pending as Pass[]) || []);
      setErr(null);
    } else {
      setErr(String(r.data.message || 'Could not load the queue.'));
    }
  }, [token]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, [load]);

  const confirm = async (id: string) => {
    setBusy(id);
    const r = await api('/api/scan/confirm', { credentialId: id }, token);
    setBusy(null);
    if (r.ok) {
      if (navigator.vibrate) navigator.vibrate(32);
      setRows((cur) => (cur || []).filter((x) => x.credentialId !== id));
    } else {
      setErr(String(r.data.message || 'Could not confirm that pass.'));
    }
  };

  return (
    <>
      <div className="body">
        <div className="pad">
          <h1>Waiting on you</h1>
          <p className="lede">Comp, flagged and table passes need a second pair of eyes before the wristband.</p>
          {err ? <p className="note bad"><b>Problem</b>{err}</p> : null}
        </div>

        {rows === null ? (
          <div className="skel"><i /><i /><i /></div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <b>Nothing waiting</b>
            Scanned passes that need you will appear here.
          </div>
        ) : (
          <div className="queue">
            {rows.map((p) => (
              <div className="qrow" key={p.credentialId}>
                <div className="who">
                  <b>{p.holderName || p.publicRef || 'Guest'}</b>
                  <span>
                    {p.tierName || 'Pass'}
                    {p.tableNo ? ` · Table ${p.tableNo}` : ''}
                    {p.scannedAt ? ` · ${clock(p.scannedAt)}` : ''}
                  </span>
                </div>
                <button className="go" disabled={busy === p.credentialId} onClick={() => confirm(p.credentialId)}>
                  {busy === p.credentialId ? '…' : 'Wristband'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="foot">
        <button className="btn ghost tiny" onClick={onOut}>End shift</button>
      </div>
    </>
  );
}
