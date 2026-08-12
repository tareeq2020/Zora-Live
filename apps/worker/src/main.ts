/* PR-9: durable background worker (a long-lived host, not serverless — these are
   continuous loops, not request-scoped functions).

   SINGLETON, ENFORCED. Two workers would double-run the sweeps + reconciliation
   and race each other. pm2 `instances: 1` is advisory; a Postgres SESSION advisory
   lock on a PINNED connection is the hard guard: at boot we pg_try_advisory_lock a
   constant key on a reserved connection and HOLD it for the process lifetime. If we
   cannot acquire it, another worker already owns the loops — we log and exit.

   BS43 (#2, eng review ARCH-4): the broadcast fan-out lives here too, and it is
   deliberately a BOUNDED trickle. Each broadcast tick claims at most
   BROADCAST_BATCH recipients, sends them, and returns — it never loops until the
   queue is empty. A 50,000-person blast is therefore ~2,000 short ticks
   interleaved with reconcile and the sweeps, instead of one job that owns the
   process while payments go unreconciled. Money loops keep their own intervals
   and are never behind the messaging one. */

// Env loading (BS58). The worker sends the ticket SMS (reconcile → notifyOrderPaid),
// so it MUST have the SMS creds. Two things bit us before: dotenv was not a worker
// dependency (require could silently throw), and config() with no path reads
// <cwd>/.env = apps/worker/.env, NOT apps/api/.env where the secrets live. So:
//   1. load a local apps/worker/.env if present (dev override),
//   2. then the SHARED apps/api/.env (single source of truth) — dotenv does not
//      overwrite already-set keys, so the local file still wins where it overlaps.
// A load failure is logged LOUDLY, never swallowed.
try {
  const path = require('path');
  require('dotenv').config();
  require('dotenv').config({ path: path.resolve(__dirname, '../../api/.env') });
} catch (e) {
  console.error('[worker] FATAL: dotenv failed to load — env (DB, SMS, gateway) will be missing', e);
}
import {
  makeSql, sweepExpiredHolds, sweepExpiredReservations, reconcilePending, splitAwareExpirySweep,
  drainBroadcasts, broadcastBatchSize, logSmsStartup,
} from '@zora/core';

// Constant key shared by every worker instance (distinct from the migrate lock).
const WORKER_LOCK_KEY = 990926;

/** Env override with a floor, so a typo can never turn a money loop off or spin
    it into a hot loop. Money intervals keep their production defaults. */
function intervalMs(name: string, fallback: number, min: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= min ? Math.floor(raw) : fallback;
}

const HOLD_SWEEP_MS = 60_000; // release expired GA/VIP holds every minute
const RESERVATION_SWEEP_MS = 60_000; // release expired booking soft-reservations every minute
const SPLIT_SWEEP_MS = 60_000; // BS3: bill-split window expiry (release unpaid, flag paid for refund)
// Overridable only so the e2e can prove reconcile still ticks WHILE a broadcast
// drains (ARCH-4). Floored at 250ms — it can be made faster, never disabled.
const RECONCILE_MS = intervalMs('RECONCILE_MS', 30_000, 250); // reconcile pending payments every 30s
// BS43: the broadcast trickle. Short interval + small batch = interleaved, not
// bursty; the batch size is the actual bound (see @zora/core/broadcasts).
const BROADCAST_MS = intervalMs('BROADCAST_TICK_MS', 5_000, 100);

/* Verbose tick tracing. Off in production (a quiet worker is a readable log);
   on in the e2e, where "did reconcile keep running while the queue drained" is
   exactly the thing under test and a silent no-op tick is indistinguishable
   from a starved one. */
const DEBUG = process.env.WORKER_DEBUG === '1';

const sql = makeSql();

async function tick(label: string, fn: (sql: any) => Promise<number>): Promise<void> {
  try {
    const n = await fn(sql);
    if (n > 0) console.log(`[worker] ${label}: processed ${n}`);
    else if (DEBUG) console.log(`[worker] ${label}: idle`);
  } catch (e) {
    console.error(`[worker] ${label} failed`, e);
  }
}

/* One in-flight guard per loop. Without it a slow tick (a gateway timing out
   mid-batch) would stack the next interval on top of it, and the "bounded batch"
   promise would quietly become "unbounded concurrent batches". */
function everyMs(ms: number, label: string, fn: (sql: any) => Promise<number>): void {
  let running = false;
  setInterval(() => {
    if (running) {
      if (DEBUG) console.log(`[worker] ${label}: still running — skipping this tick`);
      return;
    }
    running = true;
    void tick(label, fn).finally(() => {
      running = false;
    });
  }, ms);
}

function startWorkers(): void {
  everyMs(HOLD_SWEEP_MS, 'hold-sweep', sweepExpiredHolds);
  everyMs(RESERVATION_SWEEP_MS, 'reservation-sweep', sweepExpiredReservations);
  // BS3: split-aware expiry — releases unpaid split tables, flags paid-but-unfilled
  // ones as refund_pending (inventory kept locked). Returns released+flagged count.
  everyMs(SPLIT_SWEEP_MS, 'split-sweep', async (s) => {
    const { released, flagged } = await splitAwareExpirySweep(s);
    return released + flagged;
  });
  everyMs(RECONCILE_MS, 'reconcile', reconcilePending);
  // BS43 (#2 / ARCH-4): BOUNDED per tick. drainBroadcasts claims at most
  // BROADCAST_BATCH rows and returns; it does not drain to empty.
  everyMs(BROADCAST_MS, 'broadcast-drain', async (s) => {
    const r = await drainBroadcasts(s);
    if (r.claimed > 0) {
      console.log(
        `[worker] broadcast-batch: claimed=${r.claimed} sent=${r.sent} failed=${r.failed} skipped=${r.skipped}`,
      );
    }
    return r.claimed;
  });
  console.log(
    '[worker] started: hold-sweep + reservation-sweep + split-sweep + payment reconciliation' +
      ` + broadcast fan-out (batch=${broadcastBatchSize()} every ${BROADCAST_MS}ms) (singleton)`,
  );
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
  logSmsStartup(); // BS58: one-line SMS config check — the worker sends ticket SMS
  startWorkers();
}

main().catch((e) => {
  console.error('[worker] fatal boot error', e);
  process.exit(1);
});
