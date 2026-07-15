/* ════════════════════════════════════════════════════════════════
   ZORA — site server + admin CMS API
   ─────────────────────────────────────────────────────────────────
   Run:      npm start          (then open http://localhost:4100)
   Pages:    /                  ZORA main page
             /drop-001.html     DROP 001: OFFSHORE landing
   Admin:    http://localhost:4100/admin
   Storage:  ./data/*.json      (no database server needed)
   ════════════════════════════════════════════════════════════════ */
const express  = require('express');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const eventsApi = require('./lib/events'); // shared events source (Supabase if configured, else data/events.json)
const { ticketSVG, ticketPNG } = require('./lib/ticket'); // programmatic branded passes

const app        = express();
const PORT       = process.env.PORT || 4100;
const DATA_DIR   = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_DIR  = path.join(__dirname, 'admin');

// ── JSON file helpers ─────────────────────────────────────────────
function readJson(name, fallback){
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); }
  catch { return fallback; }
}
function writeJson(name, data){
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 2), 'utf8');
}

// ── First-run setup: admin account + session secret + seed data ───
fs.mkdirSync(DATA_DIR, { recursive: true });

let adminAccount = readJson('admin.json', null);
if (!adminAccount){
  adminAccount = { username: 'admin', passwordHash: bcrypt.hashSync('zora2026', 10) };
  writeJson('admin.json', adminAccount);
  console.log('──────────────────────────────────────────────────');
  console.log('  First run: admin account created.');
  console.log('  Username: admin   Password: zora2026');
  console.log('  CHANGE THIS PASSWORD in Admin -> Access.');
  console.log('──────────────────────────────────────────────────');
}

const secretFile = path.join(DATA_DIR, '.session-secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'));
const SESSION_SECRET = fs.readFileSync(secretFile, 'utf8');

const DEFAULT_SETTINGS = {
  dropTitle:     'DROP 001',
  dropName:      'OFFSHORE',
  status:        'countdown',                      // countdown | live | soldout
  dropAt:        '2026-07-30T20:00:00+03:00',      // boarding passes drop (EAT)
  eventDateLabel:'SAT 15 AUG 2026',
  coordinates:   "06°45'S / 039°16'E",
  port:          'DAR ES SALAAM',
  venue:         'Undisclosed shore. Revealed 48 hours before boarding.',
  capacityLabel: 'VESSEL 200 / SHORE 3,000',
  tagline:       'Culture, exported.',
  zoraTagline:   'The ticket is the product.',
  appNote:       'The app is the only door.',
  contactEmail:  'board@zora.app',
  instagram:     ''
};
if (!fs.existsSync(path.join(DATA_DIR, 'settings.json'))) writeJson('settings.json', DEFAULT_SETTINGS);

const DEFAULT_TIERS = [
  { id: 'v1', event: 'vessel', order: 1, name: 'BOARDING PASS',        detail: '200 souls. Sunset departure, midnight return to shore.', priceLabel: 'NOT FOR SALE', splitNote: 'Earned. Top crews, top referrers, verified attendance.', status: 'locked' },
  { id: 's1', event: 'shore',  order: 1, name: 'WAVE 01',              detail: 'First 1,000 shore passes.',                              priceLabel: '65,000 TZS',  splitNote: 'One number. No fees at checkout.',                      status: 'open'   },
  { id: 's2', event: 'shore',  order: 2, name: 'WAVE 02',              detail: 'Next 1,200 shore passes.',                               priceLabel: '85,000 TZS',  splitNote: 'Unlocks when Wave 01 closes.',                          status: 'locked' },
  { id: 's3', event: 'shore',  order: 3, name: 'WAVE 03',              detail: 'Final 800 shore passes.',                                priceLabel: '105,000 TZS', splitNote: 'Unlocks when Wave 02 closes.',                          status: 'locked' },
  { id: 's4', event: 'shore',  order: 4, name: 'CABANA — CREW OF 6',   detail: '40 cabanas on the sand. Table service all night.',       priceLabel: '900,000 TZS', splitNote: 'Crew split in-app: 150,000 TZS each.',                  status: 'open'   }
];
if (!fs.existsSync(path.join(DATA_DIR, 'tiers.json'))) writeJson('tiers.json', DEFAULT_TIERS);

// ── Middleware ────────────────────────────────────────────────────
app.use(express.json({ limit: '12mb' })); // room for base64 image uploads from the admin
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 } // 8h
}));

