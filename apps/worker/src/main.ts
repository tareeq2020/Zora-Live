/* PR-9: durable background worker (a long-lived host, not serverless — these are
   continuous loops, not request-scoped functions).

   SINGLETON, ENFORCED. Two workers would double-run the sweeps + reconciliation
   and race each other. pm2 `instances: 1` is advisory; a Postgres SESSION advisory
   lock on a PINNED connection is the hard guard: at boot we pg_try_advisory_lock a
   constant key on a reserved connection and HOLD it for the process lifetime. If we
   cannot acquire it, another worker already owns the loops — we log and exit. */

try { require('dotenv').config(); } catch { /* dotenv optional */ }
import { makeSql, sweepExpiredHolds, sweepExpiredReservations, reconcilePending, splitAwareExpirySweep } from '@zora/core';

// Constant key shared by every worker instance (distinct from the migrate lock).
const WORKER_LOCK_KEY = 990926;

const HOLD_SWEEP_MS = 60_000; // release expired GA/VIP holds every minute
const RESERVATION_SWEEP_MS = 60_000; // release expired booking soft-reservations every minute
const SPLIT_SWEEP_MS = 60_000; // BS3: bill-split window expiry (release unpaid, flag paid for refund)
const RECONCILE_MS = 30_000; // reconcile pending payments every 30s

const sql = makeSql();

async function tick(label: string, fn: (sql: any) => Promise<number>): Promise<void> {
  try {
    const n = await fn(sql);
    if (n > 0) console.log(`[worker] ${label}: processed ${n}`);
  } catch (e) {
    console.error(`[worker] ${label} failed`, e);
  }
}

function startWorkers(): void {
  setInterval(() => void tick('hold-sweep', sweepExpiredHolds), HOLD_SWEEP_MS);
  setInterval(() => void tick('reservation-sweep', sweepExpiredReservations), RESERVATION_SWEEP_MS);
  // BS3: split-aware expiry — releases unpaid split tables, flags paid-but-unfilled
  // ones as refund_pending (inventory kept locked). Returns released+flagged count.
  setInterval(() => void tick('split-sweep', async (s) => {
    const { released, flagged } = await splitAwareExpirySweep(s);
    return released + flagged;
  }), SPLIT_SWEEP_MS);
  setInterval(() => void tick('reconcile', reconcilePending), RECONCILE_MS);
  console.log('[worker] started: hold-sweep + reservation-sweep + split-sweep + payment reconciliation (singleton)');
}

async function main(): Promise<void> {
  // Reserve a connection out of the pool and hold the advisory lock on it for the
  // whole process. A reserved connection stays checked-out (never idle-reaped), so
  // the session lock survives — releasing it (crash/exit) frees the singleton slot.
  const lockConn = await sql.reserve();
  const [{ locked }] = await lockConn`select pg_try_advisory_lock(${WORKER_LOCK_KEY}) as locked`;
  if (!locked) {
    console.log('[worker] another worker holds the lock — exiting');
    lockConn.release();
    await sql.end({ timeout: 5 });
    process.exit(0);
  }
  console.log('[worker] advisory lock acquired — this instance owns the loops');
  startWorkers();
}

main().catch((e) => {
  console.error('[worker] fatal boot error', e);
  process.exit(1);
});
