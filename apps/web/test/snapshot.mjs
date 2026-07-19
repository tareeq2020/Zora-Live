/* Structural-snapshot runner + the ONE working end-to-end example.

   The home case snapshots the homepage and diffs it against its committed golden
   (golden/index.snapshot.txt). F4 converted public/index.html to the React `/`
   route and deleted the static file, so — exactly as this header anticipated —
   `getHtml` now reads the home from the running route (cases marked `web: true`)
   instead of the file. The golden was regenerated for the intentional F4 reorder;
   the diff still proves the live DOM stays structurally stable release to release.
   File-based cases (no `web` flag) still read public/ directly, no server needed.

   Usage:
     WEB=http://localhost:3000 node apps/web/test/snapshot.mjs
                                                # verify all cases vs goldens
                                                # (home needs the web server up)
     WEB=http://localhost:3000 node apps/web/test/snapshot.mjs --update
                                                # (re)generate goldens
     node apps/web/test/snapshot.mjs --from-web # force EVERY case to the live route
*/

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { snapshot, diff } from './lib/snapshot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');
const GOLDEN = join(HERE, 'golden');
const WEB = process.env.WEB || 'http://localhost:3000';

const UPDATE = process.argv.includes('--update');
const FROM_WEB = process.argv.includes('--from-web');

/* The snapshot cases. Each conversion PR adds/edits a case here.
   - `mask`: selector allowlist for volatile/non-deterministic nodes whose text
     is replaced with «MASK» (countdown clock, claim codes, JS-filled slots, …)
     so a render is reproducible. Everything else is structurally asserted.
   - `route`: the clean route to snapshot once the page is React (used with
     --from-web); until then the static `file` is the source. */
const CASES = [
  {
    name: 'home',
    // public/index.html was deleted in F4; the home is now the React `/` route, so
    // this case always sources from the running web server.
    web: true,
    route: '/',
    golden: 'index.snapshot.txt',
    // Selectors are compound-simple only (tag/.class/#id/[attr]); no descendant
    // combinators — mask by the volatile node's own id/class/attr.
    mask: [
      '#clock', // OFFSHORE countdown — Date.now() driven
      '#count-label',
      '#clock-units',
      '#k-title', // JS-rendered from /api/settings
      '[data-slot]', // placement/hero slots filled by placements.js at runtime
    ],
  },
];

async function getHtml(c) {
  // Web-sourced when forced (--from-web) or when the case has no static twin left
  // (c.web — e.g. the home, whose public/index.html was deleted in F4).
  if (FROM_WEB || c.web) {
    const res = await fetch(WEB + c.route);
    if (!res.ok) throw new Error(`${c.route} -> HTTP ${res.status}`);
    return res.text();
  }
  return readFile(join(PUBLIC, c.file), 'utf8');
}

let pass = 0;
const fails = [];

for (const c of CASES) {
  const goldenPath = join(GOLDEN, c.golden);
  let html;
  try {
    html = await getHtml(c);
  } catch (e) {
    fails.push(`✗ ${c.name}: could not load source — ${e.message}`);
    continue;
  }
  const snap = snapshot(html, { mask: c.mask });

  if (UPDATE || !existsSync(goldenPath)) {
    await writeFile(goldenPath, snap);
    console.log(`✎ ${c.name}: wrote golden ${c.golden} (${snap.split('\n').length} lines)`);
    pass++;
    continue;
  }

  const golden = await readFile(goldenPath, 'utf8');
  const d = diff(snap, golden);
  if (!d) {
    console.log(`✓ ${c.name}: structural snapshot matches ${c.golden}`);
    pass++;
  } else {
    fails.push(`✗ ${c.name}: structural snapshot differs from ${c.golden}\n${d}`);
  }
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\n' + fails.join('\n\n'));
  process.exit(1);
}
