/* PR-BS2 tests: pure bill-split + OTP logic (no DB).
   Build core first (`pnpm --filter "@zora/core..." build`) — we import dist.
   The DB-backed flows (createTableSplit, onShareSuccessful, aggregation gate,
   expiry sweep) are exercised by db/test/split.e2e.sh against real Postgres. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeShareAmounts, signShareToken, verifyShareToken,
  generateOtpCode, hashOtp,
} from '../dist/index.js';

test('computeShareAmounts: even split — everyone equal', () => {
  const { hostShare, inviteeShare } = computeShareAmounts(900000, 5);
  assert.equal(inviteeShare, 180000);
  assert.equal(hostShare, 180000);
  assert.equal(hostShare + inviteeShare * 4, 900000); // sums exactly
});

test('computeShareAmounts: uneven split — invitees floor, host absorbs remainder', () => {
  const target = 900000, n = 7;
  const { hostShare, inviteeShare } = computeShareAmounts(target, n);
  assert.equal(inviteeShare, Math.floor(target / n)); // 128571
  assert.equal(hostShare + inviteeShare * (n - 1), target); // exact, no lost/created TZS
  assert.ok(hostShare >= inviteeShare); // host never pays less than an invitee
});

test('computeShareAmounts: shares always sum to target across many N', () => {
  for (const target of [20000, 100001, 900000, 1234567]) {
    for (let n = 2; n <= 12; n++) {
      const { hostShare, inviteeShare } = computeShareAmounts(target, n);
      assert.equal(hostShare + inviteeShare * (n - 1), target, `target=${target} n=${n}`);
    }
  }
});

test('share token: sign → verify round-trip', () => {
  const secret = 'test-secret';
  const t = signShareToken('11111111-2222-3333-4444-555555555555', 3, secret);
  const d = verifyShareToken(t, secret);
  assert.deepEqual(d, { splitId: '11111111-2222-3333-4444-555555555555', shareIndex: 3 });
});

test('share token: tamper is rejected', () => {
  const secret = 'test-secret';
  const t = signShareToken('split-abc', 2, secret);
  assert.equal(verifyShareToken(t + 'x', secret), null);         // mangled sig
  assert.equal(verifyShareToken(t, 'other-secret'), null);        // wrong key
  assert.equal(verifyShareToken('garbage', secret), null);        // not a token
  assert.equal(verifyShareToken('only-one-part', secret), null);
});

test('otp: code is 6 numeric digits, leading zeros preserved', () => {
  for (let i = 0; i < 200; i++) {
    const c = generateOtpCode();
    assert.match(c, /^[0-9]{6}$/);
  }
});

test('otp: hash is deterministic and bound to phone+code', () => {
  const s = 'otp-secret';
  assert.equal(hashOtp('+255700000000', '123456', s), hashOtp('+255700000000', '123456', s));
  assert.notEqual(hashOtp('+255700000000', '123456', s), hashOtp('+255700000000', '123457', s));
  assert.notEqual(hashOtp('+255700000000', '123456', s), hashOtp('+255700000001', '123456', s));
});
