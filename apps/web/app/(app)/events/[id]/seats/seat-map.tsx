'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CheckoutFlow, { type CheckoutTier } from '../../../../components/checkout-flow';
import { CITIES } from '../../../../lib/cities';

/* BS126 — the live buyer seat map (Web Premium v1, F5 / DD3).

   Replaces the BS115 imperative SVG port and its placeholder availability.
   Everything shown comes from the server:
     • GET /api/events/:id            — name, date, venue, tiers (prices)
     • GET /api/events/:id/seatmap    — PUBLISHED zones (seated / table / GA) — BS143
     • GET /api/events/:id/seats      — live seat state, polled every 5s while the
                                        tab is visible (If-None-Match → 304)
     • GET /api/inventory             — GA remaining per tier
   Seats are real <button>s with spoken labels ("Row C seat 7, available"); the
   state is never colour alone (DD3: ✓ for your pick, dashed for held, solid for
   sold, "R" for reserved). Checkout reuses <CheckoutFlow> with seat lines grouped
   by tier; the hold countdown is the server's holdExpiresAt. A 409 seat_taken
   marks the taken seat and keeps the rest of the picks.

   Desktop follows Seats.dc.html; phone (<900px) follows SeatsPhone.dc.html:
   zone overview first, then that zone's seats, with Map / List / Best available. */

type SeatState = 'available' | 'held' | 'sold' | 'reserved';
type Seat = {
  seatId: string;
  zoneId: string;
  kind: 'seat' | 'table';
  label: string;
  rowLabel?: string | null;
  seatNumber?: number | null;
  tierId: string | null;
  seatsCount: number;
  priceMode: 'per_seat' | 'per_table';
  state: SeatState;
};
type Zone = { id: string; name: string; type: 'ga' | 'seated' | 'table'; x: number; y: number; tierId?: string; price?: number; capacity?: number };
type EventInfo = { id?: string; name?: string; dateLabel?: string; venue?: string; city?: string; cover?: string; organizerHandle?: string; webCheckout?: { tiers?: CheckoutTier[] } };

const POLL_MS = 5000;
const MAX_ITEMS = 10;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const money = (n: number) => `TSh ${fmt(n)}`;
const TAKEN_COPY = (label: string) => `Seat ${label} just went.`;
const TAKEN_REST = 'Someone else got there first — pick another and your other seats stay held.';

function rowOf(s: Seat): { row: string; num: number | null } {
  if (s.rowLabel) return { row: s.rowLabel, num: s.seatNumber ?? null };
  const m = /^([A-Z]+)(\d+)$/.exec(s.label || '');
  return m ? { row: m[1], num: Number(m[2]) } : { row: '', num: s.seatNumber ?? null };
}
const tableShort = (s: Seat) => {
  const m = /(\d+)\s*$/.exec(s.label || '');
  return m ? `T${m[1]}` : s.label;
};

type ViewState = 'available' | 'pick' | 'held' | 'sold' | 'reserved';
const SPOKEN: Record<ViewState, string> = {
  available: 'available',
  pick: 'your pick',
  held: 'held by someone',
  sold: 'sold',
  reserved: 'reserved',
};

