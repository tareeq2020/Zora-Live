/* BS157: one outcome per cart + the gateway capture helpers. Pure, no DB —
   build core first (`pnpm --filter @zora/core build`); we import dist. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../dist/index.js';

const {
  cartOutcome, classifyAttempt, outcomeLabel, explainOutcome, matchRecoveries, normalizeBuyerPhone,
  sanitizeGatewayPayload, extractFailureReason, extractReason, CART_OUTCOMES, CAPTURE_MAX_CHARS,
  FAILURE_REASONS, mapFailureReason,
} = core;

const NOW = Date.parse('2026-11-06T12:00:00Z');
const ago = (min) => new Date(NOW - min * 60_000).toISOString();
const out = (o) => cartOutcome({ now: NOW, createdAt: ago(600), attempts: [], ...o });
const pick = (r) => [r.outcome, r.outcomeDetail, r.recoveredBy];
const failedWith = (failureReason) => out({ status: 'failed', attempts: [{ ...ACCEPTED_FAILED, failureReason }] });

const ACCEPTED_FAILED = { status: 'failed', orderReference: 'REF-1', createdAt: ago(500) };
const REFUSED = { status: 'created', error: 'x-bridge /collection/mobile failed: 400 {"message":"Credentials for GODIGITAL not found"}', createdAt: ago(550) };
const GODIGITAL_LEGACY = { status: 'created', orderReference: null, createdAt: ago(550) }; // before errors were stored
const PAID = { status: 'successful', orderReference: 'REF-2', createdAt: ago(400) };

test('every outcome is labelled', () => {
  for (const k of CART_OUTCOMES) assert.ok(outcomeLabel(k).length > 0, k);
  assert.equal(CART_OUTCOMES.length, 12);
});

test('paid: first try', () => {
  assert.deepEqual(pick(out({ status: 'paid', attempts: [PAID] })), ['paid', null, null]);
});

test('paid_after_retry: failed → pending → paid on the same order', () => {
  assert.deepEqual(pick(out({ status: 'paid', attempts: [ACCEPTED_FAILED, PAID] })), ['paid_after_retry', null, null]);
  // a refused attempt before the paying one also counts as a retry
  assert.equal(out({ status: 'paid', attempts: [REFUSED, PAID] }).outcome, 'paid_after_retry');
  // and a timed-out push
  assert.equal(out({ status: 'paid', attempts: [{ status: 'expired', orderReference: 'R', createdAt: ago(500) }, PAID] }).outcome, 'paid_after_retry');
});

test('installment_active counts as paid', () => {
  assert.deepEqual(pick(out({ status: 'installment_active', attempts: [PAID] })), ['paid', 'installment', null]);
});

test('money states beat the attempts', () => {
  assert.equal(out({ status: 'payment_short', attempts: [{ status: 'partial', orderReference: 'R' }] }).outcome, 'underpaid');
  assert.equal(out({ status: 'paid_unseatable', attempts: [PAID] }).outcome, 'paid_unseatable');
  assert.equal(out({ status: 'refunded', attempts: [PAID] }).outcome, 'refunded');
});

test('comp and door sale come first', () => {
  assert.equal(out({ status: 'paid', type: 'comp' }).outcome, 'comp');
  assert.equal(out({ status: 'paid', channel: 'gate_cash' }).outcome, 'door_sale');
  assert.equal(out({ status: 'cancelled', channel: 'gate_mobile' }).outcome, 'door_sale');
  // a comp is never "recovered" either
  assert.equal(out({ status: 'paid', type: 'comp', recoveredBy: 'x' }).outcome, 'comp');
});

test('in_progress: pending with a live hold, an in-flight attempt, or a young cart', () => {
  assert.equal(out({ status: 'pending', holdLive: true }).outcome, 'in_progress');
  assert.equal(out({ status: 'pending', attempts: [{ status: 'pending', orderReference: 'R', createdAt: ago(5) }] }).outcome, 'in_progress');
  assert.equal(out({ status: 'pending', createdAt: ago(3) }).outcome, 'in_progress');
  // a created attempt seconds old is still being sent, not refused
  assert.equal(classifyAttempt({ status: 'created', createdAt: ago(1) }, NOW), 'in_flight');
  // pending, past its hold, nothing in flight → not in progress
  assert.equal(out({ status: 'pending', holdLive: false }).outcome, 'abandoned');
});

test('abandoned: no payment ever started', () => {
  assert.deepEqual(pick(out({ status: 'expired' })), ['abandoned', 'expired', null]);
  assert.deepEqual(pick(out({ status: 'pending', holdLive: false })), ['abandoned', 'pending', null]);
});

test('system_error: every attempt refused by the gateway', () => {
  assert.deepEqual(pick(out({ status: 'pending', attempts: [REFUSED] })), ['system_error', 'gateway_refused', null]);
  assert.deepEqual(pick(out({ status: 'expired', attempts: [REFUSED, REFUSED] })), ['system_error', 'gateway_refused', null]);
});

test('system_error: legacy GODIGITAL attempt (created, no order_reference, cart expired)', () => {
  assert.equal(classifyAttempt(GODIGITAL_LEGACY, NOW), 'refused');
  // BS159: before acceptance was tracked, the reason is honestly "not recorded"
  assert.deepEqual(pick(out({ status: 'expired', attempts: [GODIGITAL_LEGACY] })), ['system_error', 'not_recorded', null]);
  // reconcile later expired the stuck attempt: still ours, not the buyer's
  assert.equal(out({ status: 'expired', attempts: [{ status: 'expired', createdAt: ago(550) }] }).outcome, 'system_error');
});

/* ── BS159: accepted_at, the cut-over, honest refusal reasons ── */
const { refusalReason, ACCEPT_TRACKED_SINCE_MS, REFUSAL_REASONS, attemptAccepted } = core;
const NEW_NOW = ACCEPT_TRACKED_SINCE_MS + 6 * 3600_000; // after the cut-over
const newAgo = (min) => new Date(NEW_NOW - min * 60_000).toISOString();
const outNew = (o) => cartOutcome({ now: NEW_NOW, createdAt: newAgo(600), attempts: [], ...o });
const NO_PROVIDER = 'x-bridge /collection/card failed: 422 {"statusCode":422,"code":"NO_PROVIDER_FOR_METHOD","message":"No provider"}';

