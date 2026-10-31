/* BS135 (F7 / A18): installment worker jobs.

   1. Reminders (SMS + email) — 3 days before each due date, ON the due date
      (the due-date nudge, with the pay-now link and the control-number
      fallback), and once when a payment is missed. At most ONE reminder per
      order per day, each (row, kind) at most once, only 09:00–20:00 EAT.
      Idempotent through claim rows in webhook_event (provider
      'installment-reminder'), the same once-latch pattern alertOps uses — no
      new table.
   2. Locked default close (A18) — after grace:
        lock plan → status 'closing' (no new collections: planInstallmentAttempt
        and openInstallmentAttempt refuse a non-active plan under the plan lock)
        → reconcile every in-flight attempt
        → if it got paid meanwhile, the allocator already completed it (done)
        → else, under the plan lock again: release the reservation + seats,
          order → installment_defaulted, unpaid rows → missed, plan → defaulted,
          refund owed = paid − service fee (+ any excess) recorded on the plan
        → buyer notified once.
      While an attempt is still in flight the plan stays 'closing' and the job
      retries next tick; after CLOSING_MAX_HOURS it closes anyway — a payment
      that lands later is recorded as excess and refunded (applyInstallmentOutcome).
   3. Housekeeping — a plan whose order died before the deposit (expired /
      cancelled) is marked 'cancelled'.

   REFUNDS: x-bridge has no automated reversal Zora can call, and refundOrder()
   only records a refund against line-item gross for refundable statuses. So the
   default records refund_due + refund_status 'pending' on the plan and raises an
   'installment_refund_pending' ops alert (the manual-refund worklist). Ops pays
   the buyer back and calls recordInstallmentRefund(), which books the debit on
   the order (refunded_amount) and flips refund_status → 'recorded'. */
import { tx } from '../db';
import { alertOps } from '../ops';
import { sendSms } from '../sms';
import { sendEmail, escapeHtml } from '../email';
import { publicWebOrigin } from '../origins';
import { releaseReservation, INSTALLMENT_REF } from '../inventory';
import { ORDER_STATUS } from '../order-status';
import { addDays, eatToday } from '../installments';
import { reconcile } from './service';

type Sql = any;

/** Quiet hours: reminders only go out 09:00–20:00 Tanzania time. */
export const REMINDER_HOURS = { from: 9, to: 20 };
/** How long a plan may sit in 'closing' waiting on in-flight attempts. */
export const CLOSING_MAX_HOURS = 24;

export type ReminderKind = 'pre3' | 'due' | 'missed';

function eatHour(now: Date): number {
  return (now.getUTCHours() + 3) % 24;
}

/** Where a reminder sends the buyer. TODO(BS134): the web pay page for one
    installment lives here (it calls POST /api/checkout/:orderId/pay). */
export function installmentPayLink(orderId: string): string {
  return `${publicWebOrigin()}/pay/${encodeURIComponent(orderId)}`;
}

function fmtMoney(n: number, currency: string): string {
  return `${currency} ${Number(n).toLocaleString('en-US')}`;
}

function reminderText(kind: ReminderKind, eventName: string, n: number, count: number, amount: string, due: string, link: string, graceUntil: string): string {
  if (kind === 'pre3') return `${eventName}: payment ${n} of ${count} (${amount}) is due on ${due}. Pay now: ${link}`;
  if (kind === 'due') return `${eventName}: payment ${n} of ${count} (${amount}) is due today. Pay now or get a control number: ${link}`;
  return `${eventName}: payment ${n} of ${count} (${amount}) was due on ${due}. Pay by ${graceUntil} to keep your booking: ${link}`;
}

/** Claim a once-only latch row. True = we own it (first claim). */
async function claim(sql: Sql, key: string): Promise<boolean> {
  const [r] = await sql`
    insert into webhook_event (provider, dedup_key, transaction_id, applied)
    values ('installment-reminder', ${key}, null, true)
    on conflict (provider, dedup_key) do nothing returning id`;
  return !!r;
}

async function buyerContact(sql: Sql, orderId: string): Promise<{ phone: string | null; email: string | null; name: string | null; eventName: string } | null> {
  const [r] = await sql`
    select c.phone, c.email, c.name, e.name as event_name
      from "order" o join customer c on c.id = o.customer_id join event e on e.id = o.event_id
     where o.id = ${orderId}::uuid`;
  if (!r) return null;
  // Synthetic comp/gate keys are never texted (they are not phone numbers).
  const phone = r.phone && /^\+?\d{9,15}$/.test(String(r.phone)) ? r.phone : null;
  return { phone, email: r.email ?? null, name: r.name ?? null, eventName: r.event_name };
}

