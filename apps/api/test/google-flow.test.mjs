/* BS148 — organizer Google sign-in: the pure pieces.
     node --test apps/api/test/google-flow.test.mjs   (after `pnpm --filter ./apps/api build`)
   state encode/verify · `next` sanitizer · signup ticket · claims → session decision. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const g = require('../dist/auth/google-flow.js');

const S = 'test-secret';

test('state round-trips intent + next, and is bound to the cookie mac', () => {
  const { state, cookie } = g.encodeState(S, 'nonce123', 'org', '/dashboard/events');
  assert.equal(cookie.startsWith(state + '.'), true);
  assert.deepEqual(g.verifyState(S, cookie, state), { i: 'org', n: '/dashboard/events' });
  assert.equal(g.peekIntent(cookie), 'org');
});

test('state rejects forged mac, wrong secret, swapped payload, missing pieces', () => {
  const { state, cookie } = g.encodeState(S, 'n1', 'org', null);
  assert.equal(g.verifyState('other', cookie, state), null);
  assert.equal(g.verifyState(S, cookie.replace(/\.[^.]+$/, '.forged'), state), null);
  assert.equal(g.verifyState(S, cookie, 'n1'), null); // payload stripped from query state
  // An attacker re-encodes the payload as admin but cannot re-sign it.
  const adminPayload = Buffer.from(JSON.stringify({ i: 'admin', n: null })).toString('base64url');
  const [n, , mac] = cookie.split('.');
  assert.equal(g.verifyState(S, `${n}.${adminPayload}.${mac}`, `${n}.${adminPayload}`), null);
  assert.equal(g.verifyState(S, '', state), null);
  assert.equal(g.verifyState(S, 'abc.forged', 'abc'), null); // legacy 2-part cookie
  assert.equal(g.verifyState(S, cookie, ''), null);
});

test('a next smuggled into the state is re-sanitized on verify', () => {
  const nonce = 'n2';
  const payload = Buffer.from(JSON.stringify({ i: 'org', n: '//evil.com' })).toString('base64url');
  const signed = `${nonce}.${payload}`;
  const cookie = `${signed}.${g.hmac(S, 'g-state:', signed)}`;
  assert.deepEqual(g.verifyState(S, cookie, signed), { i: 'org', n: null });
});

test('unknown intent falls back to admin (BS141 default)', () => {
  assert.equal(g.parseIntent(undefined), 'admin');
  assert.equal(g.parseIntent('ORG'), 'org');
  assert.equal(g.parseIntent('signup'), 'signup');
  assert.equal(g.parseIntent('root'), 'admin');
});

test('sanitizeNext: only same-site relative paths', () => {
  assert.equal(g.sanitizeNext('/dashboard/events?x=1'), '/dashboard/events?x=1');
  for (const bad of ['//evil.com', '/\\evil.com', '\\\\evil.com', 'https://evil.com', 'javascript:alert(1)',
    'evil.com', '', ' ', '/ok\nSet-Cookie:x', '/a\\b', null, undefined, 42, '/' + 'a'.repeat(600)]) {
    assert.equal(g.sanitizeNext(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('organizerLanding: dashboard paths only, never back to login/signup', () => {
  assert.equal(g.organizerLanding(null), '/dashboard/overview');
  assert.equal(g.organizerLanding('/dashboard/payouts'), '/dashboard/payouts');
  assert.equal(g.organizerLanding('/dashboard'), '/dashboard');
  assert.equal(g.organizerLanding('/dashboard/login?x'), '/dashboard/overview');
  assert.equal(g.organizerLanding('/dashboard/signup'), '/dashboard/overview');
  assert.equal(g.organizerLanding('/admin'), '/dashboard/overview');
  assert.equal(g.organizerLanding('//evil.com'), '/dashboard/overview');
  assert.equal(g.organizerLanding('/dashboardevil'), '/dashboard/overview');
});

test('errorPage per intent', () => {
  assert.equal(g.errorPage('admin'), '/admin/login');
  assert.equal(g.errorPage('org'), '/dashboard/login');
  assert.equal(g.errorPage('signup'), '/dashboard/signup');
});

test('signup ticket: verifies, lowercases, expires, rejects tampering', () => {
  const now = Date.now();
  const t = g.encodeTicket(S, { sub: '123', email: 'Ama@Example.com', name: 'Ama', exp: now + 60_000 });
  assert.deepEqual(g.verifyTicket(S, t, now), { sub: '123', email: 'ama@example.com', name: 'Ama', exp: now + 60_000 });
  assert.equal(g.verifyTicket(S, t, now + 120_000), null);
  assert.equal(g.verifyTicket('other', t, now), null);
  const forged = Buffer.from(JSON.stringify({ sub: '9', email: 'x@y.z', exp: now + 1e6 })).toString('base64url');
  assert.equal(g.verifyTicket(S, `${forged}.${t.split('.')[1]}`, now), null);
  assert.equal(g.verifyTicket(S, '', now), null);
});

/* ── claims → session ─────────────────────────────────────────────────────── */
const claims = { sub: 'g-1', email: 'owner@brunch.co' };
const m = (over = {}) => ({ organizerId: 'o-brunch', organizerHandle: 'brunch', role: 'owner', status: 'active', kycStatus: 'approved', ...over });
const u = (over = {}) => ({ id: 'u1', email: 'owner@brunch.co', googleSub: null, ...over });

