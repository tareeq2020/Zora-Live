/* Behavior-smoke scaffold (FRONTEND-PLAN.md §7.1(2)).

   Boots/uses web (:3000) + api (:4101) and asserts a route actually renders and
   behaves. F1 ships the SCAFFOLD with one working assertion (the '/' homepage
   still serves and contains its hero copy); each later PR appends the behaviors
   its page needs — countdown ticks, discover renders N cards from a fixture,
   QR SVG 200s, the organizer gate redirect matrix (anon->login / authed->page /
   wrong-org blocked) — against pg-parity's seeded throwaway Postgres.

   Boot approach mirrors verify.mjs: it does not manage processes itself — point
   it at already-running servers (the ship/verify flow starts them). `ensureUp`
   just polls readiness so a race doesn't cause a false negative.

   Usage:
     WEB=http://localhost:3000 API=http://localhost:4101 node apps/web/test/behavior-smoke.mjs
*/

import { withDeterminism } from './lib/deterministic.mjs';

const WEB = process.env.WEB || 'http://localhost:3000';
const API = process.env.API || 'http://localhost:4101';

let pass = 0;
const fails = [];
const ok = (label) => {
  pass++;
  console.log(`✓ ${label}`);
};
const bad = (label, detail) => fails.push(`✗ ${label}\n    ${detail}`);

async function ensureUp(base, { tries = 30, delay = 500 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(base, { redirect: 'manual' });
      if (res.status > 0) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, delay));
  }
  return false;
}

/** Assert a route renders: HTTP 200 and (optionally) contains a marker string. */
async function assertRenders(base, path, { marker, name } = {}) {
  const label = name || `route ${path} renders`;
  try {
    const res = await fetch(base + path);
    const body = await res.text();
    if (res.status !== 200) return bad(label, `HTTP ${res.status}`);
    if (marker && !body.includes(marker)) return bad(label, `missing marker: ${JSON.stringify(marker)}`);
    ok(label);
  } catch (e) {
    bad(label, e.message);
  }
}

async function run() {
  if (!(await ensureUp(WEB))) {
    console.error(`web not reachable at ${WEB} — start it (or set WEB=) before running behavior smoke.`);
    process.exit(2);
  }

  // Determinism installed for any in-process assertions this harness makes.
  // (Freezing the app's own clock is done by the render step a converting PR
  //  adds — see deterministic.mjs; here it guards harness-side logic.)
  await withDeterminism(async () => {
    // Working example: '/' still serves the homepage with its hero copy intact.
    await assertRenders(WEB, '/', {
      marker: 'the ticket is the product',
      name: "'/' renders homepage",
    });

    // MT4: the organizer dashboard HOME is behind the /dashboard gate. Anonymous
    // (no organizer session) must rewrite to the seller sign-in card IN PLACE
    // (200, not a redirect) — this exercises the route + middleware wiring without
    // needing a seeded session. The authed render of the real KPI/drops home is
    // covered by /qa once an organizer session exists.
    await assertRenders(WEB, '/dashboard', {
      marker: 'SELLER SIGN-IN',
      name: '/dashboard (anon) -> seller sign-in gate',
    });

    // ── scaffold for later PRs (uncomment/extend as pages convert) ──
    // await assertRenders(WEB, '/discover', { marker: 'data-event-card' });
    // await assertRenders(WEB, '/events/offshore', { marker: 'countdown' });
    // const t = await fetch(`${WEB}/t/DEMO`); ...QR SVG 200...
    // Gate matrix (F6): authed -> page, wrong-org -> blocked.
  });

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) {
    console.log('\n' + fails.join('\n\n'));
    process.exit(1);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(2);
});
