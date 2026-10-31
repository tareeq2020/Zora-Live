/* BS132 (F7 / A19): installment schedule maths + offer validation. PURE — no DB,
   no clock reads (callers pass `today`), so every rule is unit-tested
   (test/installments.test.mjs).

   The rules (A19):
   - Money is whole TSh (integers). No fractions ever reach a payment attempt.
   - n = 1 is the deposit, due on the purchase day.
   - The remainder is split evenly over the other (count − 1) payments; the
     rounding remainder goes on the LAST payment. Σ amounts === total, always.
   - Payment k (k ≥ 2) falls (k − 1) periods after purchase. The schedule must
     fit: the last due date may not be after the final due date (event date −
     final_due_days_before_event). Otherwise it is rejected with a message the
     buyer can read — never silently compressed.
   - The result is snapshotted onto the order (installment_plan/_schedule) at
     purchase, so a later config edit never changes a placed plan.

   Dates are calendar dates (YYYY-MM-DD) in Tanzania time (EAT, UTC+3, no DST). */

export const INSTALLMENT_FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const;
export type InstallmentFrequency = (typeof INSTALLMENT_FREQUENCIES)[number];

export const INSTALLMENT_MIN_COUNT = 2;
export const INSTALLMENT_MAX_COUNT = 6;

/** The organizer's offer for one event (installment_config row). */
export interface InstallmentConfig {
  eventId: string;
  enabled: boolean;
  /** Tier ids the offer applies to; empty = every tier of the event. */
  tiers: string[];
  depositPct: number | null;
  depositAmount: number | null;
  /** Number of payments INCLUDING the deposit (2–6). */
  count: number;
  frequency: InstallmentFrequency;
  finalDueDaysBeforeEvent: number;
  graceDays: number;
}

export interface ScheduleRow {
  n: number;
  dueDate: string; // YYYY-MM-DD
  amount: number;  // whole TSh
}

export type ScheduleResult =
  | { ok: true; deposit: number; finalDue: string; rows: ScheduleRow[] }
  | { ok: false; reason: ScheduleRejection; message: string };

export type ScheduleRejection =
  | 'bad_total'
  | 'bad_count'
  | 'bad_frequency'
  | 'bad_deposit'
  | 'bad_date'
  | 'final_due_passed'
  | 'does_not_fit'
  | 'amount_too_small';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse YYYY-MM-DD to a UTC-midnight epoch (ms), or null if not a real date. */
function parseDate(s: string): number | null {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return t;
}

function fmt(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const t = parseDate(date);
  if (t == null) throw new Error(`bad date: ${date}`);
  return fmt(t + days * 86_400_000);
}

/** Add calendar months, clamping to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const t = parseDate(date);
  if (t == null) throw new Error(`bad date: ${date}`);
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return fmt(Date.UTC(y, m, Math.min(day, lastDay)));
}

/** Due date of payment n (1-based) for a plan bought on `start`. */
export function dueDateFor(start: string, n: number, frequency: InstallmentFrequency): string {
  const k = n - 1;
  if (frequency === 'weekly') return addDays(start, 7 * k);
  if (frequency === 'biweekly') return addDays(start, 14 * k);
  return addMonths(start, k);
}

/** Today's calendar date in Tanzania (EAT = UTC+3, no DST). */
export function eatToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Final due date: event date minus the configured lead days. */
export function finalDueFor(eventDate: string, daysBefore: number): string | null {
  if (parseDate(eventDate) == null || !Number.isInteger(daysBefore) || daysBefore < 0) return null;
  return addDays(eventDate, -daysBefore);
}

/** Deposit in whole TSh. A percentage rounds half-up; the deposit must leave at
    least 1 TSh for each remaining payment. Null = invalid. */
export function depositFor(total: number, depositPct: number | null, depositAmount: number | null, count: number): number | null {
  let dep: number;
  if (depositAmount != null) {
    if (!Number.isInteger(depositAmount) || depositAmount <= 0) return null;
    dep = depositAmount;
  } else if (depositPct != null) {
    if (!Number.isFinite(depositPct) || depositPct <= 0 || depositPct >= 100) return null;
    dep = Math.round((total * depositPct) / 100);
  } else return null;
  if (dep < 1 || total - dep < count - 1) return null;
  return dep;
}

export interface BuildScheduleInput {
  total: number;
  depositPct: number | null;
  depositAmount: number | null;
  count: number;
  frequency: InstallmentFrequency;
  /** Purchase date (YYYY-MM-DD, EAT). */
  today: string;
  /** Last date any payment may fall on (YYYY-MM-DD). */
  finalDue: string;
}

