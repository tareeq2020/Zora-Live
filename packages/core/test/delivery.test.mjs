/* PR-10 delivery tests — run against the BUILT dist (pnpm --filter "@zora/core..." build first).
   node packages/core/test/delivery.test.mjs   (or: pnpm db:test:delivery)

   Covers: SMS misconfig/mock never throws; email mock never throws; QR PNG magic
   bytes; PDF %PDF header; and render-failure isolation (a ticket with an absent
   QR still builds both the PDF and the credential email). */
import assert from 'node:assert/strict';
import {
  sendSms, sendEmail, sendCredentialEmail, renderQrPng, buildTicketsPdf,
} from '../dist/index.js';

let pass = 0;
async function test(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(`       ${err?.message ?? err}`);
    process.exitCode = 1;
  }
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

console.log('delivery.test.mjs');

// 1. SMS with no creds + explicit mock driver → dev, no throw.
await test('sendSms(mock) → {delivered:false, dev:true}, no throw', async () => {
  const r = await sendSms('+255700000001', 'hi', { SMS_DRIVER: 'mock' });
  assert.deepEqual(r, { delivered: false, dev: true });
});

// 1b. Real driver selected but creds absent → misconfig fallback, still no throw.
await test('sendSms(at, no creds) → dev fallback, no throw', async () => {
  const r = await sendSms('+255700000002', 'hi', { SMS_DRIVER: 'at' });
  assert.deepEqual(r, { delivered: false, dev: true });
});
await test('sendSms(beem, no creds) → dev fallback, no throw', async () => {
  const r = await sendSms('+255700000003', 'hi', { SMS_DRIVER: 'beem' });
  assert.deepEqual(r, { delivered: false, dev: true });
});

// 2. Email mock → no throw.
await test('sendEmail(mock) → {delivered:false, dev:true}, no throw', async () => {
  const r = await sendEmail('buyer@example.com', 'Subject', '<p>hi</p>', [], { EMAIL_DRIVER: 'mock' });
  assert.deepEqual(r, { delivered: false, dev: true });
});

// 3. renderQrPng → PNG buffer.
let qr;
await test("renderQrPng('zora:abc:def') → PNG Buffer", async () => {
  qr = await renderQrPng('zora:abc:def');
  assert.ok(Buffer.isBuffer(qr), 'expected a Buffer');
  assert.ok(qr.subarray(0, 8).equals(PNG_MAGIC), 'expected PNG magic bytes');
});

// 4. buildTicketsPdf → %PDF buffer.
await test('buildTicketsPdf([...]) → %PDF Buffer', async () => {
  const pdf = await buildTicketsPdf([
    { publicRef: 'ZORA-7Q4M-2KX9', tier: 'VIP', eventName: 'DROP 001 — OFFSHORE', qrPng: qr },
  ]);
  assert.ok(Buffer.isBuffer(pdf), 'expected a Buffer');
  assert.equal(pdf.subarray(0, 4).toString('ascii'), '%PDF');
});

// 5. Render-failure isolation: a ticket with qrPng:undefined still builds PDF + email.
await test('render isolation: qrPng undefined still builds PDF', async () => {
  const pdf = await buildTicketsPdf([
    { publicRef: 'ZORA-NOQR-0001', tier: 'GA', eventName: 'DROP 001' },
  ]);
  assert.equal(pdf.subarray(0, 4).toString('ascii'), '%PDF');
});
await test('render isolation: sendCredentialEmail with undefined QR does not throw', async () => {
  const r = await sendCredentialEmail(
    'buyer@example.com',
    {
      buyerName: 'Amina <script>',
      eventName: 'DROP 001 — OFFSHORE',
      tickets: [
        { publicRef: 'ZORA-NOQR-0001', tier: 'GA & "friends"', qrPng: undefined },
      ],
    },
    { EMAIL_DRIVER: 'mock' },
  );
  assert.deepEqual(r, { delivered: false, dev: true });
});

// 5b. Exotic (non-Latin) text must not make the PDF throw.
await test('buildTicketsPdf tolerates non-WinAnsi glyphs (emoji, diacritics)', async () => {
  const pdf = await buildTicketsPdf([
    { publicRef: 'ZORA-EMOJI-01', tier: 'VIP 🎟️', eventName: 'Fâl452 — Ngoma 🎶 Zawadi' },
  ]);
  assert.equal(pdf.subarray(0, 4).toString('ascii'), '%PDF');
});

if (process.exitCode) {
  console.log(`\n${pass} passed, some FAILED`);
} else {
  console.log(`\nall ${pass} passed`);
}