test('accepted_at + expired -> timed_out, never refused (even with no reference)', () => {
  const a = { status: 'expired', method: 'mobile', acceptedAt: newAgo(299), createdAt: newAgo(300) };
  assert.equal(classifyAttempt(a, NEW_NOW), 'timed_out');
  assert.deepEqual(pick(outNew({ status: 'expired', attempts: [a] })), ['buyer_didnt_complete', 'timed_out', null]);
  // with x-bridge's reason, that reason wins
  assert.deepEqual(pick(outNew({ status: 'expired', attempts: [{ ...a, failureReason: 'payer_no_response' }] })),
    ['buyer_didnt_complete', 'payer_no_response', null]);
  // a legacy-dated row with an accept is also never refused
  assert.equal(classifyAttempt({ status: 'expired', acceptedAt: ago(500), createdAt: ago(500) }, NOW), 'timed_out');
  // accepted but still 'created' is in flight, not refused
  assert.equal(classifyAttempt({ status: 'created', acceptedAt: newAgo(30), createdAt: newAgo(30) }, NEW_NOW), 'in_flight');
  assert.equal(attemptAccepted({ status: 'expired', acceptedAt: newAgo(1) }), true);
  assert.equal(attemptAccepted({ status: 'expired' }), false);
});

test('after the cut-over: no accept + no ref -> truly refused (no_gateway_reference)', () => {
  const created = { status: 'created', method: 'mobile', createdAt: newAgo(30) };
  const expired = { status: 'expired', method: 'mobile', createdAt: newAgo(30) };
  assert.equal(classifyAttempt(created, NEW_NOW), 'refused');
  assert.deepEqual(pick(outNew({ status: 'expired', attempts: [created] })), ['system_error', 'no_gateway_reference', null]);
  assert.deepEqual(pick(outNew({ status: 'expired', attempts: [expired] })), ['system_error', 'no_gateway_reference', null]);
  // a card row after the cut-over with no error is "never reached", not guessed
  assert.equal(refusalReason({ ...expired, method: 'card' }), 'no_gateway_reference');
  // the cut-over can be moved (the API reads it from config)
  assert.equal(outNew({ status: 'expired', attempts: [expired], acceptTrackedSinceMs: NEW_NOW }).outcomeDetail, 'not_recorded');
});

