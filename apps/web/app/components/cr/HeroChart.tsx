'use client';

/* HeroChart — the one hero metric (Lane A · BS69).
   DESIGN.md Control-Room v2: ONE metric (revenue over time), smooth filled area
   in the blue anchor, range switch (7D/14D/30D/ALL) + EXPORT. Ships a
   "view as table" a11y alternative (Pass 6 — a chart is not accessible alone),
   count-up/draw-in respect prefers-reduced-motion via CSS only (SVG is static).
   States: loading skeleton · empty ("no revenue yet") · flat baseline for a
   range with no data. */

import { useId, useMemo, useState } from 'react';

export type ChartPoint = { label: string; value: number };
export type ChartRange = '7D' | '14D' | '30D' | 'ALL';

export type HeroChartProps = {
  title: string;
  /** The series for the selected range. */
  data: ChartPoint[];
  /** Big headline number (pre-formatted), e.g. total revenue for the range. */
  total?: string;
  totalUnit?: string;
  range: ChartRange;
  onRangeChange?: (r: ChartRange) => void;
  ranges?: ChartRange[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Empty-state primary action (e.g. COPY LINK to storefront). */
  emptyAction?: React.ReactNode;
  emptyText?: string;
  onExport?: () => void;
};

const W = 720;
const H = 200;
const PAD = 8;

function buildPath(data: ChartPoint[]): { area: string; line: string; last: { x: number; y: number } | null } {
  if (data.length === 0) return { area: '', line: '', last: null };
  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(...data.map((d) => d.value), 0);
  const span = max - min || 1;
  const n = data.length;
  const x = (i: number) => (n === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (n - 1));
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  const pts = data.map((d, i) => ({ x: x(i), y: y(d.value) }));
  // smooth-ish: use quadratic midpoints between points
  let line = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const midX = (pts[i - 1].x + pts[i].x) / 2;
    line += ` Q ${pts[i - 1].x} ${pts[i - 1].y} ${midX} ${(pts[i - 1].y + pts[i].y) / 2}`;
    line += ` T ${pts[i].x} ${pts[i].y}`;
  }
  const area = `${line} L ${pts[pts.length - 1].x} ${H - PAD} L ${pts[0].x} ${H - PAD} Z`;
  return { area, line, last: pts[pts.length - 1] };
}

export function HeroChart({
  title,
  data,
  total,
  totalUnit,
  range,
  onRangeChange,
  ranges = ['7D', '14D', '30D', 'ALL'],
  loading,
  error,
  onRetry,
  emptyAction,
  emptyText = 'No revenue yet — share your storefront to make your first sale.',
  onExport,
}: HeroChartProps) {
  const gradId = useId().replace(/:/g, '');
  const [showTable, setShowTable] = useState(false);
  const { area, line, last } = useMemo(() => buildPath(data), [data]);
  const hasData = data.some((d) => d.value > 0);

  return (
    <section className="cr-panel" aria-label={title}>
      <div className="cr-chart-head">
        <div className="cr-chart-metric">
          <small>{title}</small>
          {loading ? <span className="cr-skel" style={{ width: 160, height: 28, display: 'inline-block' }} /> : total ?? '—'}
          {total && totalUnit ? <span className="cr-kpi-unit">{totalUnit}</span> : null}
        </div>
        <div className="cr-chart-controls">
          <div className="cr-range" role="tablist" aria-label="Chart range">
            {ranges.map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={r === range}
                className={r === range ? 'cr-on' : ''}
                onClick={() => onRangeChange?.(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <button type="button" className="cr-btn" onClick={onExport} disabled={!onExport}>
            EXPORT
          </button>
          <button
            type="button"
            className="cr-linkbtn"
            aria-expanded={showTable}
            onClick={() => setShowTable((s) => !s)}
          >
            {showTable ? 'VIEW AS CHART' : 'VIEW AS TABLE'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="cr-skel" style={{ width: '100%', height: H, borderRadius: 12 }} />
      ) : error ? (
        <div className="cr-error">
          <strong>Chart unavailable</strong>
          {onRetry ? (
            <button type="button" className="cr-linkbtn" onClick={onRetry}>
              RETRY
            </button>
          ) : null}
        </div>
      ) : !hasData ? (
        <div className="cr-chart-empty">
          <p>{emptyText}</p>
          {emptyAction}
        </div>
      ) : showTable ? (
        <table className="cr-chart-table">
          <caption className="cr-visually-hidden" style={{ position: 'absolute', left: -9999 }}>
            {title} — data table
          </caption>
          <thead>
            <tr>
              <th>Date</th>
              <th style={{ textAlign: 'right' }}>{totalUnit || 'Value'}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td>{d.label}</td>
                <td>{d.value.toLocaleString('en-US')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg
          className="cr-chart-svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${title} area chart. Use "view as table" for values.`}
        >
          <defs>
            <linearGradient id={`cr-fill-${gradId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--cr-blue)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--cr-blue)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#cr-fill-${gradId})`} />
          <path d={line} fill="none" stroke="var(--cr-blue)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {last ? <circle cx={last.x} cy={last.y} r="3.5" fill="var(--cr-blue)" /> : null}
        </svg>
      )}
    </section>
  );
}
