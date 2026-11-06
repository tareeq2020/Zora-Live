#!/usr/bin/env node
/* BS158: x-bridge SANDBOX smoke. Pushes a small amount to each sandbox test
   number through core's collectMobile, polls collectionStatus until it ends, and
   checks the status and failureReason each number is wired to.

   Run with a SANDBOX key only:
     XBRIDGE_BASE_URL=… XBRIDGE_KEY_ID=… XBRIDGE_SECRET=… node db/test/xbridge-sandbox-smoke.mjs

   Safety: it first calls GET /v1/payments/test and stops unless x-bridge says
   environment "sandbox". It never pushes with a live key. It touches no
   database. Build core first (pnpm --filter "@zora/core" build).

   `--mock` runs the same checks against core's MOCK mode (no network), to test
   the script itself. Exit code is non-zero on any mismatch. */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const core = require('../../packages/core/dist/index.js');
const { collectMobile, collectionStatus, xbridgeConfig, xbridgeRequest, SANDBOX_FAIL_NUMBERS, SANDBOX_OK_NUMBER } = core;

const MOCK = process.argv.includes('--mock');
const AMOUNT = Number(process.env.SMOKE_AMOUNT || 1000);
const TIMEOUT_MS = 60_000;
const POLL_MS = 2_000;
const CALLBACK = process.env.SMOKE_CALLBACK_URL || 'https://example.invalid/xbridge-sandbox-smoke';

const CASES = [
  ...Object.entries(SANDBOX_FAIL_NUMBERS).map(([phone, reason]) => ({ phone, wantStatus: 'FAILED', wantReason: reason })),
  { phone: SANDBOX_OK_NUMBER, wantStatus: 'COMPLETED', wantReason: null },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (msg) => { console.error(`xbridge-sandbox-smoke: ${msg}`); process.exit(2); };

async function guard() {
  const cfg = xbridgeConfig();
  if (MOCK) {
    if (!cfg.mock) die('--mock given but x-bridge is configured live (unset XBRIDGE_KEY_ID or set XBRIDGE_MOCK=true).');
    console.log('MOCK mode: no network calls.');
    return cfg;
  }
  if (cfg.mock) die('x-bridge is in MOCK mode (XBRIDGE_MOCK=true or no XBRIDGE_KEY_ID). Set a SANDBOX key, or pass --mock.');
  let info;
  try {
    info = await xbridgeRequest('/v1/payments/test', { method: 'GET' }, cfg);
  } catch (e) {
    die(`GET /v1/payments/test failed: ${String(e?.message ?? e).slice(0, 300)}`);
  }
  const env = info?.environment ?? info?.data?.environment ?? null;
  if (env !== 'sandbox') die(`refusing to push: x-bridge reports environment ${JSON.stringify(env)}, not "sandbox".`);
  console.log(`x-bridge ${cfg.baseUrl}: environment sandbox. Pushing ${AMOUNT} TZS to ${CASES.length} numbers.`);
  return cfg;
}

async function runCase(c, cfg, runId, i) {
  const transactionId = `SMOKE-${runId}-${i + 1}`;
  const row = { ...c, transactionId, gotStatus: null, gotReason: null, error: null, ms: 0 };
  const t0 = Date.now();
  try {
    await collectMobile({ transactionId, amount: AMOUNT, payerPhone: c.phone, callbackUrl: CALLBACK }, cfg);
    for (;;) {
      const s = await collectionStatus(transactionId, cfg);
      row.gotStatus = s.status;
      row.gotReason = s.failureReason ?? null;
      if (s.status !== 'PENDING') break;
      if (Date.now() - t0 > TIMEOUT_MS) { row.error = 'timed out (still PENDING after 60 s)'; break; }
      await sleep(POLL_MS);
    }
  } catch (e) {
    row.error = String(e?.message ?? e).slice(0, 160);
  }
  row.ms = Date.now() - t0;
  row.pass = !row.error && row.gotStatus === c.wantStatus && row.gotReason === c.wantReason;
  return row;
}

const cfg = await guard();
const runId = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const rows = await Promise.all(CASES.map((c, i) => runCase(c, cfg, runId, i)));

const pad = (s, n) => String(s).padEnd(n);
console.log('');
console.log([pad('number', 15), pad('expected', 28), pad('got', 34), pad('time', 7), 'result'].join(' '));
for (const r of rows) {
  const want = `${r.wantStatus}/${r.wantReason ?? 'null'}`;
  const got = r.error ? `error: ${r.error}` : `${r.gotStatus}/${r.gotReason ?? 'null'}`;
  console.log([pad(r.phone, 15), pad(want, 28), pad(got, 34), pad(`${(r.ms / 1000).toFixed(1)}s`, 7), r.pass ? 'PASS' : 'FAIL'].join(' '));
}
const bad = rows.filter((r) => !r.pass).length;
console.log('');
console.log(bad ? `SANDBOX SMOKE: FAIL (${bad}/${rows.length} mismatched)` : `SANDBOX SMOKE: PASS (${rows.length}/${rows.length})`);
process.exit(bad ? 1 : 0);