function requireAuth(req, res, next){
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Not logged in' });
}

// ── Auth API ──────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const acct = readJson('admin.json', adminAccount);
  if (username === acct.username && bcrypt.compareSync(password || '', acct.passwordHash)){
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Wrong username or password' });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => res.json({ isAdmin: !!(req.session && req.session.isAdmin) }));
app.post('/api/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  const acct = readJson('admin.json', adminAccount);
  if (!bcrypt.compareSync(current || '', acct.passwordHash))
    return res.status(400).json({ error: 'Current password is wrong' });
  if (!next || next.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  acct.passwordHash = bcrypt.hashSync(next, 10);
  writeJson('admin.json', acct);
  res.json({ ok: true });
});

// ── Drop settings ─────────────────────────────────────────────────
app.get('/api/settings', (req, res) => res.json(readJson('settings.json', DEFAULT_SETTINGS)));
app.put('/api/settings', requireAuth, (req, res) => {
  const current = readJson('settings.json', DEFAULT_SETTINGS);
  const updated = { ...current, ...req.body };
  writeJson('settings.json', updated);
  res.json(updated);
});

// ── Tiers CRUD ────────────────────────────────────────────────────
app.get('/api/tiers', (req, res) => {
  const tiers = readJson('tiers.json', DEFAULT_TIERS);
  tiers.sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(tiers);
});
app.post('/api/tiers', requireAuth, (req, res) => {
  const tiers = readJson('tiers.json', []);
  const item = { id: Date.now().toString(36), ...req.body };
  tiers.push(item);
  writeJson('tiers.json', tiers);
  res.json(item);
});
app.put('/api/tiers/:id', requireAuth, (req, res) => {
  const tiers = readJson('tiers.json', []);
  const i = tiers.findIndex(x => x.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  tiers[i] = { ...tiers[i], ...req.body, id: tiers[i].id };
  writeJson('tiers.json', tiers);
  res.json(tiers[i]);
});
app.delete('/api/tiers/:id', requireAuth, (req, res) => {
  writeJson('tiers.json', readJson('tiers.json', []).filter(x => x.id !== req.params.id));
  res.json({ ok: true });
});

// ── Crew registrations (public write, admin read) ─────────────────
app.post('/api/register', (req, res) => {
  const { crewName, leadName, phone, email, size } = req.body || {};
  if (!crewName || !leadName || !phone)
    return res.status(400).json({ error: 'Crew name, lead name and phone are required' });
  const crewSize = parseInt(size, 10);
  if (!crewSize || crewSize < 2 || crewSize > 6)
    return res.status(400).json({ error: 'Crew size must be between 2 and 6' });

  const regs = readJson('registrations.json', []);
  const cleanPhone = String(phone).replace(/[^\d+]/g, '');
  if (regs.some(r => r.phone === cleanPhone))
    return res.status(409).json({ error: 'This phone number is already on the manifest' });

  const code = 'Z001-' + String(regs.length + 1).padStart(4, '0');
  const reg = {
    id: Date.now().toString(36),
    code,
    crewName: String(crewName).slice(0, 80),
    leadName: String(leadName).slice(0, 80),
    phone: cleanPhone,
    email: String(email || '').slice(0, 120),
    size: crewSize,
    at: new Date().toISOString()
  };
  regs.push(reg);
  writeJson('registrations.json', regs);
  res.json({ ok: true, code });
});
app.get('/api/registrations', requireAuth, (req, res) => res.json(readJson('registrations.json', [])));
app.delete('/api/registrations/:id', requireAuth, (req, res) => {
  writeJson('registrations.json', readJson('registrations.json', []).filter(x => x.id !== req.params.id));
  res.json({ ok: true });
});
app.get('/api/registrations.csv', requireAuth, (req, res) => {
  const regs = readJson('registrations.json', []);
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['code','crew','lead','phone','email','size','registered_at']]
    .concat(regs.map(r => [r.code, r.crewName, r.leadName, r.phone, r.email, r.size, r.at]));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="zora-drop-001-manifest.csv"');
  res.send('﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n'));
});

// ── Floor plan bridge (organizer draws -> buyer reads) ────────────
// PUT is open in this demo so the standalone builder can publish without a
// login wall. In production this is gated to the event's owning organizer.
app.get('/api/floorplan', (req, res) =>
  res.json(readJson('floorplan.json', { space: { w: 1600, h: 900 }, stage: null, zones: [], updatedAt: null })));
