'use client';

/* Admin console data helpers (moved from the retired /admin/dashboard in BS151).
     · adminApi         — the one fetch wrapper. 401 -> back to /admin so the
                          middleware gate re-runs.
     · useAdminResource — loading / ready / error + reload() and optimistic set().
     · AdminSkeleton / AdminError / AdminEmpty — state atoms on the CR classes.
     · money / whenLocal / useNow / ageLabel / useJsonLoader — formatters. */

import {
  useCallback,
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

// ── state atoms (CR classes) ─────────────────────────────────────────────────

export function AdminSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="cr-cards" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="cr-skel" style={{ height: 44, borderRadius: 12, width: `${100 - (i % 3) * 14}%` }} />
      ))}
    </div>
  );
}

export function AdminError({ message, onRetry }: { message?: string | null; onRetry?: () => void }) {
  return (
    <div className="cr-error" role="alert">
      <strong>Couldn&apos;t load</strong>
      <span>{message || 'Something went wrong.'}</span>
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

export function AdminEmpty({ line, sub, action }: { line: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="cr-empty">
      <strong>{line}</strong>
      {sub ? <span>{sub}</span> : null}
      {action}
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
