/* PR-8 tests: x-bridge adapter (no live gateway). BS150: we never name a provider.
   Build core first (`pnpm --filter "@zora/core..." build`) — we import dist. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeMsisdn,
  cardCheckoutUrl,
  BILLPAY_CONNECTION,
  collectMobile,
  collectBillPay,
  collectCard,
  collectionStatus,
  xbridgeConfig,
  __resetTokenCache,
  __setMockCollectionStatus,
  __clearMockCollectionStatus,
} from '../dist/index.js';

/* ── normalizeMsisdn ──────────────────────────────────────────────────── */

test('normalizeMsisdn: leading 0 → +255', () => {
  assert.equal(normalizeMsisdn('0712345678'), '+255712345678');
});

test('normalizeMsisdn: 255-prefixed stays, gains +', () => {
  assert.equal(normalizeMsisdn('255712345678'), '+255712345678');
});

test('normalizeMsisdn: strips spaces/punctuation and keeps the +', () => {
  assert.equal(normalizeMsisdn('+255 712-345-678'), '+255712345678');
  assert.equal(normalizeMsisdn('0712 345 678'), '+255712345678');
});

/* ── cardCheckoutUrl ──────────────────────────────────────────────────── */

test('cardCheckoutUrl: prefers cardPaymentLink, else paymentGatewayUrl', () => {
  assert.equal(cardCheckoutUrl({ cardPaymentLink: 'a', paymentGatewayUrl: 'b' }), 'a');
  assert.equal(cardCheckoutUrl({ paymentGatewayUrl: 'b' }), 'b');
  assert.equal(cardCheckoutUrl({}), undefined);
});

/* ── MOCK mode: collect* / collectionStatus return shapes ─────────────── */

function mockCfg() {
  return xbridgeConfig({ XBRIDGE_MOCK: 'true' });
}

test('mock collectMobile shape', async () => {
  const r = await collectMobile(
    { transactionId: 'T1', amount: 5000, payerPhone: '+255712345678', callbackUrl: 'https://cb' },
    mockCfg(),
  );
  assert.deepEqual(r, { orderReference: 'MOCK-T1', gatewayResponse: { status: 'PENDING' } });
});

test('mock collectBillPay shape', async () => {
  const r = await collectBillPay(
    { transactionId: 'T2', amount: 5000, payerName: 'A', payerPhone: '+255712345678', callbackUrl: 'https://cb' },
    mockCfg(),
  );
  assert.deepEqual(r, { billPayNumber: 'MOCK-CN', orderReference: 'MOCK-T2' });
});

test('mock collectCard shape yields a checkout url', async () => {
  const r = await collectCard(
    { transactionId: 'T3', amount: 5000, noOfItems: 1, buyer: {}, billing: {}, redirectUrl: 'r', cancelUrl: 'c' },
    mockCfg(),
  );
  assert.equal(r.paymentGatewayUrl, 'https://mock/checkout');
  assert.equal(cardCheckoutUrl(r), 'https://mock/checkout');
  assert.equal(r.orderReference, 'MOCK-T3');
});

test('mock collectionStatus default COMPLETED with amount == collectedAmount', async () => {
  const r = await collectionStatus('T4', mockCfg());
  assert.equal(r.status, 'COMPLETED');
  assert.equal(r.amount, r.collectedAmount);
  assert.equal(r.transactionId, 'T4');
});

test('mock collectionStatus is steerable for the state machine', async () => {
  __setMockCollectionStatus('T5', { status: 'PARTIAL', amount: '5000', collectedAmount: '2000' });
  const r = await collectionStatus('T5', mockCfg());
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.amount, '5000');
  assert.equal(r.collectedAmount, '2000');
  __clearMockCollectionStatus();
});

/* ── Real path (stubbed fetch): what goes over the wire ──────────────── */