test('legacy rows: card -> card_unavailable, mobile/billpay -> not_recorded', () => {
  const legacy = (method, status = 'expired') => ({ status, method, createdAt: ago(550) });
  assert.deepEqual(pick(out({ status: 'expired', attempts: [legacy('card')] })), ['system_error', 'card_unavailable', null]);
  assert.deepEqual(pick(out({ status: 'expired', attempts: [legacy('mobile')] })), ['system_error', 'not_recorded', null]);
  assert.deepEqual(pick(out({ status: 'expired', attempts: [legacy('billpay', 'created')] })), ['system_error', 'not_recorded', null]);
  // the newest refused attempt names the reason
  assert.equal(out({ status: 'expired', attempts: [legacy('mobile'), legacy('card')] }).outcomeDetail, 'card_unavailable');
});

test('422 NO_PROVIDER_FOR_METHOD -> card_unavailable (method_unavailable for non-card)', () => {
  const card = { status: 'created', method: 'card', error: NO_PROVIDER, createdAt: newAgo(30) };
  assert.equal(classifyAttempt(card, NEW_NOW), 'refused');
  assert.deepEqual(pick(outNew({ status: 'expired', attempts: [card] })), ['system_error', 'card_unavailable', null]);
  assert.equal(refusalReason({ ...card, method: 'mobile' }), 'method_unavailable');
  // any other error stays gateway_refused
  assert.equal(refusalReason({ ...card, error: 'x-bridge /collection/mobile failed: 400 {"message":"bad"}' }), 'gateway_refused');
  // provider_error from x-bridge is still a system error (BS157)
  assert.deepEqual(pick(outNew({ status: 'failed', attempts: [{ status: 'failed', orderReference: 'R', failureReason: 'provider_error', createdAt: newAgo(30) }] })),
    ['system_error', 'provider_error', null]);
});

