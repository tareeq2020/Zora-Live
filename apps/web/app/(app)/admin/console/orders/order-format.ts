/* BS153: shared formatting for the orders list and the per-cart detail page. */
import { CART_OUTCOMES, outcomeLabel } from '@zora/core/cart-outcome';

/* BS157: cart outcomes. Words and order come from @zora/core (pure module). */
export const OUTCOME_ORDER: readonly string[] = CART_OUTCOMES;

/** "Paid after retry", "Buyer didn't complete: cancelled by buyer", … */
export function outcomeText(outcome: string, detail?: string | null): string {
  return outcomeLabel(outcome, detail ?? null);
}

/** Chip tone: good = money in, mid = still open, alert = needs us, low = lost. */
export function outcomeTone(outcome: string): 'good' | 'mid' | 'low' | 'alert' {
  if (['paid', 'paid_after_retry', 'recovered', 'comp', 'door_sale'].includes(outcome)) return 'good';
  if (outcome === 'in_progress') return 'mid';
  if (['system_error', 'underpaid', 'paid_unseatable'].includes(outcome)) return 'alert';
  return 'low';
}

export const STAGE_LABEL: Record<string, string> = {
  cart_created: 'Cart',
  payment_started: 'Payment started',
  gateway_accepted: 'Gateway accepted',
  paid: 'Paid',
  passes_delivered: 'Delivered',
  checked_in: 'Checked in',
};

/** Stages a single cart moves through, in order (mirrors @zora/core ORDER_STAGES). */
export const ORDER_STAGES = ['cart_created', 'payment_started', 'gateway_accepted', 'paid', 'passes_delivered', 'checked_in'];

export function stageTone(stage: string): 'good' | 'mid' | 'low' {
  const i = ORDER_STAGES.indexOf(stage);
  return i >= 3 ? 'good' : i >= 1 ? 'mid' : 'low';
}

export const money = (n: number | null | undefined, cur: string) =>
  n == null ? '—' : `${Number(n).toLocaleString('en-US')} ${cur || ''}`.trim();

export const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const whenFull = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

/** "4m 12s", "2h 03m", "3d 4h" — the gap between two steps. */
export function gap(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const s = Math.round(ms / 1000);
  if (s < 1) return '<1s';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Shorten a gateway error for a table cell: drop the "x-bridge /path failed: 400" prefix and JSON wrapping. */
export function shortError(e: string | null | undefined): string {
  if (!e) return '';
  let s = e.replace(/^x-bridge\s+\S+\s+failed:\s*/i, '');
  const code = /^(\d{3})\s/.exec(s)?.[1];
  const m = /"message"\s*:\s*"([^"]+)"/.exec(s);
  if (m) s = (code ? `${code} ` : '') + m[1];
  return s.length > 80 ? s.slice(0, 77) + '...' : s;
}

/** The list's Payment cell: method · status · short error, or the truth when none. */
export function attemptLine(a: { method: string | null; status: string; error: string | null } | null): string {
  if (!a) return 'no payment started';
  const parts = [a.method || 'unknown', a.error ? 'refused' : a.status];
  if (a.error) parts.push(shortError(a.error));
  return parts.join(' · ');
}
