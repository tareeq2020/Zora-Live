'use client';

/* DataTable — the control-room table (Lane A · BS69).
   DESIGN.md Control-Room v2 rule 3: mono numerics, semantic status pills,
   and it COLLAPSES TO STACKED CARDS ≤900px (each row → a card: the primary
   fields prominent, the rest below). Ships loading / empty / error states.

   Generic over a row type via a small column config. Numeric columns render
   right-aligned in IBM Plex Mono; a column can render arbitrary content
   (e.g. a <StatusPill/>) via its `render`. */

import { useEffect, useState } from 'react';

export type Column<T> = {
  key: string;
  header: string;
  /** right-aligned mono numerics */
  numeric?: boolean;
  /** show this column's value as the card title on the stacked (mobile) view */
  primary?: boolean;
  render: (row: T) => React.ReactNode;
};

export type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** empty-state copy + optional CTA (empty states are features — DESIGN rule 4) */
  emptyTitle?: string;
  emptyBody?: React.ReactNode;
  /** skeleton row count while loading */
  skeletonRows?: number;
  /** collapse breakpoint in px (DESIGN rule 3 default 900) */
  collapseAt?: number;
  caption?: string;
};

/** SSR-safe matchMedia: renders `false` on the server + first client paint
 *  (so hydration matches), then adopts the real value in an effect. */
function useBelow(px: number): boolean {
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px}px)`);
    const on = () => setBelow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [px]);
  return below;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  emptyTitle = 'Nothing here yet',
  emptyBody,
  skeletonRows = 6,
  collapseAt = 900,
  caption,
}: DataTableProps<T>) {
  const stacked = useBelow(collapseAt);

  if (loading) {
    return (
      <div className="cr-cards" aria-busy="true">
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <span key={i} className="cr-skel" style={{ height: 48, borderRadius: 12 }} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="cr-error" role="alert">
        <strong>Couldn&apos;t load</strong>
        <span>{error}</span>
        {onRetry ? (
          <div style={{ marginTop: 8 }}>
            <button type="button" className="cr-linkbtn" onClick={onRetry}>
              RETRY
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="cr-empty">
        <strong>{emptyTitle}</strong>
        {emptyBody}
      </div>
    );
  }

  if (stacked) {
    const primary = columns.find((c) => c.primary) || columns[0];
    return (
      <div className="cr-cards">
        {rows.map((row) => (
          <div key={rowKey(row)} className="cr-card-row">
            <div className="cr-card-line">
              <span className="cr-card-v" style={{ fontWeight: 600 }}>
                {primary.render(row)}
              </span>
            </div>
            {columns
              .filter((c) => c.key !== primary.key)
              .map((c) => (
                <div key={c.key} className="cr-card-line">
                  <span className="cr-card-k">{c.header}</span>
                  <span className={'cr-card-v' + (c.numeric ? ' cr-num' : '')}>{c.render(row)}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="cr-table-wrap">
      <table className="cr-table">
        {caption ? (
          <caption style={{ position: 'absolute', left: -9999 }}>{caption}</caption>
        ) : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.numeric ? 'cr-num' : undefined} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'cr-num' : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