app.put('/api/floorplan', (req, res) => {
  const body = req.body || {};
  const zones = Array.isArray(body.zones) ? body.zones.slice(0, 300) : [];
  const plan = {
    space: body.space && body.space.w ? body.space : { w: 1600, h: 900 },
    stage: body.stage || null,
    zones,
    updatedAt: new Date().toISOString()
  };
  writeJson('floorplan.json', plan);
  res.json({ ok: true, zones: zones.length, updatedAt: plan.updatedAt });
});

// ── Central media management + CDN sorting ────────────────────────
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');
function imageSize(fp){
  try {
    const b = fs.readFileSync(fp);
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; // PNG
    if (b[0] === 0xFF && b[1] === 0xD8){ // JPEG — scan SOF markers
      let o = 2;
      while (o < b.length - 8){
        if (b[o] !== 0xFF){ o++; continue; }
        const m = b[o + 1];
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: b.readUInt16BE(o + 5), w: b.readUInt16BE(o + 7) };
        o += 2 + b.readUInt16BE(o + 2);
      }
    }
  } catch {}
  return null;
}
function categorize(f){
  if (/hero|banner/i.test(f)) return 'banner';
  if (/event-|tile/i.test(f)) return 'marketplace tile';
  if (/map|floor|venue/i.test(f)) return 'organizer map';
  return 'asset';
}
function listMedia(){
  const statuses = readJson('media.json', {});
  let files = [];
  try { files = fs.readdirSync(ASSETS_DIR).filter(f => /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(f)); } catch {}
  return files.map(f => {
    const st = fs.statSync(path.join(ASSETS_DIR, f));
    const kb = Math.round(st.size / 1024);
    const d = imageSize(path.join(ASSETS_DIR, f));
    const lowres = d ? (d.w < 1000 || d.h < 600) : (kb < 40);
    const meta = statuses[f] || {};
    return {
      name: f,
      url: '/assets/' + f,
      cdnUrl: 'cdn.zora.com/img/' + crypto.createHash('md5').update(f).digest('hex').slice(0, 8) + '/' + f + '?w=1600&q=80&fm=webp',
      sizeKB: kb,
      optimizedKB: Math.max(6, Math.round(kb * 0.42)),   // simulated post-compression size
      dims: d ? (d.w + '×' + d.h) : '—',
      lowres,
      category: categorize(f),
      status: meta.status || (lowres ? 'flagged' : 'pending'),
      flagReason: meta.flagReason || (lowres ? 'Low resolution — below 1000px wide' : ''),
      modified: st.mtimeMs
    };
  }).sort((a, b) => b.modified - a.modified);
}
app.get('/api/media', requireAuth, (req, res) => res.json(listMedia()));
app.put('/api/media/:name/status', requireAuth, (req, res) => {
  const name = path.basename(req.params.name);
  const { status, flagReason } = req.body || {};
  if (!['approved', 'flagged', 'pending'].includes(status)) return res.status(400).json({ error: 'Bad status' });
  const statuses = readJson('media.json', {});
  statuses[name] = { status, flagReason: status === 'flagged' ? (flagReason || 'Flagged by admin') : '' };
  writeJson('media.json', statuses);
  res.json({ ok: true, name, status });
});

// ── Image upload (base64 data URL -> /assets) ─────────────────────
// Open in this demo so the organizer Studio can upload; gated to the
// authenticated organizer/admin in production.
app.post('/api/upload', (req, res) => {
  const { name, dataUrl } = req.body || {};
  const m = /^data:image\/(jpe?g|png|webp|gif);base64,/.exec(dataUrl || '');
  if (!m) return res.status(400).json({ error: 'Send a JPG, PNG, WEBP or GIF image' });
  const ext = m[1].replace('jpeg', 'jpg');
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Image is over 8MB' });
  const safe = String(name || 'image').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
  const fname = Date.now().toString(36) + '-' + safe + '.' + ext;
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ASSETS_DIR, fname), buf);
  res.json({ ok: true, name: fname, url: '/assets/' + fname });
});

