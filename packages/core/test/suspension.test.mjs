/* BS70 (dashboard #6/T7) — the suspended-organizer cascade. Pure, no DB: build
   core first (`pnpm --filter "@zora/core..." build`); we import dist.

   The `SuspendedHandleSet` is the cached set consulted on every PUBLIC event
   read. This guards the plan's CRITICAL failure-mode: a suspended org's events
   must vanish from public reads, and must not linger public because the set went
   stale — hence the synchronous `markSuspended` at the flip plus a `refresh`
   that reconciles against the DB (so a concurrent double-flip converges on truth,
   not on call order). The `fetcher` + injectable clock make all of it testable
   without a database. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SuspendedHandleSet, normalizeHandle } from '../dist/index.js';

const ev = (id, handle) => ({ id, organizerHandle: handle });

test('normalizeHandle lower-cases; handle match is case-insensitive', () => {
  assert.equal(normalizeHandle('BrunchCity'), 'brunchcity');
  const s = new SuspendedHandleSet(async () => ['BrunchCity']);
  return s.refresh().then(() => {
    assert.equal(s.has('brunchcity'), true);
    assert.equal(s.has('BRUNCHCITY'), true);
  });
});

// ── CRITICAL: suspend org → its events vanish from public reads ──────────────
test('suspend org → its events drop from the public list; others stay', async () => {
  const s = new SuspendedHandleSet(async () => ['suspendedco']);
  await s.refresh();
  const events = [
    ev('e1', 'suspendedco'),
    ev('e2', 'goodco'),
    ev('e3', 'suspendedco'),
    ev('e4', null),          // legacy/seed event with no owner — always visible
  ];
  const visible = s.filterVisible(events).map((e) => e.id);
  assert.deepEqual(visible, ['e2', 'e4']);
  assert.equal(s.isVisible(ev('x', 'suspendedco')), false);
  assert.equal(s.isVisible(ev('x', 'goodco')), true);
});

// ── FAILURE MODE: stale after setStatus → refresh (no lingering-public window) ─
test('markSuspended closes the stale window synchronously, before refresh runs', async () => {
  // The DB fetcher still reflects the OLD state (org not yet suspended in a read
  // replica / not yet reloaded). Without the optimistic write the event would
  // stay public until the next reload — the failure mode.
  let dbSuspended = [];
  const s = new SuspendedHandleSet(async () => dbSuspended);
  await s.refresh();
  assert.equal(s.isVisible(ev('e1', 'orgx')), true); // still public

  // Admin flips status → optimistic synchronous mark: hidden IMMEDIATELY.
  s.markSuspended('orgx', true);
  assert.equal(s.isVisible(ev('e1', 'orgx')), false);

  // The authoritative reconcile then confirms it against the DB.
  dbSuspended = ['orgx'];
  await s.refresh();
  assert.equal(s.has('orgx'), true);
});

// ── FAILURE MODE: concurrent status flip converges on the DB truth ───────────
test('rapid suspend→unlock: last write wins, refresh confirms unsuspended', async () => {
  let dbSuspended = ['orgx'];
  const s = new SuspendedHandleSet(async () => dbSuspended);
  await s.refresh();
  assert.equal(s.has('orgx'), true);

  // Two flips land back-to-back: suspend then unlock.
  s.markSuspended('orgx', true);
  s.markSuspended('orgx', false);
  assert.equal(s.has('orgx'), false); // last write wins immediately

  // DB settles on unsuspended; refresh agrees (does not resurrect the suspension).
  dbSuspended = [];
  await s.refresh();
  assert.equal(s.has('orgx'), false);
});

// ── TTL: a lazily-loaded set self-heals, but not before the TTL lapses ───────
test('ensureFresh honours the TTL with an injectable clock', async () => {
  let dbSuspended = [];
  let nowMs = 1_000;
  const s = new SuspendedHandleSet(async () => dbSuspended, 30_000, () => nowMs);

  await s.ensureFresh();                 // first load
  assert.equal(s.has('orgx'), false);

  dbSuspended = ['orgx'];                // org suspended out-of-band (no flip seen)
  nowMs += 10_000;                       // within TTL
  await s.ensureFresh();
  assert.equal(s.has('orgx'), false);    // not reloaded yet

  nowMs += 25_000;                       // now past the 30s TTL
  await s.ensureFresh();
  assert.equal(s.has('orgx'), true);     // self-healed
});

test('concurrent refresh calls share a single in-flight load', async () => {
  let calls = 0;
  const s = new SuspendedHandleSet(async () => { calls += 1; await new Promise((r) => setTimeout(r, 5)); return []; });
  await Promise.all([s.refresh(), s.refresh(), s.refresh()]);
  assert.equal(calls, 1);
});
