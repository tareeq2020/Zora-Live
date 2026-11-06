/* BS158: MOCK mode answers x-bridge's sandbox test numbers like the sandbox, and
   the admin push phone rules. Build core first — we import dist. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectMobile,
  collectionStatus,
  __setMockCollectionStatus,
  __clearMockCollectionStatus,
  __setMockSandboxDelay,
  sandboxOutcomeFor,
  SANDBOX_FAIL_NUMBERS,
  SANDBOX_OK_NUMBER,
  tanzanianMobile,
  maskPhone,
  mapStatus,
} from '../dist/index.js';

const MOCK = { baseUrl: 'http://x', mock: true };
const LIVE_LOOKING = { baseUrl: 'http://127.0.0.1:9', keyId: 'k', secret: 's', mock: false };
let seq = 0;
const txId = () => `SBX-${process.pid}-${++seq}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EXPECTED = {
  '+255700003301': 'payer_no_response',
  '+255700003302': 'payer_cancelled',
  '+255700003303': 'insufficient_funds',
  '+255700003304': 'wrong_pin',
  '+255700003305': 'invalid_number',
  '+255700003306': 'provider_error',
  '+255700003307': 'unknown',
  '+255700002222': 'payer_cancelled',
};

test('the sandbox number table is exactly the published one', () => {
  assert.deepEqual({ ...SANDBOX_FAIL_NUMBERS }, EXPECTED);
  assert.equal(SANDBOX_OK_NUMBER, '+255700001111');
});

test('sandboxOutcomeFor matches on the last 9 digits, any format', () => {
  assert.deepEqual(sandboxOutcomeFor('0700003304'), { status: 'FAILED', failureReason: 'wrong_pin' });
  assert.deepEqual(sandboxOutcomeFor('+255 700 001 111'), { status: 'COMPLETED', failureReason: null });
  assert.equal(sandboxOutcomeFor('+255712345678'), null);
  assert.equal(sandboxOutcomeFor(''), null);
});

test('fail numbers: PENDING right after the push, then FAILED with the reason', async () => {
  __clearMockCollectionStatus();
  __setMockSandboxDelay(150);
  const ids = {};
  for (const phone of Object.keys(EXPECTED)) {
    const id = txId();
    ids[phone] = id;
    const r = await collectMobile({ transactionId: id, amount: 1000, payerPhone: phone, callbackUrl: 'http://cb' }, MOCK);
    assert.equal(r.gatewayResponse.status, 'PENDING');
    const s = await collectionStatus(id, MOCK);
    assert.equal(s.status, 'PENDING', phone);
    assert.equal(s.failureReason, null);
    assert.equal(mapStatus(s), 'pending');
  }
  await sleep(200);
  for (const [phone, reason] of Object.entries(EXPECTED)) {
    const s = await collectionStatus(ids[phone], MOCK);
    assert.equal(s.status, 'FAILED', phone);
    assert.equal(s.failureReason, reason, phone);
    assert.equal(mapStatus(s), 'failed');
  }
  __setMockSandboxDelay(3000);
});

test('the default delay is about 3 s', async () => {
  __clearMockCollectionStatus();
  __setMockSandboxDelay(3000);
  const id = txId();
  await collectMobile({ transactionId: id, amount: 1000, payerPhone: '+255700003301', callbackUrl: 'http://cb' }, MOCK);
  await sleep(50);
  assert.equal((await collectionStatus(id, MOCK)).status, 'PENDING');
});

test('1111: COMPLETED for the pushed amount, failureReason null', async () => {
  __clearMockCollectionStatus();
  const id = txId();
  await collectMobile({ transactionId: id, amount: 35000, payerPhone: '0700001111', callbackUrl: 'http://cb' }, MOCK);
  const s = await collectionStatus(id, MOCK);
  assert.equal(s.status, 'COMPLETED');
  assert.equal(s.failureReason, null);
  assert.equal(s.amount, '35000');
  assert.equal(s.collectedAmount, '35000');
  assert.equal(mapStatus(s), 'successful');
});

test('other numbers keep the old mock default (COMPLETED 1000, no failureReason key)', async () => {
  __clearMockCollectionStatus();
  const id = txId();
  await collectMobile({ transactionId: id, amount: 35000, payerPhone: '0712345678', callbackUrl: 'http://cb' }, MOCK);
  const s = await collectionStatus(id, MOCK);
  assert.equal(s.status, 'COMPLETED');
  assert.equal(s.amount, '1000');
  assert.equal('failureReason' in s, false);
});

test('a forced status still wins over the sandbox number', async () => {
  __clearMockCollectionStatus();
  __setMockSandboxDelay(0);
  const id = txId();
  await collectMobile({ transactionId: id, amount: 1000, payerPhone: '+255700003301', callbackUrl: 'http://cb' }, MOCK);
  __setMockCollectionStatus(id, { status: 'PARTIAL', amount: '1000', collectedAmount: '400' });
  assert.equal((await collectionStatus(id, MOCK)).status, 'PARTIAL');
  __setMockSandboxDelay(3000);
});

test('XBRIDGE_MOCK_STATUS_FILE still wins over the sandbox number', async () => {
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  __clearMockCollectionStatus();
  const dir = mkdtempSync(join(tmpdir(), 'sbx-'));
  const file = join(dir, 's.json');
  const id = txId();
  writeFileSync(file, JSON.stringify({ [id]: { status: 'COMPLETED', amount: '1000', collectedAmount: '1000' } }));
  process.env.XBRIDGE_MOCK_STATUS_FILE = file;
  try {
    await collectMobile({ transactionId: id, amount: 1000, payerPhone: '+255700003302', callbackUrl: 'http://cb' }, MOCK);
    assert.equal((await collectionStatus(id, MOCK)).status, 'COMPLETED');
  } finally {
    delete process.env.XBRIDGE_MOCK_STATUS_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('live config never uses the sandbox table (it calls the network)', async () => {
  // Port 9 refuses: a live call fails on the network, it is never answered by the mock.
  await assert.rejects(() => collectMobile({ transactionId: txId(), amount: 1000, payerPhone: '+255700001111', callbackUrl: 'http://cb' }, LIVE_LOOKING));
});

test('tanzanianMobile: +255, 9 digits, starting 6 or 7', () => {
  assert.equal(tanzanianMobile('0712345678'), '+255712345678');
  assert.equal(tanzanianMobile('+255 655 123 456'), '+255655123456');
  assert.equal(tanzanianMobile('712345678'), '+255712345678');
  for (const n of [...Object.keys(EXPECTED), SANDBOX_OK_NUMBER]) assert.equal(tanzanianMobile(n), n);
  for (const bad of ['+255812345678', '+254712345678', '0712', '07123456789', '', null, 'abc']) {
    assert.equal(tanzanianMobile(bad), null, String(bad));
  }
});

test('maskPhone keeps the first digit and the last three', () => {
  assert.equal(maskPhone('0712345123'), '+255 7•• ••• 123');
  assert.equal(maskPhone('+255700001111'), '+255 7•• ••• 111');
  assert.equal(maskPhone(null), null);
});