/** Build the schedule, or reject it with a buyer-readable message. */
export function buildSchedule(input: BuildScheduleInput): ScheduleResult {
  const { total, count, frequency, today, finalDue } = input;
  if (!Number.isInteger(total) || total <= 0) return { ok: false, reason: 'bad_total', message: 'This order total cannot be split into installments.' };
  if (!Number.isInteger(count) || count < INSTALLMENT_MIN_COUNT || count > INSTALLMENT_MAX_COUNT) {
    return { ok: false, reason: 'bad_count', message: `Installments must be between ${INSTALLMENT_MIN_COUNT} and ${INSTALLMENT_MAX_COUNT} payments.` };
  }
  if (!(INSTALLMENT_FREQUENCIES as readonly string[]).includes(frequency)) {
    return { ok: false, reason: 'bad_frequency', message: 'Unknown installment frequency.' };
  }
  const tToday = parseDate(today);
  const tFinal = parseDate(finalDue);
  if (tToday == null || tFinal == null) return { ok: false, reason: 'bad_date', message: 'The event date is not set, so installments are not available.' };
  if (tFinal < tToday) return { ok: false, reason: 'final_due_passed', message: 'It is too close to the event to pay in installments. Pay in full instead.' };

  const deposit = depositFor(total, input.depositPct, input.depositAmount, count);
  if (deposit == null) return { ok: false, reason: 'bad_deposit', message: 'The deposit for this order is not valid. Pay in full instead.' };

  const rest = total - deposit;
  const k = count - 1;
  const each = Math.floor(rest / k);
  if (each < 1) return { ok: false, reason: 'amount_too_small', message: 'This order is too small to split into installments.' };
  const last = rest - each * (k - 1);

  const rows: ScheduleRow[] = [{ n: 1, dueDate: today, amount: deposit }];
  for (let n = 2; n <= count; n++) {
    rows.push({ n, dueDate: dueDateFor(today, n, frequency), amount: n === count ? last : each });
  }
  const lastDue = rows[rows.length - 1].dueDate;
  if (parseDate(lastDue)! > tFinal) {
    return {
      ok: false, reason: 'does_not_fit',
      message: `${count} ${frequency} payments would end on ${lastDue}, after the last payment date (${finalDue}). Choose fewer payments or pay in full.`,
    };
  }
  // Invariant (A19): Σ === total. Guarded here as well as in tests — a broken
  // schedule must never be written.
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  if (sum !== total) throw new Error(`installment schedule sum ${sum} != total ${total}`);
  return { ok: true, deposit, finalDue, rows };
}

/** Validate + normalise an organizer-submitted offer. Returns the clean config
    or a list of field errors. (BS136's settings UI posts through this.) */
export function sanitizeInstallmentConfig(eventId: string, raw: unknown):
  | { ok: true; config: InstallmentConfig }
  | { ok: false; errors: string[] } {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  const depositPct = num(src.depositPct);
  const depositAmount = num(src.depositAmount);
  if ((depositPct == null) === (depositAmount == null)) errors.push('deposit_one_of_pct_or_amount');
  if (depositPct != null && !(Number.isFinite(depositPct) && depositPct > 0 && depositPct < 100)) errors.push('deposit_pct_range');
  if (depositAmount != null && !(Number.isInteger(depositAmount) && depositAmount > 0)) errors.push('deposit_amount_invalid');
  const count = Number(src.count);
  if (!Number.isInteger(count) || count < INSTALLMENT_MIN_COUNT || count > INSTALLMENT_MAX_COUNT) errors.push('count_range');
  const frequency = String(src.frequency ?? '') as InstallmentFrequency;
  if (!(INSTALLMENT_FREQUENCIES as readonly string[]).includes(frequency)) errors.push('frequency_invalid');
  const finalDueDaysBeforeEvent = Number(src.finalDueDaysBeforeEvent);
  if (!Number.isInteger(finalDueDaysBeforeEvent) || finalDueDaysBeforeEvent < 0 || finalDueDaysBeforeEvent > 365) errors.push('final_due_days_range');
  const graceDays = Number(src.graceDays);
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 30) errors.push('grace_days_range');
  const tiers = Array.isArray(src.tiers)
    ? Array.from(new Set(src.tiers.filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length <= 120))).slice(0, 100)
    : [];
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    config: {
      eventId, enabled: src.enabled === true, tiers,
      depositPct: depositPct == null ? null : Math.round(depositPct * 100) / 100,
      depositAmount, count, frequency, finalDueDaysBeforeEvent, graceDays,
    },
  };
}

/** Is the offer open for this cart? (enabled + every cart tier allowed.) */
export function configCoversCart(config: InstallmentConfig | null, tierIds: string[]): boolean {
  if (!config || !config.enabled) return false;
  if (!config.tiers.length) return true;
  return tierIds.every((t) => config.tiers.includes(t));
}
