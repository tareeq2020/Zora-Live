/* Oracle-diff contract test.
   Boots nothing itself — expects the legacy Express server (the oracle) and the
   NestJS api to already be running, pointed at the SAME data dir. It replays a
   fixture of requests against both and asserts identical status + body (+ key
   headers). Any mismatch => non-zero exit. This is the Phase-1 parity guarantee.

   Usage: ORACLE=http://localhost:4199 API=http://localhost:4101 node parity.mjs */

const ORACLE = process.env.ORACLE || 'http://localhost:4199';
const API = process.env.API || 'http://localhost:4101';

let pass = 0;
const failures = [];

function canon(x) {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === 'object') {
    return Object.keys(x).sort().reduce((o, k) => ((o[k] = canon(x[k])), o), {});
  }
  return x;
}
const j = (x) => JSON.stringify(canon(x));

async function hit(base, method, path, { cookie, body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const raw = await res.text();
  return { status: res.status, ct, raw, setCookie: res.headers.get('set-cookie') };
}

async function diff(label, method, path, opts = {}) {
  const [a, b] = await Promise.all([hit(ORACLE, method, path, opts), hit(API, method, path, opts)]);
  const problems = [];
  if (a.status !== b.status) problems.push(`status ${a.status} vs ${b.status}`);

  const isJson = a.ct.includes('application/json') || b.ct.includes('application/json');
  if (isJson) {
    let pa, pb;
    try { pa = JSON.parse(a.raw); } catch { pa = a.raw; }
    try { pb = JSON.parse(b.raw); } catch { pb = b.raw; }
    if (j(pa) !== j(pb)) problems.push(`body:\n    oracle=${j(pa).slice(0, 300)}\n    api=   ${j(pb).slice(0, 300)}`);
  } else {
    if (a.raw !== b.raw) problems.push(`raw body differs (${a.raw.length} vs ${b.raw.length} bytes)`);
    const cta = a.ct.split(';')[0], ctb = b.ct.split(';')[0];
    if (cta !== ctb) problems.push(`content-type ${cta} vs ${ctb}`);
  }

  if (problems.length) { failures.push(`✗ ${label} [${method} ${path}]\n    ${problems.join('\n    ')}`); }
  else { pass++; console.log(`✓ ${label}`); }
}

async function loginCookie(base) {
  const res = await hit(base, 'POST', '/api/login', { body: { username: 'admin', password: 'zora2026' } });
  return (res.setCookie || '').split(';')[0];
}

async function run() {
  // ── Public GET routes ──
  await diff('settings', 'GET', '/api/settings');
  await diff('tiers', 'GET', '/api/tiers');
  await diff('events list', 'GET', '/api/events');
  await diff('events by city', 'GET', '/api/events?city=dar');
  await diff('event by id', 'GET', '/api/events/offshore-001');
  await diff('event 404', 'GET', '/api/events/does-not-exist');
  await diff('placements', 'GET', '/api/placements');
  await diff('storefront-theme', 'GET', '/api/storefront-theme');
  await diff('floorplan', 'GET', '/api/floorplan');
  await diff('impersonation (anon)', 'GET', '/api/impersonation');
  await diff('kyc reasons', 'GET', '/api/kyc/reasons');
  await diff('tenant resolve', 'GET', '/api/tenant/thebrunchcity');
  await diff('tenant 404', 'GET', '/api/tenant/nobody');
  await diff('me (anon)', 'GET', '/api/me');

  // ── Ticket render (deterministic svg) ──
  await diff('ticket svg (ad-hoc)', 'GET', '/api/tickets/Z001-0001.svg');
  await diff('ticket svg (query overrides)', 'GET', '/api/tickets/DEMO.svg?event=TEST%20NIGHT&guest=Ada&tier=WAVE%2001&theme=light');

  // ── Auth-gate parity (no cookie => 401 identical shape) ──
  await diff('organizers gate', 'GET', '/api/organizers');
  await diff('audit gate', 'GET', '/api/audit');

  // ── Login parity ──
  await diff('login wrong', 'POST', '/api/login', { body: { username: 'admin', password: 'nope' } });

  // ── Authenticated GET routes (separate session per server) ──
  const [ca, cb] = await Promise.all([loginCookie(ORACLE), loginCookie(API)]);
  const authed = [
    ['registrations', '/api/registrations'],
    ['organizers', '/api/organizers'],
    ['audit', '/api/audit'],
    ['media', '/api/media'],
    ['agents', '/api/agents'],
    ['kyc queue', '/api/kyc'],
    ['me (admin)', '/api/me'],
  ];
  for (const [label, path] of authed) {
    const [a, b] = await Promise.all([hit(ORACLE, 'GET', path, { cookie: ca }), hit(API, 'GET', path, { cookie: cb })]);
    let pa, pb;
    try { pa = JSON.parse(a.raw); } catch { pa = a.raw; }
    try { pb = JSON.parse(b.raw); } catch { pb = b.raw; }
    if (a.status === b.status && j(pa) === j(pb)) { pass++; console.log(`✓ ${label} (authed)`); }
    else failures.push(`✗ ${label} (authed)\n    status ${a.status}/${b.status}\n    oracle=${j(pa).slice(0, 300)}\n    api=   ${j(pb).slice(0, 300)}`);
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
}

run().catch((e) => { console.error(e); process.exit(2); });