// ── Placements: link an image to a named area of the site ─────────
const SLOTS = [
  { key: 'home-hero',         label: 'Homepage hero background',   def: '/assets/event-01.jpg' },
  { key: 'home-gallery-1',    label: 'Homepage gallery — 1',       def: '/assets/event-01.jpg' },
  { key: 'home-gallery-2',    label: 'Homepage gallery — 2',       def: '/assets/event-02.jpg' },
  { key: 'home-gallery-3',    label: 'Homepage gallery — 3',       def: '/assets/event-05.jpg' },
  { key: 'home-gallery-4',    label: 'Homepage gallery — 4',       def: '/assets/event-06.jpg' },
  { key: 'about-hero',        label: 'About page hero',            def: '/assets/event-02.jpg' },
  { key: 'discover-featured', label: 'Marketplace featured banner',def: '/assets/event-01.jpg' }
];
app.get('/api/placements', (req, res) => {
  const saved = readJson('placements.json', {});
  const placements = {};
  SLOTS.forEach(s => placements[s.key] = { label: s.label, url: saved[s.key] || s.def });
  res.json({ slots: SLOTS.map(s => ({ key: s.key, label: s.label })), placements });
});
app.put('/api/placements', requireAuth, (req, res) => {
  const body = req.body || {};
  const saved = readJson('placements.json', {});
  SLOTS.forEach(s => { if (typeof body[s.key] === 'string' && body[s.key]) saved[s.key] = body[s.key]; });
  writeJson('placements.json', saved);
  res.json({ ok: true, placements: saved });
});

// ── Organizer accounts: status control + secure "act on behalf" + audit ──
const DEFAULT_ORGANIZERS = [
  { id:'o1', name:'The Brunch City', handle:'thebrunchcity', email:'hello@thebrunchcity.co', status:'active',    events:9, revenue:167713000, joined:'2024-03-11' },
  { id:'o2', name:'Offshore Ltd',    handle:'offshore',      email:'board@offshore.app',     status:'active',    events:1, revenue:84200000,  joined:'2026-05-02' },
  { id:'o3', name:'Basement',        handle:'basement',      email:'crew@basement.co',       status:'active',    events:4, revenue:22400000,  joined:'2025-11-20' },
  { id:'o4', name:'Palmwine Co',     handle:'palmwine',      email:'team@palmwine.ng',       status:'suspended', events:2, revenue:11800000,  joined:'2025-08-14' }
];
if (!fs.existsSync(path.join(DATA_DIR, 'organizers.json'))) writeJson('organizers.json', DEFAULT_ORGANIZERS);

function audit(req, action, detail){
  const log = readJson('audit.json', []);
  log.push({ at: new Date().toISOString(), admin: 'admin', action: action, detail: detail || '', ip: req.ip || '' });
  writeJson('audit.json', log.slice(-500));   // keep last 500
}

app.get('/api/organizers', requireAuth, (req, res) => res.json(readJson('organizers.json', DEFAULT_ORGANIZERS)));
app.put('/api/organizers/:id/status', requireAuth, (req, res) => {
  const orgs = readJson('organizers.json', DEFAULT_ORGANIZERS);
  const o = orgs.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  const status = req.body && req.body.status;
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Bad status' });
  o.status = status; writeJson('organizers.json', orgs);
  audit(req, status === 'suspended' ? 'suspend_organizer' : 'unlock_organizer', o.name + ' (' + o.handle + ')');
  res.json(o);
});
// impersonation — admin session temporarily "acts on behalf" of an organizer
app.post('/api/organizers/:id/impersonate', requireAuth, (req, res) => {
  const orgs = readJson('organizers.json', DEFAULT_ORGANIZERS);
  const o = orgs.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  if (o.status === 'suspended') return res.status(400).json({ error: 'Cannot act on behalf of a suspended account' });
  req.session.impersonating = { id: o.id, name: o.name, handle: o.handle, startedAt: new Date().toISOString() };
  audit(req, 'impersonate_start', o.name + ' (' + o.handle + ')');
  res.json({ ok: true, impersonating: req.session.impersonating });
});
app.post('/api/impersonate/exit', requireAuth, (req, res) => {
  const imp = req.session.impersonating;
  if (imp) audit(req, 'impersonate_end', imp.name + ' (' + imp.handle + ')');
  req.session.impersonating = null;
  res.json({ ok: true });
});
app.get('/api/impersonation', (req, res) => res.json({ impersonating: (req.session && req.session.impersonating) || null }));
app.get('/api/audit', requireAuth, (req, res) => res.json(readJson('audit.json', []).slice(-120).reverse()));

