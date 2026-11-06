/* BS161 — PhoneField normalization (app/components/phone.ts): every typed or
   pasted form gives the 9 national digits, and e164 is +255 + those digits,
   which the server normalizes the same as the old forms.
     node --test apps/web/test/phone-field.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const ts = createRequire(join(web, 'package.json'))('typescript');
const src = readFileSync(join(web, 'app/components/phone.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
const P = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

test('one country today: Tanzania, the default', () => {
  assert.equal(P.COUNTRIES.length, 1);
  assert.equal(P.DEFAULT_COUNTRY.iso, 'TZ');
  assert.equal(P.DEFAULT_COUNTRY.dial, '255');
  assert.equal(P.countryOf('XX').iso, 'TZ');
});

test('every input form gives the 9 national digits', () => {
  for (const raw of ['0712 345 678', '0712345678', '712345678', '712 345 678', '+255 712 345 678', '+255712345678', '255712345678', '255 712 345 678', '+255 0712 345 678', ' (0712) 345-678 ']) {
    const v = P.phoneValue(raw);
    assert.deepEqual(v, { country: 'TZ', national: '712345678', e164: '+255712345678', valid: true }, raw);
  }
});

test('partial typing groups as it goes', () => {
  assert.equal(P.nationalDigits('0'), '');
  assert.equal(P.nationalDigits('07'), '7');
  assert.equal(P.groupNational('7'), '7');
  assert.equal(P.groupNational('7123'), '712 3');
  assert.equal(P.groupNational('712345678'), '712 345 678');
  assert.equal(P.nationalDigits('+255'), '');
  assert.equal(P.nationalDigits('+255 71'), '71');
});

test('extra digits are cut at 9', () => {
  assert.equal(P.nationalDigits('7123456789'), '712345678');
});

test('invalid inputs are not valid', () => {
  for (const raw of ['', 'abc', '71234567', '512345678', '812345678', '+254712345678', '12345']) {
    assert.equal(P.phoneValue(raw).valid, false, raw);
  }
  assert.equal(P.phoneValue('').e164, '');
  assert.equal(P.phoneValue('abc').national, '');
});

test('toE164 lands where the old forms did, through the real server normalizers', async () => {
  const load = async (rel) => {
    const code = ts.transpileModule(readFileSync(join(web, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
    return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  };
  const { normalizeTzPhone } = await load('../api/src/common/phone.ts'); // checkout/splits/otp customer key
  const { normalizeMsisdn } = await import('../../../packages/core/dist/payments/xbridge.js'); // payer phone to x-bridge (needs the core build)
  const e = P.toE164('712345678');
  assert.equal(e, '+255712345678');
  assert.equal(normalizeTzPhone(e), '255712345678');
  assert.equal(normalizeMsisdn(e), '+255712345678');
  for (const old of ['0712 345 678', '0712345678', '712345678', '+255712345678']) {
    assert.equal(normalizeTzPhone(e), normalizeTzPhone(old), old);
    assert.equal(normalizeMsisdn(e), normalizeMsisdn(old), old);
  }
});

test('network from the number', () => {
  assert.equal(P.networkFromNumber('754000000')?.id, 'VODACOM');
  assert.equal(P.networkFromNumber('712345678')?.id, 'TIGO');
  assert.equal(P.networkFromNumber('784000000')?.id, 'AIRTEL');
  assert.equal(P.networkFromNumber('621000000')?.id, 'HALOTEL');
  assert.equal(P.networkFromNumber('700001111'), null);
  assert.equal(P.networkFromNumber('7'), null);
});

test('checkout v2 still re-exports networkFromNumber', () => {
  assert.match(readFileSync(join(web, 'app/components/checkout-flow-v2.tsx'), 'utf8'), /export \{ networkFromNumber \}/);
});
