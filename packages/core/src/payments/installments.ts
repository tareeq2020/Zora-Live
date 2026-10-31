/* BS132 (F7): installment orders — creation, per-installment attempts (A16), and
   the outcome allocator that moves an order pending → installment_active → paid.

   MONEY RULES (each one is load-bearing):
   - Every attempt on an installment order is bound to ONE installment_schedule row
     (payment_transaction.schedule_n) and charges THAT row's amount. Nothing on
     this path ever charges the order's target_value (A16).
   - An outcome is allocated exactly once: applyOutcome's txn-level guard (the
     payment_transaction row lock) runs before we get here, and we additionally
     lock the plan, the order and the schedule row. A second success for a row
     that is already paid is recorded as EXCESS (owed back) and alerted — it never
     pays the next row and never double-counts.
   - Deposit cleared → order 'installment_active', held units → RESERVED (A3), seats
     → 'reserved' (hold_order_id = the order), NO credentials (A5).
   - Last row cleared → reservation → sold, seats → sold, order → 'paid', plan
     'completed', credentials issued; reconcile() then notifies like any paid order.
   - Late deposit after the hold sweep (A17): re-reserve the same seats/quantity
     under lock; if gone → 'paid_unseatable' + ops alert, never a silent resell.

   Pay-in-full orders never reach this file: applyOutcome only delegates when the
   attempt carries a schedule_n, and initiatePayment only binds one when the order
   has an installment_plan. */
import { tx } from '../db';
import { alertOps } from '../ops';
import {
  INSTALLMENT_REF, convertHoldsToReservation, tryReserveOrder, convertReservation,
  tryReacquire, releaseHolds,
} from '../inventory';
import { ORDER_STATUS } from '../order-status';
import {
  buildSchedule, configCoversCart, finalDueFor, eatToday,
  type InstallmentConfig, type ScheduleRow, type ScheduleRejection,
} from '../installments';
import { createGaVipOrder, issueCredentials, type CreateGaVipOrderInput, type PaymentOutcome } from './service';

type Sql = any;

/* ── config + event context ───────────────────────────────────────────────── */

function rowToConfig(r: any): InstallmentConfig {
  return {
    eventId: r.event_id,
    enabled: r.enabled === true,
    tiers: Array.isArray(r.tiers) ? r.tiers : [],
    depositPct: r.deposit_pct == null ? null : Number(r.deposit_pct),
    depositAmount: r.deposit_amount == null ? null : Number(r.deposit_amount),
    count: Number(r.count),
    frequency: r.frequency,
    finalDueDaysBeforeEvent: Number(r.final_due_days_before_event),
    graceDays: Number(r.grace_days),
  };
}

/** The organizer's offer for an event, or null when none is configured. */
export async function readInstallmentConfig(sql: Sql, eventId: string): Promise<InstallmentConfig | null> {
  const [r] = await sql`select * from installment_config where event_id = ${eventId}`;
  return r ? rowToConfig(r) : null;
}

/** Upsert an already-sanitized offer (sanitizeInstallmentConfig). The table's
    CHECKs are the backstop for anything that slipped past validation. */
export async function upsertInstallmentConfig(sql: Sql, c: InstallmentConfig): Promise<InstallmentConfig> {
  const [r] = await sql`
    insert into installment_config (event_id, enabled, tiers, deposit_pct, deposit_amount, count, frequency,
                                    final_due_days_before_event, grace_days, updated_at)
    values (${c.eventId}, ${c.enabled}, ${c.tiers}, ${c.depositPct}, ${c.depositAmount}, ${c.count}, ${c.frequency},
            ${c.finalDueDaysBeforeEvent}, ${c.graceDays}, now())
    on conflict (event_id) do update set
      enabled = excluded.enabled, tiers = excluded.tiers, deposit_pct = excluded.deposit_pct,
      deposit_amount = excluded.deposit_amount, count = excluded.count, frequency = excluded.frequency,
      final_due_days_before_event = excluded.final_due_days_before_event, grace_days = excluded.grace_days,
      updated_at = now()
    returning *`;
  return rowToConfig(r);
}

