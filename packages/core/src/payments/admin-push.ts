/* BS158: an admin sends a mobile-money payment prompt for a cart from the console.

   This is a thin wrapper around initiatePayment: the money rules (what the cart
   owes, the installment row, the attempt row, the gateway call) are its rules,
   untouched. What this adds:
   - refusals with clear codes, checked under a lock on the order row so two
     admins clicking at once cannot both push;
   - an admin may revive an EXPIRED cart: its stock and seats are held again
     (all or nothing) and it goes back to pending. A failed cart is revived the
     same way here, seats included. The buyer path is unchanged;
   - the log: admin_push_requested before the gateway call, admin_push_refused
     on every refusal, and who asked on pay_requested. */
import { tx } from '../db';
import { tryRehold } from '../inventory';
import { initiatePayment } from './service';
import { normalizeMsisdn } from './xbridge';
import { logOrderEvent, sanitizeGatewayError } from '../order-events';
import { isPayable, ORDER_STATUS } from '../order-status';
import { hasInstallmentPlan, planInstallmentAttempt, InstallmentAttemptRefused } from './installments';

type Sql = any; // postgres.js Sql | tx handle

export const ADMIN_PUSH_LIMITS = {
  /** At most this many admin prompts per cart per hour. */
  maxPerHour: 3,
  /** Minimum gap between two admin prompts for one cart. */
  minGapSecs: 30,
  /** An attempt younger than this counts as in flight even if it already ended. */
  inFlightSecs: 120,
} as const;

export type AdminPushCode =
  | 'order_not_found' | 'not_payable' | 'method_disabled' | 'invalid_phone'
  | 'attempt_in_flight' | 'rate_limited' | 'inventory_unavailable';

const HTTP_STATUS: Record<AdminPushCode, number> = {
  order_not_found: 404, not_payable: 409, method_disabled: 403, invalid_phone: 400,
  attempt_in_flight: 409, rate_limited: 429, inventory_unavailable: 409,
};

export class AdminPushRefused extends Error {
  readonly httpStatus: number;
  constructor(
    public readonly code: AdminPushCode,
    message: string,
    public readonly extra: { status?: string; reason?: string; retryAfterSecs?: number; amount?: number | null; phone?: string | null } = {},
  ) {
    super(message);
    this.name = 'AdminPushRefused';
    this.httpStatus = HTTP_STATUS[code];
  }
}

/** A Tanzanian mobile number as +255 + 9 digits starting 6 or 7, else null. */
export function tanzanianMobile(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = normalizeMsisdn(s);
  return /^\+255[67]\d{8}$/.test(n) ? n : null;
}

/** "+255 7•• ••• 123": enough to recognise, not enough to copy. */
export function maskPhone(raw: unknown): string | null {
  const n = tanzanianMobile(raw);
  if (n) {
    const d = n.slice(4);
    return `+255 ${d[0]}•• ••• ${d.slice(6)}`;
  }
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length >= 3 ? '•'.repeat(Math.max(0, digits.length - 3)) + digits.slice(-3) : null;
}

interface OrderRow {
  id: string;
  status: string;
  type: string | null;
  channel: string | null;
  target_value: number | string | null;
  buyer_phone: string | null;
}

interface Evaluation {
  refusal: AdminPushRefused | null;
  amount: number | null;
  scheduleN: number | null;
  /** The status a revive moves from (expired | failed), or null. */
  revive: string | null;
}

const REVIVABLE: readonly string[] = [ORDER_STATUS.EXPIRED, ORDER_STATUS.FAILED];

function waitText(secs: number): string {
  return secs >= 90 ? `${Math.ceil(secs / 60)} min` : `${Math.max(1, Math.ceil(secs))} s`;
}

