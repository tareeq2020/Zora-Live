/* Write-path + KYC-crypto parity (the surface the read-only parity test skipped).
   Both servers share one data dir, so we can't run writes concurrently. Instead:
   back up data -> replay the write sequence against the oracle from baseline ->
   restore -> replay the SAME sequence against the api from baseline -> restore ->
   diff responses (masking nondeterministic ids/timestamps). Plus a real KYC
   decrypt of an existing .enc doc through both, byte-compared (proves the shared
   AES key derivation). Always restores in finally.

   Usage: ORACLE=... API=... DATA=... node parity-writes.mjs */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const ORACLE = process.env.ORACLE || 'http://localhost:4199';
const API = process.env.API || 'http://localhost:4101';
const DATA = process.env.DATA || path.resolve('legacy/zora-site/data');

let pass = 0;
const fails = [];
const ok = (l) => { pass++; console.log(`✓ ${l}`); };
const bad = (l, d) => fails.push(`✗ ${l}\n    ${d}`);

// 1x1 transparent PNG (deterministic bytes -> deterministic sha256/size)
const PNG_DATAURL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const NONDET = new Set(['id', 'code', 'ref', 'docId', 'at', 'updatedAt', 'createdAt', 'expiresAt', 'submittedAt', 'reviewedAt', 'startedAt', 'sha256']);
function mask(x) {
  if (Array.isArray(x)) return x.map(mask);
  if (x && typeof x === 'object') {
    return Object.keys(x).sort().reduce((o, k) => ((o[k] = NONDET.has(k) ? '·' : mask(x[k])), o), {});
  }
  return x;
}
const j = (x) => JSON.stringify(mask(x));

function backup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zora-data-'));
  execSync(`cp -R ${JSON.stringify(DATA)}/. ${JSON.stringify(tmp)}/`);
  return tmp;
}
function restore(tmp) {
  // wipe DATA and copy the backup back (preserves kyc-private + .session-secret)
  for (const f of fs.readdirSync(DATA)) execSync(`rm -rf ${JSON.stringify(path.join(DATA, f))}`);
  execSync(`cp -R ${JSON.stringify(tmp)}/. ${JSON.stringify(DATA)}/`);
}

async function login(base) {
  const r = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'zora2026' }),
  });
  return (r.headers.get('set-cookie') || '').split(';')[0];
}

async function call(base, cookie, step) {
  const headers = {};
  if (step.auth) headers.cookie = cookie;
  if (step.body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(base + step.path, { method: step.method, headers, body: step.body !== undefined ? JSON.stringify(step.body) : undefined });
  let body;
  const text = await r.text();
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

// The write sequence (order matters — later steps depend on earlier state).
const SEQ = [
  { label: 'PUT settings', method: 'PUT', path: '/api/settings', auth: true, body: { tagline: 'QA PARITY' } },
  { label: 'POST tiers', method: 'POST', path: '/api/tiers', auth: true, body: { name: 'QA TIER', event: 'shore', order: 9 } },
  { label: 'PUT tiers/s1', method: 'PUT', path: '/api/tiers/s1', auth: true, body: { priceLabel: 'QA PRICE' } },
  { label: 'DELETE tiers/s3', method: 'DELETE', path: '/api/tiers/s3', auth: true },
  { label: 'POST register ok', method: 'POST', path: '/api/register', body: { crewName: 'QA Crew', leadName: 'Ada', phone: '+255700000001', size: 4 } },
  { label: 'POST register dup 409', method: 'POST', path: '/api/register', body: { crewName: 'QA Crew', leadName: 'Ada', phone: '+255700000001', size: 4 } },
  { label: 'POST register missing 400', method: 'POST', path: '/api/register', body: { crewName: 'X' } },
  { label: 'POST register badsize 400', method: 'POST', path: '/api/register', body: { crewName: 'X', leadName: 'Y', phone: '+255700000009', size: 9 } },
  { label: 'PUT floorplan', method: 'PUT', path: '/api/floorplan', body: { space: { w: 1600, h: 900 }, stage: null, zones: [{ id: 'z1', x: 1, y: 2 }] } },
  { label: 'PUT placements', method: 'PUT', path: '/api/placements', auth: true, body: { 'home-hero': '/assets/event-02.jpg' } },
  { label: 'PUT storefront-theme', method: 'PUT', path: '/api/storefront-theme', body: { accent: '#101010' } },
  { label: 'POST agents', method: 'POST', path: '/api/agents', auth: true, body: { name: 'Gate Ada', contact: 'ada@zora.app', event: 'OFFSHORE' } },
  { label: 'PUT organizers/o2 suspend', method: 'PUT', path: '/api/organizers/o2/status', auth: true, body: { status: 'suspended' } },
  { label: 'POST organizers/o2 impersonate (suspended->400)', method: 'POST', path: '/api/organizers/o2/impersonate', auth: true },
  { label: 'POST kyc/upload', method: 'POST', path: '/api/kyc/upload', body: { dataUrl: PNG_DATAURL } },
  { label: 'PUT settings unauth 401', method: 'PUT', path: '/api/settings', body: { tagline: 'nope' } },
];

async function replay(base) {
  const cookie = await login(base);
  const out = [];
  for (const step of SEQ) out.push({ label: step.label, ...(await call(base, cookie, step)) });
  return out;
}

async function kycDecryptCompare() {
  // Find an existing kyc record with a doc whose .enc file exists.
  const all = JSON.parse(fs.readFileSync(path.join(DATA, 'kyc.json'), 'utf8'));
  let target = null;
  for (const v of all) for (const d of v.documents || []) {
    if (fs.existsSync(path.join(DATA, 'kyc-private', d.id + '.enc'))) { target = { id: v.id, docId: d.id }; break; }
    if (target) break;
  }
  if (!target) { console.log('… no existing .enc doc to decrypt-compare (skipped)'); return; }
  const co = await login(ORACLE), ca = await login(API);
  const [o, a] = await Promise.all([
    fetch(`${ORACLE}/api/kyc/${target.id}/documents/${target.docId}`, { headers: { cookie: co } }),
    fetch(`${API}/api/kyc/${target.id}/documents/${target.docId}`, { headers: { cookie: ca } }),
  ]);
  const [ob, ab] = [Buffer.from(await o.arrayBuffer()), Buffer.from(await a.arrayBuffer())];
  if (o.status === a.status && ob.equals(ab) && ob.length > 0) ok(`KYC decrypt existing doc byte-identical (${ob.length}b, ${o.headers.get('content-type')})`);
  else bad('KYC decrypt existing doc', `oracle ${o.status}/${ob.length}b vs api ${a.status}/${ab.length}b, equal=${ob.equals(ab)}`);
}

async function run() {
  const base = backup();
  try {
    const oracleOut = await replay(ORACLE);
    restore(base);
    const apiOut = await replay(API);
    restore(base);
    for (let i = 0; i < SEQ.length; i++) {
      const o = oracleOut[i], a = apiOut[i];
      if (o.status === a.status && j(o.body) === j(a.body)) ok(`${o.label} (${o.status})`);
      else bad(o.label, `status ${o.status} vs ${a.status}\n    oracle=${j(o.body).slice(0, 260)}\n    api=   ${j(a.body).slice(0, 260)}`);
    }
    await kycDecryptCompare();
  } finally {
    restore(base);
    execSync(`rm -rf ${JSON.stringify(base)}`);
  }
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { console.log('\n' + fails.join('\n\n')); process.exit(1); }
}

run().catch((e) => { console.error(e); process.exit(2); });