/** Organizer handle + ISO date of an event. Both live in the 'events'
    collection_store blob (event.organizer_id is NULL post-seed). */
export async function eventInstallmentContext(sql: Sql, eventId: string): Promise<{ orgHandle: string | null; eventDate: string | null }> {
  const [row] = await sql`
    select lower(e->>'organizerHandle') as handle, e->>'date' as date
      from collection_store cs
      cross join lateral jsonb_array_elements(cs.data::jsonb) e
     where cs.name = 'events' and jsonb_typeof(cs.data::jsonb) = 'array' and e->>'id' = ${eventId}
     limit 1`;
  const date = typeof row?.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(row.date) ? row.date.slice(0, 10) : null;
  return { orgHandle: row?.handle || null, eventDate: date };
}

/* ── order creation ───────────────────────────────────────────────────────── */

class ScheduleRejected extends Error {
  constructor(public readonly reason: ScheduleRejection, message: string) {
    super(message);
    this.name = 'ScheduleRejected';
  }
}

export interface CreateInstallmentOrderInput extends Omit<CreateGaVipOrderInput, 'onCreated'> {
  /** The event's offer, read BEFORE the tx (like every other config). */
  config: InstallmentConfig;
  /** Event date YYYY-MM-DD (from the events blob). */
  eventDate: string | null;
  orgHandle?: string | null;
  /** Purchase date (YYYY-MM-DD, EAT). Defaults to today — a seam for tests. */
  today?: string;
}

export type CreateInstallmentOrderResult =
  | { ok: true; orderId: string; total: number; subtotal: number; fee: number; deposit: number; finalDue: string; schedule: ScheduleRow[] }
  | { ok: false; reason: 'sold_out'; tier: string }
  | { ok: false; reason: 'seat_taken'; seats: string[] }
  | { ok: false; reason: 'not_offered' }
  | { ok: false; reason: 'schedule_rejected'; code: ScheduleRejection; message: string };

/**
 * Create an installment order: the SAME createGaVipOrder flow (customer, items,
 * holds, seats, fee, commission stamp), plus — inside its transaction — the plan
 * + schedule snapshot (A19). The order stays 'pending' with HELD inventory until
 * the deposit clears. A schedule that doesn't fit rolls the whole order back.
 */
export async function createInstallmentOrder(sql: Sql, input: CreateInstallmentOrderInput): Promise<CreateInstallmentOrderResult> {
  const { config, eventDate, today = eatToday() } = input;
  if (!configCoversCart(config, input.cart.map((l) => l.tier))) return { ok: false, reason: 'not_offered' };
  const finalDue = eventDate ? finalDueFor(eventDate, config.finalDueDaysBeforeEvent) : null;
  if (!finalDue) return { ok: false, reason: 'schedule_rejected', code: 'bad_date', message: 'The event date is not set, so installments are not available.' };

  let built: { deposit: number; rows: ScheduleRow[] } | null = null;
  try {
    const r = await createGaVipOrder(sql, {
      ...input,
      onCreated: async (t, o) => {
        const s = buildSchedule({
          total: o.total, depositPct: config.depositPct, depositAmount: config.depositAmount,
          count: config.count, frequency: config.frequency, today, finalDue,
        });
        if (!s.ok) throw new ScheduleRejected(s.reason, s.message);
        const [cur] = await t`
          select pv.currency from order_item oi join price_version pv on pv.id = oi.price_version_id
           where oi.order_id = ${o.orderId} limit 1`;
        await t`
          insert into installment_plan (order_id, event_id, org_handle, total, service_fee, currency, deposit, count,
                                        frequency, final_due, grace_days, status)
          values (${o.orderId}::uuid, ${o.eventId}, ${input.orgHandle ?? null}, ${o.total}, ${o.fee}, ${cur?.currency ?? 'TZS'},
                  ${s.deposit}, ${config.count}, ${config.frequency}, ${finalDue}::date, ${config.graceDays}, 'pending')`;
        for (const row of s.rows) {
          await t`insert into installment_schedule (order_id, n, due_date, amount)
                  values (${o.orderId}::uuid, ${row.n}, ${row.dueDate}::date, ${row.amount})`;
        }
        built = { deposit: s.deposit, rows: s.rows };
      },
    });
    if (!r.ok) return r;
    const b = built as unknown as { deposit: number; rows: ScheduleRow[] };
    return { ok: true, orderId: r.orderId, total: r.total, subtotal: r.subtotal, fee: r.fee, deposit: b.deposit, finalDue, schedule: b.rows };
  } catch (e) {
    if (e instanceof ScheduleRejected) return { ok: false, reason: 'schedule_rejected', code: e.reason, message: e.message };
    throw e;
  }
}

