// Scanning-agent access codes: generate (admin/website), redeem → scoped JWT,
// verify tickets, revoke. In-memory demo store (swap for Postgres/Redis in prod).
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no O0 I1 L
const PEPPER = process.env.AGENT_CODE_PEPPER || 'dev-pepper-change-me';
const JWT_SECRET = process.env.AGENT_JWT_SECRET || 'dev-agent-jwt-secret-change-me';

const codes = new Map();     // codeHash -> record
const sessions = new Map();  // jti -> { eventId, codeId }
const attempts = new Map();  // ip -> { n, ts }
const seen = new Map();      // eventId -> Set(ticket)

const normalize = (c) => String(c || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
const hashCode = (c) => crypto.createHmac('sha256', PEPPER).update(normalize(c)).digest('hex');
const format = (c) => c.replace(/(.{4})(?=.)/g, '$1-');
function generateCode(len = 8) { let s = ''; for (let i = 0; i < len; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)]; return s; }

function rateLimited(ip, max = 10, windowMs = 60000) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now - a.ts > windowMs) { attempts.set(ip, { n: 1, ts: now }); return false; }
  a.n++;
  return a.n > max;
}

// Codes are created by the Website / Web-App Admin (backend-controlled), never organizers.
function createCode({ eventId = 'offshore', ttlHours = 8, scopes = ['tickets:scan'], maxUses = 1 } = {}) {
  const raw = generateCode(8);
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + ttlHours * 3600e3;
  codes.set(hashCode(raw), { id, eventId, scopes, status: 'active', deviceId: null, expiresAt, uses: 0, maxUses });
  return { id, code: format(raw), eventId, expires_at: new Date(expiresAt).toISOString() };
}

function redeem({ code, deviceId }, ip) {
  if (rateLimited(ip)) return { status: 429, error: 'rate_limited' };
  const rec = codes.get(hashCode(code));
  if (!rec) return { status: 401, error: 'invalid_code' };
  if (rec.status === 'revoked') return { status: 403, error: 'revoked' };
  if (Date.now() > rec.expiresAt) { rec.status = 'expired'; return { status: 401, error: 'expired' }; }
  if (rec.uses >= rec.maxUses) return { status: 409, error: 'already_used' };
  if (rec.deviceId && deviceId && rec.deviceId !== deviceId) return { status: 409, error: 'device_mismatch' };

  rec.uses++;
  if (!rec.deviceId) rec.deviceId = deviceId || null;
  if (rec.uses >= rec.maxUses) rec.status = 'used';

  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { role: 'scanner', scope: rec.scopes, event_id: rec.eventId, device_id: deviceId, jti },
    JWT_SECRET,
    { subject: `agent:${rec.id}`, algorithm: 'HS256', expiresIn: '8h', issuer: 'zora-gate', audience: 'zora-scanner' },
  );
  sessions.set(jti, { eventId: rec.eventId, codeId: rec.id });
  return { status: 200, token, event_id: rec.eventId, scopes: rec.scopes, expires_in: 8 * 3600 };
}

function authScanner(header) {
  const raw = String(header || '').replace(/^Bearer\s+/i, '');
  try {
    const c = jwt.verify(raw, JWT_SECRET, { audience: 'zora-scanner', issuer: 'zora-gate' });
    if (!c.scope || !c.scope.includes('tickets:scan')) return { status: 403, error: 'out_of_scope' };
    if (!sessions.has(c.jti)) return { status: 401, error: 'revoked' }; // instant kick
    return { claims: c };
  } catch {
    return { status: 401, error: 'bad_token' };
  }
}

function verifyTicket(header, { ticket }) {
  const a = authScanner(header);
  if (a.error) return { status: a.status, error: a.error };
  const ev = a.claims.event_id;
  if (!seen.has(ev)) seen.set(ev, new Set());
  const s = seen.get(ev);
  if (s.has(ticket)) return { status: 200, ok: false, result: 'duplicate', ticket };
  s.add(ticket);
  return { status: 200, ok: true, result: 'valid', ticket };
}

function revoke({ codeId }) {
  for (const rec of codes.values()) if (rec.id === codeId) rec.status = 'revoked';
  for (const [jti, s] of sessions) if (s.codeId === codeId) sessions.delete(jti);
  return { status: 200, ok: true };
}

module.exports = { createCode, redeem, verifyTicket, revoke };
