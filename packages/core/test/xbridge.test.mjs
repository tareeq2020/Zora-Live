/* PR-8 tests: pure FSP routing/fee + x-bridge adapter (no live gateway).
   Build core first (`pnpm --filter "@zora/core..." build`) — we import dist. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeMsisdn,
  cardCheckoutUrl,
  resolveFsp,
  feeRateForFsp,
  DEFAULT_FSP_ROUTE_MAP,
  DEFAULT_FEE_RATE,
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

/* ── resolveFsp ───────────────────────────────────────────────────────── */

test('resolveFsp: precedence mno → default → CLICKPESA fallback', () => {
  const map = { mobile: { VODACOM: 'SELCOM', default: 'GODIGITAL' } };
  assert.equal(resolveFsp(map, 'mobile', 'VODACOM'), 'SELCOM'); // mno wins
  assert.equal(resolveFsp(map, 'mobile', 'AIRTEL'), 'GODIGITAL'); // unknown mno → default
  assert.equal(resolveFsp(map, 'mobile'), 'GODIGITAL'); // no mno → default
  assert.equal(resolveFsp({}, 'mobile'), 'CLICKPESA'); // nothing → hard fallback
});

test('resolveFsp: defaults map routes as documented', () => {
  assert.equal(resolveFsp(DEFAULT_FSP_ROUTE_MAP, 'mobile'), 'CLICKPESA');
  assert.equal(resolveFsp(DEFAULT_FSP_ROUTE_MAP, 'billpay'), 'CLICKPESA');
  assert.equal(resolveFsp(DEFAULT_FSP_ROUTE_MAP, 'card'), 'SELCOM');
});

test('resolveFsp: GODIGITAL capability failover (only mobile is supported)', () => {
  const map = { card: { default: 'GODIGITAL' }, billpay: { default: 'GODIGITAL' }, mobile: { default: 'GODIGITAL' } };
  assert.equal(resolveFsp(map, 'card'), 'SELCOM'); // card → SELCOM
  assert.equal(resolveFsp(map, 'billpay'), 'CLICKPESA'); // billpay → CLICKPESA
  assert.equal(resolveFsp(map, 'mobile'), 'GODIGITAL'); // mobile keeps GODIGITAL
});

/* ── feeRateForFsp ────────────────────────────────────────────────────── */

test('feeRateForFsp: non-negative numeric override wins, else base', () => {
  assert.equal(feeRateForFsp({ SELCOM: 0.025 }, DEFAULT_FEE_RATE, 'SELCOM'), 0.025);
  assert.equal(feeRateForFsp({ SELCOM: 0 }, DEFAULT_FEE_RATE, 'SELCOM'), 0); // 0 is valid
  assert.equal(feeRateForFsp({}, DEFAULT_FEE_RATE, 'SELCOM'), DEFAULT_FEE_RATE); // missing → base
  assert.equal(feeRateForFsp({ SELCOM: -1 }, DEFAULT_FEE_RATE, 'SELCOM'), DEFAULT_FEE_RATE); // negative → base
});

/* ── MOCK mode: collect* / collectionStatus return shapes ─────────────── */

function mockCfg() {
  return xbridgeConfig({ XBRIDGE_MOCK: 'true' });
}

test('mock collectMobile shape', async () => {
  const r = await collectMobile(
    { transactionId: 'T1', amount: 5000, payerPhone: '+255712345678', fspId: 'CLICKPESA', callbackUrl: 'https://cb' },
    mockCfg(),
  );
  assert.deepEqual(r, { orderReference: 'MOCK-T1', gatewayResponse: { status: 'PENDING' } });
});

test('mock collectBillPay shape', async () => {
  const r = await collectBillPay(
    { transactionId: 'T2', amount: 5000, payerName: 'A', payerPhone: '+255712345678', fspId: 'CLICKPESA', callbackUrl: 'https://cb' },
    mockCfg(),
  );
  assert.deepEqual(r, { billPayNumber: 'MOCK-CN', orderReference: 'MOCK-T2' });
});

test('mock collectCard shape yields a checkout url', async () => {
  const r = await collectCard(
    { fspId: 'SELCOM', transactionId: 'T3', amount: 5000, noOfItems: 1, buyer: {}, billing: {}, redirectUrl: 'r', cancelUrl: 'c' },
    mockCfg(),
  );
  assert.equal(r.paymentGatewayUrl, 'https://mock/checkout');
  assert.equal(cardCheckoutUrl(r), 'https://mock/checkout');
  assert.equal(r.orderReference, 'MOCK-T3');
});

test('mock collectionStatus default COMPLETED with amount == collectedAmount', async () => {
  const r = await collectionStatus('T4', 'CLICKPESA', mockCfg());
  assert.equal(r.status, 'COMPLETED');
  assert.equal(r.amount, r.collectedAmount);
  assert.equal(r.transactionId, 'T4');
});

test('mock collectionStatus is steerable for the state machine', async () => {
  __setMockCollectionStatus('T5', { status: 'PARTIAL', amount: '5000', collectedAmount: '2000' });
  const r = await collectionStatus('T5', 'CLICKPESA', mockCfg());
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.amount, '5000');
  assert.equal(r.collectedAmount, '2000');
  __clearMockCollectionStatus();
});

/* ── Real path (stubbed fetch): paymentMode only for CLICKPESA ────────── */

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
    bodies.push({ url: String(url), body: JSON.parse(init.body) });
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

test('collectBillPay: paymentMode (EXACT) sent ONLY for CLICKPESA', async () => {
  const bodies = [];
  await withFetchStub(bodies, async () => {
    const cfg = realCfg();
    await collectBillPay(
      { transactionId: 'C1', amount: 5000, payerName: 'A', payerPhone: '+255712345678', fspId: 'CLICKPESA', callbackUrl: 'cb', paymentMode: 'EXACT' },
      cfg,
    );
    await collectBillPay(
      { transactionId: 'S1', amount: 5000, payerName: 'A', payerPhone: '+255712345678', fspId: 'SELCOM', callbackUrl: 'cb', paymentMode: 'EXACT' },
      cfg,
    );
  });

  const clickpesa = bodies.find((b) => b.body.transactionId === 'C1').body;
  const selcom = bodies.find((b) => b.body.transactionId === 'S1').body;

  assert.equal(clickpesa.paymentMode, 'EXACT'); // CLICKPESA carries it
  assert.equal('paymentMode' in selcom, false); // Selcom must NOT (it 400s on it)
  // Shared contract fields present + currency injected.
  assert.equal(clickpesa.currency, 'TZS');
  assert.equal(clickpesa.callback_url, 'cb');
});

test('collectBillPay: response reads orderReference ?? reference', async () => {
  const bodies = [];
  let out;
  await withFetchStub(bodies, async () => {
    out = await collectBillPay(
      { transactionId: 'C2', amount: 5000, payerName: 'A', payerPhone: '+255712345678', fspId: 'CLICKPESA', callbackUrl: 'cb' },
      realCfg(),
    );
  });
  assert.equal(out.billPayNumber, 'CN-1');
  assert.equal(out.orderReference, 'REF-1'); // fell through to `reference`
});
