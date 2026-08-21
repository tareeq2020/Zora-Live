'use client';

/* PR-BS89 · Control-Room console — shared bits for the ported super-admin
   surfaces (verification · payouts · organizers · payments · scanner · media ·
   access).

   The legacy /admin/dashboard sections relied on admin-kit's ToastProvider,
   whose `.toast` styling lives in the legacy imperative stylesheet and does NOT
   resolve inside the CR shell. Rather than pull legacy CSS into the console, we
   ship a tiny CR-native toast here, styled entirely with `--cr-*` tokens, so
   every ported page keeps its success / error feedback while staying on-theme.

   The data plumbing (adminApi / useAdminResource / errText / ageLabel / …) is
   still reused verbatim from ../../dashboard/admin-kit — same endpoints, same
   401 handling — so no API behaviour changes. This file only adds presentation
   and small CR-styled form atoms shared across the ported pages. */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ── CR-native toast ──────────────────────────────────────────────────────────

type ToastFn = (message: string, isError?: boolean) => void;
const ToastCtx = createContext<ToastFn>(() => {});

/** Fire a transient toast from any descendant of <ConsoleToastProvider>. */
export const useConsoleToast = (): ToastFn => useContext(ToastCtx);

export function ConsoleToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ text: string; err: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = useCallback<ToastFn>((message, isError) => {
    setToast({ text: String(message || '').toUpperCase(), err: !!isError });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {toast ? (
        <p
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 22,
            transform: 'translateX(-50%)',
            zIndex: 60,
            margin: 0,
            maxWidth: 'min(92vw, 520px)',
            padding: '11px 18px',
            borderRadius: 10,
            border: '1px solid ' + (toast.err ? 'var(--cr-red)' : 'var(--cr-hair)'),
            background: toast.err ? 'var(--cr-wash-red)' : 'var(--cr-card)',
            color: toast.err ? 'var(--cr-on-wash-red)' : 'var(--cr-ink)',
            boxShadow: 'var(--cr-shadow)',
            fontFamily: 'var(--cr-mono)',
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textAlign: 'center',
          }}
        >
          {toast.text}
        </p>
      ) : null}
    </ToastCtx.Provider>
  );
}

// ── small CR-styled form atoms (shared by the ported forms) ──────────────────

/** A labelled field column matching the CR panel rhythm. */
export function CrField({ label, htmlFor, children, style }: { label: ReactNode; htmlFor?: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      <label
        htmlFor={htmlFor}
        style={{ fontFamily: 'var(--cr-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--cr-mut)' }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/** The CR section header + explanatory hint used atop each ported surface. */
export function CrSectionHead({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <h2 className="cr-section-h" style={{ margin: 0 }}>
        {title}
      </h2>
      {hint ? <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--cr-ink2)', maxWidth: 760 }}>{hint}</p> : null}
    </div>
  );
}

/** Key/value meta grid for drawer bodies (mirrors the legacy kyc-meta grid). */
export function CrMeta({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, margin: '4px 0 16px' }}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <p style={{ margin: 0, fontFamily: 'var(--cr-mono)', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.12em', color: 'var(--cr-mut)' }}>{k}</p>
          <p style={{ margin: '3px 0 0', fontSize: 13.5, color: 'var(--cr-ink)', wordBreak: 'break-word' }}>{v}</p>
        </div>
      ))}
    </div>
  );
}

/** A primary (accent) button variant — CR btn base + a blue fill. */
export const crPrimaryBtn: React.CSSProperties = {
  background: 'var(--cr-blue)',
  borderColor: 'var(--cr-blue)',
  color: '#fff',
};

/** A danger button variant. */
export const crDangerBtn: React.CSSProperties = {
  background: 'var(--cr-wash-red)',
  borderColor: 'var(--cr-red)',
  color: 'var(--cr-on-wash-red)',
};