/** The refusal rules, in order. Reads only. */
async function evaluate(q: Sql, o: OrderRow, opts: { mobileEnabled: boolean; phone?: string | null; checkPhone: boolean }): Promise<Evaluation> {
  const out: Evaluation = { refusal: null, amount: null, scheduleN: null, revive: null };
  const refuse = (code: AdminPushCode, message: string, extra: AdminPushRefused['extra'] = {}) => {
    out.refusal = new AdminPushRefused(code, message, { status: o.status, amount: out.amount, ...extra });
    return out;
  };

  // 1. not_payable
  if (o.type === 'comp') return refuse('not_payable', 'This is a comp: there is nothing to collect.', { reason: 'comp' });
  if (String(o.channel ?? 'online').startsWith('gate')) return refuse('not_payable', 'This is a door sale: it is settled at the gate.', { reason: 'door_sale' });
  const expired = o.status === ORDER_STATUS.EXPIRED;
  if (!isPayable(o.status) && !expired) return refuse('not_payable', `This cart can't take a payment (status ${o.status}).`, { reason: o.status });
  if (expired && (o.type === 'table' || o.type === 'table_share')) {
    return refuse('not_payable', 'An expired table or split seat cannot be revived from here.', { reason: `revive_${o.type}` });
  }
  const revive = REVIVABLE.includes(o.status) ? o.status : null;
  if (await hasInstallmentPlan(q, o.id)) {
    try {
      const plan = await planInstallmentAttempt(q, o.id, revive ? ORDER_STATUS.PENDING : o.status, null);
      out.amount = plan.amount;
      out.scheduleN = plan.n;
    } catch (e) {
      if (e instanceof InstallmentAttemptRefused) return refuse('not_payable', `This plan can't take a payment now (${e.code}).`, { reason: e.code });
      throw e;
    }
  } else {
    out.amount = Number(o.target_value ?? 0);
  }
  if (!(Number(out.amount) > 0)) return refuse('not_payable', 'There is nothing to collect on this cart.', { reason: 'zero_amount' });

  // 2. method_disabled
  if (!opts.mobileEnabled) return refuse('method_disabled', 'Mobile money is switched off in Settings.');

  // 3. invalid_phone (the push names a number; the preview only reads)
  if (opts.checkPhone) {
    const given = opts.phone != null && String(opts.phone).trim() !== '';
    const target = tanzanianMobile(given ? opts.phone : o.buyer_phone);
    if (!target) {
      return refuse('invalid_phone', given
        ? 'Enter a Tanzanian mobile number: +255, then 9 digits starting 6 or 7.'
        : "The buyer's number is not a Tanzanian mobile. Enter one.");
    }
  }

  // 4. attempt_in_flight: still open at the gateway, or started under 2 min ago.
  //    An attempt the gateway refused (error set) never reached the payer.
  const [inflight] = await q`
    select count(*)::int as n,
           count(*) filter (where status in ('created', 'pending', 'processing'))::int as open,
           coalesce(max(extract(epoch from (created_at + make_interval(secs => ${ADMIN_PUSH_LIMITS.inFlightSecs}) - now()))), 0)::float as wait
      from payment_transaction
     where order_id = ${o.id}::uuid and error is null
       and (status in ('created', 'pending', 'processing')
            or created_at > now() - make_interval(secs => ${ADMIN_PUSH_LIMITS.inFlightSecs}))`;
  if (inflight.n > 0) {
    const wait = Math.max(1, Math.ceil(Number(inflight.wait) || ADMIN_PUSH_LIMITS.inFlightSecs));
    return refuse('attempt_in_flight', inflight.open > 0
      ? 'A payment for this cart is still in progress. Wait for it to finish.'
      : `A payment was started under 2 min ago. Try again in ${waitText(wait)}.`, { retryAfterSecs: wait });
  }

  // 5. rate_limited: from the log of admin prompts.
  const [rl] = await q`
    select count(*)::int as n,
           extract(epoch from (now() - max(at)))::float as since_last,
           extract(epoch from (min(at) + interval '1 hour' - now()))::float as hour_left
      from order_event
     where order_id = ${o.id}::uuid and step = 'admin_push_requested' and at > now() - interval '1 hour'`
    .catch(() => [{ n: 0 }]);
  if (rl && rl.n >= ADMIN_PUSH_LIMITS.maxPerHour) {
    const wait = Math.max(1, Math.ceil(Number(rl.hour_left) || 3600));
    return refuse('rate_limited', `${ADMIN_PUSH_LIMITS.maxPerHour} prompts already sent for this cart in the last hour. Try again in ${waitText(wait)}.`, { retryAfterSecs: wait });
  }
  if (rl && rl.n > 0 && Number(rl.since_last) < ADMIN_PUSH_LIMITS.minGapSecs) {
    const wait = Math.max(1, Math.ceil(ADMIN_PUSH_LIMITS.minGapSecs - Number(rl.since_last)));
    return refuse('rate_limited', `A prompt was just sent. Try again in ${waitText(wait)}.`, { retryAfterSecs: wait });
  }

  out.revive = revive;
  return out;
}

