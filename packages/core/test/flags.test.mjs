import assert from 'node:assert/strict';
import test from 'node:test';
import { isFlagOn, resolveFlags, sanitizeFlagRules, FLAG_NAMES } from '../dist/flags.js';

test('absent or malformed flags are off', () => {
  assert.equal(isFlagOn(undefined, 'zp_seatmap'), false);
  assert.equal(isFlagOn({ zp_seatmap: 'yes' }, 'zp_seatmap'), false);
  assert.equal(isFlagOn({ zp_seatmap: { on: 'true' } }, 'zp_seatmap'), false);
});

test('event beats org beats global', () => {
  const rules = { zp_seatmap: { on: false, orgs: ['brunchcity'], events: ['e1'], offEvents: ['e2'], offOrgs: ['bad'] } };
  assert.equal(isFlagOn(rules, 'zp_seatmap', {}), false);
  assert.equal(isFlagOn(rules, 'zp_seatmap', { event: 'e1' }), true);
  assert.equal(isFlagOn(rules, 'zp_seatmap', { org: 'brunchcity' }), true);
  assert.equal(isFlagOn(rules, 'zp_seatmap', { org: 'brunchcity', event: 'e2' }), false);
  assert.equal(isFlagOn({ zp_seatmap: { on: true, offOrgs: ['bad'] } }, 'zp_seatmap', { org: 'bad' }), false);
  assert.equal(isFlagOn({ zp_seatmap: { on: true } }, 'zp_seatmap', { org: 'any' }), true);
});

test('resolveFlags returns every flag', () => {
  const all = resolveFlags({ zp_look_v2: { on: true } });
  assert.deepEqual(Object.keys(all).sort(), [...FLAG_NAMES].sort());
  assert.equal(all.zp_look_v2, true);
  assert.equal(all.zp_installments, false);
});

test('sanitizeFlagRules drops unknown flags and junk', () => {
  const clean = sanitizeFlagRules({ zp_seatmap: { on: true, orgs: ['a', 3, ''], extra: 1 }, evil: { on: true } });
  assert.deepEqual(clean, { zp_seatmap: { on: true, orgs: ['a'] } });
});