async function withFetchStub(bodies, fn) {
  const orig = globalThis.fetch;
  __resetTokenCache();
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/generate-token')) {
      return new Response(
        JSON.stringify({ token: 'tok', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    bodies.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return new Response(
      JSON.stringify({ billPayNumber: 'CN-1', reference: 'REF-1' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = orig;
    __resetTokenCache();
  }
}

function realCfg() {
  // keyId present + mock off ⇒ real HTTP path (which our stub intercepts).
  return xbridgeConfig({ XBRIDGE_KEY_ID: 'k', XBRIDGE_SECRET: 's', XBRIDGE_MOCK: 'false' });
}

test('mobile push, card checkout and status read never name a provider (x-bridge routes by method)', async () => {
  const bodies = [];
  await withFetchStub(bodies, async () => {
    const cfg = realCfg();
    await collectMobile({ transactionId: 'M1', amount: 5000, payerPhone: '+255712345678', callbackUrl: 'cb' }, cfg);
    await collectCard({ transactionId: 'K1', amount: 5000, noOfItems: 1, buyer: {}, billing: {}, redirectUrl: 'r', cancelUrl: 'c' }, cfg);
    await collectionStatus('M1', cfg);
  });
  const mobile = bodies.find((b) => b.url.endsWith('/collection/mobile')).body;
  const card = bodies.find((b) => b.url.endsWith('/collection/card')).body;
  const status = bodies.find((b) => b.url.includes('/collection/status'));
  assert.equal('fspId' in mobile, false);
  assert.equal('fspId' in card, false);
  assert.equal(status.url.includes('fspId'), false);
  assert.equal(mobile.currency, 'TZS');
  assert.equal(mobile.callback_url, 'cb');
});

test('collectBillPay: sends the pinned connection x-bridge still requires, plus paymentMode', async () => {
  const bodies = [];
  await withFetchStub(bodies, async () => {
    await collectBillPay(
      { transactionId: 'C1', amount: 5000, payerName: 'A', payerPhone: '+255712345678', callbackUrl: 'cb', paymentMode: 'EXACT' },
      realCfg(),
    );
  });
  const body = bodies.find((b) => b.body?.transactionId === 'C1').body;
  assert.equal(body.fspId, BILLPAY_CONNECTION);
  assert.equal(body.paymentMode, 'EXACT');
  assert.equal(body.currency, 'TZS');
});

test('collectBillPay: response reads orderReference ?? reference', async () => {
  const bodies = [];
  let out;
  await withFetchStub(bodies, async () => {
    out = await collectBillPay(
      { transactionId: 'C2', amount: 5000, payerName: 'A', payerPhone: '+255712345678', callbackUrl: 'cb' },
      realCfg(),
    );
  });
  assert.equal(out.billPayNumber, 'CN-1');
  assert.equal(out.orderReference, 'REF-1'); // fell through to `reference`
});

/* ── BS166: /v1 card, signature, helpers ─────────────────────────────── */
import {
  verifyXbridgeSignature, signXbridgeWebhook, missingBillingFields, receivedAmount, cardAvailability,
  createCardCheckout, statusForAttempt, mapStatus, xbridgeV1Config,
} from '../dist/index.js';

test('signature: valid, rotated, stale, future, tampered, missing timestamp', () => {
  const raw = '{"eventId":"e1","event":"payment.received"}';
  const now = Date.now();
  const ts = String(Math.floor(now / 1000));
  const sig = signXbridgeWebhook(raw, 's3cret', ts);
  assert.equal(verifyXbridgeSignature(raw, { 'x-bridge-signature': sig, 'x-bridge-timestamp': ts }, 's3cret', now), 'ok');
  assert.equal(verifyXbridgeSignature(raw, { 'x-bridge-signature': 'v1=' + 'a'.repeat(64) + ', ' + sig, 'x-bridge-timestamp': ts }, 's3cret', now), 'ok');
  assert.equal(verifyXbridgeSignature(raw, { 'x-bridge-signature': sig, 'x-bridge-timestamp': ts }, 's3cret', now + 301_000), 'stale');
  assert.equal(verifyXbridgeSignature(raw, { 'x-bridge-signature': sig, 'x-bridge-timestamp': ts }, 's3cret', now - 61_000), 'stale');
  assert.equal(verifyXbridgeSignature(raw + ' ', { 'x-bridge-signature': sig, 'x-bridge-timestamp': ts }, 's3cret', now), 'bad_signature');
  assert.equal(verifyXbridgeSignature(raw, { 'x-bridge-signature': sig }, 's3cret', now), 'bad_timestamp');
  assert.equal(verifyXbridgeSignature(raw, {}, 's3cret', now), 'no_signature');
});

test('missingBillingFields: all required but address2; country must be 2 letters', () => {
  assert.deepEqual(missingBillingFields(null).length, 8);
  const full = { firstname: 'A', lastname: 'M', address1: 'Plot 1', city: 'Dar', stateOrRegion: 'Dar', postcodeOrPobox: '11101', country: 'TZ', phone: '+255712345678' };
  assert.deepEqual(missingBillingFields(full), []);
  assert.deepEqual(missingBillingFields({ ...full, city: ' ' }), ['city']);
  assert.deepEqual(missingBillingFields({ ...full, country: 'Tanzania' }), ['country']);
});

test('receivedAmount: value, minor units, flat', () => {
  assert.deepEqual(receivedAmount({ amount: { currency: 'TZS', amountMinor: 100000, exponent: 2, value: '1000.00' } }), { value: 1000, currency: 'TZS' });
  assert.deepEqual(receivedAmount({ amount: { currency: 'TZS', amountMinor: 250000, exponent: 2 } }), { value: 2500, currency: 'TZS' });
  assert.deepEqual(receivedAmount({ amount: '500', currency: 'TZS' }), { value: 500, currency: 'TZS' });
});

test('mapStatus: EXPIRED and AUTH_PENDING_REVIEW are not final', () => {
  assert.equal(mapStatus({ transactionId: 't', status: 'EXPIRED' }), 'pending');
  assert.equal(mapStatus({ transactionId: 't', status: 'AUTH_PENDING_REVIEW' }), 'pending');
});

test('v1 config: base URL drops a trailing /api', () => {
  assert.equal(xbridgeV1Config({ XBRIDGE_BASE_URL: 'https://api.xbridge.co.tz/api', XBRIDGE_KEY_ID: 'k' }).baseUrl, 'https://api.xbridge.co.tz');
  assert.equal(xbridgeV1Config({ XBRIDGE_BASE_URL: 'https://api.xbridge.co.tz/api', XBRIDGE_V1_BASE_URL: 'https://x.test/' }).baseUrl, 'https://x.test');
});

test('mock card: availability, refusals, page', async () => {
  const prev = { ...process.env };
  process.env.XBRIDGE_MOCK = 'true';
  const a = await cardAvailability('TZS');
  assert.equal(a.available, true);
  assert.equal(a.billingRequired, true);
  await assert.rejects(createCardCheckout({ transactionId: 'T1', amount: 1000, buyer: { name: 'A', email: 'a@x.co', phone: '+255712345678' }, redirectUrl: 'https://w/r', cancelUrl: 'https://w/c' }),
    (e) => e.code === 'BILLING_ADDRESS_REQUIRED' && e.status === 400);
  const billing = { firstname: 'A', lastname: 'M', address1: 'Plot 1', city: 'Dar', stateOrRegion: 'Dar', postcodeOrPobox: '11101', country: 'TZ', phone: '+255712345678' };
  const r = await createCardCheckout({ transactionId: 'T1', amount: 1000, buyer: { name: 'A', email: 'a@x.co', phone: '+255712345678' }, billing, redirectUrl: 'https://w/r?x=1', cancelUrl: 'https://w/c' });
  assert.equal(r.paymentUrl, 'https://w/r?x=1&mockcard=1');
  assert.equal(r.orderReference, 'MOCK-CARD-T1');
  process.env.XBRIDGE_MOCK_CARD = '0';
  assert.equal((await cardAvailability('TZS')).available, false);
  process.env = prev;
});

test('statusForAttempt: card (/v1) and legacy both answer in mock', async () => {
  process.env.XBRIDGE_MOCK = 'true';
  __setMockCollectionStatus('V1-T', { status: 'EXPIRED' });
  assert.equal((await statusForAttempt('V1-T', 'xbridge_v1c')).status, 'EXPIRED');
  assert.equal((await statusForAttempt('V1-T', null)).status, 'EXPIRED');
  __clearMockCollectionStatus();
});
