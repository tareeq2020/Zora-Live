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