/* ── binding an attempt to one schedule row (A16) ─────────────────────────── */

export interface InstallmentBinding {
  n: number;
  amount: number;
}

/** Thrown for a refused installment attempt; `code` is the API error. */
export class InstallmentAttemptRefused extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'InstallmentAttemptRefused';
  }
}

/** Does the order have an installment plan? (One indexed PK read.) */
export async function hasInstallmentPlan(sql: Sql, orderId: string): Promise<boolean> {
  const r = await sql`select 1 from installment_plan where order_id = ${orderId}::uuid`;
  return r.length > 0;
}

/**
 * Pre-flight for an installment attempt (no writes): which row it pays, and
 * whether the order/plan may take it. `scheduleN` omitted = the next unpaid row.
 * Rows are paid in order — a later row can't be paid while an earlier one is open.
 */
export async function planInstallmentAttempt(sql: Sql, orderId: string, orderStatus: string, scheduleN?: number | null): Promise<InstallmentBinding> {
  const [plan] = await sql`select status from installment_plan where order_id = ${orderId}::uuid`;
  if (!plan) throw new InstallmentAttemptRefused('not_installment_order');
  const [next] = await sql`
    select n, amount from installment_schedule
     where order_id = ${orderId}::uuid and status <> 'paid' order by n limit 1`;
  if (!next) throw new InstallmentAttemptRefused('installment_fully_paid');
  const n = scheduleN == null ? Number(next.n) : Number(scheduleN);
  if (!Number.isInteger(n) || n < 1) throw new InstallmentAttemptRefused('bad_schedule_n');
  if (n !== Number(next.n)) throw new InstallmentAttemptRefused('installment_out_of_order', `pay installment ${next.n} first`);
  if (n === 1) {
    if (orderStatus !== ORDER_STATUS.PENDING && orderStatus !== ORDER_STATUS.FAILED) throw new InstallmentAttemptRefused('not_payable');
  } else {
    if (orderStatus !== ORDER_STATUS.INSTALLMENT_ACTIVE) throw new InstallmentAttemptRefused('not_payable');
    if (plan.status !== 'active') throw new InstallmentAttemptRefused('plan_closing', `installment plan is ${plan.status}`);
  }
  return { n, amount: Number(next.amount) };
}

/**
 * Open the payment_transaction row for one installment, under a lock on the plan
 * so two "pay now" taps can never both open an attempt for the same row. Refuses
 * while another attempt for that row is still in flight (the buyer would be
 * pushed twice and could pay twice).
 */
