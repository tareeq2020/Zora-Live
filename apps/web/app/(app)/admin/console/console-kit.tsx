'use client';

/* PR-BS89 · Control-Room console — shared bits for the ported super-admin
   surfaces (verification · payouts · organizers · payments · scanner · media ·
   access).

   A CR-native toast styled with `--cr-*` tokens, plus small CR form atoms.
   Data plumbing (adminApi / useAdminResource / errText / …) lives in ./admin-kit. */

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
            // handoff toast: dark surface, bone text, 48px, green/red left bar
            minHeight: 48,
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            borderRadius: 12,
            border: 'none',
            borderLeft: '4px solid ' + (toast.err ? 'var(--cr-red-fill)' : 'var(--cr-green-fill)'),
            background: '#111111',
            color: '#F7F5EE',
            fontFamily: 'var(--cr-mono)',
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: '0.08em',
            textAlign: 'left',
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
        style={{ fontFamily: 'var(--cr-mono)', fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--cr-mut)' }}
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
      {hint ? <p style={{ margin: '8px 0 0', fontSize: 15, lineHeight: 1.4, color: 'var(--cr-ink2)', maxWidth: 760 }}>{hint}</p> : null}
    </div>
  );
}

/** Key/value meta grid for drawer bodies (mirrors the legacy kyc-meta grid). */
export function CrMeta({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, margin: '4px 0 16px' }}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <p style={{ margin: 0, fontFamily: 'var(--cr-mono)', fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', color: 'var(--cr-mut)' }}>{k}</p>
          <p style={{ margin: '4px 0 0', fontSize: 15, color: 'var(--cr-ink)', overflowWrap: 'anywhere' }}>{v}</p>
        </div>
      ))}
    </div>
  );
}

/** Primary button (handoff §1): black block + yellow label; yellow + black on dark. */
export const crPrimaryBtn: React.CSSProperties = {
  background: 'var(--cr-primary-bg)',
  borderColor: 'var(--cr-primary-bg)',
  color: 'var(--cr-primary-fg)',
};

/** Danger button (handoff §1): alert red fill, white label (6.6:1). */
export const crDangerBtn: React.CSSProperties = {
  background: 'var(--cr-red-fill)',
  borderColor: 'var(--cr-red-fill)',
  color: 'var(--cr-on-state)',
};
