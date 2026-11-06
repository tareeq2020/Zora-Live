'use client';

/* KPITile + KPIRow — the control-room stat tiles (Lane A · BS69).
   IBM Plex Mono value (big, tabular-nums), plain mono uppercase label, a small
   delta (▲ green / ▼ red / — mut). BS154: flat per the design handoff — the
   `tint` prop is kept for callers but no longer colours anything. Optional
   `bar` (0–1) draws the one yellow progress bar (passes sold vs capacity).
   States: loading (skeleton), error (retry), null value → "—" (never 0). */

export type KpiTint = 'blue' | 'green' | 'amber' | 'cyan' | 'neutral';

export type KpiTileProps = {
  label: string;
  /** Pre-formatted display value (e.g. "229,500"). null/undefined → em dash. */
  value?: string | number | null;
  /** Optional unit shown small after the value (e.g. "TZS", "%"). */
  unit?: string;
  tint?: KpiTint;
  /** Signed percentage or count vs the comparison window. */
  delta?: { dir: 'up' | 'down' | 'flat'; label: string } | null;
  /** Optional 0–1 fill for a flat yellow progress bar under the value. */
  bar?: number | null;
  /** Small mono caption under the bar (e.g. "23 / 235 sold · all time"). */
  barLabel?: string;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
};

const DELTA_GLYPH = { up: '▲', down: '▼', flat: '—' } as const;

export function KPITile({ label, value, unit, tint = 'neutral', delta, bar, barLabel, loading, error, onRetry }: KpiTileProps) {
  if (loading) {
    return (
      <div className="cr-kpi" aria-busy="true">
        <span className="cr-skel" style={{ width: 74, height: 18 }} />
        <span className="cr-skel" style={{ width: 108, height: 28 }} />
        <span className="cr-skel" style={{ width: 52, height: 12 }} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="cr-kpi">
        <span className="cr-kpi-label" data-tint="neutral">
          {label}
        </span>
        <span className="cr-kpi-value" style={{ fontSize: 16, color: 'var(--cr-ink2)' }}>
          couldn&apos;t load
        </span>
        {onRetry ? (
          <button type="button" className="cr-linkbtn" onClick={onRetry}>
            RETRY
          </button>
        ) : null}
      </div>
    );
  }
  // null/undefined metric → em dash (never a misleading 0), per Pass 2.
  const display = value === null || value === undefined || value === '' ? '—' : value;
  return (
    <div className="cr-kpi">
      <span className="cr-kpi-label" data-tint={tint}>
        {label}
      </span>
      <span className="cr-kpi-value">
        {display}
        {unit && display !== '—' ? <span className="cr-kpi-unit">{unit}</span> : null}
      </span>
      {typeof bar === 'number' && display !== '—' ? (
        <span className="cr-kpi-bar" role="presentation">
          <span style={{ width: `${Math.round(Math.max(0, Math.min(1, bar)) * 100)}%` }} />
        </span>
      ) : null}
      {barLabel && typeof bar === 'number' && display !== '—' ? (
        <span className="cr-kpi-delta">{barLabel}</span>
      ) : delta ? (
        <span className="cr-kpi-delta" data-dir={delta.dir}>
          {DELTA_GLYPH[delta.dir]} {delta.label}
        </span>
      ) : (
        <span className="cr-kpi-delta">&nbsp;</span>
      )}
    </div>
  );
}

export function KPIRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="cr-kpi-row" role="group" aria-label="Key metrics">
      {children}
    </div>
  );
}
