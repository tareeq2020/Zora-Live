import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeProductAnalyticsProperties, productRoutePattern } from '../dist/product-analytics.js';

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

test('product analytics sanitizer keeps allowlisted eventName/tierName but still drops PII keys', () => {
  const safe = sanitizeProductAnalyticsProperties({
    eventName: 'Apricot Crush',
    tierName: 'VIP',
    eventId: 'apricot-crush',
    name: 'Jane Buyer',
    email: 'buyer@example.com',
    phone: '+255700000000',
    token: 'tok_123',
    inviteToken: 'inv_123',
  });

  assert.deepEqual(safe, {
    eventName: 'Apricot Crush',
    tierName: 'VIP',
    eventId: 'apricot-crush',
  });
});

test('productRoutePattern replaces dynamic segments and drops the query string', () => {
  assert.equal(productRoutePattern('/join/abc123secret'), '/join/[token]');
  assert.equal(productRoutePattern('/join-team/abc123secret?x=1'), '/join-team/[token]');
  assert.equal(productRoutePattern('/t/ZP-1234'), '/t/[code]');
  assert.equal(productRoutePattern('/events/apricot-crush/seats'), '/events/[id]/seats');
  assert.equal(productRoutePattern('/storefront/thebrunchcity/events/apricot-crush'), '/storefront/[handle]/events/[id]');
  assert.equal(productRoutePattern('/@thebrunchcity'), '/@[handle]');
  assert.equal(productRoutePattern('/discover?q=tokenish'), '/discover');
});
