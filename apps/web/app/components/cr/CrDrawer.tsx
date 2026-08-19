'use client';

/* CrDrawer — the shared right-side off-canvas panel (Lane A lib · BS73).
   A focus-trapped modal drawer (Tab-trap · Esc · scrim click-out · restore-focus
   · aria-modal) that renders a scrim + a right-aligned panel with an optional
   title/subtitle header and a close (✕). Extracted so the admin Orders cart
   drawer (and future drill-ins) stop hand-rolling inline-token modals.

   Render it conditionally (`{open ? <CrDrawer …/> : null}`) OR always with the
   `open` prop — either way it only traps focus while `open` is true. */

import { useCallback, useEffect, useRef } from 'react';
import './cr-tokens.css';

export type CrDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** Accessible label when no visible title is rendered. */
  ariaLabel?: string;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
};

const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

export function CrDrawer({ open, onClose, ariaLabel, title, subtitle, children }: CrDrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => onClose(), [onClose]);

  // Focus-trap + Esc while open; restore focus to the opener on unmount/close.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;

    const focusables = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    focusables()[0]?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const el = document.activeElement as HTMLElement | null;
      if (e.shiftKey && el === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && el === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnFocusRef.current?.focus?.();
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="cr-drawer-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="cr-drawer-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label={ariaLabel}>
        <div className="cr-drawer-head">
          <div style={{ minWidth: 0 }}>
            {title ? <h3 className="cr-drawer-title">{title}</h3> : null}
            {subtitle ? <p className="cr-drawer-sub">{subtitle}</p> : null}
          </div>
          <button type="button" aria-label="Close" onClick={close} className="cr-btn">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
