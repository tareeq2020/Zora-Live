/* BS160: the organizer's view of a cart. Pure, no DB — build core first
   (`pnpm --filter @zora/core build`); we import dist. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../dist/index.js';

const {
  organizerOutcome, organizerExplanation, organizerStage, organizerTimeline, attemptFailureLabel, buildTimeline,
  ORG_SYSTEM_ERROR_LABEL, ORG_FUNNEL_STAGES,
} = core;

test('system error: generic words, no sub-reason', () => {
  for (const d of ['gateway_refused', 'no_gateway_reference', 'provider_error']) {
    const v = organizerOutcome({ outcome: 'system_error', outcomeDetail: d });
    assert.deepEqual(v, { outcome: 'system_error', outcomeLabel: ORG_SYSTEM_ERROR_LABEL, outcomeDetail: null });
    assert.doesNotMatch(organizerExplanation({ outcome: 'system_error', outcomeDetail: d }), /gateway|x-bridge|integration|error/i);
  }
});

test('buyer reasons keep the core label and explanation', () => {
  const v = organizerOutcome({ outcome: 'buyer_didnt_complete', outcomeDetail: 'insufficient_funds' });
  assert.equal(v.outcomeLabel, "Buyer didn't complete: not enough balance");
  assert.equal(v.outcomeDetail, 'insufficient_funds');
  assert.equal(organizerExplanation({ outcome: 'buyer_didnt_complete', outcomeDetail: 'payer_cancelled' }), 'The buyer cancelled the payment prompt.');
});

test('no explanation mentions our plumbing', () => {
  const cases = [
    ['paid', null], ['paid', 'installment'], ['paid_after_retry', null], ['recovered', 'system_error'], ['in_progress', null],
    ['abandoned', 'expired'], ['buyer_didnt_complete', 'timed_out'], ['buyer_didnt_complete', 'declined'],
    ['buyer_didnt_complete', 'unknown'], ['buyer_didnt_complete', 'something_new'], ['underpaid', null],
    ['paid_unseatable', null], ['refunded', null], ['comp', null], ['door_sale', null], ['brand_new_outcome', null],
  ];
  for (const [outcome, outcomeDetail] of cases) {
    const t = organizerExplanation({ outcome, outcomeDetail });
    assert.ok(t.length > 0, outcome);
    assert.doesNotMatch(t, /gateway|x-bridge|integration|\bops\b|error|admin/i, `${outcome}: ${t}`);
  }
});

test('recovered and abandoned lose their internal detail', () => {
  assert.equal(organizerOutcome({ outcome: 'recovered', outcomeDetail: 'system_error' }).outcomeDetail, null);
  assert.equal(organizerOutcome({ outcome: 'abandoned', outcomeDetail: 'expired' }).outcomeDetail, null);
});

test('stage: gateway_accepted reads as payment_started', () => {
  assert.equal(organizerStage('gateway_accepted'), 'payment_started');
  assert.equal(organizerStage('paid'), 'paid');
  assert.ok(!ORG_FUNNEL_STAGES.includes('gateway_accepted'));
});

test('attempt failure label: buyer reason vs system', () => {
  assert.equal(attemptFailureLabel({ status: 'failed', orderReference: 'R', failureReason: 'payer_cancelled' }), 'Payment failed: cancelled by buyer');
  assert.equal(attemptFailureLabel({ status: 'created', error: 'x-bridge 400 boom' }), ORG_SYSTEM_ERROR_LABEL);
  assert.equal(attemptFailureLabel({ status: 'failed', orderReference: 'R', failureReason: 'provider_error' }), ORG_SYSTEM_ERROR_LABEL);
});

const T = (m) => new Date(Date.UTC(2026, 10, 1, 10, m)).toISOString();

test('timeline: retries collapse, earlier failures drop once paid, no ids or detail', () => {
  const attempts = [
    { transactionId: 'ZORA-x-1', status: 'failed', orderReference: 'R1', failureReason: 'insufficient_funds', createdAt: T(1) },
    { transactionId: 'ZORA-x-2', status: 'created', error: 'x-bridge 500', createdAt: T(3) },
    { transactionId: 'ZORA-x-3', status: 'successful', orderReference: 'R3', createdAt: T(5) },
  ];
  const logged = [
    { at: T(0), step: 'cart_created', transactionId: null, detail: {} },
    { at: T(1), step: 'pay_requested', transactionId: 'ZORA-x-1', detail: { method: 'mobile' } },
    { at: T(1), step: 'gateway_accepted', transactionId: 'ZORA-x-1', detail: { orderReference: 'R1' } },
    { at: T(2), step: 'callback_received', transactionId: 'ZORA-x-1', detail: {} },
    { at: T(2), step: 'failed', transactionId: 'ZORA-x-1', detail: {} },
    { at: T(2), step: 'hold_released', transactionId: 'ZORA-x-1', detail: {} },
    { at: T(3), step: 'admin_push_requested', transactionId: null, detail: { by: 'ops' } },
    { at: T(3), step: 'pay_requested', transactionId: 'ZORA-x-2', detail: { by: 'ops' } },
    { at: T(3), step: 'gateway_rejected', transactionId: 'ZORA-x-2', detail: { error: 'x-bridge 500' } },
    { at: T(5), step: 'pay_requested', transactionId: 'ZORA-x-3', detail: {} },
    { at: T(6), step: 'paid', transactionId: 'ZORA-x-3', detail: {} },
    { at: T(6), step: 'passes_issued', transactionId: null, detail: { count: 2 } },
    { at: T(7), step: 'buyer_notified', transactionId: null, detail: {} },
    { at: T(50), step: 'checked_in', transactionId: null, detail: { publicRef: 'A' } },
    { at: T(51), step: 'checked_in', transactionId: null, detail: { publicRef: 'B' } },
  ];
  const out = organizerTimeline(buildTimeline(logged, []), attempts);
  assert.deepEqual(out.map((e) => e.step), ['cart_created', 'pay_requested', 'paid', 'passes_issued', 'buyer_notified', 'checked_in']);
  assert.equal(out[1].label, 'Payment tried 3 times');
  assert.equal(out[3].label, 'Passes sent');
  assert.equal(out[5].label, 'Checked in (2 passes)');
  for (const e of out) assert.deepEqual(Object.keys(e).sort(), ['at', 'label', 'step']);
  assert.doesNotMatch(JSON.stringify(out), /ZORA-|R1|admin|gateway|error|ops/i);
});

test('timeline: unpaid cart keeps only the last failure, with the buyer reason', () => {
  const attempts = [
    { transactionId: 't1', status: 'expired', orderReference: 'R1', createdAt: T(1) },
    { transactionId: 't2', status: 'failed', orderReference: 'R2', failureReason: 'payer_cancelled', createdAt: T(3) },
  ];
  const derived = [
    { at: T(0), step: 'cart_created', transactionId: null, detail: {} },
    { at: T(1), step: 'pay_requested', transactionId: 't1', detail: {} },
    { at: T(2), step: 'status_changed', transactionId: 't1', detail: { to: 'expired' } },
    { at: T(3), step: 'pay_requested', transactionId: 't2', detail: {} },
    { at: T(4), step: 'failed', transactionId: 't2', detail: {} },
  ];
  const out = organizerTimeline(buildTimeline([], derived), attempts);
  assert.deepEqual(out.map((e) => [e.step, e.label]), [
    ['cart_created', 'Cart created'],
    ['pay_requested', 'Payment tried 2 times'],
    ['failed', 'Payment failed: cancelled by buyer'],
  ]);
});

test('timeline: one attempt says Payment started; a refused one reads as ours', () => {
  const attempts = [{ transactionId: 't1', status: 'created', error: 'boom', createdAt: T(1) }];
  const derived = [
    { at: T(0), step: 'cart_created', transactionId: null, detail: {} },
    { at: T(1), step: 'pay_requested', transactionId: 't1', detail: {} },
    { at: T(1), step: 'gateway_rejected', transactionId: 't1', detail: { error: 'boom' } },
    { at: T(20), step: 'expired', transactionId: null, detail: {} },
  ];
  const out = organizerTimeline(buildTimeline([], derived), attempts);
  assert.deepEqual(out.map((e) => [e.step, e.label]), [
    ['cart_created', 'Cart created'], ['pay_requested', 'Payment started'], ['failed', ORG_SYSTEM_ERROR_LABEL], ['expired', 'Cart expired'],
  ]);
});