export async function openInstallmentAttempt(
  sql: Sql, orderId: string, binding: InstallmentBinding, method: string, fspId: string,
): Promise<string> {
  return tx(async (t: Sql) => {
    const [plan] = await t`select status from installment_plan where order_id = ${orderId}::uuid for update`;
    if (!plan) throw new InstallmentAttemptRefused('not_installment_order');
    if (binding.n > 1 && plan.status !== 'active') throw new InstallmentAttemptRefused('plan_closing', `installment plan is ${plan.status}`);
    const [row] = await t`select status, amount from installment_schedule where order_id = ${orderId}::uuid and n = ${binding.n}`;
    if (!row || row.status === 'paid') throw new InstallmentAttemptRefused('installment_already_paid');
    if (Number(row.amount) !== binding.amount) throw new InstallmentAttemptRefused('installment_amount_changed');
    const inflight = await t`
      select transaction_id from payment_transaction
       where order_id = ${orderId}::uuid and schedule_n = ${binding.n}
         and status in ('created', 'pending', 'processing') limit 1`;
    if (inflight.length) {
      throw new InstallmentAttemptRefused('installment_attempt_in_flight', 'a payment for this installment is already in progress — approve or cancel it first');
    }
    const [{ k }] = await t`select count(*)::int as k from payment_transaction where order_id = ${orderId}::uuid`;
    const transactionId = `ZORA-${orderId}-${k + 1}`;
    await t`
      insert into payment_transaction (order_id, transaction_id, method, fsp_id, amount, status, schedule_n)
      values (${orderId}::uuid, ${transactionId}, ${method}, ${fspId}, ${binding.amount}, 'created', ${binding.n})`;
    return transactionId;
  }, sql);
}

/* ── allocating an outcome (called from applyOutcome, inside its tx) ──────── */

interface InstallmentTxn {
  order_id: string;
  schedule_n: number;
  amount: number | string | null;
}

/** Seats of an order (BS125), locked. */
async function lockOrderSeats(t: Sql, orderId: string): Promise<any[]> {
  return t`
    select si.seat_id, si.state, si.hold_order_id, si.hold_expires_at <= now() as expired
      from order_seat os join seat_inventory si on si.event_id = os.event_id and si.seat_id = os.seat_id
     where os.order_id = ${orderId} for update of si`;
}

/** Release an order's still-HELD seats back to the map. */
async function releaseHeldSeats(t: Sql, orderId: string): Promise<void> {
  await t`update seat_inventory set state='available', hold_order_id=null, hold_expires_at=null, updated_at=now()
           where hold_order_id=${orderId} and state='held'`;
}

/**
 * Allocate one terminal outcome of an installment attempt. Runs inside
 * applyOutcome's transaction, AFTER its txn-level guard locked the
 * payment_transaction row and proved it non-terminal. Returns the order status
 * ('paid' triggers the normal buyer notification in reconcile()).
 */