test('org: matches by sub first', () => {
  const d = g.decideGoogle({ intent: 'org', claims, bySub: { user: u({ googleSub: 'g-1' }), memberships: [m()] }, byEmail: { user: u({ id: 'u2' }), memberships: [m()] } });
  assert.equal(d.kind, 'organizer');
  assert.equal(d.userId, 'u1');
  assert.equal(d.matchedBy, 'sub');
  assert.equal(d.linkSub, false);
  assert.equal(d.acting.organizerHandle, 'brunch');
});

test('org: matches by email and links the sub', () => {
  const d = g.decideGoogle({ intent: 'org', claims, bySub: null, byEmail: { user: u(), memberships: [m(), m({ organizerId: 'o2', organizerHandle: 'two', role: 'admin' })] } });
  assert.equal(d.kind, 'organizer');
  assert.equal(d.matchedBy, 'email');
  assert.equal(d.linkSub, true);
  assert.equal(d.memberships.length, 2);
});

test('org: email-matched user already linked to another Google account is refused', () => {
  const d = g.decideGoogle({ intent: 'org', claims, byEmail: { user: u({ googleSub: 'g-OTHER' }), memberships: [m()] } });
  assert.deepEqual(d, { kind: 'error', error: 'google_mismatch' });
});

test('org: no match → no_account (never creates an organizer)', () => {
  assert.deepEqual(g.decideGoogle({ intent: 'org', claims }), { kind: 'error', error: 'no_account' });
  // a user with no organizer membership is not an organizer either
  assert.deepEqual(g.decideGoogle({ intent: 'org', claims, byEmail: { user: u(), memberships: [] } }), { kind: 'error', error: 'no_account' });
});

test('org: suspended acting organizer is refused (user + legacy paths)', () => {
  assert.deepEqual(g.decideGoogle({ intent: 'org', claims, byEmail: { user: u(), memberships: [m({ status: 'suspended' })] } }), { kind: 'error', error: 'suspended' });
  assert.deepEqual(g.decideGoogle({ intent: 'org', claims, legacyOrg: { handle: 'old', status: 'suspended', kycStatus: null } }), { kind: 'error', error: 'suspended' });
});

test('org: legacy organizer by contact email when no user exists', () => {
  const d = g.decideGoogle({ intent: 'org', claims, legacyOrg: { handle: 'old', status: 'active', kycStatus: 'approved' } });
  assert.equal(d.kind, 'legacy');
  assert.equal(d.org.handle, 'old');
});

test('signup: no account → signup ticket; existing organizer → just signs in', () => {
  assert.deepEqual(g.decideGoogle({ intent: 'signup', claims }), { kind: 'signup' });
  assert.deepEqual(g.decideGoogle({ intent: 'signup', claims, byEmail: { user: u(), memberships: [] } }), { kind: 'signup' });
  assert.equal(g.decideGoogle({ intent: 'signup', claims, byEmail: { user: u(), memberships: [m()] } }).kind, 'organizer');
});

test('intent decides for an account that is BOTH admin-allowlisted and an organizer', () => {
  const both = { claims, adminAllowed: true, byEmail: { user: u(), memberships: [m()] } };
  assert.deepEqual(g.decideGoogle({ ...both, intent: 'admin' }), { kind: 'admin' });
  assert.equal(g.decideGoogle({ ...both, intent: 'org' }).kind, 'organizer');
  // admin intent ignores organizer membership entirely
  assert.deepEqual(g.decideGoogle({ ...both, intent: 'admin', adminAllowed: false }), { kind: 'error', error: 'not_allowed' });
});
