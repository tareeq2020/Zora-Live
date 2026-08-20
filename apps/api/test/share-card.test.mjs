/* BS86 — share-card renderer failure-mode tests (eng-review's 3 locks).
   Runs against the framework-agnostic vendor module (no Nest/DB needed):

     node --test apps/api/test/share-card.test.mjs

   1. render-fail → still a PNG (a broken/undecodable cover degrades to a
      branded fallback card, never a throw / 500).
   2. suspended → not visible (the store-card visibility predicate the route
      404s on; the event card reuses isPublicEvent, tested at the route level).
   3. version bump on publish (the cache digest changes when event.updated_at
      changes, and when a sold-bucket boundary is crossed). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const c = require('../src/vendor/share-card.js');

const THEME = { bg: '#F7F1E7', card: '#FFFDF8', accent: '#C46A28', brandName: 'The Brunch City' };
const isPng = (buf) => Buffer.isBuffer(buf) && buf.length > 8 && buf.slice(0, 4).toString('hex') === '89504e47';

test('failure-mode 1: a broken cover still yields a valid PNG (branded fallback)', async () => {
  const png = await c.shareCardPNG({
    format: 'og', theme: THEME, title: 'Broken cover',
    coverDataUri: 'data:image/png;base64,thisisNOTvalidbase64pngdata!!!',
    url: 'zorapass.com/thebrunchcity',
  });
  assert.ok(isPng(png), 'expected a PNG buffer even when the cover is undecodable');
});

test('failure-mode 1b: no theme + no cover still yields a valid PNG', async () => {
  const png = await c.shareCardPNG({ format: 'og' });
  assert.ok(isPng(png));
  const story = await c.shareCardPNG({ format: 'story' });
  assert.ok(isPng(story));
});

test('fetchCover rejects non-http, and returns null (never throws) on bad input', async () => {
  assert.equal(await c.fetchCover(''), null);
  assert.equal(await c.fetchCover('not-a-url'), null);
  assert.equal(await c.fetchCover('ftp://x/y.png'), null);
});

test('failure-mode 2: suspended / hidden store is NOT visible (route 404s on this)', () => {
  const never = { has: () => false };
  assert.equal(c.storeCardVisible(null, never), false, 'missing org → 404');
  assert.equal(c.storeCardVisible({ status: 'suspended', handle: 'x' }, never), false, 'suspended status → 404');
  assert.equal(c.storeCardVisible({ status: 'active', handle: 'x' }, { has: (h) => h === 'x' }), false, 'in suspended set → 404');
  assert.equal(c.storeCardVisible({ status: 'active', handle: 'x' }, never), true, 'active + not suspended → visible');
});

test('failure-mode 3: publishing/editing (event.updated_at) bumps the cache digest', () => {
  const base = { format: 'og', theme: THEME, title: 'Drop', priceFrom: 65000, sold: 5, eventUpdatedAt: '2026-08-01T00:00:00Z' };
  const before = c.computeCardDigest(base);
  const afterPublish = c.computeCardDigest({ ...base, eventUpdatedAt: '2026-08-20T12:00:00Z' });
  assert.notEqual(before, afterPublish, 'a new updated_at must change v so the unfurl re-fetches');
});

test('failure-mode 3b: price change and sold-bucket crossing bump the digest; within-bucket sales do NOT', () => {
  const base = { format: 'og', theme: THEME, title: 'Drop', priceFrom: 65000, sold: 12 };
  assert.notEqual(c.computeCardDigest(base), c.computeCardDigest({ ...base, priceFrom: 85000 }), 'price change bumps v');
  assert.notEqual(c.computeCardDigest(base), c.computeCardDigest({ ...base, sold: 60 }), 'crossing 50 bumps v');
  assert.equal(c.computeCardDigest(base), c.computeCardDigest({ ...base, sold: 20 }), '12→20 stays in the same bucket → same v (cache hit)');
});

test('D4 threshold: "{N} going" only at ≥10, coarse-bucketed', () => {
  assert.equal(c.goingLabel(0), null);
  assert.equal(c.goingLabel(9), null, 'below 10 → no weak number');
  assert.equal(c.goingLabel(10), '10+ going');
  assert.equal(c.goingLabel(52), '50+ going');
  assert.equal(c.goingBucket(9), null);
  assert.equal(c.goingBucket(60), 50);
});