// ── KYC identity verification (Phase 1: manual review pipeline) ─────
// SECURITY MODEL:
//  • Documents are written to data/kyc-private/ which is OUTSIDE public_dir,
//    so express.static NEVER serves them. There is no public URL for an ID.
//  • Each file is encrypted at rest (AES-256-GCM) with a key derived from the
//    server session secret, and streamed to an authenticated ADMIN only, via
//    GET /api/kyc/:id/documents/:docId (the "signed URL" equivalent).
//  • Approve flips the record to `approved` (= is_verified; unlocks payouts).
//  • Every submit / view / approve / reject is logged (audit + per-record events).
// Phase 2 seam: `vendor*` fields on each record are where an automated check
//    (Smile ID / Sumsub) writes its risk score + extracted fields before review.
const KYC_DIR = path.join(DATA_DIR, 'kyc-private');
fs.mkdirSync(KYC_DIR, { recursive: true });

const ID_TYPES = ['passport', 'drivers_license', 'national_id'];
const KYC_REASONS = [
  { code: 'blurry_photo',         label: 'Blurry / unreadable photo',   user: 'The image was too blurry to read. Retake it in good light, holding steady.' },
  { code: 'expired_document',     label: 'Expired document',            user: 'This document has expired. Please upload a current, valid ID.' },
  { code: 'name_mismatch',        label: 'Name mismatch',               user: 'The name on the ID does not match your account. Upload a matching ID, or update your account name.' },
  { code: 'incomplete_upload',    label: 'Incomplete — a side is missing', user: 'We need every side of the document. Please add the missing image and resubmit.' },
  { code: 'document_unclear',     label: 'Document type unclear',       user: 'We could not clearly read the document. Retake it with all four corners visible.' },
  { code: 'unsupported_document', label: 'Unsupported document',        user: "We could not accept this document. Please use a passport, driver's license, or national ID." },
  { code: 'suspected_fraud',      label: 'Suspected fraud',             user: 'We could not verify this submission. Please contact support@zora.app.' }
];

// AES-256-GCM at rest; key = SHA-256('kyc:' + session secret). Blob = iv(12)|tag(16)|ciphertext.
const KYC_KEY = crypto.createHash('sha256').update('kyc:' + SESSION_SECRET).digest();
function kycEncrypt(buf){
  const iv = crypto.randomBytes(12);
  const c  = crypto.createCipheriv('aes-256-gcm', KYC_KEY, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}
function kycDecrypt(blob){
  const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), enc = blob.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', KYC_KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]);
}
// Shape sent to the admin queue — no raw storage internals, doc-number masked.
function kycPublic(v){
  return {
    id: v.id, ref: v.ref, status: v.status, idType: v.idType, country: v.country,
    fullName: v.fullName, docNumberMasked: v.docNumberMasked || null,
    attempt: v.attempt, submittedAt: v.submittedAt, reviewedAt: v.reviewedAt,
    reviewedBy: v.reviewedBy, rejection: v.rejection,
    documents: (v.documents || []).map(d => ({ id: d.id, side: d.side, contentType: d.contentType })),
    events: v.events || []
  };
}
function kycEvent(v, actor, action, detail){
  v.events = v.events || [];
  v.events.push({ at: new Date().toISOString(), actor, action, detail: detail || '' });
}

// Step 1 — receive one document, encrypt, store privately, return an opaque docId.
// (Open in the demo like /api/upload; in production gate to the authenticated user.)
app.post('/api/kyc/upload', (req, res) => {
  const { dataUrl } = req.body || {};
  const m = /^data:(image\/(?:jpe?g|png|webp)|application\/pdf);base64,/.exec(dataUrl || '');
  if (!m) return res.status(400).json({ error: 'Upload a JPG, PNG, WEBP or PDF' });
  const contentType = m[1];
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (!buf.length) return res.status(400).json({ error: 'Empty file' });
  if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'File is over 8MB' });
  const docId = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(KYC_DIR, docId + '.enc'), kycEncrypt(buf));
  res.json({ ok: true, docId, contentType, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
});

