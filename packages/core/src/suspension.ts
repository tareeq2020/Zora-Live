/* Suspended-organizer cascade (Lane D, dashboard-redesign #6/T7).

   When an organizer is suspended their events must vanish from every PUBLIC read
   (/api/events, /api/events/:id, discover, the storefront, the tenant lookup).
   Ownership (event.organizerHandle) lives in the events blob, not Postgres (C3),
   so a per-event `join organizer on status` is impossible without re-reading the
   whole org table on every render. Instead we keep a small in-memory SET of
   suspended handles, consulted synchronously per event, refreshed:
     · lazily on a short TTL (a stale set self-heals within `ttlMs`), and
     · SYNCHRONOUSLY the moment an admin flips status (the critical failure-mode:
       a suspended org's events staying public until the next TTL tick).

   `markSuspended` is the optimistic synchronous write applied at the flip;
   `refresh` reconciles against the database (the authority) and is what makes a
   concurrent double-flip converge on the DB truth rather than on call order. */

import type { Sql } from './db';
import { db } from './db';

/** How long a lazily-loaded set is trusted before a read triggers a reload.
    Short on purpose — the authoritative path is the synchronous flip; this only
    bounds how long an out-of-band DB change (or a missed flip) can linger. */
export const SUSPENDED_HANDLES_TTL_MS = 30_000;

/** Handles are stored lower-cased; compare lower-cased. */
export function normalizeHandle(handle: unknown): string {
  return String(handle ?? '').toLowerCase();
}

/** Anything with an organizer handle — the events blob entries, essentially. */
export interface HasOrganizerHandle {
  organizerHandle?: string | null;
}

/**
 * A cached set of suspended organizer handles. Constructed with a `fetcher`
 * (the DB read) so the mechanism is unit-testable without a database, plus an
 * injectable clock for the TTL.
 */
export class SuspendedHandleSet {
  private set = new Set<string>();
  private loadedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly fetcher: () => Promise<string[]>,
    private readonly ttlMs: number = SUSPENDED_HANDLES_TTL_MS,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Is this handle currently suspended? Synchronous — the whole point. */
  has(handle: string | null | undefined): boolean {
    return this.set.has(normalizeHandle(handle));
  }

  /** A public read is visible unless its owner is suspended. Missing handle
      (legacy/seed events with no owner) is always visible. */
  isVisible(ev: HasOrganizerHandle | null | undefined): boolean {
    const h = ev?.organizerHandle;
    return !h || !this.has(h);
  }

  /** Drop suspended-org events from a list (the list-read chokepoint). */
  filterVisible<T extends HasOrganizerHandle>(events: T[]): T[] {
    return events.filter((e) => this.isVisible(e));
  }

  /** Reconcile against the database (the authority). Concurrent callers share
      one in-flight load. */
  async refresh(): Promise<void> {
    if (!this.inflight) {
      this.inflight = (async () => {
        const handles = await this.fetcher();
        this.set = new Set(handles.map(normalizeHandle));
        this.loadedAt = this.clock();
      })().finally(() => { this.inflight = null; });
    }
    await this.inflight;
  }

  /** Load if never loaded or the TTL has lapsed; otherwise a no-op.
      Best-effort and FAIL-OPEN: `ensureFresh` runs on every public event read
      (listEvents/getEvent), so a transient failure of the organizer query must
      NOT throw and 500 the whole storefront. On error we keep the last-known set
      (or an empty set on a cold start = show everything) and let the next read
      retry — a suspended org's events briefly showing during a DB blip is far
      less bad than taking the entire public read path down. The authoritative
      suspension path is the synchronous flip (`markSuspended`), not this. */
  async ensureFresh(): Promise<void> {
    const fresh = this.loadedAt !== 0 && this.clock() - this.loadedAt < this.ttlMs;
    if (fresh) return;
    try {
      await this.refresh();
    } catch {
      /* fail open — retain last-known set, retry on the next read */
    }
  }

  /** Optimistic synchronous write at the status flip — closes the stale window
      before `refresh` has a chance to run. Last write wins, so a rapid
      suspend→unlock leaves the set unsuspended immediately; `refresh` then
      confirms it against the DB. */
  markSuspended(handle: string, suspended: boolean): void {
    const h = normalizeHandle(handle);
    if (!h) return;
    if (suspended) this.set.add(h);
    else this.set.delete(h);
  }

  /** Test/inspection helper — a copy, never the live set. */
  snapshot(): Set<string> {
    return new Set(this.set);
  }
}

/** The DB fetcher: every currently-suspended handle. */
export async function fetchSuspendedHandles(sql: Sql): Promise<string[]> {
  const rows = (await sql`select handle from organizer where status = 'suspended'`) as { handle: string }[];
  return rows.map((r) => r.handle);
}

/* Process-wide singleton — one set shared by the events read path and the admin
   status-flip path, so a suspension applied by the flip is seen by the very next
   public read in the same process. */
let _singleton: SuspendedHandleSet | null = null;

export function suspendedHandles(sql: Sql = db()): SuspendedHandleSet {
  if (!_singleton) _singleton = new SuspendedHandleSet(() => fetchSuspendedHandles(sql));
  return _singleton;
}

/** Test hook — reset the singleton between runs. */
export function __resetSuspendedHandles(): void {
  _singleton = null;
}
