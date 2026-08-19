'use client';

/* StatusPill — the control-room status token (Lane A · BS69).
   Semantic dot + mono uppercase label. Tones map to DESIGN.md Control-Room v2:
   paid=cyan · pending=amber · refund/failed=red · live=green · draft=neutral. */

export type PillTone = 'paid' | 'pending' | 'refund' | 'failed' | 'live' | 'draft' | 'neutral';

/** Map common order/event status strings onto a tone. Extend as needed — kept
 *  small and explicit so the mapping is auditable rather than clever. */
export function toneForStatus(status?: string | null): PillTone {
  switch ((status || '').toLowerCase()) {
    case 'paid':
    case 'completed':
    case 'succeeded':
      return 'paid';
    case 'pending':
    case 'processing':
    case 'started':
      return 'pending';
    case 'refund':
    case 'refunded':
      return 'refund';
    case 'failed':
    case 'expired':
    case 'cancelled':
    case 'canceled':
      return 'failed';
    case 'live':
    case 'published':
    case 'on sale':
      return 'live';
    default:
      return 'draft';
  }
}

export function StatusPill({ tone, label }: { tone: PillTone; label: string }) {
  return (
    <span className="cr-pill" data-tone={tone}>
      {label}
    </span>
  );
}