// Step 2 — create the verification record from the uploaded docIds.
app.post('/api/kyc/submit', (req, res) => {
  const { idType, country, fullName, docNumber, documents } = req.body || {};
  if (!ID_TYPES.includes(idType))        return res.status(400).json({ error: 'Choose a valid ID type' });
  if (!country)                          return res.status(400).json({ error: 'Select your country' });
  if (!fullName || String(fullName).trim().length < 2) return res.status(400).json({ error: 'Enter the full name on the document' });
  if (!Array.isArray(documents) || !documents.length)  return res.status(400).json({ error: 'Upload your document' });
  const docs = [];
  for (const d of documents){
    if (!d || !/^[a-f0-9]{32}$/.test(d.docId || ''))                  return res.status(400).json({ error: 'Bad document reference' });
    if (!fs.existsSync(path.join(KYC_DIR, d.docId + '.enc')))         return res.status(400).json({ error: 'A document expired before submit — please re-upload' });
    docs.push({ id: d.docId, side: String(d.side || 'front').slice(0, 20), contentType: d.contentType || 'image/jpeg' });
  }
  const all = readJson('kyc.json', []);
  const name = String(fullName).trim().slice(0, 120);
  const prior = all.filter(v => (v.fullName || '').toLowerCase() === name.toLowerCase()).length;
  // Store only a masked doc number for review + a hash for duplicate/fraud linking; never the plaintext.
  const dn = String(docNumber || '').replace(/\s+/g, '');
  const now = new Date().toISOString();
  const rec = {
    id: crypto.randomBytes(8).toString('hex'),
    ref: 'KYC-' + Date.now().toString(36).toUpperCase(),
    status: 'submitted',
    idType, country, fullName: name,
    docNumberMasked: dn ? dn.slice(0, 2) + '••••' + dn.slice(-2) : null,
    docNumberHash: dn ? crypto.createHash('sha256').update(dn).digest('hex') : null,
    documents: docs,
    attempt: prior + 1,
    submittedAt: now, reviewedAt: null, reviewedBy: null, rejection: null,
    vendor: null, vendorRiskScore: null, vendorDecision: null,  // Phase 2 seam
    ip: req.ip || '', ua: (req.headers['user-agent'] || '').slice(0, 200),
    events: []
  };
  kycEvent(rec, 'user', 'submitted', idType + ' / ' + country);
  all.push(rec);
  writeJson('kyc.json', all);
  res.json({ ok: true, ref: rec.ref, status: rec.status });
});

// User-facing status poll (by ref, no PII, no documents).
app.get('/api/kyc/status/:ref', (req, res) => {
  const v = readJson('kyc.json', []).find(x => x.ref === req.params.ref);
  if (!v) return res.status(404).json({ error: 'Not found' });
  let reason = null;
  if (v.status === 'rejected' && v.rejection){
    const r = KYC_REASONS.find(x => x.code === v.rejection.code);
    reason = (r && r.user) || v.rejection.note || 'Please resubmit.';
  }
  res.json({ ref: v.ref, status: v.status, idType: v.idType, submittedAt: v.submittedAt, reviewedAt: v.reviewedAt, reason });
});

// Standardized rejection reasons (used by admin UI + status copy).
app.get('/api/kyc/reasons', (req, res) => res.json(KYC_REASONS.map(r => ({ code: r.code, label: r.label }))));

// Admin review queue (newest first).
app.get('/api/kyc', requireAuth, (req, res) => {
  res.json(readJson('kyc.json', []).map(kycPublic).reverse());
});

