/* Phase-2 web verification.
   Expects web (Next, :3000), api (Nest, :4101) and the legacy oracle (:4199) all
   running. Checks that the lift-and-shifted site behaves identically:
     1. every page is served byte-identical to the oracle
     2. '/' serves the homepage (index.html)
     3. the /api/* proxy returns the same JSON as the oracle
     4. tenant routes (/@handle, /events/:id) rewrite/redirect correctly
     5. /admin is session-gated (login page when anonymous)

   Usage: WEB=http://localhost:3000 ORACLE=http://localhost:4199 node verify.mjs */

const WEB = process.env.WEB || 'http://localhost:3000';
const ORACLE = process.env.ORACLE || 'http://localhost:4199';

let pass = 0;
const fails = [];
const ok = (label) => { pass++; console.log(`✓ ${label}`); };
const bad = (label, detail) => fails.push(`✗ ${label}\n    ${detail}`);

const PAGES = [
  // drop-001.html + seatmap.html were deleted in F3: the flagship + seat map are
  // now the React routes /events/offshore and /events/:id/seats (see section 4b/4c).
  'index.html', 'about.html', 'brand.html', 'commission.html', 'create-event.html',
  'dashboard.html', 'dashboard-seatbuilder.html', 'discover.html',
  'help.html', 'signup.html', 'studio.html', 'tenant.html',
  'thebrunchcity.html', 'ticket-preview.html', 'zora-tokens.css', 'zora-theme.js',
  'placements.js', 'zbot.js',
];

async function get(base, path, opts = {}) {
  const res = await fetch(base + path, { redirect: 'manual', ...opts });
  return { status: res.status, body: await res.text(), loc: res.headers.get('location'), ct: res.headers.get('content-type') || '' };
}

async function run() {
  // 1. Byte-identical pages
  for (const p of PAGES) {
    const [w, o] = await Promise.all([get(WEB, '/' + p), get(ORACLE, '/' + p)]);
    if (w.status === 200 && w.body === o.body) ok(`page ${p}`);
    else bad(`page ${p}`, `web ${w.status} ${w.body.length}b vs oracle ${o.status} ${o.body.length}b`);
  }

  // 2. '/' serves the homepage
  const [rootW, rootO] = await Promise.all([get(WEB, '/'), get(ORACLE, '/')]);
  if (rootW.status === 200 && rootW.body === rootO.body) ok("'/' serves homepage");
  else bad("'/' serves homepage", `web ${rootW.status} ${rootW.body.length}b vs oracle ${rootO.status} ${rootO.body.length}b`);

  // 3. /api proxy matches oracle
  for (const api of ['/api/settings', '/api/tiers', '/api/events', '/api/placements']) {
    const [w, o] = await Promise.all([get(WEB, api), get(ORACLE, api)]);
    const eq = w.status === o.status && w.body === o.body;
    eq ? ok(`proxy ${api}`) : bad(`proxy ${api}`, `web ${w.status} vs oracle ${o.status}; bodies ${w.body === o.body ? 'match' : 'differ'}`);
  }

  // 4a. /@handle rewrites to tenant.html (served inline, 200)
  const tenant = await get(WEB, '/@thebrunchcity');
  const tenantHtml = await get(WEB, '/tenant.html');
  if (tenant.status === 200 && tenant.body === tenantHtml.body) ok('/@handle -> tenant.html');
  else bad('/@handle -> tenant.html', `status ${tenant.status}, body match ${tenant.body === tenantHtml.body}`);

  // 4a2. nested /@handle/events/:id ALSO rewrites to tenant.html — regression
  // guard: the narrow matcher used to miss multi-segment tenant paths (404).
  const tenantNested = await get(WEB, '/@thebrunchcity/events/brunch-vol-09');
  if (tenantNested.status === 200 && tenantNested.body === tenantHtml.body) ok('/@handle/events/:id -> tenant.html');
  else bad('/@handle/events/:id -> tenant.html', `status ${tenantNested.status}, body match ${tenantNested.body === tenantHtml.body}`);

  // 4b. Canonical flagship renders IN PLACE on the apex (F3): /events/offshore
  // (slug alias) and /events/offshore-001 return the 200 <EventPage>, NOT the old
  // 302-to-tenant that the oracle still does — an intentional divergence. A
  // NON-canonical apex id still 302s to its tenant leaf, matching the oracle.
  const stripOrigin = (l) => (l || '').replace(/^https?:\/\/[^/]+/, '');
  for (const slug of ['offshore', 'offshore-001']) {
    const w = await get(WEB, '/events/' + slug);
    if (w.status === 200 && /OFFSHORE/i.test(w.body)) ok(`/events/${slug} renders flagship in place (200)`);
    else bad(`/events/${slug} renders flagship in place`, `web ${w.status}, has-name ${/OFFSHORE/i.test(w.body)}`);
  }
  {
    const id = 'brunch-vol-09'; // non-canonical apex id -> still 302 to tenant leaf
    const [w, o] = await Promise.all([get(WEB, '/events/' + id), get(ORACLE, '/events/' + id)]);
    if (w.status === o.status && stripOrigin(w.loc) === stripOrigin(o.loc)) ok(`/events/${id} still 302s to tenant leaf (${w.status})`);
    else bad(`/events/${id} 302s to tenant leaf`, `web ${w.status} loc ${stripOrigin(w.loc)} vs oracle ${o.status} loc ${stripOrigin(o.loc)}`);
  }

  // 4c. /events/:id/seats renders the seat map; the old static paths (now deleted)
  // 301-alias to the canonical React routes so existing links keep working.
  {
    const seats = await get(WEB, '/events/offshore/seats');
    if (seats.status === 200) ok('/events/offshore/seats renders seat map (200)');
    else bad('/events/offshore/seats renders', `status ${seats.status}`);
    for (const [oldPath, dest] of [['/drop-001.html', '/events/offshore'], ['/seatmap.html', '/events/offshore/seats']]) {
      const r = await get(WEB, oldPath);
      if (r.status === 301 && stripOrigin(r.loc) === dest) ok(`${oldPath} -> ${dest} (301 alias)`);
      else bad(`${oldPath} alias`, `status ${r.status} loc ${stripOrigin(r.loc)}`);
    }
  }

  // 5. /admin anonymous -> login page
  const admin = await get(WEB, '/admin');
  const loginHtml = await get(WEB, '/admin/login.html');
  if (admin.status === 200 && admin.body === loginHtml.body) ok('/admin (anon) -> login.html');
  else bad('/admin (anon) -> login.html', `status ${admin.status}, body match ${admin.body === loginHtml.body}`);

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { console.log('\n' + fails.join('\n\n')); process.exit(1); }
}

run().catch((e) => { console.error(e); process.exit(2); });
