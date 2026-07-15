// Zora Gate — a real (minimal) backend for the live-edit publish loop.
// HTTP: POST /events/:id/publish saves the patch, bumps a version, and broadcasts
// over WebSocket to every connected client. Opens a localtunnel so the phone can
// reach it over the internet (past café-Wi-Fi isolation).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const localtunnel = require('localtunnel');
const agent = require('./agent');

const PORT = process.env.PORT || 4300;
const DB = path.join(__dirname, 'events.json');

const load = () => { try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return {}; } };
const save = (d) => fs.writeFileSync(DB, JSON.stringify(d, null, 2));

let db = load();
if (!db.offshore) {
  db.offshore = {
    id: 'offshore', cap: 3200,
    tiers: [{ name: 'Wave 01', price: 65000 }, { name: 'Wave 02', price: 85000 }, { name: 'Cabana — crew of 6', price: 900000 }],
    version: 1, updatedAt: new Date().toISOString(),
  };
  save(db);
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', ...CORS }); res.end(JSON.stringify(obj)); };
const readBody = (req, cb) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { let b = {}; try { b = JSON.parse(s || '{}'); } catch {} cb(b); }); };

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.url === '/health') return json(res, 200, { ok: true, clients: wss.clients.size });

  const m = req.url.match(/^\/events\/([^/]+?)(\/publish)?$/);
  if (m && req.method === 'GET') { const ev = db[m[1]]; return ev ? json(res, 200, ev) : json(res, 404, { error: 'not found' }); }

  if (m && m[2] === '/publish' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let patch = {};
      try { patch = JSON.parse(body || '{}'); } catch {}
      const id = m[1];
      const prev = db[id] || { id };
      const ev = {
        ...prev,
        ...(patch.cap != null ? { cap: patch.cap } : {}),
        ...(patch.tiers ? { tiers: patch.tiers } : {}),
        version: (prev.version || 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      db[id] = ev; save(db);
      const msg = JSON.stringify({ event: 'event.published', payload: ev });
      let n = 0;
      wss.clients.forEach((c) => { if (c.readyState === 1) { c.send(msg); n++; } });
      console.log(`[gate] published ${id} v${ev.version} → ${n} client(s)`);
      json(res, 200, { ok: true, version: ev.version, clients: n });
    });
    return;
  }

  // ── Scanning-agent access codes ──────────────────────────────────
  // createCode is what the Website / Web-App Admin calls (backend-controlled);
  // organizers never hit it. redeem/verify are the agent's handshake + scans.
  if (req.url === '/agent/codes' && req.method === 'POST') {
    return readBody(req, (b) => { const r = agent.createCode(b); console.log('[gate] agent code created for', r.eventId); json(res, 200, r); });
  }
  if (req.url === '/agent/redeem' && req.method === 'POST') {
    return readBody(req, (b) => { const r = agent.redeem(b, req.socket.remoteAddress || 'ip'); json(res, r.status, r); });
  }
  if (req.url === '/tickets/verify' && req.method === 'POST') {
    return readBody(req, (b) => { const r = agent.verifyTicket(req.headers.authorization, b); json(res, r.status, r); });
  }
  if (req.url === '/agent/revoke' && req.method === 'POST') {
    return readBody(req, (b) => { const r = agent.revoke(b); json(res, r.status, r); });
  }

  json(res, 404, { error: 'not found' });
});

const wss = new WebSocketServer({ server });
wss.on('connection', () => console.log('[gate] client connected · total', wss.clients.size));

// A stable subdomain means PUBLIC_URL stays the same across restarts, so the
// mobile GATE_URL doesn't need re-editing every time. Override with GATE_SUBDOMAIN.
const SUBDOMAIN = process.env.GATE_SUBDOMAIN || 'zora-gate-tz';

// localtunnel flaps (its edge drops sockets); when it does it emits an 'error'
// event. Unhandled, that event throws and kills the whole Gate — the bug that
// kept taking the server down. We handle it, keep the HTTP/WS server alive, and
// transparently reopen the tunnel with the same subdomain.
let tunnel = null;
let reopening = false;
async function openTunnel() {
  if (reopening) return;
  reopening = true;
  try {
    tunnel = await localtunnel({ port: PORT, subdomain: SUBDOMAIN });
    reopening = false;
    console.log('[gate] PUBLIC_URL=' + tunnel.url + (tunnel.url.includes(SUBDOMAIN) ? '' : ' (subdomain taken — using random)'));
    tunnel.on('close', () => console.log('[gate] tunnel closed'));
    tunnel.on('error', (err) => {
      console.log('[gate] tunnel error:', err.message, '· reopening in 3s');
      try { tunnel.close(); } catch {}
      tunnel = null;
      setTimeout(() => { reopening = false; openTunnel(); }, 3000);
    });
  } catch (e) {
    reopening = false;
    console.log('[gate] tunnel failed:', e.message, '· retrying in 5s');
    setTimeout(openTunnel, 5000);
  }
}

server.listen(PORT, () => {
  console.log('[gate] http+ws listening on :' + PORT);
  openTunnel();
});

// Last-resort guard: a stray async error should never take the Gate down.
process.on('uncaughtException', (e) => console.log('[gate] uncaught (ignored):', e.message));
process.on('unhandledRejection', (e) => console.log('[gate] unhandled rejection (ignored):', e && e.message));