/** Hold an expired/failed cart's stock and seats again (all or nothing) and set
    it back to pending. Runs inside the caller's tx: a throw undoes all of it. */
async function reviveOrder(t: Sql, orderId: string, from: string, ttlSecs: number): Promise<void> {
  const fail = () => new AdminPushRefused('inventory_unavailable', 'The tickets or seats on this cart are no longer available.', { status: from });
  // Same primitive as a buyer's failed-payment retry (BS56): available → held.
  if (!(await tryRehold(t, orderId, ttlSecs))) throw fail();
  // BS125: the exact seats the cart chose, if any, must be free (or already ours).
  const [{ n: seats }] = await t`select count(*)::int as n from order_seat where order_id = ${orderId}::uuid`;
  if (seats > 0) {
    const held = await t`
      update seat_inventory si
         set state = 'held', hold_order_id = ${orderId}::uuid,
             hold_expires_at = now() + make_interval(secs => ${ttlSecs}), updated_at = now()
        from order_seat os
       where os.order_id = ${orderId}::uuid and si.event_id = os.event_id and si.seat_id = os.seat_id
         and (si.state = 'available'
              or (si.state = 'held' and (si.hold_order_id = ${orderId}::uuid or si.hold_expires_at <= now())))
      returning si.seat_id`;
    if (held.length !== seats) throw fail();
  }
  await t`update "order" set status = 'pending' where id = ${orderId}::uuid and status = ${from}`;
  await logOrderEvent(t, orderId, 'status_changed', { from, to: 'pending', reason: 'admin_revive', seats }, null);
}

async function readOrder(q: Sql, orderId: string, lock: boolean): Promise<OrderRow | null> {
  const rows = lock
    ? await q`
        select o.id, o.status, o.type, o.channel, o.target_value, c.phone as buyer_phone
          from "order" o left join customer c on c.id = o.customer_id
         where o.id = ${orderId}::uuid for update of o`
    : await q`
        select o.id, o.status, o.type, o.channel, o.target_value, c.phone as buyer_phone
          from "order" o left join customer c on c.id = o.customer_id
         where o.id = ${orderId}::uuid`;
  return rows[0] ?? null;
}

export interface AdminPushPreview {
  available: boolean;
  code: AdminPushCode | null;
  message: string | null;
  retryAfterSecs: number | null;
  amount: number | null;
  scheduleN: number | null;
  /** The status a push would revive the cart from (expired | failed), or null. */
  revives: string | null;
  buyerPhoneValid: boolean;
  limits: typeof ADMIN_PUSH_LIMITS;
}

/** What the console shows before a push: can it be sent, and for how much. No writes. */
export async function adminPushPreview(sql: Sql, orderId: string, opts: { mobileEnabled: boolean }): Promise<AdminPushPreview | null> {
  const o = await readOrder(sql, orderId, false);
  if (!o) return null;
  const ev = await evaluate(sql, o, { mobileEnabled: opts.mobileEnabled, checkPhone: false });
  return {
    available: !ev.refusal,
    code: ev.refusal?.code ?? null,
    message: ev.refusal?.message ?? null,
    retryAfterSecs: ev.refusal?.extra.retryAfterSecs ?? null,
    amount: ev.amount,
    scheduleN: ev.scheduleN,
    revives: ev.refusal ? null : ev.revive,
    buyerPhoneValid: !!tanzanianMobile(o.buyer_phone),
    limits: ADMIN_PUSH_LIMITS,
  };
}

export interface AdminPushInput {
  orderId: string;
  /** Defaults to the buyer's number. */
  phone?: string | null;
  note?: string | null;
  admin: { id: string; name: string };
  mobileEnabled: boolean;
  callbackUrl: string;
  holdTtlSecs?: number;
}

export interface AdminPushResult {
  transactionId: string | null;
  status: 'pending';
  gateway: 'accepted' | 'rejected';
  error?: string;
  amount: number;
  phone: string;
  scheduleN: number | null;
  revivedFrom: string | null;
}

/** Send one admin payment prompt. Throws AdminPushRefused for every refusal
    (already logged as admin_push_refused). A gateway refusal is a result with
    gateway 'rejected', stored on the attempt like any other. */
