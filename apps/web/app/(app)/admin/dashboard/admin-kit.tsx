'use client';

/* PR-BS36 — shared AdminShell primitives (eng-review CQ4: build these BEFORE
   porting panels so every section is thin and inherits the same behaviour).

   What lives here:
     · adminApi        — the one fetch wrapper. 401 -> bounce to /admin so the
                         middleware gate re-runs (identical to the legacy
                         console's `api()` helper — session behaviour unchanged).
     · useAdminResource— gives a section all six DESIGN.md states for free:
                         default / loading / empty / error+retry / disabled /
                         success, plus `reload()` and optimistic `set()`.
     · AdminTable      — one table renderer that is responsive by construction
                         (CSS turns <td data-label> into stacked cards <620px)
                         and renders the loading/empty/error states itself.
     · AdminCard       — the bordered control-room panel.
     · AdminEmpty / AdminError / AdminSkeleton / ComingSoon — the state atoms.
     · ToastProvider / useToast — replaces the legacy global `toast()`.

   No API surface changes: every caller passes the same /api/* paths the legacy
   SCRIPT string used. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// ── fetch ────────────────────────────────────────────────────────────────────

/** The legacy console's `api()`, typed. Same headers, same 401 handling (a lost
 *  session sends the staffer back to /admin, where the middleware gate re-runs
 *  and rewrites to /admin/login). Errors surface `data.error` like before. */
export async function adminApi<T = unknown>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) {
    if (typeof window !== 'undefined') window.location.href = '/admin';
    throw new Error('Session expired');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data as T;
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? 'Request failed');
}

// ── useAdminResource ─────────────────────────────────────────────────────────

export type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error';

export type AdminResource<T> = {
  status: ResourceStatus;
  data: T | null;
  error: string | null;
  /** true once a load has completed at least once (drives skeleton vs. inline refresh) */
  loaded: boolean;
  reload: () => void;
  set: (next: T) => void;
};

/**
 * Fetch-and-track one admin resource. `load` must be stable (wrap in useCallback
 * or pass a module-level function) — it is the effect's only dependency.
 */
export function useAdminResource<T>(load: () => Promise<T>, options?: { enabled?: boolean }): AdminResource<T> {
  const enabled = options?.enabled !== false;
  const [status, setStatus] = useState<ResourceStatus>(enabled ? 'loading' : 'idle');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    setStatus('loading');
    setError(null);
    load()
      .then((v) => {
        if (stale || !alive.current) return;
        setData(v);
        setLoaded(true);
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (stale || !alive.current) return;
        setError(errText(e));
        setStatus('error');
      });
    return () => {
      stale = true;
    };
  }, [load, enabled, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const set = useCallback((next: T) => setData(next), []);

  return { status, data, error, loaded, reload, set };
}

// ── toast ────────────────────────────────────────────────────────────────────

type ToastFn = (message: string, isError?: boolean) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = (): ToastFn => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ text: string; err: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = useCallback<ToastFn>((message, isError) => {
    setToast({ text: String(message || '').toUpperCase(), err: !!isError });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
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
        <p className={'toast' + (toast.err ? ' err' : '')} role="status" aria-live="polite">
          {toast.text}
        </p>
      ) : null}
    </ToastCtx.Provider>
  );
}

// ── state atoms (DESIGN.md rule 4 — empty and error are features) ────────────

export function AdminSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skel" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <i key={i} style={{ width: `${100 - (i % 3) * 14}%` }} />
      ))}
    </div>
  );
}

export function AdminError({ message, onRetry }: { message?: string | null; onRetry?: () => void }) {
  return (
    <div className="state err" role="alert">
      <p className="st-l">{message || 'Something went wrong.'}</p>
      {onRetry ? (
        <button type="button" className="btn ghost small" onClick={onRetry}>
          RETRY
        </button>
      ) : null}
    </div>
  );
}

export function AdminEmpty({ line, sub, action }: { line: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="state">
      <p className="st-l">{line}</p>
      {sub ? <p className="st-s">{sub}</p> : null}
      {action}
    </div>
  );
}

/** Placeholder body for a section another lane owns. */
export function ComingSoon({ line, sub }: { line: string; sub: string }) {
  return (
    <div className="state soon">
      <p className="st-l">{line}</p>
      <p className="st-s">{sub}</p>
    </div>
  );
}

// ── AdminCard ────────────────────────────────────────────────────────────────

export function AdminCard({
  title,
  subtitle,
  actions,
  flush,
  children,
}: {
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** drop the body padding (tables render edge-to-edge) */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {title || actions || subtitle ? (
        <header className="card-h">
          <div>
            {title ? <p className="ct">{title}</p> : null}
            {subtitle ? <p className="cs">{subtitle}</p> : null}
          </div>
          {actions ? <div className="ca">{actions}</div> : null}
        </header>
      ) : null}
      <div className={'card-b' + (flush ? ' flush' : '')}>{children}</div>
    </section>
  );
}

// ── AdminTable ───────────────────────────────────────────────────────────────

export type AdminColumn<T> = {
  key: string;
  /** column header AND the stacked-card label below 620px */
  label: string;
  render: (row: T) => ReactNode;
  /** actions column: no card label, right-aligned */
  actions?: boolean;
};

export function AdminTable<T>({
  columns,
  rows,
  rowKey,
  resource,
  empty,
  emptySub,
  emptyAction,
}: {
  columns: AdminColumn<T>[];
  rows: T[] | null | undefined;
  rowKey: (row: T, index: number) => string;
  /** when given, the table renders loading / error(+retry) itself */
  resource?: Pick<AdminResource<unknown>, 'status' | 'error' | 'loaded' | 'reload'>;
  /** warm empty line — never "No results." (DESIGN.md rule 4) */
  empty: string;
  emptySub?: string;
  emptyAction?: ReactNode;
}) {
  if (resource && resource.status === 'loading' && !resource.loaded) return <AdminSkeleton rows={5} />;
  if (resource && resource.status === 'error') return <AdminError message={resource.error} onRetry={resource.reload} />;
  if (!rows || rows.length === 0) return <AdminEmpty line={empty} sub={emptySub} action={emptyAction} />;

  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.actions ? '' : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.actions ? '' : c.label}>
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

// ── formatting helpers (mono figures — DESIGN.md rules 2 / 4b) ──────────────

/** Legacy `nfMoney` — compact TZS used by the organizers revenue column. */
export function money(n: number): string {
  const v = Number(n) || 0;
  const s = v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : String(v);
  return s + ' TZS';
}

export function whenLocal(iso?: string | number | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** Age with the legacy KYC SLA colouring (>24h = late). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function ageLabel(iso: string, now: number): { text: string; late: boolean } {
  const h = (now - new Date(iso).getTime()) / 36e5;
  const text = h < 1 ? `${Math.max(0, Math.round(h * 60))}m ago` : h < 24 ? `${h.toFixed(0)}h ago` : `${Math.floor(h / 24)}d ago`;
  return { text, late: h > 24 };
}

/** Stable identity for section fetchers so useAdminResource's effect is sane. */
export function useJsonLoader<T>(path: string): () => Promise<T> {
  return useMemo(() => () => adminApi<T>(path), [path]);
}
