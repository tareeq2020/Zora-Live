/* PR-MT6 — convenience runner: executes drop-validation.test.mjs with Node's
   type-stripping enabled (so it can import the TS helpers directly), and works
   whether or not the running Node needs the experimental flag.
     node apps/web/test/run-drop-validation.mjs */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const test = path.join(here, 'drop-validation.test.mjs');

const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', test], {
  stdio: 'inherit',
});
process.exit(r.status ?? 1);
