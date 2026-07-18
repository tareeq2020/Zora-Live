/* Structural-snapshot runner + the ONE working end-to-end example.

   Example (self-contained, no server needed): snapshot the current static
   homepage (public/index.html) and diff it against its committed golden
   (golden/index.snapshot.txt). This is the reference golden the plan calls for —
   proof the pipeline works today. When index.html is converted to React (F4),
   that PR points `getHtml` at the running route instead of the file, keeps the
   same golden, and the diff proves the React DOM still matches structurally.

   Usage:
     node apps/web/test/snapshot.mjs            # verify all cases vs goldens
     node apps/web/test/snapshot.mjs --update   # (re)generate goldens
     WEB=http://localhost:3000 node apps/web/test/snapshot.mjs --from-web
                                                # snapshot the live route instead
                                                # of the static file (post-convert)
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
    file: 'index.html',
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
  if (FROM_WEB) {
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
