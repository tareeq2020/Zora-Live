'use client';

/* BS122 — CHECKOUT v2 (web-premium-v1 F3 / DD6), behind the zp_checkout_v2 flag.

   Visual spec: the approved CheckoutPasses / CheckoutPay (desktop) and
   CheckoutPhonePasses / CheckoutPhonePay (phone) mockups + 03_COMPONENTS §1/§7.

   Layout: a full-screen bone page. Desktop = action column + summary column
   (artwork, name, mono date · time, venue · city, line items, Subtotal, Service
   fee or "All fees included.", Total, the ONE primary button). Phone = compact
   event strip on top, totals + primary button in a sticky bottom bar.

   Two input steps:
     1 · PASSES          tiers with 48px steppers; group options inline at 2+
     2 · DETAILS + PAY   name, +255 phone, email, 18+, method group — the mobile
                         network is derived from the number (no network screen)
   then poll → result. The hold countdown chip appears once the order exists.

   Payment API calls are IDENTICAL to v1 (same bodies, same endpoints):
     POST /api/checkout → POST /api/checkout/:orderId/pay → GET /api/orders/:id/status.
   Newer API reads degrade to v1 behaviour when the API hasn't been redeployed:
     GET /api/payment-methods fails → Mobile money + Card.
     checkout response without subtotal/fee → total only.
     GET /api/settings feeRate (pre-order estimate) missing → no fee estimate.
   The amount charged is always the server's `total`; if it differs from the
   amount on the button when the order is created, we stop and show it first.

   BS134 (F7): step 2 offers "Pay in installments" when the server quotes a plan
   for this cart (GET /api/events/:id/installments/quote — flag zp_installments +
   the organizer's offer). No quote (flag off, tier not offered, old API, 404) →
   the option is simply absent. Choosing it creates the order through
   POST /api/checkout/installments and the same pay call charges the deposit
   (row 1); the result is "Booked — 1 of N paid." with CHECK MY PASS → /pay/:id. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { SUPPORT_EMAIL } from '@zora/core/contacts';
import { trackProductEvent } from './product-analytics';
import { stockStatus } from './event-card';
import type { CheckoutFlowProps, CheckoutTier } from './checkout-types';
import { dayLabel, ruleText, type InstallmentQuote, type ScheduleRow } from '../lib/installments';

type Step = 'passes' | 'details' | 'poll' | 'done';
type Method = 'mobile' | 'billpay' | 'card';
type MethodGroup = { id: Method; label: string };
type Pool = { tierId: string; available: number; capacity?: number };
type Order = {
  orderId: string;
  total: number;
  subtotal?: number;
  fee?: number;
  currency?: string;
  holdExpiresAt?: string;
  /** BS134: present when the order is an installment plan (deposit = row 1). */
  installments?: { deposit: number; finalDue: string; graceDays: number; schedule: ScheduleRow[] };
};
type Plan = 'full' | 'installments';
type Credential = { qr: string; code: string; publicRef: string; tier: string; state: string; seatLabel?: string };
type Notice = { kind: 'error' | 'info'; text: string } | null;

// Today's behaviour when GET /api/payment-methods is unavailable.
const FALLBACK_GROUPS: MethodGroup[] = [
  { id: 'mobile', label: 'Mobile money' },
  { id: 'card', label: 'Card' },
];
// The pay endpoint accepts exactly these; a group the API lists that the pay
// contract can't take yet (e.g. QR before x-bridge ships it) is not offered.
const PAYABLE: ReadonlySet<string> = new Set(['mobile', 'billpay', 'card']);

const POLL_MS = 3000;
const POLL_MAX = 60;
const TERMINAL = new Set(['paid', 'payment_short', 'paid_unseatable', 'failed', 'expired']);

// 04_UI_COPY §5
const COPY = {
  payFailed: 'That payment didn’t go through. Try again, or use another method.',
  expired: 'That took too long. Start again — nothing was charged.',
  soldOut: 'The last passes went while you were paying. Nothing was charged — join the waitlist?',
  network: 'No connection. Check your signal and try again.',
};

const fmt = (n: number) => n.toLocaleString('en-US');
const curLabel = (c: string) => (c === 'TZS' ? 'TSh' : c);

/* Mobile-money network from a Tanzanian number (the 9 digits after +255). The
   result is only the routing hint the pay call already takes as `mno` (same ids
   v1's picker sent: VODACOM / TIGO / AIRTEL / HALOTEL); an unknown prefix sends
   none and the route map's default applies. */
const PREFIX_MNO: Record<string, { id: string; name: string }> = {
  '74': { id: 'VODACOM', name: 'Vodacom' },
  '75': { id: 'VODACOM', name: 'Vodacom' },
  '76': { id: 'VODACOM', name: 'Vodacom' },
  '65': { id: 'TIGO', name: 'Yas' },
  '67': { id: 'TIGO', name: 'Yas' },
  '71': { id: 'TIGO', name: 'Yas' },
  '77': { id: 'TIGO', name: 'Yas' },
  '68': { id: 'AIRTEL', name: 'Airtel' },
  '69': { id: 'AIRTEL', name: 'Airtel' },
  '78': { id: 'AIRTEL', name: 'Airtel' },
  '61': { id: 'HALOTEL', name: 'Halotel' },
  '62': { id: 'HALOTEL', name: 'Halotel' },
};
export function networkFromNumber(local9: string): { id: string; name: string } | null {
  return local9.length >= 2 ? PREFIX_MNO[local9.slice(0, 2)] || null : null;
}

/** Keep the 9 local digits: drop non-digits, a leading 255 or 0. */
function localDigits(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('255')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 9);
}
const groupPhone = (d: string) => [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean).join(' ');