async function deliver(sql: Sql, orderId: string, subject: string, text: string): Promise<{ sms: boolean; email: boolean }> {
  const who = await buyerContact(sql, orderId);
  const out = { sms: false, email: false };
  if (!who) return out;
  try { if (who.phone) { await sendSms(who.phone, text); out.sms = true; } } catch (e) { console.error('installment SMS failed', e); }
  try {
    if (who.email) {
      const html = `<p>Hi ${escapeHtml(who.name ?? 'there')},</p><p>${escapeHtml(text)}</p><p>— ZoraPass</p>`;
      await sendEmail(who.email, subject, html);
      out.email = true;
    }
  } catch (e) { console.error('installment email failed', e); }
  return out;
}

/**
 * Send due reminders. Returns the number of reminders sent.
 * Also marks rows whose due date has passed as 'missed' (they stay payable
 * during grace — only the default close ends that).
 */
export async function sendInstallmentReminders(sql: Sql, now: Date = new Date()): Promise<number> {
  const today = eatToday(now);
  await sql`
    update installment_schedule s set status = 'missed'
      from installment_plan p
     where p.order_id = s.order_id and p.status = 'active'
       and s.status = 'due' and s.due_date < ${today}::date`;
  const hour = eatHour(now);
  if (hour < REMINDER_HOURS.from || hour >= REMINDER_HOURS.to) return 0;

  const pre3 = addDays(today, 3);
  // Candidate rows, most urgent first per order. Each (row, kind) is sent once;
  // the first row per order whose reminder is still unsent wins today's slot.
  const rows = await sql`
    select s.order_id, s.n, to_char(s.due_date, 'YYYY-MM-DD') as due, s.amount, p.count, p.currency, p.grace_days,
           case when s.due_date < ${today}::date then 'missed'
                when s.due_date = ${today}::date then 'due'
                else 'pre3' end as kind
      from installment_schedule s
      join installment_plan p on p.order_id = s.order_id
     where p.status = 'active' and s.status <> 'paid'
       and (s.due_date < ${today}::date or s.due_date = ${today}::date or s.due_date = ${pre3}::date)
     order by s.order_id,
              case when s.due_date < ${today}::date then 0 when s.due_date = ${today}::date then 1 else 2 end, s.n
     limit 2000`;

  let sent = 0;
  const handled = new Set<string>();
  for (const r of rows) {
    if (handled.has(r.order_id)) continue;
    const kind = r.kind as ReminderKind;
    // A missed row is reminded ONCE (not every day of grace).
    const rowKey = `row:${r.order_id}:${r.n}:${kind}`;
    const dayKey = `day:${r.order_id}:${today}`;
    const won = await tx(async (t: Sql): Promise<'sent' | 'row_done' | 'day_taken'> => {
      if (!(await claim(t, rowKey))) return 'row_done';
      if (!(await claim(t, dayKey))) throw new DayTaken(); // roll back the row claim: try this row another day
      return 'sent';
    }, sql).catch((e: unknown) => { if (e instanceof DayTaken) return 'day_taken' as const; throw e; });
    if (won === 'row_done') continue;          // this row's reminder already went; try the order's next row
    handled.add(r.order_id);
    if (won === 'day_taken') continue;         // this order already got today's reminder
    const who = await buyerContact(sql, r.order_id);
    const link = installmentPayLink(r.order_id);
    const graceUntil = addDays(r.due, Number(r.grace_days));
    const text = reminderText(kind, who?.eventName ?? 'Your booking', Number(r.n), Number(r.count), fmtMoney(Number(r.amount), r.currency), r.due, link, graceUntil);
    const subject = kind === 'missed' ? 'Payment missed — keep your booking' : kind === 'due' ? 'Your payment is due today' : 'Your next payment is coming up';
    await deliver(sql, r.order_id, subject, text);
    sent++;
  }
  return sent;
}

class DayTaken extends Error {}

/* ── locked default close (A18) ──────────────────────────────────────────── */

export interface DefaultCloseResult {
  closing: number;    // plans moved active → closing this run
  reopened: number;   // overdue row paid while closing → back to active
  defaulted: number;  // plans closed as defaulted
  completed: number;  // plans that turned out paid while closing
  waiting: number;    // plans still closing (attempt in flight)
}

/**
 * Close every plan whose earliest unpaid row is past its grace. Idempotent and
 * restartable: each step re-checks state under the plan lock, so a crash between
 * steps resumes on the next tick (a 'closing' plan is picked up again).
 */