test('system_error labels and explanations name each reason', () => {
  assert.deepEqual([...REFUSAL_REASONS].sort(), ['card_unavailable', 'gateway_refused', 'method_unavailable', 'no_gateway_reference', 'not_recorded']);
  assert.equal(outcomeLabel('system_error', 'card_unavailable'), "System error: card isn't available at x-bridge");
  assert.equal(outcomeLabel('system_error', 'not_recorded'), "System error: didn't reach x-bridge; the reason wasn't recorded before 6 Nov");
  assert.equal(outcomeLabel('system_error', 'gateway_refused'), 'System error: x-bridge refused the request');
  assert.equal(outcomeLabel('system_error'), 'System error (not the buyer)');
  for (const d of REFUSAL_REASONS) {
    assert.match(explainOutcome({ outcome: 'system_error', outcomeDetail: d }), /not the buyer/i, d);
  }
  assert.match(explainOutcome({ outcome: 'system_error', outcomeDetail: 'card_unavailable' }), /Card isn't available at x-bridge/);
  assert.match(explainOutcome({ outcome: 'system_error', outcomeDetail: 'not_recorded' }), /6 Nov/);
});

test('buyer_didnt_complete: declined / timed out / x-bridge reason', () => {
  assert.deepEqual(pick(out({ status: 'failed', attempts: [ACCEPTED_FAILED] })), ['buyer_didnt_complete', 'declined', null]);
  assert.deepEqual(pick(out({ status: 'expired', attempts: [{ status: 'expired', orderReference: 'R', createdAt: ago(500) }] })),
    ['buyer_didnt_complete', 'timed_out', null]);
  // a push still "pending" on a cart whose hold lapsed: the buyer ran out of time
  assert.equal(out({ status: 'expired', attempts: [{ status: 'pending', orderReference: 'R', createdAt: ago(500) }] }).outcomeDetail, 'timed_out');
  // a free-text reason (fallback fields) is not one of x-bridge's values: unknown, raw kept
  const free = failedWith('Insufficient balance');
  assert.deepEqual(pick(free), ['buyer_didnt_complete', 'unknown', null]);
  assert.equal(free.reasonRaw, 'Insufficient balance');
  // refused then accepted-and-failed: the gateway took one, so the buyer's story wins
  assert.equal(out({ status: 'failed', attempts: [REFUSED, ACCEPTED_FAILED] }).outcome, 'buyer_didnt_complete');
  // the reason comes from the newest attempt the gateway took, not a later refusal
  assert.equal(out({ status: 'failed', attempts: [{ ...ACCEPTED_FAILED, failureReason: 'payer_cancelled' }, REFUSED] }).outcomeDetail, 'payer_cancelled');
  assert.equal(outcomeLabel('buyer_didnt_complete', 'timed_out'), "Buyer didn't complete: timed out");
});

test("x-bridge failureReason: every value maps to its outcome and words", () => {
  const want = {
    payer_no_response: ['buyer_didnt_complete', "Buyer didn't complete: timed out: no approval"],
    payer_cancelled: ['buyer_didnt_complete', "Buyer didn't complete: cancelled by buyer"],
    insufficient_funds: ['buyer_didnt_complete', "Buyer didn't complete: not enough balance"],
    wrong_pin: ['buyer_didnt_complete', "Buyer didn't complete: wrong PIN"],
    invalid_number: ['buyer_didnt_complete', "Buyer didn't complete: number can't receive mobile money"],
    unknown: ['buyer_didnt_complete', "Buyer didn't complete: declined: no reason given"],
    // a network/provider problem is not the buyer: system_error
    provider_error: ['system_error', 'System error: network/provider problem (not the buyer)'],
  };
  assert.deepEqual(Object.keys(want).sort(), [...FAILURE_REASONS].sort());
  for (const [code, [outcome, label]] of Object.entries(want)) {
    const r = failedWith(code);
    assert.equal(r.outcome, outcome, code);
    assert.equal(r.outcomeDetail, code, code);
    assert.equal(r.reasonRaw, code, code);
    assert.equal(outcomeLabel(r.outcome, r.outcomeDetail), label, code);
    assert.ok(explainOutcome(r).length > 10, code);
  }
  // a value x-bridge adds later: unknown, raw kept and shown in the explanation
  const later = failedWith('sim_swap_detected');
  assert.deepEqual([later.outcome, later.outcomeDetail, later.reasonRaw], ['buyer_didnt_complete', 'unknown', 'sim_swap_detected']);
  assert.match(explainOutcome(later), /sim_swap_detected/);
  assert.equal(mapFailureReason(' PAYER_CANCELLED '), 'payer_cancelled');
  assert.equal(mapFailureReason(null), null);
  assert.equal(mapFailureReason(''), null);
  // no reason at all (key absent today): our own words
  assert.equal(failedWith(null).outcomeDetail, 'declined');
  // our reconcile expired an accepted push with no gateway reason
  assert.equal(out({ status: 'expired', attempts: [{ status: 'expired', orderReference: 'R', createdAt: ago(500) }] }).outcomeDetail, 'timed_out');
  // x-bridge's no-response reason on an expired attempt still wins over our guess
  assert.equal(out({ status: 'expired', attempts: [{ status: 'expired', orderReference: 'R', failureReason: 'payer_no_response' }] }).outcomeDetail, 'payer_no_response');
  // provider_error on an old attempt, the buyer cancelled the newest: the buyer's story
  assert.equal(out({ status: 'failed', attempts: [{ ...ACCEPTED_FAILED, failureReason: 'provider_error' }, { ...ACCEPTED_FAILED, failureReason: 'payer_cancelled' }] }).outcome, 'buyer_didnt_complete');
  // recovered keeps the raw reason of the cart it recovers
  assert.equal(out({ status: 'failed', attempts: [{ ...ACCEPTED_FAILED, failureReason: 'wrong_pin' }], recoveredBy: 'o2' }).reasonRaw, 'wrong_pin');
});

test('installment default is the buyer not completing', () => {
  assert.deepEqual(pick(out({ status: 'installment_defaulted', attempts: [PAID] })), ['buyer_didnt_complete', 'installment_defaulted', null]);
});

test('recovered: any unpaid outcome, when the buyer paid in another cart', () => {
  assert.deepEqual(pick(out({ status: 'failed', attempts: [ACCEPTED_FAILED], recoveredBy: 'ord-2' })), ['recovered', 'buyer_didnt_complete', 'ord-2']);
  assert.deepEqual(pick(out({ status: 'expired', attempts: [GODIGITAL_LEGACY], recoveredBy: 'ord-2' })), ['recovered', 'system_error', 'ord-2']);
  assert.deepEqual(pick(out({ status: 'expired', recoveredBy: 'ord-2' })), ['recovered', 'abandoned', 'ord-2']);
  assert.deepEqual(pick(out({ status: 'pending', holdLive: true, recoveredBy: 'ord-2' })), ['recovered', 'in_progress', 'ord-2']);
  // a paid cart is never "recovered"
  assert.equal(out({ status: 'paid', attempts: [PAID], recoveredBy: 'ord-2' }).outcome, 'paid');
  assert.equal(out({ status: 'payment_short', recoveredBy: 'ord-2' }).outcome, 'underpaid');
});

test('matchRecoveries: same customer or same phone, same event, within 24h after', () => {
  const t0 = '2026-11-05T10:00:00Z';
  const carts = [
    { id: 'c1', eventId: 'e1', createdAt: t0, customerId: 'u1', phone: '0712000001' },
    { id: 'c2', eventId: 'e1', createdAt: t0, customerId: 'u2', phone: '+255 712 000 002' },
    { id: 'c3', eventId: 'e1', createdAt: t0, customerId: 'u3', phone: '0712000003' },
    { id: 'c4', eventId: 'e1', createdAt: t0, customerId: 'u4', phone: '0712000004' },
    { id: 'c5', eventId: 'e1', createdAt: t0, customerId: 'u5', phone: null },
  ];
  const paid = [
    { id: 'p1b', eventId: 'e1', createdAt: '2026-11-05T12:00:00Z', customerId: 'u1', phone: null },
    { id: 'p1a', eventId: 'e1', createdAt: '2026-11-05T11:00:00Z', customerId: 'u1', phone: null }, // earliest wins
    { id: 'p2', eventId: 'e1', createdAt: '2026-11-05T10:30:00Z', customerId: 'other', phone: '712000002' }, // phone match
    { id: 'p3', eventId: 'e2', createdAt: '2026-11-05T10:30:00Z', customerId: 'u3', phone: '0712000003' }, // other event
    { id: 'p4', eventId: 'e1', createdAt: '2026-11-06T10:00:01Z', customerId: 'u4', phone: null }, // 24h + 1s
    { id: 'p5', eventId: 'e1', createdAt: '2026-11-05T09:00:00Z', customerId: 'u5', phone: null }, // before the cart
  ];
  const m = matchRecoveries(carts, paid);
  assert.equal(m.get('c1'), 'p1a');
  assert.equal(m.get('c2'), 'p2');
  assert.equal(m.has('c3'), false);
  assert.equal(m.has('c4'), false);
  assert.equal(m.has('c5'), false);
  // a cart never recovers itself
  assert.equal(matchRecoveries([carts[0]], [{ ...carts[0] }]).size, 0);
});

test('normalizeBuyerPhone', () => {
  assert.equal(normalizeBuyerPhone('0712 000 001'), '255712000001');
  assert.equal(normalizeBuyerPhone('712000001'), '255712000001');
  assert.equal(normalizeBuyerPhone('+255712000001'), '255712000001');
  assert.equal(normalizeBuyerPhone('comp:1234567890'), null);
  assert.equal(normalizeBuyerPhone('12'), null);
});

test('explainOutcome gives one line for every outcome', () => {
  for (const k of CART_OUTCOMES) assert.ok(explainOutcome({ outcome: k, outcomeDetail: 'declined' }).length > 10, k);
  assert.match(explainOutcome({ outcome: 'system_error', outcomeDetail: 'gateway_refused' }), /not the buyer/);
  assert.match(explainOutcome({ outcome: 'paid_after_retry' }, [ACCEPTED_FAILED, REFUSED, PAID]), /2 failed attempts/);
});

/* ── capture helpers ── */

test('sanitizeGatewayPayload: secrets redacted, phones masked, size capped', () => {
  const body = {
    event: 'collection.updated', transactionId: 'ZORA-1-1', status: 'FAILED',
    payerPhone: '+255712345678', msisdn: 255712345678, apiKey: 'k-123', signature: 'abc', token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig',
    nested: { secret: 's', note: 'call 0712345678 now', authorization: 'Bearer abc.def' },
    message: 'Bearer abcdef123',
  };
  const s = sanitizeGatewayPayload(JSON.stringify(body));
  const j = JSON.stringify(s);
  for (const leak of ['k-123', '"abc"', 'eyJhbGci', '712345678', 'abcdef123', 'abc.def']) assert.ok(!j.includes(leak), leak);
  assert.equal(s.payerPhone, '**********678');
  assert.equal(s.msisdn, '*********678');
  assert.equal(s.apiKey, '[redacted]');
  assert.equal(s.nested.secret, '[redacted]');
  assert.equal(s.status, 'FAILED');
  assert.equal(s.transactionId, 'ZORA-1-1');
  const big = sanitizeGatewayPayload({ rows: Array.from({ length: 50 }, (_, i) => ({ i, pad: 'x'.repeat(900) })) });
  assert.equal(big.truncated, true);
  assert.ok(JSON.stringify(big).length <= CAPTURE_MAX_CHARS);
  assert.deepEqual(Object.keys(sanitizeGatewayPayload('not json 0712345678')), ['raw']);
  assert.ok(!sanitizeGatewayPayload('not json 0712345678').raw.includes('712345678'));
});

test('extractReason: x-bridge failureReason first, generic fields only when the key is absent', () => {
  for (const code of FAILURE_REASONS) {
    // status reply and collection.updated callback carry it next to status
    assert.deepEqual(extractReason({ transactionId: 't', status: 'FAILED', failureReason: code }), { reason: code, structured: true });
    assert.deepEqual(extractReason(JSON.stringify({ event: 'collection.updated', transactionId: 't', status: 'FAILED', failureReason: code })),
      { reason: code, structured: true });
  }
  // unrecognised value: stored raw
  assert.deepEqual(extractReason({ status: 'FAILED', failureReason: 'sim_swap_detected' }), { reason: 'sim_swap_detected', structured: true });
  // key present and null (any other status, or FAILED with none): no reason, no guessing
  assert.equal(extractReason({ status: 'PENDING', failureReason: null, message: 'Waiting for PIN' }), null);
  assert.equal(extractReason({ status: 'FAILED', failureReason: null, message: 'Wrong PIN' }), null);
  assert.equal(extractReason({ status: 'COMPLETED', failureReason: null }), null);
  // key absent (x-bridge today): fallback fields
  assert.deepEqual(extractReason({ status: 'FAILED', resultDesc: 'Request cancelled by user' }), { reason: 'Request cancelled by user', structured: false });
});

test('extractFailureReason: reason-like fields, none on success', () => {
  assert.equal(extractFailureReason({ status: 'FAILED', reason: 'Insufficient balance' }), 'Insufficient balance');
  assert.equal(extractFailureReason({ status: 'FAILED', resultDesc: 'Request cancelled by user' }), 'Request cancelled by user');
  assert.equal(extractFailureReason({ status: 'FAILED', gatewayResponse: { statusDescription: 'Timeout at MNO' } }), 'Timeout at MNO');
  assert.equal(extractFailureReason({ status: 'FAILED', fspStatus: 'FAILED', message: 'Wrong PIN' }), 'Wrong PIN');
  assert.equal(extractFailureReason({ status: 'COMPLETED', message: 'Paid but weird' }), null);
  assert.equal(extractFailureReason({ status: 'FAILED' }), null);
  assert.equal(extractFailureReason({ status: 'FAILED', message: 'failed' }), null);
  assert.ok(!extractFailureReason({ status: 'FAILED', reason: 'number 0712345678 blocked' }).includes('712345678'));
  assert.equal(extractFailureReason('{"status":"FAILED","failureReason":"Declined"}'), 'Declined');
  assert.equal(extractFailureReason({ status: 'FAILED', failure_reason: 'Declined' }), 'Declined');
  assert.equal(extractFailureReason('nope'), null);
});
