import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeTheme, pickTextOn, contrastRatio, ZORA_PASS_DEFAULTS, ZP_BLACK, ZP_BONE,
} from '../dist/theme-resolve.js';

const storefront = { brandName: 'The Brunch City', accent: '#C46A28', bg: '#F7F1E7', logoUrl: 'https://cdn/x/sf-logo.png', updatedAt: '2026-10-01T00:00:00.000Z' };
const event = { coverUrl: 'https://cdn/x/cover.jpg', updatedAt: '2026-10-02T00:00:00.000Z' };

test('defaults only → Zora pass defaults', () => {
  const t = mergeTheme({});
  assert.equal(t.accent, ZORA_PASS_DEFAULTS.accent);
  assert.equal(t.brandName, 'ZoraPass');
  assert.equal(t.template, 'artwork_top');
  assert.deepEqual(t.showFields, ['guest_name', 'seat', 'pass_type']);
  assert.equal(t.artworkUrl, '');
});

test('inheritance: defaults → storefront → event → ticket design', () => {
  const sf = mergeTheme({ storefront });
  assert.equal(sf.accent, '#C46A28');
  assert.equal(sf.logoUrl, 'https://cdn/x/sf-logo.png');

  const ev = mergeTheme({ storefront, event });
  assert.equal(ev.accent, '#C46A28');
  assert.equal(ev.artworkUrl, 'https://cdn/x/cover.jpg');

  const td = mergeTheme({
    storefront, event,
    design: { accent: '#7FD1AE', bgImage: 'https://cdn/x/art.png', organizerLogoUrl: 'https://cdn/x/td-logo.png', template: 'full_colour', sponsorLogos: ['a', 'b', 'c', 'd', 'e'], showFields: ['seat', 'bogus'], updatedAt: '2026-10-03T00:00:00.000Z' },
  });
  assert.equal(td.accent, '#7FD1AE');
  assert.equal(td.artworkUrl, 'https://cdn/x/art.png');
  assert.equal(td.logoUrl, 'https://cdn/x/td-logo.png');
  assert.equal(td.template, 'full_colour');
  assert.equal(td.sponsorLogos.length, 4, 'sponsors capped at 4');
  assert.deepEqual(td.showFields, ['seat'], 'unknown show fields dropped');
  assert.equal(td.updatedAt, '2026-10-03T00:00:00.000Z', 'newest layer stamp wins');
});

test('blank / invalid design values fall through to the layer below', () => {
  const t = mergeTheme({ storefront, event, design: { accent: 'red', bgImage: '  ', template: 'nope' } });
  assert.equal(t.accent, '#C46A28');
  assert.equal(t.artworkUrl, 'https://cdn/x/cover.jpg');
  assert.equal(t.template, 'artwork_top');
});

test('inheritStorefront=false skips the storefront layer', () => {
  const t = mergeTheme({ storefront, event, design: { inheritStorefront: false } });
  assert.equal(t.accent, ZORA_PASS_DEFAULTS.accent);
  assert.equal(t.logoUrl, '');
  assert.equal(t.artworkUrl, 'https://cdn/x/cover.jpg', 'event layer still applies');
});

test('caller defaults (share card) are respected', () => {
  const t = mergeTheme({ defaults: { brandName: 'Fallback', accent: '#123456', secondary: '#000', bg: '#fff', card: '#fff', typography: 'x', logoUrl: '' } });
  assert.equal(t.accent, '#123456');
  assert.equal(t.brandName, 'Fallback');
});

test('contrast pick: readable text on any accent', () => {
  assert.equal(pickTextOn('#FFD21F'), ZP_BLACK);
  assert.equal(pickTextOn('#F4A259'), ZP_BLACK);
  assert.equal(pickTextOn('#1D2A6E'), ZP_BONE);
  assert.equal(pickTextOn('#111111'), ZP_BONE);
  // every pick clears 4.5:1, including mid-tones where neither brand ink does
  for (const c of ['#FFD21F', '#F4A259', '#7FD1AE', '#C46A28', '#777777', '#808080', '#3D5AFE', '#FF4D7D', '#000000', '#FFFFFF', '#0f0']) {
    const ink = pickTextOn(c);
    assert.ok(contrastRatio(c, ink) >= 4.5, `${c} → ${ink} = ${contrastRatio(c, ink).toFixed(2)}`);
  }
  assert.equal(contrastRatio('#000000', '#FFFFFF').toFixed(0), '21');
});

test('accentOnBlack falls back to bone when the accent is too dark for the black pass', () => {
  assert.equal(mergeTheme({ design: { accent: '#F4A259' } }).accentOnBlack, '#F4A259');
  assert.equal(mergeTheme({ design: { accent: '#1D2A6E' } }).accentOnBlack, ZP_BONE);
});

test('credential email: unchanged without brand, accent + logo with brand (BS131)', async () => {
  const { buildCredentialEmailHtml } = await import('../dist/email/index.js');
  const base = { buyerName: 'Amina', eventName: 'Brunch A', tickets: [{ publicRef: 'ABC-123', tier: 'GA', qrPng: null }] };
  const plain = buildCredentialEmailHtml(base).html;
  assert.match(plain, />ZORA</);
  assert.doesNotMatch(plain, /background-color:#/);
  assert.equal(buildCredentialEmailHtml({ ...base, brand: null }).html, plain, 'null brand = identical');
  const branded = buildCredentialEmailHtml({ ...base, brand: { accent: '#F4A259', onAccent: '#111111', brandName: 'The Brunch City', logoUrl: 'https://cdn.example/logo.png' } }).html;
  assert.match(branded, /color:#111111;background-color:#F4A259/);
  assert.match(branded, /<img src="https:\/\/cdn\.example\/logo\.png" alt="The Brunch City"/);
  // a bad colour never reaches the HTML
  const bad = buildCredentialEmailHtml({ ...base, brand: { accent: 'red;x:y', onAccent: '#111111' } }).html;
  assert.equal(bad, plain);
});