export async function closeDefaultedPlans(sql: Sql, now: Date = new Date()): Promise<DefaultCloseResult> {
  const today = eatToday(now);
  const out: DefaultCloseResult = { closing: 0, reopened: 0, defaulted: 0, completed: 0, waiting: 0 };

  // Step 1 — lock: active plans past grace → closing. From here no new attempt opens.
  const toClose = await sql`
    select p.order_id from installment_plan p
     where p.status = 'active'
       and exists (select 1 from installment_schedule s
                    where s.order_id = p.order_id and s.status <> 'paid'
                      and s.due_date + p.grace_days < ${today}::date)
     limit 200`;
  for (const r of toClose) {
    const moved = await sql`
      update installment_plan set status = 'closing', closing_at = now()
       where order_id = ${r.order_id} and status = 'active' returning order_id`;
    if (moved.length) out.closing++;
  }

  // Step 2+3 — every closing plan (new or left over from an earlier tick).
  const closing = await sql`
    select order_id, closing_at < now() - make_interval(hours => ${CLOSING_MAX_HOURS}) as overdue_close
      from installment_plan where status = 'closing' order by closing_at limit 200`;
  for (const p of closing) {
    const orderId: string = p.order_id;
    // Step 2 — reconcile in-flight attempts (a payment may have landed).
    const inflight = await sql`
      select transaction_id from payment_transaction
       where order_id = ${orderId} and schedule_n is not null and status in ('created', 'pending', 'processing')`;
    for (const t of inflight) {
      try { await reconcile(sql, t.transaction_id); } catch (e) { console.error('[installments] reconcile during close failed', t.transaction_id, e); }
    }
    const still = await sql`
      select count(*)::int as n from payment_transaction
       where order_id = ${orderId} and schedule_n is not null and status in ('created', 'pending', 'processing')`;
    if (Number(still[0].n) > 0 && !p.overdue_close) { out.waiting++; continue; }

    // Step 3 — decide exactly once, under the plan lock (same lock order as the allocator).
    const result = await tx(async (t: Sql): Promise<'defaulted' | 'completed' | 'reopened' | 'skip'> => {
      const [plan] = await t`select * from installment_plan where order_id = ${orderId} for update`;
      if (!plan || plan.status !== 'closing') return plan?.status === 'completed' ? 'completed' : 'skip';
      const [ord] = await t`select status from "order" where id = ${orderId} for update`;
      const [agg] = await t`
        select count(*) filter (where status <> 'paid')::int as open,
               coalesce(sum(amount) filter (where status = 'paid'), 0)::bigint as paid
          from installment_schedule where order_id = ${orderId}`;
      if (Number(agg.open) === 0) {
        // Paid in full meanwhile but not completed (shouldn't happen — the
        // allocator completes on the last row). Hand back to active + alert.
        await t`update installment_plan set status = 'active', closing_at = null where order_id = ${orderId}`;
        await alertOps(t, 'installment_close_found_paid', orderId);
        return 'skip';
      }
      // The overdue row got paid while closing (and nothing else is past grace):
      // the reason to default is gone — the plan goes back to active.
      const [late] = await t`
        select exists (select 1 from installment_schedule
                        where order_id = ${orderId} and status <> 'paid'
                          and due_date + ${Number(plan.grace_days)}::int < ${today}::date) as past`;
      if (!late.past) {
        await t`update installment_plan set status = 'active', closing_at = null where order_id = ${orderId}`;
        return 'reopened';
      }
      await releaseReservation(t, INSTALLMENT_REF, orderId);
      await t`update seat_inventory set state = 'available', hold_order_id = null, hold_expires_at = null,
                     reserved_note = null, updated_at = now()
               where hold_order_id = ${orderId} and state = 'reserved'`;
      await t`update installment_schedule set status = 'missed' where order_id = ${orderId} and status <> 'paid'`;
      if (ord?.status === ORDER_STATUS.INSTALLMENT_ACTIVE) {
        await t`update "order" set status = 'installment_defaulted' where id = ${orderId}`;
      }
      // Owner decision 3: refund what was paid minus the service fee (fee-first,
      // the platform's). Excess/duplicate money was never the organizer's: owed too.
      const refund = Math.max(0, Number(agg.paid) - Number(plan.service_fee)) + Number(plan.excess_collected);
      await t`update installment_plan set status = 'defaulted', closed_at = now(), refund_due = ${refund},
                     refund_status = ${refund > 0 ? 'pending' : 'none'}
               where order_id = ${orderId}`;
      await alertOps(t, 'installment_defaulted', orderId);
      if (refund > 0) await alertOps(t, 'installment_refund_pending', orderId, String(refund));
      return 'defaulted';
    }, sql);

    if (result === 'completed') out.completed++;
    if (result === 'reopened') out.reopened++;
    if (result !== 'defaulted') continue;
    out.defaulted++;
    // Step 4 — tell the buyer, once.
    if (await claim(sql, `default:${orderId}`)) {
      const [pl] = await sql`select refund_due, currency from installment_plan where order_id = ${orderId}`;
      const who = await buyerContact(sql, orderId);
      const refundPart = Number(pl.refund_due) > 0
        ? ` We will refund ${fmtMoney(Number(pl.refund_due), pl.currency)} (what you paid, minus the service fee).`
        : '';
      await deliver(sql, orderId, 'Your booking was released',
        `${who?.eventName ?? 'Your booking'}: the payment plan was not completed in time, so your booking has been released.${refundPart}`);
    }
  }
  return out;
}

