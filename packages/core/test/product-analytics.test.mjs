import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeProductAnalyticsProperties } from '../dist/product-analytics.js';

test('product analytics sanitizer keeps allowlisted product properties', () => {
  const safe = sanitizeProductAnalyticsProperties({
    surface: 'mobile',
    role: 'organizer',
    eventId: 'offshore-001',
    eventCount: 3,
    scannerRole: 'agent',
    canSell: true,
    status: 'requested',
  });

  assert.deepEqual(safe, {
    surface: 'mobile',
    role: 'organizer',
    eventId: 'offshore-001',
    eventCount: 3,
    scannerRole: 'agent',
    canSell: true,
    status: 'requested',
  });
});

test('product analytics sanitizer drops PII, secrets, ticket data, and unknown keys', () => {
  const safe = sanitizeProductAnalyticsProperties({
    email: 'buyer@example.com',
    phone: '+255700000000',
    scannerCode: 'ABC123',
    ticketSignature: 'secret',
    credentialId: 'cred_123',
    paymentToken: 'tok_123',
    randomInternalObject: 'nope',
    route: '/events/offshore-001',
    count: 2,
  });

  assert.deepEqual(safe, {
    route: '/events/offshore-001',
    count: 2,
  });
});

test('product analytics sanitizer limits arrays to primitive values and caps length', () => {
  const safe = sanitizeProductAnalyticsProperties({
    source: ['a', 'b', { bad: true }, null, ...Array.from({ length: 25 }, (_, i) => i)],
  });

  assert.deepEqual(safe.source, ['a', 'b', 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
});