export async function applyInstallmentOutcome(
  t: Sql, transactionId: string, txr: InstallmentTxn, outcome: PaymentOutcome, collected: number | null,
): Promise<string | null> {
  const orderId = txr.order_id;
  const n = Number(txr.schedule_n);
  // Lock order: plan → order → schedule row (the default job takes the same order).
  const [plan] = await t`select * from installment_plan where order_id = ${orderId} for update`;
  const [ord] = await t`select status from "order" where id = ${orderId} for update`;
  const [row] = await t`select n, amount, status from installment_schedule where order_id = ${orderId} and n = ${n} for update`;

  const markTx = (status: 'successful' | 'failed' | 'partial') => t`
    update payment_transaction set status = ${status},
           collected_amount = coalesce(${status === 'failed' ? null : collected}, collected_amount), updated_at = now()
     where transaction_id = ${transactionId}`;

  if (!plan || !row || !ord) {
    await markTx(outcome === 'successful' ? 'successful' : outcome === 'short' ? 'partial' : 'failed');
    await alertOps(t, 'installment_orphan_attempt', orderId, transactionId);
    return ord?.status ?? null;
  }

  if (outcome === 'failed') {
    await markTx('failed');
    // A failed DEPOSIT behaves exactly like a failed pay-in-full attempt: the order
    // goes 'failed' and its holds/seats are released (a retry re-holds them).
    if (n === 1 && ord.status === ORDER_STATUS.PENDING) {
      await t`update "order" set status = 'failed' where id = ${orderId} and status = 'pending'`;
      await releaseHolds(t, orderId);
      await releaseHeldSeats(t, orderId);
      return ORDER_STATUS.FAILED;
    }
    return ord.status; // a failed later installment changes nothing; the buyer retries
  }

  // A "successful" that collected less than THIS row's amount is a short payment:
  // the row is only ever paid in full (the gateway's own amount echo is not trusted).
  if (outcome === 'successful' && collected != null && collected < Number(row.amount)) outcome = 'short';

  if (outcome === 'short') {
    await markTx('partial');
    await alertOps(t, 'installment_short', orderId, transactionId);
    if (n === 1 && ord.status === ORDER_STATUS.PENDING) {
      await t`update "order" set status = 'payment_short' where id = ${orderId}`;
      return ORDER_STATUS.PAYMENT_SHORT;
    }
    return ord.status; // money held for ops; the row stays unpaid
  }

  // ── successful ──
  const got = collected ?? Number(txr.amount ?? 0);
  const recordExcess = async (amount: number, kind: string) => {
    await t`update installment_plan set excess_collected = excess_collected + ${Math.max(0, amount)} where order_id = ${orderId}`;
    await alertOps(t, kind, orderId, transactionId);
  };

  // A row already paid, or a plan that is over: this money is owed back, whole.
  if (row.status === 'paid' || plan.status === 'defaulted' || plan.status === 'completed') {
    await markTx('successful');
    await recordExcess(got, row.status === 'paid' ? 'installment_duplicate_collection' : `installment_late_${plan.status}`);
    return ord.status;
  }

  const payRow = async () => {
    await markTx('successful');
    await t`update installment_schedule set status = 'paid', paid_at = now(), transaction_id = ${transactionId}
             where order_id = ${orderId} and n = ${n}`;
    const over = got - Number(row.amount);
    if (over > 0) await recordExcess(over, 'installment_overpaid');
  };

  if (n === 1) {
    // Deposit. Only a not-yet-active order can take it (pending, a failed retry
    // that settled late, or an order whose holds were swept: A17).
    if (ord.status !== ORDER_STATUS.PENDING && ord.status !== ORDER_STATUS.FAILED && ord.status !== ORDER_STATUS.EXPIRED) {
      await markTx('successful');
      await recordExcess(got, 'installment_deposit_unexpected');
      return ord.status;
    }
    const unseatable = async (): Promise<string> => {
      await markTx('successful');
      await t`update "order" set status = 'paid_unseatable' where id = ${orderId}`;
      await t`update installment_plan set status = 'cancelled', closed_at = now() where order_id = ${orderId}`;
      await releaseHolds(t, orderId);
      await releaseHeldSeats(t, orderId);
      await alertOps(t, 'paid_unseatable', orderId);
      return ORDER_STATUS.PAID_UNSEATABLE;
    };
    const seatRows = await lockOrderSeats(t, orderId);
    const seatsOk = seatRows.every((r: any) =>
      r.state === 'available' || (r.state === 'held' && (r.hold_order_id === orderId || r.expired)));
    if (!seatsOk) return unseatable();

    // Safety-net expiry for the reservation sweep: final due + grace + 1 day.
    const [{ exp }] = await t`
      select ((final_due + grace_days + 2)::timestamp at time zone 'Africa/Dar_es_Salaam') as exp
        from installment_plan where order_id = ${orderId}`;
    const moved = await convertHoldsToReservation(t, orderId, exp);
    if (moved === 0 && !(await tryReserveOrder(t, orderId, exp))) return unseatable();
    if (seatRows.length) {
      // Reserved for THIS plan: hold_order_id names the order, no expiry (the
      // seat sweep only touches 'held'), never resellable until default/complete.
      await t`update seat_inventory set state = 'reserved', hold_order_id = ${orderId}, hold_expires_at = null,
                     reserved_note = 'installment', updated_at = now()
               where (event_id, seat_id) in (select event_id, seat_id from order_seat where order_id = ${orderId})`;
    }
    await payRow();
    await t`update "order" set status = 'installment_active' where id = ${orderId}`;
    await t`update installment_plan set status = 'active' where order_id = ${orderId}`;
    return completeIfPaid(t, orderId, ORDER_STATUS.INSTALLMENT_ACTIVE);
  }

  // Later installment: the plan must be live (active, or closing — the default
  // job reconciles in-flight attempts while closing and a success then counts).
  if (ord.status !== ORDER_STATUS.INSTALLMENT_ACTIVE || (plan.status !== 'active' && plan.status !== 'closing')) {
    await markTx('successful');
    await recordExcess(got, 'installment_unexpected_state');
    return ord.status;
  }
  await payRow();
  return completeIfPaid(t, orderId, ORDER_STATUS.INSTALLMENT_ACTIVE);
}