// Gated document stream — authenticated admin only, never cached, view is logged.
app.get('/api/kyc/:id/documents/:docId', requireAuth, (req, res) => {
  const all = readJson('kyc.json', []);
  const v = all.find(x => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const doc = (v.documents || []).find(d => d.id === req.params.docId);
  if (!doc) return res.status(404).json({ error: 'No such document' });
  const file = path.join(KYC_DIR, doc.id + '.enc');
  if (!fs.existsSync(file)) return res.status(410).json({ error: 'Document purged' });
  let buf;
  try { buf = kycDecrypt(fs.readFileSync(file)); }
  catch { return res.status(500).json({ error: 'Could not decrypt document' }); }
  kycEvent(v, 'admin', 'viewed_document', doc.side); writeJson('kyc.json', all);
  res.setHeader('Content-Type', doc.contentType || 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', 'inline');
  res.send(buf);
});

// Approve — unlocks payouts (is_verified). Decision is audited.
app.post('/api/kyc/:id/approve', requireAuth, (req, res) => {
  const all = readJson('kyc.json', []);
  const v = all.find(x => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  if (v.status !== 'approved'){
    v.status = 'approved'; v.reviewedAt = new Date().toISOString(); v.reviewedBy = 'admin'; v.rejection = null;
    kycEvent(v, 'admin', 'approved');
    writeJson('kyc.json', all);
    audit(req, 'kyc_approve', (v.fullName || v.ref) + ' · ' + v.idType + '/' + v.country);
  }
  res.json(kycPublic(v));
});

// Reject — requires a standardized reason; user is shown the mapped message.
app.post('/api/kyc/:id/reject', requireAuth, (req, res) => {
  const { code, note } = req.body || {};
  if (!KYC_REASONS.find(r => r.code === code)) return res.status(400).json({ error: 'Pick a rejection reason' });
  const all = readJson('kyc.json', []);
  const v = all.find(x => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: 'Not found' });
  v.status = 'rejected'; v.reviewedAt = new Date().toISOString(); v.reviewedBy = 'admin';
  v.rejection = { code, note: String(note || '').slice(0, 300) };
  kycEvent(v, 'admin', 'rejected', code);
  writeJson('kyc.json', all);
  audit(req, 'kyc_reject', (v.fullName || v.ref) + ' · ' + code);
  res.json(kycPublic(v));
});

// ── Storefront theme (the studio publishes here; the storefront reads it) ──
const DEFAULT_THEME = {
  handle: 'thebrunchcity', brandName: 'The Brunch City',
  accent: '#C46A28', secondary: '#1D6E56', bg: '#F7F1E7', card: '#FFFDF8',
  typography: 'editorial', logoUrl: '', faviconUrl: '', bannerUrl: ''
};
app.get('/api/storefront-theme', (req, res) => res.json(readJson('theme.json', DEFAULT_THEME)));
app.put('/api/storefront-theme', (req, res) => {           // open in demo; gated to the owning organizer in prod
  const updated = { ...readJson('theme.json', DEFAULT_THEME), ...(req.body || {}) };
  writeJson('theme.json', updated);
  res.json({ ok: true, theme: updated });
});

// ── Scanning agents (staff provisioning + temporary credentials) ──
function genCode(){ return String(Math.floor(100000 + Math.random() * 900000)); } // 6-digit check-in code
app.get('/api/agents', requireAuth, (req, res) => res.json(readJson('agents.json', [])));
app.post('/api/agents', requireAuth, (req, res) => {
  const { name, contact, event } = req.body || {};
  if (!name || !contact) return res.status(400).json({ error: 'Agent name and phone or email are required' });
  const agents = readJson('agents.json', []);
  const agent = {
    id: Date.now().toString(36),
    name: String(name).slice(0, 80),
    contact: String(contact).slice(0, 120),
    via: /@/.test(contact) ? 'email' : 'phone',
    event: String(event || 'All events').slice(0, 80),
    role: 'agent',
    code: genCode(),
    status: 'active',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3).toISOString() // 3-day temporary credential
  };
  agents.push(agent);
  writeJson('agents.json', agents);
  res.json(agent);
});
app.post('/api/agents/:id/rotate', requireAuth, (req, res) => {
  const agents = readJson('agents.json', []);
  const a = agents.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  a.code = genCode(); a.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3).toISOString();
  writeJson('agents.json', agents);
  res.json(a);
});
app.delete('/api/agents/:id', requireAuth, (req, res) => {
  writeJson('agents.json', readJson('agents.json', []).filter(x => x.id !== req.params.id));
  res.json({ ok: true });
});

// ── Admin pages ───────────────────────────────────────────────────
app.get(['/admin', '/login'], (req, res) => {
  const page = (req.session && req.session.isAdmin) ? 'dashboard.html' : 'login.html';
  res.sendFile(path.join(ADMIN_DIR, page));
});