/** Plans whose order died before the deposit → cancelled. */
export async function cancelStalePendingPlans(sql: Sql): Promise<number> {
  const r = await sql`
    update installment_plan p set status = 'cancelled', closed_at = now()
      from "order" o
     where o.id = p.order_id and p.status = 'pending'
       and o.status in (${ORDER_STATUS.EXPIRED}, ${ORDER_STATUS.CANCELLED})
       and not exists (select 1 from installment_schedule s where s.order_id = p.order_id and s.status = 'paid')`;
  return Number(r.count ?? 0);
}

/** One worker tick: reminders, default close, housekeeping. Returns work done. */
export async function runInstallmentJobs(sql: Sql, now: Date = new Date()): Promise<number> {
  const closed = await closeDefaultedPlans(sql, now);
  const reminded = await sendInstallmentReminders(sql, now);
  const cancelled = await cancelStalePendingPlans(sql);
  return closed.closing + closed.reopened + closed.defaulted + closed.completed + reminded + cancelled;
}

/* ── refunds (manual rail) ───────────────────────────────────────────────── */

export type RecordInstallmentRefundResult =
  | { ok: true; orderId: string; refunded: number }
  | { ok: false; reason: 'not_found' | 'no_refund_pending' };

/** Ops has paid the buyer back: book the debit on the order and close the item. */
export async function recordInstallmentRefund(sql: Sql, orderId: string, reference: string): Promise<RecordInstallmentRefundResult> {
  return tx(async (t: Sql): Promise<RecordInstallmentRefundResult> => {
    const [p] = await t`select refund_due, refund_status from installment_plan where order_id = ${orderId}::uuid for update`;
    if (!p) return { ok: false, reason: 'not_found' };
    if (p.refund_status !== 'pending') return { ok: false, reason: 'no_refund_pending' };
    await t`update installment_plan set refund_status = 'recorded' where order_id = ${orderId}::uuid`;
    await t`update "order" set refunded_amount = ${Number(p.refund_due)}, refunded_at = now() where id = ${orderId}::uuid`;
    await alertOps(t, 'installment_refund_recorded', orderId, String(reference).slice(0, 120));
    return { ok: true, orderId, refunded: Number(p.refund_due) };
  }, sql);
}

/* ── BS136: organizer "Send reminder" (manual nudge) ─────────────────────── */

/** Text + deliver one reminder for the order's next unpaid row, right now (no
    quiet-hours or once-per-row latch — the caller owns its own rate limit).
    Returns false when the plan is not active or nothing is left to pay. */
export async function sendManualInstallmentReminder(sql: Sql, orderId: string, now: Date = new Date()): Promise<{ sent: boolean; sms: boolean; email: boolean }> {
  const today = eatToday(now);
  const [r] = await sql`
    select s.n, to_char(s.due_date, 'YYYY-MM-DD') as due, s.amount, p.count, p.currency, p.grace_days
      from installment_schedule s join installment_plan p on p.order_id = s.order_id
     where s.order_id = ${orderId}::uuid and p.status = 'active' and s.status <> 'paid'
     order by s.n limit 1`;
  if (!r) return { sent: false, sms: false, email: false };
  const kind: ReminderKind = r.due < today ? 'missed' : r.due === today ? 'due' : 'pre3';
  const who = await buyerContact(sql, orderId);
  const text = reminderText(kind, who?.eventName ?? 'Your booking', Number(r.n), Number(r.count),
    fmtMoney(Number(r.amount), r.currency), r.due, installmentPayLink(orderId), addDays(r.due, Number(r.grace_days)));
  const subject = kind === 'missed' ? 'Payment missed — keep your booking' : kind === 'due' ? 'Your payment is due today' : 'Your next payment is coming up';
  const out = await deliver(sql, orderId, subject, text);
  return { sent: true, ...out };
}