/** Every row paid → reserved → sold, seats sold, order 'paid', passes issued. */
async function completeIfPaid(t: Sql, orderId: string, current: string): Promise<string> {
  const [agg] = await t`
    select count(*) filter (where s.status <> 'paid')::int as open,
           coalesce(sum(s.amount) filter (where s.status = 'paid'), 0)::bigint as paid,
           p.total
      from installment_schedule s join installment_plan p on p.order_id = s.order_id
     where s.order_id = ${orderId} group by p.total`;
  if (!agg || Number(agg.open) > 0) return current;
  // Cumulative check (A16): the allocated money must be exactly the plan total.
  if (Number(agg.paid) !== Number(agg.total)) {
    await alertOps(t, 'installment_sum_mismatch', orderId, `${agg.paid}/${agg.total}`);
    return current;
  }
  let converted = await convertReservation(t, INSTALLMENT_REF, orderId);
  if (converted === 0) {
    // The safety-net sweep released the reservation (plan ran past its expiry):
    // re-take straight to sold, or flag — never issue a pass without stock.
    if (!(await tryReacquire(t, orderId))) {
      await t`update "order" set status = 'paid_unseatable' where id = ${orderId}`;
      await t`update installment_plan set status = 'completed', closed_at = now() where order_id = ${orderId}`;
      await t`update seat_inventory set state = 'available', hold_order_id = null, reserved_note = null, updated_at = now()
               where hold_order_id = ${orderId} and state = 'reserved'`;
      await alertOps(t, 'paid_unseatable', orderId);
      return ORDER_STATUS.PAID_UNSEATABLE;
    }
    converted = 1;
  }
  await t`update seat_inventory set state = 'sold', sold_order_id = ${orderId}, hold_order_id = null, hold_expires_at = null,
                 reserved_note = null, updated_at = now()
           where hold_order_id = ${orderId} and state = 'reserved'`;
  await t`update "order" set status = 'paid' where id = ${orderId}`;
  await t`update installment_plan set status = 'completed', closed_at = now() where order_id = ${orderId}`;
  await issueCredentials(t, orderId);
  return ORDER_STATUS.PAID;
}

/* ── read model (BS134 pass page: "Booked — X of N paid") ─────────────────── */

export interface InstallmentSummary {
  orderId: string;
  status: string;
  total: number;
  currency: string;
  paid: number;
  outstanding: number;
  paidCount: number;
  count: number;
  finalDue: string;
  graceDays: number;
  schedule: { n: number; dueDate: string; amount: number; status: string; paidAt: string | null }[];
}

export async function installmentSummary(sql: Sql, orderId: string): Promise<InstallmentSummary | null> {
  const [p] = await sql`select *, to_char(final_due, 'YYYY-MM-DD') as final_due_s from installment_plan where order_id = ${orderId}::uuid`;
  if (!p) return null;
  const rows = await sql`
    select n, to_char(due_date, 'YYYY-MM-DD') as due, amount, status, paid_at
      from installment_schedule where order_id = ${orderId}::uuid order by n`;
  const schedule = rows.map((r: any) => ({
    n: Number(r.n), dueDate: r.due, amount: Number(r.amount), status: r.status,
    paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
  }));
  const paid = schedule.filter((r: any) => r.status === 'paid').reduce((s: number, r: any) => s + r.amount, 0);
  return {
    orderId, status: p.status, total: Number(p.total), currency: p.currency, paid,
    outstanding: Number(p.total) - paid, paidCount: schedule.filter((r: any) => r.status === 'paid').length,
    count: Number(p.count), finalDue: p.final_due_s, graceDays: Number(p.grace_days), schedule,
  };
}
