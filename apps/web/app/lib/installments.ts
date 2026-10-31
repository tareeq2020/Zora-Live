/* BS134: shared buyer-side installment helpers (client-safe, no I/O except the
   card-hint fetch). Copy follows the approved CheckoutPay / Confirm / PassReserved
   mockups and 04_UI_COPY: sentence-case states, mono labels, no chips. */

export type ScheduleRow = { n: number; dueDate: string; amount: number; status?: string; paidAt?: string | null };

export type InstallmentQuote = {
  currency: string;
  subtotal: number;
  fee: number;
  total: number;
  deposit: number;
  count: number;
  frequency: string;
  finalDue: string;
  graceDays: number;
  schedule: ScheduleRow[];
};

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function parts(iso: string): { y: number; m: number; d: number; t: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return { y, m: mo, d, t: new Date(Date.UTC(y, mo - 1, d)) };
}

/** "FRI 16 OCT" (mono label) from YYYY-MM-DD. */
export function dayLabel(iso: string): string {
  const p = parts(iso);
  return p ? `${DOW[p.t.getUTCDay()]} ${p.d} ${MON[p.m - 1]}` : iso;
}

/** "16 OCT" from YYYY-MM-DD or an ISO timestamp (EAT). */
export function shortDay(iso: string): string {
  if (/T/.test(iso)) {
    const t = new Date(new Date(iso).getTime() + 3 * 3_600_000);
    if (!Number.isNaN(t.getTime())) return `${t.getUTCDate()} ${MON[t.getUTCMonth()]}`;
  }
  const p = parts(iso);
  return p ? `${p.d} ${MON[p.m - 1]}` : iso;
}

/** Today in Tanzania (EAT, UTC+3), YYYY-MM-DD. */
export function eatToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Whole days from today (EAT) to the date; negative = past. */
export function daysUntil(iso: string): number {
  const a = parts(eatToday());
  const b = parts(iso);
  if (!a || !b) return 0;
  return Math.round((b.t.getTime() - a.t.getTime()) / 86_400_000);
}

/** The default rule (owner decision 3): release + refund minus the service fee. */
export function ruleText(graceDays: number): string {
  const miss =
    graceDays > 0
      ? `Miss the last date by more than ${graceDays} day${graceDays === 1 ? '' : 's'}`
      : 'Miss the last date';
  return `Your pass arrives when it's paid in full. ${miss} and the booking is released; what you paid comes back, minus the service fee.`;
}

export const moneyLabel = (n: number, currency = 'TZS') =>
  `${currency === 'TZS' ? 'TSh' : currency} ${Math.round(n).toLocaleString('en-US')}`;

/** "or 3 × TSh 20,000" — the event-card hint. */
export function hintText(o: { count: number; perPayment: number; currency: string }): string {
  return `or ${o.count} × ${moneyLabel(o.perPayment, o.currency)}`;
}

export type CardOffer = { count: number; perPayment: number; currency: string; finalDue: string };

/** One request for every card on a page. Any failure (old API, 404, offline) → {}. */
export async function fetchCardOffers(eventIds: string[]): Promise<Record<string, CardOffer>> {
  const ids = Array.from(new Set(eventIds.filter(Boolean))).slice(0, 60);
  if (!ids.length) return {};
  try {
    const r = await fetch(`/api/installments/offers?events=${encodeURIComponent(ids.join(','))}`, { cache: 'no-store' });
    if (!r.ok) return {};
    const d = (await r.json()) as { offers?: Record<string, CardOffer> };
    return d && d.offers && typeof d.offers === 'object' ? d.offers : {};
  } catch {
    return {};
  }
}
