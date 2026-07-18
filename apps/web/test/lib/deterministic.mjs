/* Deterministic-render hooks (FRONTEND-PLAN.md §7.1: "frozen Date.now / seeded
   random"). The volatile pages — index/drop-001 countdowns, thebrunchcity
   claim-code, dashboard sparklines — read Date.now() and Math.random(); freezing
   both makes a render reproducible so a structural/visual snapshot is stable.

   Two seams:
   1. install()/restore() patch THIS process's Date.now + Math.random. Use it
      when the render happens in-process (e.g. jsdom, or asserting on harness-side
      logic). Node-only, no dependencies.
   2. FIXED_NOW / FIXED_SEED are the canonical constants a conversion PR also
      forwards to the app under test (e.g. as env vars its client honors) so the
      Next server process renders under the same frozen clock. Keeping the
      constants here means harness and app agree on one source of truth. */

// A fixed instant in the OFFSHORE countdown window (before dropAt 2026-07-10),
// so the countdown renders a stable, non-zero value.
export const FIXED_NOW = Date.UTC(2026, 5, 1, 12, 0, 0); // 2026-06-01T12:00:00Z
export const FIXED_SEED = 0x9e3779b9;

// mulberry32 — small, fast, deterministic PRNG.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let saved = null;

/** Freeze Date.now() -> now, and Math.random() -> seeded PRNG, in this process. */
export function install({ now = FIXED_NOW, seed = FIXED_SEED } = {}) {
  if (saved) return; // idempotent
  saved = { now: Date.now, random: Math.random, DateRef: Date };
  const rand = mulberry32(seed);
  Date.now = () => now;
  Math.random = () => rand();
}

/** Restore the real Date.now / Math.random. */
export function restore() {
  if (!saved) return;
  Date.now = saved.now;
  Math.random = saved.random;
  saved = null;
}

/** Run fn with determinism installed, then restore (even on throw). */
export async function withDeterminism(fn, opts) {
  install(opts);
  try {
    return await fn();
  } finally {
    restore();
  }
}
