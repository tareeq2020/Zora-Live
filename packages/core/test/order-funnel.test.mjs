/* BS153: the cart-funnel read rules + the gateway-error sanitizer. Pure, no DB —
   build core first (`pnpm --filter @zora/core build`); we import dist. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../dist/index.js';

const { orderStageReached, attemptAccepted, buildTimeline, timelineDurations, funnelWithDropoff, sanitizeGatewayError, FUNNEL_STAGES } = core;

test('stage: a cart with no attempt stops at cart_created', () => {
  assert.equal(orderStageReached({ status: 'pending', attempts: [], notified: false, checkedIn: false }), 'cart_created');
});

test('stage: a refused attempt is payment_started, not gateway_accepted', () => {
  const a = { status: 'created', error: 'x-bridge /collection/mobile failed: 400 {...}' };
  assert.equal(attemptAccepted(a), false);
  assert.equal(orderStageReached({ status: 'pending', attempts: [a], notified: false, checkedIn: false }), 'payment_started');
});

test('stage: accepted, paid, delivered, checked in', () => {
  const ok = { status: 'pending', orderReference: 'MOCK-1' };
  assert.equal(orderStageReached({ status: 'pending', attempts: [ok], notified: false, checkedIn: false }), 'gateway_accepted');
  assert.equal(orderStageReached({ status: 'paid', attempts: [ok], notified: false, checkedIn: false }), 'paid');
  assert.equal(orderStageReached({ status: 'paid', attempts: [ok], notified: true, checkedIn: false }), 'passes_delivered');
  assert.equal(orderStageReached({ status: 'paid', attempts: [ok], notified: true, checkedIn: true }), 'checked_in');
  // a refunded order still reached "paid"
  assert.equal(orderStageReached({ status: 'refunded', attempts: [ok], notified: false, checkedIn: false }), 'paid');
});

test('stage: a failed-after-push attempt (no error) counts as accepted', () => {
  assert.equal(attemptAccepted({ status: 'failed' }), true);
  assert.equal(attemptAccepted({ status: 'failed', error: 'refused' }), false);
  assert.equal(attemptAccepted({ status: 'expired' }), false);
});

test('timeline: derived entries fill gaps, logged ones win, order + gaps are right', () => {
  const logged = [
    { at: '2026-11-01T10:00:00.000Z', step: 'cart_created', transactionId: null, detail: {} },
    { at: '2026-11-01T10:01:00.000Z', step: 'pay_requested', transactionId: 'T1', detail: {} },
  ];
  const derived = [
    { at: '2026-11-01T10:00:00.500Z', step: 'cart_created', transactionId: null, detail: {} }, // dup → dropped
    { at: '2026-11-01T10:01:00.000Z', step: 'pay_requested', transactionId: 'T1', detail: {} }, // dup → dropped
    { at: '2026-11-01T10:05:00.000Z', step: 'paid', transactionId: 'T1', detail: {} },
    { at: '2026-11-01T10:05:00.000Z', step: 'passes_issued', transactionId: null, detail: { count: 2 } },
  ];
  const t = buildTimeline(logged, derived);
  assert.deepEqual(t.map((e) => `${e.step}:${e.source}`), ['cart_created:logged', 'pay_requested:logged', 'paid:derived', 'passes_issued:derived']);
  assert.equal(t[0].sincePrevMs, null);
  assert.equal(t[1].sincePrevMs, 60_000);
  assert.equal(t[2].sincePrevMs, 240_000);
  assert.equal(t[2].label, 'Paid');
  const d = timelineDurations(t);
  assert.equal(d.cartToPaid, 300_000);
  assert.equal(d.paidToNotified, null);
});

test('timeline: same-instant steps keep funnel order (paid before passes_issued)', () => {
  const at = '2026-11-01T10:00:00.000Z';
  const t = buildTimeline([
    { at, step: 'passes_issued', transactionId: null, detail: {} },
    { at, step: 'paid', transactionId: 'T1', detail: {} },
  ], []);
  assert.deepEqual(t.map((e) => e.step), ['paid', 'passes_issued']);
});

test('timeline: one check-in per pass survives dedupe', () => {
  const t = buildTimeline(
    [{ at: '2026-11-01T10:00:00Z', step: 'checked_in', transactionId: null, detail: { publicRef: 'A' } }],
    [
      { at: '2026-11-01T10:00:00Z', step: 'checked_in', transactionId: null, detail: { publicRef: 'A' } },
      { at: '2026-11-01T10:02:00Z', step: 'checked_in', transactionId: null, detail: { publicRef: 'B' } },
    ],
  );
  assert.deepEqual(t.map((e) => `${e.detail.publicRef}:${e.source}`), ['A:logged', 'B:derived']);
});

test('funnel: ordered stages with drop-off from the previous one', () => {
  const counts = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0]));
  Object.assign(counts, { event_views: 100, checkout_opened: 40, carts_created: 20, payment_started: 10, gateway_accepted: 8, paid: 6, passes_delivered: 6, checked_in: 3 });
  const f = funnelWithDropoff(counts);
  assert.deepEqual(f.map((s) => s.stage), [...FUNNEL_STAGES]);
  assert.equal(f[0].dropPct, null);
  assert.equal(f[1].dropPct, 60);
  assert.equal(f[3].dropPct, 50);
  assert.equal(f[7].dropPct, 50);
  const empty = funnelWithDropoff(Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0])));
  assert.equal(empty[1].dropPct, null); // no divide-by-zero
});

test('sanitizer: keeps the reason, drops secrets and full numbers', () => {
  const raw = 'x-bridge /collection/mobile failed: 400 {"message":"Credentials for GODIGITAL not found","token":"abc123","payer":"+255712345678"} Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig';
  const s = sanitizeGatewayError(new Error(raw));
  assert.match(s, /Credentials for GODIGITAL not found/);
  assert.match(s, /failed: 400/);
  assert.doesNotMatch(s, /abc123/);
  assert.doesNotMatch(s, /eyJhbGci/);
  assert.doesNotMatch(s, /255712345678/);
  assert.match(s, /678/);
  assert.ok(sanitizeGatewayError('x'.repeat(2000)).length <= 500);
});