export async function adminPush(sql: Sql, input: AdminPushInput): Promise<AdminPushResult> {
  const { orderId, admin } = input;
  const note = input.note == null ? null : String(input.note).trim().slice(0, 280) || null;
  const ttl = input.holdTtlSecs ?? 900;
  const given = input.phone != null && String(input.phone).trim() !== '' ? String(input.phone) : null;
  const who = { by: 'admin', adminId: admin.id, adminName: admin.name };
  const logRefused = async (e: AdminPushRefused) => {
    await logOrderEvent(sql, orderId, 'admin_push_refused', {
      ...who, code: e.code, message: e.message, status: e.extra.status ?? null, reason: e.extra.reason ?? null,
      retryAfterSecs: e.extra.retryAfterSecs ?? null, phone: e.extra.phone ?? maskPhone(given) ?? null, note,
    });
  };

  let pre: { amount: number; scheduleN: number | null; revive: string | null; target: string; masked: string; startedAt: Date };
  try {
    pre = await tx(async (t: Sql) => {
      const o = await readOrder(t, orderId, true);
      if (!o) throw new AdminPushRefused('order_not_found', 'Order not found.');
      const ev = await evaluate(t, o, { mobileEnabled: input.mobileEnabled, phone: given, checkPhone: true });
      const target = tanzanianMobile(given ?? o.buyer_phone) as string;
      if (ev.refusal) {
        ev.refusal.extra.phone = maskPhone(given ?? o.buyer_phone);
        throw ev.refusal; // nothing was written; the tx just ends
      }
      if (ev.revive) {
        try {
          await reviveOrder(t, orderId, ev.revive, ttl);
        } catch (e) {
          if (e instanceof AdminPushRefused) e.extra.amount = ev.amount;
          if (e instanceof AdminPushRefused) e.extra.phone = maskPhone(target);
          throw e;
        }
      }
      const [{ now }] = await t`select now() as now`;
      const masked = maskPhone(target) as string;
      await logOrderEvent(t, orderId, 'admin_push_requested', {
        ...who, note, phone: masked, amount: ev.amount, scheduleN: ev.scheduleN, revivedFrom: ev.revive,
      });
      return { amount: ev.amount as number, scheduleN: ev.scheduleN, revive: ev.revive, target, masked, startedAt: now };
    }, sql);
  } catch (e) {
    if (e instanceof AdminPushRefused && e.code !== 'order_not_found') await logRefused(e);
    throw e;
  }

  const base = { status: 'pending' as const, amount: pre.amount, phone: pre.masked, scheduleN: pre.scheduleN, revivedFrom: pre.revive };
  try {
    const r = await initiatePayment(sql, {
      orderId, method: 'mobile', payerPhone: pre.target, callbackUrl: input.callbackUrl, holdTtlSecs: ttl,
      logDetail: { ...who, note, phone: pre.masked, revivedFrom: pre.revive },
    });
    return { ...base, transactionId: r.transactionId, gateway: 'accepted' };
  } catch (e) {
    // Did the gateway refuse an attempt we opened? initiatePayment stored why.
    const [att] = await sql`
      select transaction_id, error from payment_transaction
       where order_id = ${orderId}::uuid and created_at >= ${pre.startedAt}
       order by created_at desc, transaction_id desc limit 1`;
    if (att?.error) return { ...base, transactionId: att.transaction_id, gateway: 'rejected', error: att.error };
    let refusal: AdminPushRefused | null = null;
    const extra = { amount: pre.amount, phone: pre.masked };
    if (e instanceof InstallmentAttemptRefused) {
      if (e.code === 'push_rate_limited') refusal = new AdminPushRefused('rate_limited', e.message, { ...extra, reason: e.code, retryAfterSecs: e.retryAfterSecs ?? 600 });
      else if (e.code === 'installment_attempt_in_flight') refusal = new AdminPushRefused('attempt_in_flight', e.message, { ...extra, reason: e.code });
      else refusal = new AdminPushRefused('not_payable', e.message, { ...extra, reason: e.code });
    } else {
      const msg = String((e as Error)?.message ?? e);
      if (msg.startsWith('order not payable')) refusal = new AdminPushRefused('not_payable', msg, extra);
      else if (msg === 'inventory no longer available') refusal = new AdminPushRefused('inventory_unavailable', msg, extra);
    }
    if (refusal) {
      await logRefused(refusal);
      throw refusal;
    }
    // Anything else is ours, not the gateway's: say so without leaking internals.
    const err = new Error(`admin push failed: ${sanitizeGatewayError(e)}`);
    throw err;
  }
}
