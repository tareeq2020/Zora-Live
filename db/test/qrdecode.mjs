// Decode the QR embedded in a ticket SVG. Rasterizes with @resvg/resvg-js (the
// same lib the ticket PNG endpoint uses) to get raw RGBA, then reads the QR
// with jsqr. Prints the decoded payload (or "NO_QR"). Used by ticket-qr.e2e.sh
// to prove the web pass carries the SIGNED credential payload, not the app
// deep link. Usage: node qrdecode.mjs <path-to.svg>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const reqApi = createRequire(join(ROOT, 'apps', 'api') + '/');
const reqWeb = createRequire(join(ROOT, 'apps', 'web') + '/');
const { Resvg } = reqApi('@resvg/resvg-js');
const jsQR = reqWeb('jsqr').default;

const svg = readFileSync(process.argv[2], 'utf8');
const r = new Resvg(svg, { fitTo: { mode: 'width', value: 900 } }).render();
const res = jsQR(Uint8ClampedArray.from(r.pixels), r.width, r.height);
process.stdout.write(res ? res.data : 'NO_QR');