function useCountdown(iso?: string): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!iso) {
      setLeft(null);
      return;
    }
    const end = new Date(iso).getTime();
    if (Number.isNaN(end)) {
      setLeft(null);
      return;
    }
    const tick = () => setLeft(Math.max(0, Math.round((end - Date.now()) / 1000)));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [iso]);
  return left;
}
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function CheckoutFlowV2({
  open,
  onClose,
  eventName,
  eventId,
  tiers,
  artwork,
  dateLabel,
  time,
  venue,
  city,
  onSeatTaken,
  onHold,
  onResult,
}: CheckoutFlowProps) {
  const currency = tiers[0]?.currency || 'TZS';
  const money = (n: number) => `${curLabel(currency)} ${fmt(n)}`;
  const splitHref = (t: CheckoutTier) =>
    `/split/new?tier=${encodeURIComponent(t.tierId)}&event=${encodeURIComponent(eventName)}&price=${t.unitPrice}&cap=${t.seats || 8}`;

  const [step, setStep] = useState<Step>('passes');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [pools, setPools] = useState<Record<string, Pool> | null>(null);
  const [invError, setInvError] = useState(false);
  const [feeRate, setFeeRate] = useState<number | null>(null);
  const [groups, setGroups] = useState<MethodGroup[]>(FALLBACK_GROUPS);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState(''); // 9 local digits
  const [email, setEmail] = useState('');
  const [ageAttested, setAgeAttested] = useState(false);
  const [method, setMethod] = useState<Method>('mobile');

  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [billPayNumber, setBillPayNumber] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [statusVal, setStatusVal] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  // BS134: installments — the server quote for the current cart, and the choice.
  const [quote, setQuote] = useState<InstallmentQuote | null>(null);
  const [plan, setPlan] = useState<Plan>('full');
  const [booked, setBooked] = useState<{ paidCount: number; count: number; schedule: ScheduleRow[] } | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCount = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // ── reset + live reads every time the checkout opens ──
  useEffect(() => {
    if (!open) return;
    trackProductEvent('web_checkout_opened', { eventId, eventName, count: tiers.length, source: 'checkout_v2' });
    setStep('passes');
    const init: Record<string, number> = {};
    for (const t of tiers) if (t.seatIds?.length) init[t.tierId] = t.seatIds.length;
    else if (t.quantity && t.quantity > 0) init[t.tierId] = t.quantity; // BS126: GA picked on the seat map
    if (!Object.keys(init).length && tiers.length === 1) init[tiers[0].tierId] = 1;
    setQty(init);
    setOrder(null);
    setNotice(null);
    setBillPayNumber(null);
    setRedirectUrl(null);
    setStatusVal(null);
    setCredentials([]);
    setQuote(null);
    setPlan('full');
    setBooked(null);
    setBusy(false);
    pollCount.current = 0;
    setPools(null);
    setInvError(false);
    fetch('/api/inventory', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { pools?: Pool[] }) => {
        const map: Record<string, Pool> = {};
        for (const p of d.pools || []) map[p.tierId] = p;
        setPools(map);
      })
      .catch(() => setInvError(true));
    // Fee estimate before the order exists (server: fee = round(subtotal × feeRate)).
    fetch('/api/settings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { feeRate?: number } | null) => setFeeRate(typeof d?.feeRate === 'number' ? d.feeRate : d ? 0 : null))
      .catch(() => setFeeRate(null));
    // Method groups from the API; any failure keeps today's Mobile money + Card.
    fetch('/api/payment-methods', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { groups?: Array<{ id: string; label: string; enabled: boolean }> } | null) => {
        const g = (d?.groups || [])
          .filter((x) => x && x.enabled && PAYABLE.has(x.id))
          .map((x) => ({ id: x.id as Method, label: x.label }));
        setGroups(g.length ? g : FALLBACK_GROUPS);
      })
      .catch(() => setGroups(FALLBACK_GROUPS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (groups.length && !groups.some((g) => g.id === method)) setMethod(groups[0].id);
  }, [groups, method]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);
  useEffect(() => () => stopPolling(), [stopPolling]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step !== 'poll') onClose();
      // BS137: keep Tab inside the modal (aria-modal alone does not stop it).
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const els = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      const inside = dialogRef.current.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, step]);
  // BS137: move focus into the dialog when it opens, and back where it was on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => prev?.focus?.();
  }, [open]);

  // ── hold countdown ──
  const holdLeft = useCountdown(order?.holdExpiresAt);
  useEffect(() => {
    if (holdLeft === 0 && order && step === 'details' && !busy) {
      setOrder(null);
      setNotice({ kind: 'error', text: COPY.expired });
      setStep('passes');
    }
  }, [holdLeft, order, step, busy]);

  const availOf = (tierId: string) => {
    if (!pools) return Infinity;
    const p = pools[tierId];
    return p ? Number(p.available) || 0 : 0;
  };
  const lines = useMemo(() => tiers.map((t) => ({ tier: t, q: qty[t.tierId] || 0 })).filter((l) => l.q > 0), [tiers, qty]);
  const passCount = lines.reduce((n, l) => n + l.q, 0);
  const estSubtotal = lines.reduce((s, l) => s + l.tier.unitPrice * l.q, 0);
  const estFee = feeRate != null ? Math.round(estSubtotal * feeRate) : null;
  const splitLine = lines.find((l) => l.tier.split);

  // BS134: ask the server for an installment quote for this exact cart once the
  // buyer reaches step 2. Any failure → no installment option (pay in full only).
  const cartKey = lines.map((l) => `${l.tier.tierId}:${l.q}`).join(',');
  useEffect(() => {
    if (!open || step !== 'details' || !eventId || !lines.length || order) return;
    let live = true;
    const qs = new URLSearchParams({
      tier: lines.map((l) => l.tier.tierId).join(','),
      qty: lines.map((l) => String(l.q)).join(','),
    });
    fetch(`/api/events/${encodeURIComponent(eventId)}/installments/quote?${qs.toString()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: (InstallmentQuote & { offered?: boolean }) | null) => {
        if (!live) return;
        const ok = !!d && d.offered === true && Array.isArray(d.schedule) && d.schedule.length >= 2 && typeof d.deposit === 'number';
        setQuote(ok ? d : null);
        if (!ok) setPlan('full');
      })
      .catch(() => {
        if (live) {
          setQuote(null);
          setPlan('full');
        }
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, eventId, cartKey, order]);

  // Figures shown in the summary: server-authoritative once the order exists.
  // BS134: with installments chosen, the server quote is authoritative pre-order.
  const fromQuote = !order && plan === 'installments' && quote ? quote : null;
  const subtotal = order ? order.subtotal ?? null : fromQuote ? fromQuote.subtotal : estSubtotal;
  const fee = order ? order.fee ?? null : fromQuote ? fromQuote.fee : estFee;
  const total = order ? order.total : fromQuote ? fromQuote.total : estSubtotal + (estFee || 0);
  // BS134: installments — the deposit is what PAY charges now.
  const instOn = plan === 'installments' && (!!order?.installments || (!order && !!quote));
  const instSchedule: ScheduleRow[] = order?.installments?.schedule || quote?.schedule || [];
  const dueToday = instOn ? order?.installments?.deposit ?? quote?.deposit ?? null : null;
  const instGrace = order?.installments?.graceDays ?? quote?.graceDays ?? 0;
  const payNow = dueToday != null ? dueToday : total;

  function setTierQty(t: CheckoutTier, next: number) {
    if (t.seatIds?.length) return; // seat picks fix the quantity
    const cap = Math.min(10, availOf(t.tierId));
    setQty((prev) => ({ ...prev, [t.tierId]: Math.max(0, Math.min(cap, next)) }));
  }

  function toDetails() {
    setNotice(null);
    if (!passCount) return setNotice({ kind: 'error', text: 'Add at least one pass.' });
    setStep('details');
  }
  function backToPasses() {
    // The cart can change, so a held order no longer matches it — let it lapse.
    setOrder(null);
    setNotice(null);
    setStep('passes');
  }

  function validateDetails(): string | null {
    if (phone.length !== 9) return 'Enter your phone number.';
    if (!email.trim()) return 'Enter your email.';
    if ((method === 'billpay' || method === 'card') && !name.trim()) return 'Enter your name.';
    if (!ageAttested) return 'Please confirm you are 18 or older.';
    if (!passCount) return 'Add at least one pass.';
    return null;
  }

  const fullPhone = `+255${phone}`;
  const mno = networkFromNumber(phone);

  // ── POST /api/checkout (body identical to v1, plus seatIds when picked) ──
  async function createOrder(): Promise<Order | null> {
    const viaInstallments = plan === 'installments' && !!quote;
    const res = await fetch(viaInstallments ? '/api/checkout/installments' : '/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: fullPhone,
        email: email.trim(),
        ageAttested,
        cart: lines.map((l) => ({
          tier: l.tier.tierId,
          quantity: l.q,
          ...(l.tier.seatIds?.length ? { seatIds: l.tier.seatIds } : {}),
        })),
        method,
        network: method === 'mobile' ? mno?.id : undefined,
      }),
    });
    if (res.status === 200) {
      const d = (await res.json()) as Order;
      const o: Order = {
        orderId: d.orderId,
        total: d.total,
        subtotal: typeof d.subtotal === 'number' ? d.subtotal : undefined,
        fee: typeof d.fee === 'number' ? d.fee : undefined,
        currency: d.currency,
        holdExpiresAt: d.holdExpiresAt,
        ...(d.installments && Array.isArray(d.installments.schedule) ? { installments: d.installments } : {}),
      };
      if (viaInstallments && !o.installments) {
        // An API that ignored the plan would charge the full total — never do that.
        setNotice({ kind: 'error', text: 'Installments aren’t available right now. Pay in full instead.' });
        setQuote(null);
        setPlan('full');
        return null;
      }
      setOrder(o);
      onHold?.(d.holdExpiresAt || null);
      trackProductEvent('web_checkout_started', { eventId, eventName, count: passCount, amount: d.total, currency, method });
      return o;
    }
    if (res.status === 409) {
      const d = await res.json().catch(() => ({}));
      if (d.error === 'seat_taken' && onSeatTaken) {
        // BS126: the seat map marks the taken seat and keeps the other picks.
        onSeatTaken(Array.isArray(d.seats) ? d.seats : []);
        onClose();
        return null;
      }
      if (d.error === 'seat_taken') {
        setNotice({ kind: 'error', text: 'One of those seats just went. Nothing was charged — pick another.' });
      } else {
        setPools((prev) => (d.tier ? { ...(prev || {}), [d.tier]: { tierId: d.tier, available: 0, capacity: prev?.[d.tier]?.capacity } } : prev));
        setQty((prev) => (d.tier ? { ...prev, [d.tier]: 0 } : prev));
        setNotice({ kind: 'error', text: COPY.soldOut });
      }
      setStep('passes');
      return null;
    }
    if (viaInstallments && (res.status === 403 || res.status === 422 || res.status === 404)) {
      const d = await res.json().catch(() => ({}));
      setQuote(null);
      setPlan('full');
      setNotice({
        kind: 'error',
        text: d.error === 'schedule_rejected' && d.message ? d.message : 'Installments aren’t available for this order. Pay in full instead.',
      });
      return null;
    }
    if (res.status === 503) {
      const retry = Number(res.headers.get('Retry-After')) || 0;
      const d = await res.json().catch(() => ({}));
      setNotice({
        kind: 'error',
        text:
          d.error === 'sales_paused'
            ? `Sales are briefly paused. Please try again${retry ? ` in about ${retry >= 60 ? `${Math.round(retry / 60)} min` : `${retry}s`}` : ' shortly'}.`
            : `We're at capacity for a moment${retry ? ` — retry in ${retry}s` : ''}. Hang tight and try again.`,
      });
      return null;
    }
    const d = await res.json().catch(() => ({}));
    setNotice({ kind: 'error', text: validationMessage(d.error) });
    return null;
  }

  // ── POST /api/checkout/:orderId/pay (body identical to v1) ──
  async function startPayment(o: Order) {
    const res = await fetch(`/api/checkout/${encodeURIComponent(o.orderId)}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method,
        payerPhone: fullPhone,
        payerName: name.trim() || undefined,
        mno: method === 'mobile' ? mno?.id : undefined,
      }),
    });
    if (res.status !== 200) {
      const d = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const secs = Number(res.headers.get('Retry-After')) || Number(d.retryAfterSecs) || 600;
        const mins = Math.max(1, Math.ceil(secs / 60));
        setNotice({ kind: 'error', text: `Too many payment prompts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
        return;
      }
      if (d.error === 'order_not_found' || d.error === 'not_payable') {
        setOrder(null);
        setNotice({ kind: 'error', text: COPY.expired });
        setStep('passes');
        return;
      }
      if (d.error === 'inventory_unavailable') {
        setOrder(null);
        setNotice({ kind: 'error', text: COPY.soldOut });
        setStep('passes');
        return;
      }
      setNotice({ kind: 'error', text: COPY.payFailed });
      return;
    }
    const d = await res.json();
    trackProductEvent('web_payment_started', { eventId, eventName, amount: o.installments ? o.installments.deposit : o.total, currency, method });
    setBillPayNumber(d.billPayNumber || null);
    setRedirectUrl(d.redirectUrl || null);
    if (method === 'card' && d.redirectUrl) window.open(d.redirectUrl, '_blank', 'noopener');
    setStatusVal('pending');
    setStep('poll');
    startPolling(o.orderId);
  }

  async function pay() {
    setNotice(null);
    const err = validateDetails();
    if (err) return setNotice({ kind: 'error', text: err });
    setBusy(true);
    try {
      let o = order;
      if (!o) {
        const shown = total;
        const shownToday = dueToday;
        const shownQuoteTotal = quote?.total;
        o = await createOrder();
        if (!o) return;
        // Never charge a number the buyer hasn't seen: if the server's total
        // differs from the button (e.g. a service fee we couldn't estimate),
        // stop here — the summary and button now show the real total.
        if (o.installments) {
          if (o.installments.deposit !== shownToday || o.total !== shownQuoteTotal) {
            setNotice({ kind: 'info', text: `Due today is ${money(o.installments.deposit)} of ${money(o.total)}. Check it, then pay.` });
            return;
          }
        } else if (o.total !== shown) {
          setNotice({ kind: 'info', text: `Your total is ${money(o.total)}. Check it, then pay.` });
          return;
        }
      }
      await startPayment(o);
    } catch {
      setNotice({ kind: 'error', text: COPY.network });
    } finally {
      setBusy(false);
    }
  }

  // ── GET /api/orders/:orderId/status ──
  function startPolling(orderId: string) {
    stopPolling();
    pollCount.current = 0;
    const tick = async () => {
      pollCount.current += 1;
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, { cache: 'no-store' });
        if (res.ok) {
          const d = (await res.json()) as {
            status: string;
            credentials?: Credential[];
            installments?: { paidCount: number; count: number; schedule: ScheduleRow[] };
          };
          setStatusVal(d.status);
          // BS134: a cleared deposit moves the order to installment_active — booked.
          if (d.status === 'installment_active') {
            stopPolling();
            onResult?.(d.status);
            setBooked(
              d.installments && Array.isArray(d.installments.schedule)
                ? { paidCount: d.installments.paidCount, count: d.installments.count, schedule: d.installments.schedule }
                : null,
            );
            setStep('done');
            return;
          }
          if (TERMINAL.has(d.status)) {
            stopPolling();
            onResult?.(d.status);
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
    setStep('details');
  }
  function startAgain() {
    stopPolling();
    setOrder(null);
    setNotice(null);
    setStatusVal(null);
    setStep('passes');
  }

  if (!open) return null;

  const when = [(dateLabel || '').toUpperCase(), time].filter(Boolean).join(' · ');
  const where = [venue, city].filter(Boolean).join(' · ');
  const inFlow = step === 'passes' || step === 'details';
  const ctaLabel = step === 'passes' ? 'CONTINUE' : `PAY ${curLabel(currency).toUpperCase()} ${fmt(payNow)}`;
  const ctaDisabled = busy || !passCount || (step === 'details' && holdLeft === 0);
  const onCta = step === 'passes' ? toDetails : pay;
  const ctaHint =
    step === 'details'
      ? method === 'mobile'
        ? phone.length === 9
          ? `A prompt goes to +255 ${groupPhone(phone)}. Enter your PIN.`
          : 'We send a payment prompt to your phone.'
        : method === 'card'
          ? 'You finish on a secure card page.'
          : 'You get a control number to pay from your bank or mobile money.'
      : null;

  const Totals = ({ compact }: { compact?: boolean }) => (
    <div className={'zc2-totals' + (compact ? ' compact' : '')}>
      {!compact
        ? lines.map((l) => (
            <div className="zc2-row" key={l.tier.tierId}>
              <span>
                {l.q} × {l.tier.name}
              </span>
              <span className="zc2-num">{money(l.tier.unitPrice * l.q)}</span>
            </div>
          ))
        : null}
      {subtotal != null && (!compact || (fee != null && fee > 0 && !instOn)) ? (
        <div className="zc2-row zc2-sub">
          <span>Subtotal</span>
          <span className="zc2-num">{money(subtotal)}</span>
        </div>
      ) : null}
      {fee != null && fee > 0 && !(compact && instOn) ? (
        <div className="zc2-row zc2-sub">
          <span>Service fee</span>
          <span className="zc2-num">{money(fee)}</span>
        </div>
      ) : null}
      {instOn && dueToday != null ? (
        <>
          <div className="zc2-row zc2-sub">
            <span>{compact && fee != null && fee > 0 ? `Total incl. ${money(fee)} fee` : 'Total'}</span>
            <span className="zc2-num">{money(total)}</span>
          </div>
          <div className="zc2-total">
            <span>Due today</span>
            <span className="zc2-num">{money(dueToday)}</span>
          </div>
        </>
      ) : (
        <div className="zc2-total">
          <span>Total</span>
          <span className="zc2-num">{passCount ? money(total) : '—'}</span>
        </div>
      )}
      {fee === 0 ? (
        <p className="zc2-fine">All fees included.</p>
      ) : fee == null && !order ? (
        <p className="zc2-fine">Fees are shown before you pay.</p>
      ) : null}
    </div>
  );

  const Cta = () => (
    <button type="button" className="zc2-primary" disabled={ctaDisabled} onClick={onCta} aria-busy={busy}>
      <span>{ctaLabel}</span>
      {busy ? <span className="zc2-spin" aria-hidden="true" /> : <span aria-hidden="true">→</span>}
    </button>
  );

  const Thumb = ({ small }: { small?: boolean }) => (
    <div className={'zc2-thumb' + (small ? ' small' : '')}>
      {artwork ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={artwork} alt={eventName} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="zc2-thumb-stamp" src="/brand/stamps/svg/zp-stamp-zorapass-dar-signal.svg" alt="" aria-hidden="true" />
      )}
    </div>
  );

  return (
    <div className="zc2" role="dialog" aria-modal="true" aria-label={`Get passes for ${eventName}`} ref={dialogRef} tabIndex={-1}>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <header className="zc2-head">
        {step === 'details' ? (
          <button type="button" className="zc2-back" onClick={backToPasses} aria-label="Back to passes">
            ← <span className="zc2-back-lab">PASSES</span>
          </button>
        ) : (
          <button type="button" className="zc2-back" onClick={onClose} aria-label="Back to event" disabled={step === 'poll'}>
            ← <span className="zc2-back-lab">BACK TO EVENT</span>
          </button>
        )}
        <span className="zc2-brand">
          <span className="zc2-brand-desk">ZoraPass</span>
          <span className="zc2-brand-phone">{step === 'details' ? 'Details + pay' : step === 'passes' ? 'Passes' : 'ZoraPass'}</span>
        </span>
        {order && holdLeft != null && holdLeft > 0 && step !== 'done' ? (
          <span className="zc2-hold" role="timer" aria-label={`Passes held for ${mmss(holdLeft)}`}>
            <span className="zc2-hold-long">PASSES </span>HELD {mmss(holdLeft)}
          </span>
        ) : (
          <span className="zc2-hold-spacer" />
        )}
      </header>

      {/* phone-only event strip */}
      <div className="zc2-strip">
        <Thumb small />
        <div className="zc2-ev">
          <span className="zc2-ev-name">{eventName}</span>
          {when ? <span className="zc2-ev-when">{when}</span> : null}
          {where ? <span className="zc2-ev-where">{where}</span> : null}
        </div>
      </div>

      <div className="zc2-wrap">
        <main className="zc2-main">
          {inFlow ? (
            <ol className="zc2-steps">
              <li className={step === 'passes' ? 'on' : ''} aria-current={step === 'passes' ? 'step' : undefined}>
                1 · PASSES{step === 'details' ? ' ✓' : ''}
              </li>
              <li className={step === 'details' ? 'on' : ''} aria-current={step === 'details' ? 'step' : undefined}>
                2 · DETAILS + PAY
              </li>
            </ol>
          ) : null}

          {notice ? (
            <div className={'zc2-notice ' + notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>
              {notice.text}
            </div>
          ) : null}

          {/* ── 1 · PASSES ── */}
          {step === 'passes' ? (
            <>
              <h1 className="zc2-h1">How many passes?</h1>
              {invError ? <p className="zc2-muted">Live availability is unavailable right now. You can still try.</p> : null}
              <div className="zc2-tiers">
                {tiers.map((t) => {
                  const a = availOf(t.tierId);
                  const p = pools?.[t.tierId];
                  const stock = p ? stockStatus(Number(p.available) || 0, p.capacity) : null;
                  const soldOut = a <= 0;
                  const q = qty[t.tierId] || 0;
                  const locked = !!t.seatIds?.length;
                  const notes = [
                    t.split ? `Table · seats ${t.seats || 8}` : null,
                    locked ? `Seats ${t.seatIds!.length} picked` : null,
                    soldOut ? 'SOLD OUT' : stock === 'FEW LEFT' || stock === 'ALMOST GONE' ? stock : null,
                  ].filter(Boolean);
                  return (
                    <div className={'zc2-tier' + (q > 0 ? ' on' : '') + (soldOut ? ' out' : '')} key={t.tierId}>
                      <div className="zc2-tier-info">
                        <span className="zc2-tier-name">{t.name}</span>
                        {notes.length ? <span className="zc2-tier-desc">{notes.join(' · ')}</span> : null}
                      </div>
                      <span className="zc2-tier-price">
                        {money(t.unitPrice)}
                        {t.usd ? <small> (${fmt(t.usd)})</small> : null}
                      </span>
                      <div className="zc2-step" role="group" aria-label={`${t.name} passes`}>
                        <button
                          type="button"
                          aria-label={`One fewer ${t.name}`}
                          disabled={locked || soldOut || q <= 0}
                          onClick={() => setTierQty(t, q - 1)}
                        >
                          −
                        </button>
                        <span className="zc2-step-n" aria-live="polite">
                          {q}
                        </span>
                        <button
                          type="button"
                          aria-label={`One more ${t.name}`}
                          disabled={locked || soldOut || q >= Math.min(10, a)}
                          onClick={() => setTierQty(t, q + 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* group options inline (03_COMPONENTS §7) — only where a split exists today:
                  a splittable table tier in the cart (a table is a group by itself). */}
              {splitLine ? (
                <div className="zc2-group">
                  <span className="zc2-group-h">
                    {passCount} pass{passCount === 1 ? '' : 'es'} — how do you want to pay?
                  </span>
                  <div className="zc2-group-opts">
                    <span className="zc2-opt on" aria-current="true">
                      One checkout for everyone going
                    </span>
                    <a className="zc2-opt" href={splitHref(splitLine.tier)}>
                      Split with Tuchange — each person pays their own share
                    </a>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {/* ── 2 · DETAILS + PAY ── */}
          {step === 'details' ? (
            <>
              <div className="zc2-fields">
                <label className="zc2-field">
                  <span>YOUR NAME</span>
                  <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="zc2-field">
                  <span>PHONE</span>
                  <span className="zc2-tel">
                    <span className="zc2-cc" aria-hidden="true">
                      +255
                    </span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      aria-label="Phone number, after +255"
                      placeholder="712 345 678"
                      value={groupPhone(phone)}
                      onChange={(e) => setPhone(localDigits(e.target.value))}
                    />
                  </span>
                </label>
                <label className="zc2-field zc2-span2">
                  <span>EMAIL</span>
                  <input type="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
              </div>

              {quote || order?.installments ? (
                <fieldset className="zc2-plans">
                  <legend>How do you want to pay?</legend>
                  <label className={'zc2-plan' + (plan === 'full' ? ' on' : '')}>
                    <span className="zc2-plan-top">
                      <input
                        type="radio"
                        name="zc2-plan"
                        checked={plan === 'full'}
                        disabled={!!order}
                        onChange={() => setPlan('full')}
                      />
                      <span className="zc2-plan-txt">
                        <span className="zc2-plan-l">Pay in full</span>
                        <span className="zc2-plan-d">Your pass arrives straight away.</span>
                      </span>
                      <span className="zc2-num zc2-plan-amt">{money(order ? total : quote?.total ?? total)}</span>
                    </span>
                  </label>
                  <label className={'zc2-plan' + (plan === 'installments' ? ' on' : '')}>
                    <span className="zc2-plan-top">
                      <input
                        type="radio"
                        name="zc2-plan"
                        checked={plan === 'installments'}
                        disabled={!!order}
                        onChange={() => setPlan('installments')}
                      />
                      <span className="zc2-plan-txt">
                        <span className="zc2-plan-l">Pay in installments</span>
                        <span className="zc2-plan-d">
                          Deposit today, the rest before the event. Your pass arrives when it&apos;s paid in full.
                        </span>
                      </span>
                      <span className="zc2-num zc2-plan-amt">
                        {money(order?.installments?.deposit ?? quote?.deposit ?? 0)} today
                      </span>
                    </span>
                    {plan === 'installments' ? (
                      <>
                        <span className="zc2-sched">
                          {instSchedule.map((r) => (
                            <span className={'zc2-sched-row' + (r.n === 1 ? ' now' : '')} key={r.n}>
                              <span className="zc2-sched-k">{r.n === 1 ? 'TODAY' : dayLabel(r.dueDate)}</span>
                              <span className="zc2-num">{money(r.amount)}</span>
                            </span>
                          ))}
                        </span>
                        <span className="zc2-plan-rule">{ruleText(instGrace)}</span>
                      </>
                    ) : null}
                  </label>
                </fieldset>
              ) : null}

              <fieldset className="zc2-methods">
                <legend>Pay with</legend>
                <div className="zc2-method-list" role="radiogroup">
                  {groups.map((g) => (
                    <label className={'zc2-method' + (method === g.id ? ' on' : '')} key={g.id}>
                      <input type="radio" name="zc2-method" checked={method === g.id} onChange={() => setMethod(g.id)} />
                      <span className="zc2-method-l">{g.label}</span>
                      {g.id === 'mobile' && mno ? <span className="zc2-net">{mno.name.toUpperCase()}</span> : null}
                    </label>
                  ))}
                </div>
                {method === 'mobile' ? (
                  <span className="zc2-muted">
                    {mno ? `${mno.name} — picked from your number.` : 'We pick your network from your number.'}
                  </span>
                ) : null}
              </fieldset>

              <label className="zc2-check">
                <input type="checkbox" checked={ageAttested} onChange={(e) => setAgeAttested(e.target.checked)} />
                <span>I confirm I am 18 or older.</span>
              </label>
            </>
          ) : null}

          {/* ── POLL ── */}
          {step === 'poll' ? (
            <div className="zc2-wait" role="status" aria-live="polite">
              <span className="zc2-spin big" aria-hidden="true" />
              {method === 'mobile' ? (
                <>
                  <h2>Approve on your phone</h2>
                  <p>Enter your mobile-money PIN on the prompt we sent to +255 {groupPhone(phone)}.</p>
                </>
              ) : method === 'billpay' && billPayNumber ? (
                <>
                  <h2>Pay to this control number</h2>
                  <p className="zc2-control">{billPayNumber}</p>
                  <p>Pay it from your bank or mobile money. We update here the moment it clears.</p>
                </>
              ) : method === 'card' ? (
                <>
                  <h2>Finish your card payment</h2>
                  <p>
                    A secure card page opened in a new tab.{' '}
                    {redirectUrl ? (
                      <a href={redirectUrl} target="_blank" rel="noopener noreferrer">
                        Reopen it
                      </a>
                    ) : null}{' '}
                    We update here automatically.
                  </p>
                </>
              ) : (
                <>
                  <h2>Confirming payment</h2>
                  <p>This usually takes a few seconds.</p>
                </>
              )}
            </div>
          ) : null}

          {/* ── RESULT ── */}
          {step === 'done' ? (
            <Result
              booked={
                statusVal === 'installment_active'
                  ? {
                      orderId: order?.orderId || '',
                      paidCount: booked?.paidCount ?? 1,
                      count: booked?.count ?? instSchedule.length,
                      schedule: booked?.schedule?.length ? booked.schedule : instSchedule,
                      passCount,
                      phone: phone.length === 9 ? `+255 ${groupPhone(phone)}` : '',
                      money,
                    }
                  : null
              }
              statusVal={statusVal}
              credentials={credentials}
              eventName={eventName}
              when={when}
              where={where}
              lines={lines.map((l) => `${l.q} × ${l.tier.name}`).join(', ')}
              tierName={(id) => tiers.find((t) => t.tierId === id)?.name || id}
              onClose={onClose}
              onRetry={retryPayment}
              onStartAgain={startAgain}
            />
          ) : null}
        </main>

        {/* desktop summary column */}
        <aside className="zc2-aside" aria-label="Order summary">
          <div className="zc2-sum-ev">
            <Thumb />
            <div className="zc2-ev">
              <span className="zc2-ev-name big">{eventName}</span>
              {when ? <span className="zc2-ev-when">{when}</span> : null}
              {where ? <span className="zc2-ev-where">{where}</span> : null}
            </div>
          </div>
          <Totals />
          {inFlow ? (
            <>
              <Cta />
              {ctaHint ? <p className="zc2-hint">{ctaHint}</p> : null}
            </>
          ) : null}
        </aside>
      </div>

      {/* phone sticky bar */}
      {inFlow ? (
        <div className="zc2-bar">
          <Totals compact />
          <Cta />
          {ctaHint ? <p className="zc2-hint center">{ctaHint}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

type Booked = {
  orderId: string;
  paidCount: number;
  count: number;
  schedule: ScheduleRow[];
  passCount: number;
  phone: string;
  money: (n: number) => string;
};

/* BS134: installment deposit cleared (Confirm mockup, right half). Bricolage —
   never Bungee — for the headline; the schedule is mono rows, paid rows yellow. */
function BookedResult({ b }: { b: Booked }) {
  const paid = Math.max(1, b.paidCount);
  return (
    <div className="zc2-booked">
      <span className="zc2-booked-k">
        INSTALLMENTS · {paid} OF {b.count} PAID
      </span>
      <h2 className="zc2-booked-h">
        Booked — {paid} of {b.count} paid.
      </h2>
      <p className="zc2-booked-p">
        {b.passCount > 1
          ? `Your ${b.passCount} passes are held for you. They arrive the moment the last payment clears.`
          : 'Your pass is held for you. It arrives the moment the last payment clears.'}
      </p>
      <div className="zc2-booked-rows">
        {b.schedule.map((r) => {
          const isPaid = r.status ? r.status === 'paid' : r.n === 1;
          return (
            <div className={'zc2-booked-row' + (isPaid ? ' paid' : '')} key={r.n}>
              <span>{isPaid ? (r.n === 1 ? 'PAID · TODAY' : `PAID · ${dayLabel(r.dueDate)}`) : `DUE · ${dayLabel(r.dueDate)}`}</span>
              <span>{b.money(r.amount)}</span>
            </div>
          );
        })}
      </div>
      <p className="zc2-booked-note">
        We&apos;ll text {b.phone || 'you'} three days before each date with a link to pay. You can pay early any time.
      </p>
      {b.orderId ? (
        <a className="zc2-primary zc2-booked-cta" href={`/pay/${encodeURIComponent(b.orderId)}`}>
          <span>CHECK MY PASS</span>
          <span aria-hidden="true">→</span>
        </a>
      ) : null}
    </div>
  );
}

function Result({
  booked,
  statusVal,
  credentials,
  eventName,
  when,
  where,
  lines,
  tierName,
  onClose,
  onRetry,
  onStartAgain,
}: {
  booked: Booked | null;
  statusVal: string | null;
  credentials: Credential[];
  eventName: string;
  when: string;
  where: string;
  lines: string;
  tierName: (tierId: string) => string;
  onClose: () => void;
  onRetry: () => void;
  onStartAgain: () => void;
}) {
  if (booked) return <BookedResult b={booked} />;
  if (statusVal === 'paid') {
    const good = credentials.filter((c) => c.state !== 'revoked');
    return (
      <div className="zc2-in">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="zc2-in-stamp" src="/brand/stamps/svg/zp-stamp-zorapass-dar-signal.svg" alt="" aria-hidden="true" />
        <span className="zc2-in-k">PAID IN FULL</span>
        <h2 className="zc2-in-h">YOU&apos;RE IN.</h2>
        <p className="zc2-in-p">See you inside. Your passes are below and on their way to your phone and email.</p>
        <dl className="zc2-in-dl">
          <dt>EVENT</dt>
          <dd>{eventName}</dd>
          {when ? (
            <>
              <dt>WHEN</dt>
              <dd>{when}</dd>
            </>
          ) : null}
          {where ? (
            <>
              <dt>WHERE</dt>
              <dd>{where}</dd>
            </>
          ) : null}
          {lines ? (
            <>
              <dt>PASSES</dt>
              <dd>{lines}</dd>
            </>
          ) : null}
        </dl>
        <div className="zc2-qrs">
          {good.map((c) => (
            <div className="zc2-qr" key={c.publicRef}>
              <div className="zc2-qr-img">
                <QRCodeSVG value={c.qr} size={200} level="M" includeMargin={false} bgColor="#FFFFFF" fgColor="#111111" />
              </div>
              <p className="zc2-qr-tier">{tierName(c.tier)}{c.seatLabel ? ` · ${c.seatLabel}` : ''}</p>
              <p className="zc2-qr-ref">{c.publicRef}</p>
            </div>
          ))}
        </div>
        <button type="button" className="zc2-primary flip" onClick={onClose}>
          <span>DONE</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>
    );
  }

  const states: Record<string, { title: string; body: string; retry?: 'retry' | 'again' }> = {
    payment_short: {
      title: 'Payment came up short',
      body: 'We received less than the total, so no pass was issued. Any amount taken will be reconciled — our team is on it.',
      retry: 'retry',
    },
    paid_unseatable: {
      title: 'Paid — but we couldn’t issue your pass',
      body: 'Your payment went through, but the passes ran out first. You will be refunded and our team has been alerted.',
    },
    slow: {
      title: 'Still confirming',
      body: 'Your payment is taking longer than usual. If money left your account, your pass arrives by SMS and email shortly — no need to pay again.',
    },
    expired: { title: 'Your hold ran out', body: COPY.expired, retry: 'again' },
  };
  const s = states[statusVal || ''] || { title: 'Payment didn’t go through', body: COPY.payFailed, retry: 'retry' as const };
  return (
    <div className="zc2-fail">
      <h2>{s.title}</h2>
      <p>{s.body}</p>
      <p className="zc2-muted">Need help? {SUPPORT_EMAIL}</p>
      {s.retry ? (
        <button type="button" className="zc2-primary" onClick={s.retry === 'retry' ? onRetry : onStartAgain}>
          <span>{s.retry === 'retry' ? 'TRY AGAIN' : 'START AGAIN'}</span>
          <span aria-hidden="true">→</span>
        </button>
      ) : null}
      <button type="button" className="zc2-link" onClick={onClose}>
        Close
      </button>
    </div>
  );
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
      return 'Something is off with your passes. Check them and try again.';
    default:
      return 'We couldn’t start checkout. Try again.';
  }
}

/* Scoped to .zc2. FIXED light (bone): primitive tokens only, because
   <html data-theme> defaults to dark and would flip the semantic --zp-*.
   Every rule is .zc2-prefixed twice-deep so the reset below never outranks it. */
const STYLE = `
.zc2{--bk:var(--zp-color-board-black);--bone:var(--zp-color-bone);--yl:var(--zp-color-signal-yellow);--wh:var(--zp-color-white);--line:var(--zp-color-line-light);--mut:var(--zp-color-ink-500);--ink2:var(--zp-color-ink-600);--mono:var(--zp-font-family-mono);--disp:var(--zp-font-family-display);--sans:var(--zp-font-family-sans);position:fixed;inset:0;z-index:120;background:var(--bone);color:var(--bk);font-family:var(--sans);font-size:16px;line-height:1.4;overflow-y:auto;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column}
.zc2:focus{outline:none}
.zc2 *{margin:0;padding:0;box-sizing:border-box}
.zc2 :focus-visible{outline:3px solid var(--bk);outline-offset:2px}
:where(.zc2) button{font:inherit;color:inherit;background:none;border:none;cursor:pointer}
:where(.zc2) a{color:inherit}

/* header */
.zc2 .zc2-head{position:sticky;top:0;z-index:3;background:var(--bone);height:56px;flex:none;display:flex;align-items:center;gap:8px;padding:0 12px 0 4px;border-bottom:1px solid var(--line)}
@media(min-width:960px){.zc2 .zc2-head{height:64px;padding:0 32px;gap:24px}}
.zc2 .zc2-back{min-width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:var(--mono);font-size:22px;letter-spacing:.08em}
.zc2 .zc2-back:disabled{opacity:.35;cursor:not-allowed}
.zc2 .zc2-back-lab{display:none;font-size:13px}
@media(min-width:960px){.zc2 .zc2-back{font-size:13px;padding:0 4px}.zc2 .zc2-back-lab{display:inline}}
.zc2 .zc2-brand{flex:1;min-width:0;font-weight:700}
.zc2 .zc2-brand-desk{display:none;font-size:22px;letter-spacing:-.035em}
.zc2 .zc2-brand-phone{font-size:17px}
@media(min-width:960px){.zc2 .zc2-brand{text-align:center}.zc2 .zc2-brand-desk{display:inline}.zc2 .zc2-brand-phone{display:none}}
.zc2 .zc2-hold{font-family:var(--mono);font-size:12px;letter-spacing:.08em;background:var(--bk);color:var(--yl);border-radius:var(--zp-radius-pill);padding:6px 10px;white-space:nowrap;font-variant-numeric:tabular-nums}
.zc2 .zc2-hold-long{display:none}
@media(min-width:960px){.zc2 .zc2-hold{font-size:13px;padding:8px 14px}.zc2 .zc2-hold-long{display:inline}}
.zc2 .zc2-hold-spacer{min-width:44px}

/* phone event strip */
.zc2 .zc2-strip{display:flex;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line);background:var(--wh)}
@media(min-width:960px){.zc2 .zc2-strip{display:none}}
.zc2 .zc2-thumb{width:88px;height:110px;flex:none;border-radius:12px;background:var(--bk);overflow:hidden;display:flex;align-items:center;justify-content:center}
.zc2 .zc2-thumb.small{width:52px;height:64px;border-radius:8px}
.zc2 .zc2-thumb img{width:100%;height:100%;object-fit:contain;display:block}
.zc2 .zc2-thumb .zc2-thumb-stamp{width:70%;height:auto;transform:rotate(-10deg)}
.zc2 .zc2-ev{display:flex;flex-direction:column;gap:4px;min-width:0}
.zc2 .zc2-ev-name{font-weight:700;font-size:16px;line-height:1.15}
.zc2 .zc2-ev-name.big{font-size:20px;letter-spacing:-.02em}
.zc2 .zc2-ev-when{font-family:var(--mono);font-size:12px;letter-spacing:.08em}
.zc2 .zc2-ev-where{font-size:13px;color:var(--mut)}
@media(min-width:960px){.zc2 .zc2-ev-when{font-size:13px}.zc2 .zc2-ev-where{font-size:14px}}

/* columns */
.zc2 .zc2-wrap{flex:1;width:100%;max-width:1280px;margin:0 auto;display:flex;gap:48px;align-items:flex-start;padding:16px 16px 280px}
@media(min-width:960px){.zc2 .zc2-wrap{padding:40px 32px 48px}}
.zc2 .zc2-main{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:16px}
@media(min-width:960px){.zc2 .zc2-main{gap:24px}}
.zc2 .zc2-aside{display:none}
@media(min-width:960px){.zc2 .zc2-aside{display:flex;position:sticky;top:104px;width:400px;flex:none;flex-direction:column;gap:16px;background:var(--wh);border:2px solid var(--bk);border-radius:var(--zp-radius-lg);padding:24px}}
.zc2 .zc2-sum-ev{display:flex;gap:16px}

/* steps */
.zc2 .zc2-steps{list-style:none;display:flex;gap:16px;font-family:var(--mono);font-size:12px;letter-spacing:.08em}
@media(min-width:960px){.zc2 .zc2-steps{gap:24px;font-size:13px}}
.zc2 .zc2-steps li{padding-bottom:6px;color:var(--mut);border-bottom:3px solid transparent}
.zc2 .zc2-steps li.on{color:var(--bk);font-weight:600;border-bottom-color:var(--bk)}
.zc2 .zc2-h1{font-size:24px;font-weight:700;letter-spacing:-.02em;line-height:1.1}
@media(min-width:960px){.zc2 .zc2-h1{font-size:32px}}
.zc2 .zc2-muted{font-size:14px;color:var(--mut)}

/* notice */
.zc2 .zc2-notice{font-size:16px;line-height:1.4;border-radius:12px;padding:12px 16px;border:2px solid var(--bk);background:var(--wh)}
.zc2 .zc2-notice.error{border-color:var(--zp-color-alert-red,#B42318);color:var(--zp-color-alert-red,#B42318)}
.zc2 .zc2-notice.info{background:var(--yl)}

/* tiers */
.zc2 .zc2-tiers{display:flex;flex-direction:column;gap:12px}
.zc2 .zc2-tier{background:var(--wh);border:1px solid var(--line);border-radius:var(--zp-radius-lg);padding:14px 16px;display:grid;grid-template-columns:1fr auto;grid-template-areas:"info price" "info step";gap:10px 16px;align-items:center}
@media(min-width:960px){.zc2 .zc2-tier{padding:20px 24px;grid-template-columns:1fr 160px auto;grid-template-areas:"info price step";gap:24px}}
.zc2 .zc2-tier.on{border:2px solid var(--bk)}
.zc2 .zc2-tier.out{opacity:.6}
.zc2 .zc2-tier.out .zc2-tier-name{text-decoration:line-through}
.zc2 .zc2-tier-info{grid-area:info;display:flex;flex-direction:column;gap:4px;min-width:0}
.zc2 .zc2-tier-name{font-size:18px;font-weight:700}
@media(min-width:960px){.zc2 .zc2-tier-name{font-size:20px}}
.zc2 .zc2-tier-desc{font-family:var(--mono);font-size:12px;letter-spacing:.08em;color:var(--mut)}
.zc2 .zc2-tier-price{grid-area:price;font-family:var(--mono);font-size:15px;font-weight:600;text-align:right}
@media(min-width:960px){.zc2 .zc2-tier-price{font-size:16px}}
.zc2 .zc2-tier-price small{font-weight:400;font-size:12px;color:var(--mut)}
.zc2 .zc2-step{grid-area:step;justify-self:end;display:flex;align-items:center;border:2px solid var(--bk);border-radius:12px;overflow:hidden}
.zc2 .zc2-step button{width:48px;height:48px;font-size:22px;line-height:1;background:var(--wh)}
.zc2 .zc2-step button:hover:not(:disabled){background:var(--bk);color:var(--yl)}
.zc2 .zc2-step button:disabled{color:var(--zp-color-ink-300,#BDBDBD);cursor:not-allowed}
.zc2 .zc2-step-n{width:44px;text-align:center;font-family:var(--mono);font-size:18px;font-weight:600}

/* group options */
.zc2 .zc2-group{display:flex;flex-direction:column;gap:12px;padding:14px;border:2px dashed var(--bk);border-radius:var(--zp-radius-lg)}
@media(min-width:960px){.zc2 .zc2-group{padding:20px 24px}}
.zc2 .zc2-group-h{font-weight:700}
.zc2 .zc2-group-opts{display:flex;flex-direction:column;gap:8px}
@media(min-width:960px){.zc2 .zc2-group-opts{flex-direction:row;gap:12px}}
.zc2 .zc2-opt{flex:1;min-height:56px;display:flex;align-items:center;padding:8px 16px;border-radius:12px;border:2px solid var(--bk);background:var(--wh);font-weight:700;text-decoration:none}
.zc2 .zc2-opt.on{background:var(--bk);color:var(--bone)}
.zc2 a.zc2-opt:hover{background:var(--yl)}

/* details */
.zc2 .zc2-fields{display:grid;grid-template-columns:1fr;gap:16px}
@media(min-width:680px){.zc2 .zc2-fields{grid-template-columns:repeat(2,minmax(0,1fr))}.zc2 .zc2-span2{grid-column:1 / -1}}
.zc2 .zc2-field{display:flex;flex-direction:column;gap:6px}
.zc2 .zc2-field > span:first-child{font-family:var(--mono);font-size:12px;letter-spacing:.12em}
.zc2 .zc2-field input{height:48px;border-radius:12px;border:2px solid var(--line);background:var(--wh);padding:0 14px;font-size:16px;font-family:var(--sans);color:var(--bk);width:100%}
.zc2 .zc2-field input:focus{border-color:var(--bk);outline:3px solid var(--bk);outline-offset:2px}
.zc2 .zc2-tel{display:flex;align-items:stretch}
.zc2 .zc2-cc{display:flex;align-items:center;padding:0 12px;border:2px solid var(--line);border-right:none;border-radius:12px 0 0 12px;background:var(--bone);font-family:var(--mono);font-size:16px}
.zc2 .zc2-tel input{border-radius:0 12px 12px 0;font-family:var(--mono)}
.zc2 .zc2-methods{border:none;display:flex;flex-direction:column;gap:10px}
.zc2 .zc2-methods legend{font-size:18px;font-weight:700;margin-bottom:10px}
@media(min-width:960px){.zc2 .zc2-methods legend{font-size:20px}}
.zc2 .zc2-method-list{display:flex;flex-direction:column;gap:10px}
@media(min-width:960px){.zc2 .zc2-method-list{flex-direction:row;gap:12px}.zc2 .zc2-method-list .zc2-method{flex:1}}
.zc2 .zc2-method{flex:none;display:flex;align-items:center;gap:12px;height:56px;padding:0 14px;border-radius:12px;border:2px solid var(--line);background:var(--wh);cursor:pointer;font-weight:700}
.zc2 .zc2-method.on{border-color:var(--bk)}
@media(min-width:960px){.zc2 .zc2-method.on{background:var(--bk);color:var(--bone)}}
.zc2 .zc2-method input{appearance:none;-webkit-appearance:none;width:22px;height:22px;flex:none;margin:0;border:2px solid var(--bk);border-radius:50%;background:var(--wh);cursor:pointer}
.zc2 .zc2-method input:checked{background:var(--bk);box-shadow:inset 0 0 0 4px var(--wh)}
@media(min-width:960px){.zc2 .zc2-method.on input{border-color:var(--yl);background:var(--yl);box-shadow:inset 0 0 0 4px var(--bk)}}
.zc2 .zc2-method-l{flex:1}
.zc2 .zc2-net{font-family:var(--mono);font-size:12px;letter-spacing:.08em;font-weight:500}
.zc2 .zc2-check{display:flex;align-items:center;gap:12px;min-height:44px;cursor:pointer}
.zc2 .zc2-check input{appearance:none;-webkit-appearance:none;width:22px;height:22px;flex:none;border:2px solid var(--bk);border-radius:4px;background:var(--wh);cursor:pointer;display:grid;place-content:center}
.zc2 .zc2-check input:checked{background:var(--bk)}
.zc2 .zc2-check input:checked::after{content:'';width:10px;height:6px;border:solid var(--yl);border-width:0 0 3px 3px;transform:rotate(-45deg) translate(1px,-1px)}

/* totals */
.zc2 .zc2-totals{display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--line);padding-top:16px}
.zc2 .zc2-totals.compact{border-top:none;padding-top:0;gap:6px}
.zc2 .zc2-row{display:flex;justify-content:space-between;gap:12px;font-size:16px}
.zc2 .zc2-totals.compact .zc2-row{font-size:14px}
.zc2 .zc2-sub{color:var(--ink2)}
.zc2 .zc2-num{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
.zc2 .zc2-total{display:flex;justify-content:space-between;align-items:baseline;border-top:2px solid var(--bk);padding-top:16px;margin-top:6px;font-size:18px;font-weight:700}
.zc2 .zc2-total .zc2-num{font-size:24px;font-weight:600}
.zc2 .zc2-totals.compact .zc2-total{border-top:none;padding-top:0;margin-top:0;font-size:16px}
.zc2 .zc2-totals.compact .zc2-total .zc2-num{font-size:20px}
.zc2 .zc2-fine{font-size:14px;color:var(--mut)}
.zc2 .zc2-totals.compact .zc2-fine{font-size:13px}

/* primary button — black block, yellow Bungee ≥20px, arrow right */
.zc2 .zc2-primary{width:100%;height:56px;border-radius:var(--zp-radius-lg);background:var(--bk);color:var(--yl);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 20px;font-family:var(--disp);font-size:20px;line-height:1;transition:background .12s}
@media(min-width:960px){.zc2 .zc2-primary{padding:0 24px}}
.zc2 .zc2-primary:hover:not(:disabled){background:var(--zp-color-ink-800)}
.zc2 .zc2-primary:active:not(:disabled){transform:translateY(2px)}
.zc2 .zc2-primary:disabled{background:var(--zp-color-ink-300,#BDBDBD);color:var(--zp-color-ink-500);cursor:not-allowed}
.zc2 .zc2-primary.flip{background:var(--yl);color:var(--bk)}
.zc2 .zc2-primary.flip:hover{background:var(--zp-color-yellow-press)}
.zc2 .zc2-hint{font-size:14px;color:var(--mut)}
.zc2 .zc2-hint.center{text-align:center;font-size:13px}
.zc2 .zc2-spin{width:20px;height:20px;border-radius:50%;border:3px solid currentColor;border-right-color:transparent;animation:zc2spin .8s linear infinite;flex:none}
.zc2 .zc2-spin.big{width:40px;height:40px;color:var(--bk)}
@keyframes zc2spin{to{transform:rotate(360deg)}}

/* phone sticky bar */
.zc2 .zc2-bar{position:fixed;left:0;right:0;bottom:0;z-index:4;background:var(--bone);border-top:2px solid var(--bk);padding:12px 16px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:10px}
@media(min-width:960px){.zc2 .zc2-bar{display:none}}

/* poll */
.zc2 .zc2-wait{display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;padding:32px 8px}
.zc2 .zc2-wait h2{font-size:24px;font-weight:700;letter-spacing:-.02em;margin-top:8px}
.zc2 .zc2-wait p{color:var(--ink2);max-width:40ch}
.zc2 .zc2-wait a{text-decoration:underline;font-weight:700}
.zc2 .zc2-control{font-family:var(--mono);font-size:28px;letter-spacing:.12em;color:var(--bk)}

/* result — paid (Confirm mockup: black, YOU'RE IN.) */
.zc2 .zc2-in{position:relative;background:var(--bk);color:var(--bone);border-radius:var(--zp-radius-lg);padding:32px 24px;display:flex;flex-direction:column;gap:16px}
@media(min-width:960px){.zc2 .zc2-in{padding:48px}}
.zc2 .zc2-in :focus-visible{outline-color:var(--yl)}
.zc2 .zc2-in-stamp{position:absolute;right:16px;top:16px;width:80px;height:80px;transform:rotate(-10deg);animation:zc2slam .18s cubic-bezier(.2,.7,.2,1) both}
@media(min-width:960px){.zc2 .zc2-in-stamp{right:24px;top:24px;width:96px;height:96px}}
@keyframes zc2slam{from{opacity:0;transform:scale(1.3) rotate(-20deg)}to{opacity:1;transform:scale(1) rotate(-10deg)}}
@media(prefers-reduced-motion:reduce){.zc2 .zc2-in-stamp{animation:none}.zc2 .zc2-spin{animation-duration:2s}}
.zc2 .zc2-in-k{font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--zp-color-ink-300,#BDBDBD)}
.zc2 .zc2-in-h{font-family:var(--disp);font-weight:400;font-size:48px;line-height:.95;color:var(--yl);padding-right:88px}
@media(min-width:960px){.zc2 .zc2-in-h{font-size:72px;padding-right:0}}
.zc2 .zc2-in-p{font-size:18px;max-width:40ch}
.zc2 .zc2-in-dl{display:grid;grid-template-columns:90px 1fr;row-gap:8px;font-family:var(--mono);font-size:15px}
.zc2 .zc2-in-dl dt{color:var(--zp-color-ink-300,#BDBDBD);font-size:12px;letter-spacing:.08em;padding-top:2px}
.zc2 .zc2-qrs{display:flex;flex-wrap:wrap;gap:16px;margin-top:8px}
.zc2 .zc2-qr{display:flex;flex-direction:column;align-items:center;gap:6px}
.zc2 .zc2-qr-img{background:#fff;border-radius:16px;padding:16px;line-height:0}
.zc2 .zc2-qr-tier{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase}
.zc2 .zc2-qr-ref{font-family:var(--mono);font-size:14px;letter-spacing:.06em}
.zc2 .zc2-in .zc2-primary{max-width:320px}

/* BS134 — how do you want to pay? (CheckoutPay / CheckoutPhonePay mockups) */
.zc2 .zc2-plans{border:none;display:flex;flex-direction:column;gap:10px}
.zc2 .zc2-plans legend{font-size:18px;font-weight:700;margin-bottom:10px}
@media(min-width:960px){.zc2 .zc2-plans{gap:12px}.zc2 .zc2-plans legend{font-size:20px;margin-bottom:12px}}
.zc2 .zc2-plan{display:flex;flex-direction:column;gap:12px;background:var(--wh);border:1px solid var(--line);border-radius:var(--zp-radius-lg);padding:14px;cursor:pointer}
@media(min-width:960px){.zc2 .zc2-plan{padding:16px 20px;gap:14px}}
.zc2 .zc2-plan.on{border:2px solid var(--bk)}
.zc2 .zc2-plan-top{display:flex;gap:12px;align-items:flex-start}
@media(min-width:960px){.zc2 .zc2-plan-top{gap:16px}}
.zc2 .zc2-plan input{appearance:none;-webkit-appearance:none;width:22px;height:22px;flex:none;margin:1px 0 0;border:2px solid var(--bk);border-radius:50%;background:var(--wh);cursor:pointer}
.zc2 .zc2-plan input:checked{background:var(--bk);box-shadow:inset 0 0 0 4px var(--wh)}
.zc2 .zc2-plan input:disabled{cursor:not-allowed;opacity:.5}
.zc2 .zc2-plan-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.zc2 .zc2-plan-l{font-weight:700;font-size:16px}
@media(min-width:960px){.zc2 .zc2-plan-l{font-size:18px}}
.zc2 .zc2-plan-d{font-size:14px;color:var(--mut)}
.zc2 .zc2-plan-amt{font-size:15px;font-weight:600;text-align:right}
@media(min-width:960px){.zc2 .zc2-plan-amt{font-size:16px}}
.zc2 .zc2-sched{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.zc2 .zc2-sched-row{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;font-family:var(--mono);font-size:14px;background:var(--wh)}
.zc2 .zc2-sched-row + .zc2-sched-row{border-top:1px solid var(--line)}
.zc2 .zc2-sched-row.now{background:var(--yl)}
.zc2 .zc2-sched-k{letter-spacing:.08em}
@media(min-width:960px){
  .zc2 .zc2-sched{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;border:none;border-radius:0}
  .zc2 .zc2-sched-row{flex-direction:column;gap:4px;border-radius:12px;padding:12px;background:var(--bone);font-size:16px;font-weight:600}
  .zc2 .zc2-sched-row + .zc2-sched-row{border-top:none}
  .zc2 .zc2-sched-row.now{background:var(--yl)}
  .zc2 .zc2-sched-k{font-size:12px;letter-spacing:.12em;font-weight:400}
}
.zc2 .zc2-plan-rule{font-size:13px;color:var(--ink2)}
@media(min-width:960px){.zc2 .zc2-plan-rule{font-size:14px}}

/* BS134 — installment confirmation (Confirm mockup, right half): bone, Bricolage */
.zc2 .zc2-booked{display:flex;flex-direction:column;gap:16px;background:var(--bone);border:2px solid var(--bk);border-radius:var(--zp-radius-lg);padding:32px 24px}
@media(min-width:960px){.zc2 .zc2-booked{padding:48px;gap:20px}}
.zc2 .zc2-booked-k{font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--mut)}
.zc2 .zc2-booked-h{font-family:var(--sans);font-size:36px;font-weight:800;letter-spacing:-.02em;line-height:1.02}
@media(min-width:960px){.zc2 .zc2-booked-h{font-size:56px}}
.zc2 .zc2-booked-p{font-size:18px;max-width:460px}
@media(min-width:960px){.zc2 .zc2-booked-p{font-size:20px}}
.zc2 .zc2-booked-rows{display:flex;flex-direction:column;border:2px solid var(--bk);border-radius:var(--zp-radius-lg);overflow:hidden;max-width:480px}
.zc2 .zc2-booked-row{display:flex;justify-content:space-between;gap:12px;padding:14px 18px;background:var(--wh);font-family:var(--mono);font-size:15px;font-variant-numeric:tabular-nums}
.zc2 .zc2-booked-row + .zc2-booked-row{border-top:1px solid var(--line)}
.zc2 .zc2-booked-row.paid{background:var(--yl)}
.zc2 .zc2-booked-note{font-size:15px;color:var(--ink2);max-width:480px}
.zc2 a.zc2-booked-cta{max-width:320px;text-decoration:none;margin-top:8px}

/* result — problems (never Bungee for errors) */
.zc2 .zc2-fail{display:flex;flex-direction:column;gap:12px;background:var(--wh);border:2px solid var(--bk);border-radius:var(--zp-radius-lg);padding:24px}
.zc2 .zc2-fail h2{font-size:24px;font-weight:700;letter-spacing:-.02em}
.zc2 .zc2-fail .zc2-primary{max-width:320px;margin-top:8px}
.zc2 .zc2-link{align-self:flex-start;min-height:44px;font-weight:700;text-decoration:underline}
`;