// ── Branded ticket rendering (programmatic PNG/SVG passes) ─────────
// The pass is drawn entirely in code (lib/ticket.js) — no templates. A stored
// ticket (data/tickets.json) can be rendered by code, and any field may be
// overridden via query string for live preview in the organizer studio.
const TICKET_FIELDS = ['event','dateLabel','venue','tableName','tableNo','seats','guest','ticketId','tier','qr'];
function resolveTicket(code, query){
  const store = readJson('tickets.json', {});
  const base = (code && store[code]) ? store[code] : {};
  const data = { ...base };
  if (code && !data.ticketId) data.ticketId = code;      // allow ad-hoc codes
  TICKET_FIELDS.forEach(f => { if (query[f] != null && query[f] !== '') data[f] = query[f]; });
  return data;
}
app.get('/api/tickets/:code.svg', (req, res) => {
  const svg = ticketSVG(resolveTicket(req.params.code, req.query), { theme: req.query.theme });
  res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
});
app.get('/api/tickets/:code.png', async (req, res) => {
  try {
    const png = await ticketPNG(resolveTicket(req.params.code, req.query), { theme: req.query.theme, scale: Math.min(3, Number(req.query.scale) || 2) });
    res.type('image/png').set('Cache-Control', 'no-store').set('Content-Disposition', `inline; filename="${req.params.code}.png"`).send(png);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── White-label organizer routing ─────────────────────────────────
// Every marketplace event belongs to an organizer, and each organizer owns a
// subdomain (<handle>.zora.com). The apex marketplace links out to the tenant
// subdomain; the tenant subdomain serves the organizer's branded event page.
const ROOT_DOMAIN = process.env.ZORA_ROOT_DOMAIN || 'zora.com';
function organizerByHandle(handle) {
  return readJson('organizers.json', []).find(o => o.handle === String(handle || '').toLowerCase());
}
// Build the canonical event URL. In production this is the real subdomain; on
// localhost (no wildcard DNS) we fall back to a path alias that actually resolves.
function tenantEventUrl(handle, id, req) {
  const host = (req.headers.host || '');
  const onRootDomain = host.endsWith(ROOT_DOMAIN);
  if (!onRootDomain) return `/@${handle}/events/${encodeURIComponent(id)}`;      // local / preview
  return `${req.protocol}://${handle}.${ROOT_DOMAIN}/events/${encodeURIComponent(id)}`;
}
function enrichEvent(ev, req) {
  const org = organizerByHandle(ev.organizerHandle);
  return {
    ...ev,
    organizer: org ? org.name : null,
    subdomain: ev.organizerHandle ? `${ev.organizerHandle}.${ROOT_DOMAIN}` : null,
    url: ev.organizerHandle ? tenantEventUrl(ev.organizerHandle, ev.id, req) : null,
  };
}

// ── Events API (our ecosystem only — data/events.json, or Supabase) ─
// The marketplace fetches ONLY events saved in our own database, each returned
// with its organizer + subdomain so the client can route to the tenant store.
app.get('/api/events', async (req, res) => {
  try { res.json((await eventsApi.listEvents(req.query.city)).map(ev => enrichEvent(ev, req))); }
  catch (e) { res.status(503).json({ error: e.message }); }
});
app.get('/api/events/:id', async (req, res) => {
  try { res.json(enrichEvent(await eventsApi.getEvent(req.params.id), req)); }
  catch (e) { res.status(404).json({ error: e.message }); }
});
app.post('/api/events', requireAuth, async (req, res) => {
  try { res.json(await eventsApi.upsertEvent(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/events/:id', requireAuth, async (req, res) => {
  try { res.json(await eventsApi.upsertEvent({ ...req.body, id: req.params.id })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Public tenant resolver (used by the white-label event page).
app.get('/api/tenant/:handle', (req, res) => {
  const org = organizerByHandle(req.params.handle);
  if (!org) return res.status(404).json({ error: 'Unknown organizer' });
  res.json({ handle: org.handle, name: org.name, subdomain: `${org.handle}.${ROOT_DOMAIN}`, status: org.status });
});

// Tenant resolution middleware: <handle>.zora.com → req.tenant.
app.use((req, _res, next) => {
  const host = (req.headers.host || '').split(':')[0];
  if (host.endsWith('.' + ROOT_DOMAIN)) {
    const sub = host.slice(0, -(('.' + ROOT_DOMAIN).length));
    if (sub && sub !== 'www') req.tenant = organizerByHandle(sub) || null;
  }
  next();
});

// /events/:id — on a tenant subdomain, serve the branded page; on the apex
// marketplace, 302-redirect to the owning organizer's subdomain (seamless).
app.get('/events/:id', async (req, res) => {
  if (req.tenant) return res.sendFile(path.join(PUBLIC_DIR, 'tenant.html'));
  try {
    const ev = await eventsApi.getEvent(req.params.id);
    if (!ev.organizerHandle) return res.status(404).send('Event has no organizer');
    return res.redirect(302, tenantEventUrl(ev.organizerHandle, ev.id, req));
  } catch { return res.status(404).send('Event not found'); }
});

// Local path alias for the subdomain (works without wildcard DNS): /@handle/...
app.get(['/@:handle', '/@:handle/events/:id'], (req, res) => {
  if (!organizerByHandle(req.params.handle)) return res.status(404).send('Unknown organizer');
  res.sendFile(path.join(PUBLIC_DIR, 'tenant.html'));
});

// ── Static site ───────────────────────────────────────────────────
app.use(express.static(PUBLIC_DIR));

app.listen(PORT, () => {
  console.log(`ZORA -> http://localhost:${PORT}   (DROP 001: /drop-001.html, admin: /admin)`);
});
