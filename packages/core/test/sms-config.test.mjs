/* BS58 regression: SMS config detection + the failure modes that produced
   "creds set but nothing reaches the gateway". Pure (no network) except one
   fetch-stub case. Build core first; we import dist. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { smsConfigSummary, sendSms } from '../dist/index.js';

test('driver=at with real creds -> LIVE', () => {
  const s = smsConfigSummary({ SMS_DRIVER: 'at', AT_API_KEY: 'k', AT_USERNAME: 'zora' });
  assert.equal(s.driver, 'at');
  assert.equal(s.live, true);
});

test('driver=at but creds missing -> NOT sending (the silent dev-log case)', () => {
  const s = smsConfigSummary({ SMS_DRIVER: 'at' });
  assert.equal(s.live, false);
  assert.match(s.reason, /AT_API_KEY/);
});

test('sandbox username -> NOT sending (does not deliver)', () => {
  const s = smsConfigSummary({ SMS_DRIVER: 'at', AT_API_KEY: 'k', AT_USERNAME: 'sandbox' });
  assert.equal(s.live, false);
});

test('unknown SMS_DRIVER value (e.g. "africastalking") -> falls back to mock, NOT sending', () => {
  const s = smsConfigSummary({ SMS_DRIVER: 'africastalking', AT_API_KEY: 'k', AT_USERNAME: 'zora' });
  assert.equal(s.driver, 'mock');
  assert.equal(s.live, false);
});

test('driver=beem needs key+secret+sender', () => {
  assert.equal(smsConfigSummary({ SMS_DRIVER: 'beem', BEEM_KEY: 'k' }).live, false);
  assert.equal(smsConfigSummary({ SMS_DRIVER: 'beem', BEEM_KEY: 'k', BEEM_SECRET: 's', BEEM_SENDER: 'ZORA' }).live, true);
});

test('sendSms with a real driver+creds actually calls the gateway (fetch made)', async () => {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, text: async () => '{"SMSMessageData":{}}' };
  };
  try {
    const r = await sendSms('+255700000001', 'hi', { SMS_DRIVER: 'at', AT_API_KEY: 'k', AT_USERNAME: 'zora' });
    assert.equal(calls.length, 1, 'exactly one outbound gateway call');
    assert.match(String(calls[0].url), /africastalking/);
    assert.equal(r.delivered, true);
  } finally {
    globalThis.fetch = orig;
  }
});

test('sendSms with a bad SMS_DRIVER makes NO gateway call (mock/dev-log)', async () => {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (...a) => { calls.push(a); return { ok: true, status: 200, text: async () => '' }; };
  try {
    await sendSms('+255700000001', 'hi', { SMS_DRIVER: 'africastalking', AT_API_KEY: 'k', AT_USERNAME: 'zora' });
    assert.equal(calls.length, 0, 'a bad driver value must never reach the gateway (and now boots loud)');
  } finally {
    globalThis.fetch = orig;
  }
});
