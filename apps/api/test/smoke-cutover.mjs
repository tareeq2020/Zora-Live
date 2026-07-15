/* Cutover smoke test — runs against the NEW stack only (no legacy oracle).
   Proves the api reads the repo-root /data store, the KYC secret resolves and
   decrypts a real doc, the web proxy + tenant routing work, and a write round-trips.
   Cleans up anything it creates.

   Usage: WEB=http://localhost:3000 API=http://localhost:4101 node smoke-cutover.mjs */

import * as fs from 'node:fs';
import * as path from 'node:path';

const WEB = process.env.WEB || 'http://localhost:3000';
const API = process.env.API || 'http://localhost:4101';
const DATA = process.env.DATA || path.resolve('data');
const onDisk = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));

let pass = 0;
const fails = [];
const ok = (l) => { pass++; console.log(`✓ ${l}`); };
const bad = (l, d) => fails.push(`✗ ${l}\n    ${d}`);

async function j(base, path, opts = {}) {
  const r = await fetch(base + path, opts);
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  return { status: r.status, body, ct: r.headers.get('content-type') || '', raw: t };
}
async function login(base) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'zora2026' }) });
  return (r.headers.get('set-cookie') || '').split(';')[0];
}

async function run() {
  // 1. Serves the ACTUAL root /data files (compare API output to what's on disk).
  const settings = await j(API, '/api/settings');
  const diskSettings = onDisk('settings.json');
  settings.body?.dropName === diskSettings.dropName ? ok(`api reads root /data (settings.dropName="${diskSettings.dropName}")`) : bad('settings from root data', `api=${settings.body?.dropName} disk=${diskSettings.dropName}`);

  const tiers = await j(API, '/api/tiers');
  Array.isArray(tiers.body) && tiers.body.length === onDisk('tiers.json').length ? ok(`tiers match root data (${tiers.body.length})`) : bad('tiers', `api=${tiers.body?.length} disk=${onDisk('tiers.json').length}`);

  const cookie = await login(API);
  const orgs = await j(API, '/api/organizers', { headers: { cookie } });
  Array.isArray(orgs.body) && orgs.body.some((o) => o.handle === 'offshore') ? ok(`organizers from root data (${orgs.body.length})`) : bad('organizers', JSON.stringify(orgs.body).slice(0, 160));

  // 2. KYC secret resolves + decrypts a real .enc from root data
  const kyc = await j(API, '/api/kyc', { headers: { cookie } });
  const rec = Array.isArray(kyc.body) ? kyc.body.find((v) => (v.documents || []).length) : null;
  if (rec) {
    const doc = rec.documents[0];
    const r = await fetch(`${API}/api/kyc/${rec.id}/documents/${doc.id}`, { headers: { cookie } });
    const buf = Buffer.from(await r.arrayBuffer());
    r.status === 200 && buf.length > 0 ? ok(`KYC decrypt works on root data (${buf.length}b, ${r.headers.get('content-type')})`) : bad('KYC decrypt', `status ${r.status} bytes ${buf.length}`);
  } else bad('KYC decrypt', 'no kyc record with a document found');

  // 3. Web serves homepage + proxies API
  const home = await j(WEB, '/');
  home.status === 200 && home.raw.length > 1000 ? ok(`web '/' serves homepage (${home.raw.length}b)`) : bad("web '/'", `status ${home.status} len ${home.raw.length}`);
  const proxied = await j(WEB, '/api/settings');
  proxied.body?.dropName === diskSettings.dropName ? ok('web proxies /api to backend') : bad('web proxy', JSON.stringify(proxied.body).slice(0, 160));

  // 4. Tenant routing (nested)
  const tenant = await fetch(WEB + '/@thebrunchcity/events/brunch-vol-09', { redirect: 'manual' });
  tenant.status === 200 ? ok('web tenant /@handle/events/:id serves (200)') : bad('tenant route', `status ${tenant.status}`);

  // 5. Write round-trips to root /data (then clean up)
  const phone = '+2557' + String(Date.now()).slice(-8);
  const reg = await j(WEB, '/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ crewName: 'Smoke Crew', leadName: 'Smoke', phone, size: 3 }) });
  const regs = await j(API, '/api/registrations', { headers: { cookie } });
  const created = Array.isArray(regs.body) ? regs.body.find((r) => r.phone === phone) : null;
  if (reg.status === 200 && reg.body?.ok && created) {
    ok(`write persists to root /data (register -> ${reg.body.code})`);
    await fetch(`${API}/api/registrations/${created.id}`, { method: 'DELETE', headers: { cookie } }); // cleanup
  } else bad('write round-trip', `reg status ${reg.status}, found=${!!created}`);

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { console.log('\n' + fails.join('\n\n')); process.exit(1); }
}
run().catch((e) => { console.error(e); process.exit(2); });