export function SeatMap({ eventId }: { eventId: string }) {
  const [ev, setEv] = useState<EventInfo | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [pools, setPools] = useState<Record<string, number>>({});
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [picks, setPicks] = useState<string[]>([]);
  const [ga, setGa] = useState<Record<string, number>>({});
  const [taken, setTaken] = useState<string[]>([]);
  const [message, setMessage] = useState<{ strong: string; rest: string } | null>(null);
  const [holdUntil, setHoldUntil] = useState<number | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  const [tab, setTab] = useState<'map' | 'list' | 'best'>('map');
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [bestN, setBestN] = useState(2);
  const etag = useRef<string | null>(null);
  const holdRef = useRef<number | null>(null);
  const paidRef = useRef(false); // BS137: picks just paid for (now sold — not "taken")
  holdRef.current = holdUntil;

  const tiers = useMemo(() => (ev?.webCheckout?.tiers || []).filter((t) => t && t.tierId && !t.disabled), [ev]);
  const tierPrice = useCallback(
    (tierId: string | null | undefined, zone?: Zone) => {
      const t = tierId ? tiers.find((x) => x.tierId === tierId) : undefined;
      if (t) return Number(t.unitPrice) || 0;
      return Number(zone?.price) || 0;
    },
    [tiers],
  );
  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);
  const seatById = useMemo(() => new Map((seats || []).map((s) => [s.seatId, s])), [seats]);

  // ── responsive switch (phone layout per SeatsPhone mockup) ──
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)');
    const on = () => setIsPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // ── one-off loads: event + floor plan ──
  useEffect(() => {
    let dead = false;
    fetch('/api/events/' + encodeURIComponent(eventId), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!dead && d) setEv(d); })
      .catch(() => {});
    fetch('/api/events/' + encodeURIComponent(eventId) + '/seatmap', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (dead || !p || !Array.isArray(p.zones)) return;
        const zs: Zone[] = p.zones
          .filter((z: any) => z && z.id)
          .map((z: any) => ({
            id: String(z.id), name: String(z.name || 'Zone'),
            type: z.type === 'ga' || z.type === 'table' ? z.type : 'seated',
            x: Number(z.x) || 0, y: Number(z.y) || 0,
            tierId: z.tierId || undefined,
            price: z.price == null ? undefined : Number(z.price),
            capacity: z.capacity == null ? (z.cap == null ? undefined : Number(z.cap)) : Number(z.capacity),
          }))
          .sort((a: Zone, b: Zone) => a.y - b.y || a.x - b.x);
        setZones(zs);
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [eventId]);

  // ── live seats + GA pools: poll every 5s while visible ──
  useEffect(() => {
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (dead) return;
      if (typeof document !== 'undefined' && document.hidden) return; // resumes on visibilitychange
      try {
        const headers: Record<string, string> = {};
        if (etag.current) headers['If-None-Match'] = etag.current;
        const r = await fetch('/api/events/' + encodeURIComponent(eventId) + '/seats', { cache: 'no-store', headers });
        if (r.status === 404) {
          // An API without the seats route: behave as if the seat map is off.
          window.location.replace('/events/' + encodeURIComponent(eventId));
          return;
        }
        if (r.status === 304) setUpdatedAt(Date.now());
        else if (r.ok) {
          const d = await r.json();
          etag.current = r.headers.get('ETag');
          if (!dead && Array.isArray(d?.seats)) {
            setSeats(d.seats as Seat[]);
            setUpdatedAt(Date.now());
          }
        }
      } catch { /* transient — next tick */ }
      try {
        const r = await fetch('/api/inventory', { cache: 'no-store' });
        if (r.ok) {
          const d = await r.json();
          const map: Record<string, number> = {};
          for (const p of d.pools || []) map[p.tierId] = Number(p.available) || 0;
          if (!dead) setPools(map);
        }
      } catch { /* GA counts just stay as they were */ }
      if (!dead) timer = setTimeout(tick, POLL_MS);
    };
    const onVis = () => {
      if (!document.hidden) { if (timer) clearTimeout(timer); tick(); }
      else if (timer) { clearTimeout(timer); timer = null; }
    };
    tick();
    document.addEventListener('visibilitychange', onVis);
    return () => { dead = true; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [eventId]);

  // 1s clock for "UPDATED Ns AGO" and the hold countdown
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // server hold ran out → drop it (picks stay so the buyer can continue again)
  useEffect(() => {
    if (holdUntil && now >= holdUntil) {
      setHoldUntil(null);
      setMessage({ strong: 'Your hold ran out.', rest: 'Your picks are still here — continue to hold them again.' });
    }
  }, [now, holdUntil]);

  // A pick someone else took (seen on poll) drops out with the DD3 message —
  // unless it is held by OUR checkout (its hold is live).
  useEffect(() => {
    if (!seats || holdRef.current || paidRef.current) return;
    const gone = picks.filter((id) => {
      const s = seatById.get(id);
      return !s || s.state !== 'available';
    });
    if (!gone.length) return;
    setPicks((p) => p.filter((id) => !gone.includes(id)));
    // BS137: like a 409 seat_taken, close an open checkout (no hold yet) so the
    // buyer sees the message and re-picks instead of facing an empty cart.
    setCheckoutOpen(false);
    const s = seatById.get(gone[0]);
    setMessage({ strong: TAKEN_COPY(s ? s.label : gone[0]), rest: TAKEN_REST });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats]);

  // poll confirms the taken seats → stop overriding them locally
  useEffect(() => {
    if (!seats || !taken.length) return;
    setTaken((t) => t.filter((id) => seatById.get(id)?.state === 'available'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats]);

  const viewState = (s: Seat): ViewState => {
    if (picks.includes(s.seatId)) return 'pick';
    if (taken.includes(s.seatId)) return 'held';
    return s.state === 'available' ? 'available' : s.state;
  };

  const gaCount = Object.values(ga).reduce((a, b) => a + b, 0);
  const itemCount = picks.length + gaCount;

  function toggleSeat(s: Seat) {
    const v = viewState(s);
    if (v === 'pick') { setPicks((p) => p.filter((id) => id !== s.seatId)); return; }
    if (v !== 'available') return;
    if (!s.tierId) { setMessage({ strong: 'This seat is not on sale yet.', rest: 'Pick another seat.' }); return; }
    if (itemCount >= MAX_ITEMS) { setMessage({ strong: `Up to ${MAX_ITEMS} per order.`, rest: 'Remove one to add another.' }); return; }
    setMessage(null);
    setPicks((p) => [...p, s.seatId]);
  }

  function setGaQty(z: Zone, next: number) {
    const left = z.tierId ? pools[z.tierId] ?? 0 : 0;
    const cur = ga[z.id] || 0;
    const room = MAX_ITEMS - (itemCount - cur);
    const q = Math.max(0, Math.min(next, left, room));
    setGa((g) => {
      const n = { ...g };
      if (q > 0) n[z.id] = q; else delete n[z.id];
      return n;
    });
  }

  // ── price per pick ──
  const seatPrice = (s: Seat) => {
    const base = tierPrice(s.tierId, zoneById.get(s.zoneId));
    return s.kind === 'table' && s.priceMode === 'per_seat' ? base * s.seatsCount : base;
  };
  const pickedSeats = picks.map((id) => seatById.get(id)).filter((s): s is Seat => !!s);
  const subtotal =
    pickedSeats.reduce((a, s) => a + seatPrice(s), 0) +
    Object.entries(ga).reduce((a, [zid, q]) => a + q * tierPrice(zoneById.get(zid)?.tierId, zoneById.get(zid)), 0);

  // Checkout tiers carry the picks (BS122 passthrough): a seated tier gets its
  // seatIds (the server derives the quantity), a GA tier its quantity.
  const cartTiers = useMemo(() => {
    const byTier = new Map<string, string[]>();
    for (const s of pickedSeats) {
      if (!s.tierId) continue;
      byTier.set(s.tierId, [...(byTier.get(s.tierId) || []), s.seatId]);
    }
    const gaByTier = new Map<string, number>();
    for (const [zid, q] of Object.entries(ga)) {
      const z = zoneById.get(zid);
      if (z?.tierId && q > 0 && !byTier.has(z.tierId)) gaByTier.set(z.tierId, (gaByTier.get(z.tierId) || 0) + q);
    }
    const out: CheckoutTier[] = [];
    const base = (id: string): CheckoutTier => tiers.find((t) => t.tierId === id) || { tierId: id, name: zones.find((z) => z.tierId === id)?.name || 'Pass', unitPrice: 0 };
    byTier.forEach((ids, id) => out.push({ ...base(id), seatIds: ids }));
    gaByTier.forEach((q, id) => out.push({ ...base(id), quantity: q }));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, ga, seats, zones, tiers]);

  // ── summary lines for YOUR PICKS ──
  const summary = useMemo(() => {
    const out: { key: string; title: string; sub?: string; amount: number; remove?: () => void }[] = [];
    const rows = new Map<string, Seat[]>();
    for (const s of pickedSeats) {
      if (s.kind === 'table') {
        const z = zoneById.get(s.zoneId);
        out.push({
          key: s.seatId,
          title: `${z?.name || 'Table'} ${tableShort(s)}`,
          sub: s.priceMode === 'per_seat' ? `Seats ${s.seatsCount} · priced per seat` : `Seats ${s.seatsCount}`,
          amount: seatPrice(s),
        });
      } else {
        const k = s.zoneId + '|' + rowOf(s).row;
        rows.set(k, [...(rows.get(k) || []), s]);
      }
    }
    rows.forEach((list, k) => {
      const sorted = [...list].sort((a, b) => (rowOf(a).num ?? 0) - (rowOf(b).num ?? 0));
      const r = rowOf(sorted[0]).row;
      const z = zoneById.get(sorted[0].zoneId);
      const nums = sorted.map((s) => rowOf(s).num ?? s.label).join(', ');
      out.push({
        key: k,
        title: r ? `Row ${r} · seat${sorted.length > 1 ? 's' : ''} ${nums}` : sorted.map((s) => s.label).join(', '),
        sub: z?.name,
        amount: sorted.reduce((a, s) => a + seatPrice(s), 0),
      });
    });
    for (const [zid, q] of Object.entries(ga)) {
      const z = zoneById.get(zid);
      if (!z) continue;
      out.push({ key: 'ga-' + zid, title: z.name, sub: `${q} × no seat number`, amount: q * tierPrice(z.tierId, z) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, ga, seats, zones, tiers]);

  const seatsInZone = (zid: string) => (seats || []).filter((s) => s.zoneId === zid);
  const freeIn = (zid: string) => seatsInZone(zid).filter((s) => viewState(s) === 'available').length;
  const zoneLeftLabel = (z: Zone) => {
    if (z.type === 'ga') {
      const left = z.tierId ? pools[z.tierId] : undefined;
      if (left == null) return 'NO SEAT NUMBER';
      return left <= 0 ? 'SOLD OUT' : `${fmt(left)} LEFT · NO SEAT NUMBER`;
    }
    const n = freeIn(z.id);
    return n <= 0 ? 'SOLD OUT' : `${fmt(n)} LEFT`;
  };
  const zonePriceLabel = (z: Zone) => {
    const list = seatsInZone(z.id);
    const base = tierPrice(z.tierId || list[0]?.tierId, z);
    if (z.type === 'table') {
      const t = list[0];
      if (t?.priceMode === 'per_seat') return `${money(base)} / seat`;
      return `${money(base)} / table of ${t?.seatsCount ?? ''}`.trim();
    }
    return money(base);
  };

  // ── Best available: N adjacent free seats in one row, front rows first ──
  function bestAvailable(zid: string, n: number) {
    const list = seatsInZone(zid).filter((s) => s.state === 'available' && !taken.includes(s.seatId) && s.tierId);
    const z = zoneById.get(zid);
    let found: Seat[] = [];
    if (z?.type === 'table') {
      found = list.slice(0, n);
    } else {
      const rows = new Map<string, Seat[]>();
      for (const s of list) { const r = rowOf(s).row; rows.set(r, [...(rows.get(r) || []), s]); }
      const order = Array.from(rows.keys()).sort((a, b) => a.length - b.length || a.localeCompare(b));
      for (const r of order) {
        const row = rows.get(r)!.sort((a, b) => (rowOf(a).num ?? 0) - (rowOf(b).num ?? 0));
        const all = seatsInZone(zid).filter((s) => rowOf(s).row === r).map((s) => rowOf(s).num ?? 0);
        const mid = all.length ? (Math.min(...all) + Math.max(...all)) / 2 : 0;
        let best: Seat[] | null = null;
        let bestDist = Infinity;
        for (let i = 0; i + n <= row.length; i++) {
          const run = row.slice(i, i + n);
          const contiguous = run.every((s, j) => j === 0 || (rowOf(s).num ?? 0) === (rowOf(run[j - 1]).num ?? 0) + 1);
          if (!contiguous) continue;
          const c = ((rowOf(run[0]).num ?? 0) + (rowOf(run[n - 1]).num ?? 0)) / 2;
          if (Math.abs(c - mid) < bestDist) { bestDist = Math.abs(c - mid); best = run; }
        }
        if (best) { found = best; break; }
      }
    }
    if (found.length < n) {
      setMessage({ strong: `No ${n} seats together here.`, rest: 'Try fewer, another zone, or pick on the map.' });
      return;
    }
    const keep = picks.filter((id) => seatById.get(id)?.zoneId !== zid);
    if (keep.length + gaCount + found.length > MAX_ITEMS) {
      setMessage({ strong: `Up to ${MAX_ITEMS} per order.`, rest: 'Pick fewer seats.' });
      return;
    }
    setPicks([...keep, ...found.map((s) => s.seatId)]);
    setMessage({ strong: `${found.length === 1 ? 'Seat' : 'Seats'} ${found.map((s) => s.label).join(', ')} picked.`, rest: 'We hold them when you continue.' });
    setTab('map');
  }

  // ── checkout callbacks ──
  const onSeatTaken = useCallback((ids: string[]) => {
    const labels = ids.map((id) => seatById.get(id)?.label || id);
    setPicks((p) => p.filter((id) => !ids.includes(id)));
    setTaken((t) => Array.from(new Set([...t, ...ids])));
    setHoldUntil(null);
    setMessage({
      strong: labels.length > 1 ? `Seats ${labels.join(', ')} just went.` : TAKEN_COPY(labels[0] || 'one'),
      rest: TAKEN_REST,
    });
  }, [seatById]);
  const onHold = useCallback((iso: string | null) => {
    const t = iso ? new Date(iso).getTime() : NaN;
    setHoldUntil(Number.isFinite(t) ? t : null);
  }, []);
  // BS137: clear the paid picks when the buyer closes the result, not while it is
  // showing — the open checkout still reads them for its summary and pass labels.
  const onCloseCheckout = useCallback(() => {
    setCheckoutOpen(false);
    if (paidRef.current) { paidRef.current = false; setPicks([]); setGa({}); }
  }, []);

  const ago = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  const holdLeft = holdUntil ? Math.max(0, Math.floor((holdUntil - now) / 1000)) : null;
  const holdText = holdLeft != null ? `${String(Math.floor(holdLeft / 60)).padStart(2, '0')}:${String(holdLeft % 60).padStart(2, '0')}` : null;
  const eventHref = '/events/' + encodeURIComponent(eventId);
  const seatedZones = zones.filter((z) => z.type !== 'ga' && seatsInZone(z.id).length);
  const gaZones = zones.filter((z) => z.type === 'ga');
  const curZone = seatedZones.find((z) => z.id === activeZone) || seatedZones[0] || null;

  // ── render helpers ──
  const seatButton = (s: Seat, size: 'd' | 'p') => {
    const v = viewState(s);
    const { row, num } = rowOf(s);
    const aria = row ? `Row ${row} seat ${num ?? s.label}, ${SPOKEN[v]}` : `Seat ${s.label}, ${SPOKEN[v]}`;
    return (
      <button
        key={s.seatId}
        type="button"
        className={`zsm-seat zsm-${v} zsm-${size}`}
        aria-label={aria}
        aria-pressed={v === 'pick'}
        aria-disabled={v !== 'available' && v !== 'pick'}
        onClick={() => toggleSeat(s)}
      >
        <span aria-hidden="true">{v === 'pick' ? '✓' : v === 'reserved' ? 'R' : ''}</span>
      </button>
    );
  };
  const tableButton = (s: Seat) => {
    const v = viewState(s);
    const aria = `${s.label}, seats ${s.seatsCount}, ${SPOKEN[v]}`;
    return (
      <button
        key={s.seatId}
        type="button"
        className={`zsm-table zsm-${v}`}
        aria-label={aria}
        aria-pressed={v === 'pick'}
        aria-disabled={v !== 'available' && v !== 'pick'}
        onClick={() => toggleSeat(s)}
      >
        <span aria-hidden="true">{tableShort(s)}{v === 'pick' ? ' ✓' : v === 'reserved' ? ' R' : ''}</span>
      </button>
    );
  };
  const seatRows = (z: Zone, size: 'd' | 'p') => {
    const rows = new Map<string, Seat[]>();
    for (const s of seatsInZone(z.id)) { const r = rowOf(s).row; rows.set(r, [...(rows.get(r) || []), s]); }
    const keys = Array.from(rows.keys()).sort((a, b) => a.length - b.length || a.localeCompare(b));
    return (
      <div className="zsm-rows">
        {keys.map((r) => (
          <div className="zsm-row" key={r || '_'}>
            <span className="zsm-rowlab" aria-hidden="true">{r}</span>
            {rows.get(r)!.sort((a, b) => (rowOf(a).num ?? 0) - (rowOf(b).num ?? 0)).map((s) => seatButton(s, size))}
          </div>
        ))}
      </div>
    );
  };
  const zoneBlock = (z: Zone, size: 'd' | 'p') => (
    <section key={z.id} aria-label={z.name} className={`zsm-zone zsm-zone-${z.type}`}>
      <span className="zsm-zlab">{z.name.toUpperCase()} · {zonePriceLabel(z).toUpperCase()}</span>
      {z.type === 'table' ? (
        <div className="zsm-tables">{seatsInZone(z.id).map(tableButton)}</div>
      ) : (
        seatRows(z, size)
      )}
    </section>
  );
  const gaBlock = (z: Zone) => {
    const q = ga[z.id] || 0;
    const left = z.tierId ? pools[z.tierId] ?? 0 : 0;
    const soldOut = !z.tierId || left <= 0;
    return (
      <section key={z.id} aria-label={z.name} className="zsm-ga">
        <span className="zsm-ga-name">{z.name.toUpperCase()}</span>
        <span className="zsm-ga-meta">{money(tierPrice(z.tierId, z)).toUpperCase()} · {zoneLeftLabel(z)}</span>
        <div className="zsm-step" role="group" aria-label={`${z.name} passes`}>
          <button type="button" aria-label={`Fewer ${z.name} passes`} disabled={q <= 0} onClick={() => setGaQty(z, q - 1)}>−</button>
          <span className="zsm-step-n" aria-live="polite">{q}</span>
          <button type="button" aria-label={`More ${z.name} passes`} disabled={soldOut || q >= left || itemCount >= MAX_ITEMS} onClick={() => setGaQty(z, q + 1)}>+</button>
        </div>
      </section>
    );
  };
  const legend = (compact: boolean) => (
    <div className={compact ? 'zsm-legend zsm-legend-c' : 'zsm-legend'} aria-label="Seat key">
      <span><i className="zsm-key zsm-available" />{compact ? 'FREE' : 'AVAILABLE'}</span>
      <span><i className="zsm-key zsm-pick">✓</i>{compact ? 'YOURS' : 'YOUR PICK'}</span>
      <span><i className="zsm-key zsm-held" />{compact ? 'HELD' : 'HELD BY SOMEONE'}</span>
      <span><i className="zsm-key zsm-sold" />SOLD</span>
      <span><i className="zsm-key zsm-reserved">R</i>RESERVED</span>
    </div>
  );
  const live = <span className="zsm-live">{ago == null ? 'LIVE · CONNECTING' : `LIVE · UPDATED ${ago}S AGO`}</span>;
  const statusBox = (
    <div role="status" className={message ? 'zsm-status' : 'zsm-status zsm-empty'}>
      {message ? (<><strong>{message.strong}</strong> {message.rest}</>) : null}
    </div>
  );
  const continueBtn = (
    <button type="button" className="zsm-primary" disabled={itemCount === 0} onClick={() => { setMessage(null); setCheckoutOpen(true); }}>
      CONTINUE<span aria-hidden="true">→</span>
    </button>
  );

  const loading = seats == null;

  return (
    <div className="zsm">
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <header className="zsm-top">
        <a href={eventHref} className="zsm-back" aria-label="Back to event">{isPhone ? '←' : '← BACK TO EVENT'}</a>
        <span className="zsm-title">{isPhone ? 'Choose seats' : `${ev?.name || 'Your event'} · choose your seats`}</span>
        {holdText ? <span className="zsm-hold" role="timer" aria-label={`Held for you, ${holdText} left`}>{isPhone ? 'HELD' : 'HELD FOR YOU'} {holdText}</span> : <span className="zsm-hold-gap" />}
      </header>

      {loading ? (
        <p className="zsm-loading" role="status">Loading live seats…</p>
      ) : !isPhone ? (
        /* ───────── DESKTOP ───────── */
        <div className="zsm-desk">
          <main className="zsm-main">
            <div className="zsm-legendrow">{legend(false)}{live}</div>
            <div className="zsm-card">
              <div className="zsm-stage">STAGE</div>
              <div className="zsm-zones">{seatedZones.map((z) => zoneBlock(z, 'd'))}</div>
              {gaZones.map(gaBlock)}
            </div>
          </main>
          <aside className="zsm-aside" aria-label="Your picks">
            <span className="zsm-eyebrow">YOUR PICKS</span>
            {summary.length ? summary.map((l) => (
              <div key={l.key} className="zsm-line">
                <div className="zsm-line-top"><span className="zsm-line-t">{l.title}</span><span className="zsm-line-p">{money(l.amount)}</span></div>
                {l.sub ? <span className="zsm-line-s">{l.sub}</span> : null}
              </div>
            )) : <p className="zsm-none">Tap a seat, a table or a standing zone.</p>}
            <div className="zsm-sub"><span>Subtotal</span><span className="zsm-sub-v">{money(subtotal)}</span></div>
            {continueBtn}
            {statusBox}
            <span className="zsm-note">Seats are held while you check out. Each pass shows its seat.</span>
          </aside>
        </div>
      ) : (
        /* ───────── PHONE ───────── */
        <div className="zsm-phone">
          <div role="tablist" aria-label="How to pick" className="zsm-tabs">
            {(['map', 'list', 'best'] as const).map((t) => (
              <button key={t} role="tab" type="button" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t === 'map' ? 'Map' : t === 'list' ? 'List' : 'Best available'}
              </button>
            ))}
          </div>
          <div className="zsm-legendrow zsm-legendrow-p">{live}</div>

          {tab === 'map' ? (
            <>
              <section aria-label="Venue overview" className="zsm-pcard">
                <span className="zsm-eyebrow-s">TAP A ZONE</span>
                <div className="zsm-stage-s">STAGE</div>
                <div className="zsm-zgrid">
                  {seatedZones.map((z) => (
                    <button key={z.id} type="button" className="zsm-zbtn" aria-pressed={activeZone !== null && zoneById.get(activeZone)?.type === 'ga' ? false : curZone?.id === z.id} onClick={() => setActiveZone(z.id)}>
                      <span className="zsm-zbtn-n">{z.name}</span>
                      <span className="zsm-zbtn-m">{zoneLeftLabel(z)}</span>
                    </button>
                  ))}
                </div>
                {gaZones.map((z) => (
                  <button key={z.id} type="button" className="zsm-zbtn zsm-zbtn-ga" aria-pressed={activeZone === z.id} onClick={() => setActiveZone(z.id)}>
                    <span className="zsm-zbtn-n">{z.name}</span>
                    <span className="zsm-zbtn-m">{zoneLeftLabel(z)}</span>
                  </button>
                ))}
              </section>
              {activeZone && zoneById.get(activeZone)?.type === 'ga' ? (
                <div className="zsm-pcard">{gaBlock(zoneById.get(activeZone)!)}</div>
              ) : curZone ? (
                <section aria-label={`${curZone.name} seats`} className="zsm-pcard">
                  <div className="zsm-phead"><span className="zsm-phead-t">{curZone.name} · {zonePriceLabel(curZone)}</span></div>
                  <div className="zsm-scroll">
                    {curZone.type === 'table' ? <div className="zsm-tables zsm-tables-p">{seatsInZone(curZone.id).map(tableButton)}</div> : seatRows(curZone, 'p')}
                  </div>
                  {legend(true)}
                  {curZone.type !== 'table' && seatsInZone(curZone.id).some((s) => (rowOf(s).num ?? 0) > 8) ? (
                    <span className="zsm-note">Swipe the rows sideways for more seats.</span>
                  ) : null}
                </section>
              ) : null}
            </>
          ) : null}

          {tab === 'list' ? (
            <div className="zsm-list">
              {seatedZones.map((z) => {
                const free = seatsInZone(z.id).filter((s) => { const v = viewState(s); return v === 'available' || v === 'pick'; });
                return (
                  <section key={z.id} aria-label={`${z.name} free seats`} className="zsm-pcard">
                    <div className="zsm-phead"><span className="zsm-phead-t">{z.name} · {zonePriceLabel(z)}</span><span className="zsm-zbtn-m">{zoneLeftLabel(z)}</span></div>
                    {free.length ? (
                      <ul className="zsm-ul">
                        {free.map((s) => {
                          const v = viewState(s);
                          const { row, num } = rowOf(s);
                          const name = s.kind === 'table' ? `${s.label} · seats ${s.seatsCount}` : row ? `Row ${row} seat ${num ?? s.label}` : `Seat ${s.label}`;
                          return (
                            <li key={s.seatId}>
                              <button type="button" className={'zsm-li' + (v === 'pick' ? ' on' : '')} aria-pressed={v === 'pick'} onClick={() => toggleSeat(s)}>
                                <span>{name}</span><span className="zsm-li-p">{v === 'pick' ? '✓ ' : ''}{money(seatPrice(s))}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : <p className="zsm-none">Sold out.</p>}
                  </section>
                );
              })}
              {gaZones.map((z) => <div key={z.id} className="zsm-pcard">{gaBlock(z)}</div>)}
            </div>
          ) : null}

          {tab === 'best' ? (
            <section aria-label="Best available" className="zsm-pcard">
              <label className="zsm-field">
                <span>ZONE</span>
                <select value={curZone?.id || ''} onChange={(e) => setActiveZone(e.target.value)}>
                  {seatedZones.map((z) => <option key={z.id} value={z.id}>{z.name} · {zoneLeftLabel(z)}</option>)}
                </select>
              </label>
              <div className="zsm-step zsm-step-row" role="group" aria-label="How many seats">
                <span className="zsm-step-lab">{curZone?.type === 'table' ? 'Tables' : 'Seats'}</span>
                <button type="button" aria-label="Fewer" disabled={bestN <= 1} onClick={() => setBestN((n) => Math.max(1, n - 1))}>−</button>
                <span className="zsm-step-n" aria-live="polite">{bestN}</span>
                <button type="button" aria-label="More" disabled={bestN >= MAX_ITEMS} onClick={() => setBestN((n) => Math.min(MAX_ITEMS, n + 1))}>+</button>
              </div>
              <button type="button" className="zsm-secondary" disabled={!curZone} onClick={() => curZone && bestAvailable(curZone.id, bestN)}>
                Find {bestN} {curZone?.type === 'table' ? (bestN === 1 ? 'table' : 'tables') : bestN === 1 ? 'seat' : 'seats together'}
              </button>
              <p className="zsm-note">We pick the best free {curZone?.type === 'table' ? 'tables' : 'seats side by side'}. They are held when you continue.</p>
            </section>
          ) : null}

          <div className="zsm-sheet">
            <span className="zsm-grab" aria-hidden="true" />
            {summary.length ? summary.map((l) => (
              <div key={l.key} className="zsm-line-top"><span className="zsm-line-t zsm-line-tp">{l.title}</span><span className="zsm-line-p">{money(l.amount)}</span></div>
            )) : <p className="zsm-none">Nothing picked yet.</p>}
            {summary.length > 1 ? <div className="zsm-line-top"><span className="zsm-line-t zsm-line-tp">Subtotal</span><span className="zsm-line-p">{money(subtotal)}</span></div> : null}
            {statusBox}
            {continueBtn}
          </div>
        </div>
      )}

      <CheckoutFlow
        open={checkoutOpen}
        onClose={onCloseCheckout}
        eventName={ev?.name || 'Your event'}
        eventId={eventId}
        when={[ev?.dateLabel, ev?.venue].filter(Boolean).join(' · ').toUpperCase() || undefined}
        tiers={cartTiers}
        seatMode
        organizerHandle={ev?.organizerHandle}
        dateLabel={ev?.dateLabel}
        venue={ev?.venue}
        city={CITIES.find((c) => c.id === ev?.city)?.city || ev?.city}
        artwork={ev?.cover}
        onSeatTaken={onSeatTaken}
        onHold={onHold}
        onResult={(status) => {
          if (status === 'paid') {
            paidRef.current = true; setHoldUntil(null);
            setMessage({ strong: 'Paid. Your passes are live.', rest: 'Each pass shows its seat.' });
          }
        }}
      />
    </div>
  );
}

const STYLE = `
.zsm{min-height:100vh;background:var(--zp-color-bone);color:var(--zp-color-board-black);font-family:var(--zp-font-family-sans);font-size:16px}
.zsm *{box-sizing:border-box}
.zsm button{font-family:inherit;cursor:pointer}
.zsm button:focus-visible,.zsm a:focus-visible,.zsm select:focus-visible{outline:3px solid var(--zp-color-board-black);outline-offset:2px}
.zsm-top{height:64px;padding:0 32px;display:flex;align-items:center;gap:24px;border-bottom:1px solid var(--zp-color-line-light)}
.zsm-back{font-family:var(--zp-font-family-mono);font-size:13px;letter-spacing:.08em;color:var(--zp-color-board-black);text-decoration:none;min-height:44px;display:flex;align-items:center}
.zsm-title{font-weight:700;font-size:20px;margin:0 auto;text-align:center;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.zsm-hold{font-family:var(--zp-font-family-mono);font-size:13px;letter-spacing:.08em;background:var(--zp-color-board-black);color:var(--zp-color-signal-yellow);border-radius:999px;padding:8px 14px;white-space:nowrap}
.zsm-hold-gap{width:1px}
.zsm-loading{padding:48px 32px;font-family:var(--zp-font-family-mono);font-size:13px;letter-spacing:.08em}
.zsm-desk{padding:24px 32px;display:flex;gap:32px;align-items:flex-start}
.zsm-main{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:16px}
.zsm-legendrow{display:flex;gap:20px;flex-wrap:wrap;align-items:center}
.zsm-legend{display:flex;gap:20px;flex-wrap:wrap;font-family:var(--zp-font-family-mono);font-size:12px;letter-spacing:.08em;align-items:center}
.zsm-legend span{display:flex;gap:8px;align-items:center}
.zsm-legend-c{gap:10px;font-size:12px;letter-spacing:.06em;margin-top:4px}
.zsm-legend-c span{gap:4px}
.zsm-key{width:18px;height:18px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-style:normal;font-size:12px;border:2px solid var(--zp-color-board-black)}
.zsm-legend-c .zsm-key{width:14px;height:14px;border-radius:3px;font-size:10px}
.zsm-live{margin-left:auto;font-family:var(--zp-font-family-mono);font-size:12px;letter-spacing:.08em;color:var(--zp-color-ink-500)}
.zsm-card{background:var(--zp-color-white);border:2px solid var(--zp-color-board-black);border-radius:16px;padding:24px;display:flex;flex-direction:column;gap:20px;align-items:center}
.zsm-stage{width:min(520px,100%);height:44px;border-radius:12px;background:var(--zp-color-board-black);color:var(--zp-color-signal-yellow);display:flex;align-items:center;justify-content:center;font-family:var(--zp-font-family-display);font-size:20px}
.zsm-zones{display:flex;gap:28px;width:100%;flex-wrap:wrap}
.zsm-zone{display:flex;flex-direction:column;gap:10px;min-width:0;overflow-x:auto}
.zsm-zone-table{flex:0 0 250px}
.zsm-zone-seated{flex:1 1 auto;max-width:100%}
.zsm-zlab{font-family:var(--zp-font-family-mono);font-size:12px;letter-spacing:.12em}
.zsm-tables{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.zsm-rows{display:flex;flex-direction:column;gap:6px}
.zsm-row{display:flex;gap:6px;align-items:center}
.zsm-rowlab{width:18px;flex:none;font-family:var(--zp-font-family-mono);font-size:12px}
.zsm-seat{flex:none;padding:0;border-radius:6px;font-family:var(--zp-font-family-mono);font-size:12px;display:inline-flex;align-items:center;justify-content:center}
.zsm-d{width:28px;height:28px}
.zsm-p{width:36px;height:36px;border-radius:7px}
.zsm-table{height:64px;border-radius:999px;font-family:var(--zp-font-family-mono);font-size:13px;font-weight:600}
.zsm-available{border:2px solid var(--zp-color-board-black);background:var(--zp-color-white);color:var(--zp-color-board-black)}
.zsm-pick{border:2px solid var(--zp-color-board-black);background:var(--zp-color-signal-yellow);color:var(--zp-color-board-black)}
.zsm-held{border:2px dashed var(--zp-color-ink-500);background:var(--zp-color-line-light);color:var(--zp-color-board-black)}
.zsm-sold{border:2px solid var(--zp-color-board-black);background:var(--zp-color-board-black);color:var(--zp-color-bone)}
.zsm-reserved{border:2px solid var(--zp-color-ink-500);background:var(--zp-color-ink-500);color:var(--zp-color-bone)}
.zsm-seat[aria-disabled="true"],.zsm-table[aria-disabled="true"]{cursor:not-allowed}
.zsm-ga{width:100%;min-height:120px;border-radius:12px;border:2px solid var(--zp-color-board-black);background:var(--zp-color-bone);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px}
.zsm-ga-name{font-family:var(--zp-font-family-display);font-size:20px;text-align:center}
.zsm-ga-meta{font-family:var(--zp-font-family-mono);font-size:13px;text-align:center}
.zsm-step{display:flex;align-items:center;gap:14px}
.zsm-step button{width:44px;height:44px;border-radius:50%;border:2px solid var(--zp-color-board-black);background:var(--zp-color-white);color:var(--zp-color-board-black);font-size:20px}
.zsm-step button:disabled{opacity:.35;cursor:not-allowed}
.zsm-step-n{font-family:var(--zp-font-family-mono);font-size:18px;min-width:24px;text-align:center}
.zsm-step-row{justify-content:space-between}
.zsm-step-lab{font-weight:700;margin-right:auto}
.zsm-aside{width:360px;flex:none;background:var(--zp-color-white);border:2px solid var(--zp-color-board-black);border-radius:16px;padding:24px;display:flex;flex-direction:column;gap:16px;position:sticky;top:24px}
.zsm-eyebrow{font-family:var(--zp-font-family-mono);font-size:12px;letter-spacing:.12em;color:var(--zp-color-ink-500)}
.zsm-line{display:flex;flex-direction:column;gap:2px}
.zsm-line-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.zsm-line-t{font-size:18px;font-weight:700}
.zsm-line-tp{font-size:16px}
.zsm-line-p{font-family:var(--zp-font-family-mono);font-size:16px;white-space:nowrap}
.zsm-line-s{font-size:14px;color:var(--zp-color-ink-500)}
.zsm-none{margin:0;font-size:14px;color:var(--zp-color-ink-500)}
.zsm-sub{border-top:2px solid var(--zp-color-board-black);padding-top:14px;display:flex;justify-content:space-between;align-items:baseline;font-weight:700}
.zsm-sub-v{font-family:var(--zp-font-family-mono);font-size:20px;font-weight:600}
.zsm-primary{height:56px;width:100%;border:none;border-radius:16px;background:var(--zp-color-board-black);color:var(--zp-color-signal-yellow);display:flex;align-items:center;justify-content:space-between;padding:0 24px;font-family:var(--zp-font-family-display)!important;font-size:20px}
.zsm-primary:hover{background:var(--zp-color-ink-700)}
.zsm-primary:active{transform:translateY(2px)}
.zsm-primary:disabled{opacity:.4;cursor:not-allowed;transform:none}
.zsm-secondary{height:48px;width:100%;border:2px solid var(--zp-color-board-black);border-radius:16px;background:transparent;color:var(--zp-color-board-black);font-weight:700;font-size:16px}
.zsm-secondary:disabled{opacity:.4;cursor:not-allowed}
.zsm-status{background:var(--zp-color-bone);border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.4}
.zsm-status.zsm-empty{display:none}
.zsm-note{font-size:13px;color:var(--zp-color-ink-500)}
.zsm-phone{padding:14px 16px 260px;display:flex;flex-direction:column;gap:14px}
.zsm-tabs{display:flex;border:2px solid var(--zp-color-board-black);border-radius:12px;overflow:hidden}
.zsm-tabs button{flex:1;min-height:44px;border:none;background:var(--zp-color-white);color:var(--zp-color-board-black);font-weight:700;font-size:14px;white-space:nowrap;padding:0 4px}
.zsm-tabs button+button{border-left:2px solid var(--zp-color-board-black)}
.zsm-tabs button.on{background:var(--zp-color-board-black);color:var(--zp-color-signal-yellow)}
.zsm-legendrow-p .zsm-live{margin-left:0}
.zsm-pcard{background:var(--zp-color-white);border:2px solid var(--zp-color-board-black);border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:8px}
.zsm-eyebrow-s{font-family:var(--zp-font-family-mono);font-size:12px;letter-spacing:.12em}
.zsm-stage-s{height:26px;border-radius:8px;background:var(--zp-color-board-black);color:var(--zp-color-signal-yellow);display:flex;align-items:center;justify-content:center;font-family:var(--zp-font-family-mono);font-size:12px;letter-spacing:.12em}
.zsm-zgrid{display:flex;gap:8px;flex-wrap:wrap}
.zsm-zbtn{flex:1 1 120px;min-height:72px;border-radius:10px;border:2px solid var(--zp-color-board-black);background:var(--zp-color-white);color:var(--zp-color-board-black);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:6px}
.zsm-zbtn[aria-pressed="true"]{border-width:3px;background:var(--zp-color-signal-yellow)}
.zsm-zbtn-ga{flex:none;min-height:52px;border-style:dashed;background:var(--zp-color-bone)}
.zsm-zbtn-n{font-weight:700;font-size:14px}
.zsm-zbtn-m{font-family:var(--zp-font-family-mono);font-size:12px}
.zsm-phead{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.zsm-phead-t{font-weight:700}
.zsm-scroll{overflow-x:auto;padding-bottom:4px}
.zsm-scroll .zsm-row{gap:4px}
.zsm-scroll .zsm-rowlab{width:14px}
.zsm-tables-p{grid-template-columns:repeat(3,minmax(72px,1fr))}
.zsm-list{display:flex;flex-direction:column;gap:14px}
.zsm-ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.zsm-li{width:100%;min-height:48px;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 4px;border:none;border-bottom:1px solid var(--zp-color-line-light);background:none;color:var(--zp-color-board-black);font-size:16px;text-align:left}
.zsm-li.on{background:var(--zp-color-signal-yellow)}
.zsm-li-p{font-family:var(--zp-font-family-mono);font-size:14px;white-space:nowrap}
.zsm-field{display:flex;flex-direction:column;gap:6px}
.zsm-field span{font-family:var(--zp-font-family-mono);font-size:12px;letter-spacing:.12em}
.zsm-field select{height:48px;border:2px solid var(--zp-color-board-black);border-radius:12px;background:var(--zp-color-white);font:16px var(--zp-font-family-sans);padding:0 12px;color:var(--zp-color-board-black)}
.zsm-sheet{position:fixed;left:0;right:0;bottom:0;z-index:20;background:var(--zp-color-bone);border-top:2px solid var(--zp-color-board-black);border-radius:16px 16px 0 0;padding:14px 16px 20px;display:flex;flex-direction:column;gap:10px;max-height:60vh;overflow-y:auto}
.zsm-sheet .zsm-status{background:var(--zp-color-white);font-size:14px;padding:8px 10px}
.zsm-grab{width:40px;height:4px;border-radius:999px;background:var(--zp-color-ink-300);align-self:center}
@media (max-width:899px){
  .zsm-top{height:56px;padding:0 8px 0 4px;gap:4px}
  .zsm-back{width:44px;justify-content:center;font-size:22px;font-family:var(--zp-font-family-sans)}
  .zsm-title{font-size:17px;margin:0;flex-grow:1;text-align:left}
  .zsm-hold{font-size:12px;padding:6px 10px}
}
`;
