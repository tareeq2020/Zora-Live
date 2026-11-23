/* Discover grid vs the featured card. Run: node --experimental-strip-types apps/web/test/discover-grid.test.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { gridEvents } from '../app/lib/discover-grid.ts';

const ev = (...is) => is.map((i) => ({ i }));

test("a city's only event is listed under its featured card", () => {
  assert.deepEqual(gridEvents(ev(0), 0, false), ev(0));
});

test('with other events, the featured one is not repeated', () => {
  assert.deepEqual(gridEvents(ev(0, 1, 2), 1, false), ev(0, 2));
});

test('filtering or searching lists every match, featured included', () => {
  assert.deepEqual(gridEvents(ev(0, 1), 1, true), ev(0, 1));
});

test('no featured event: the list is unchanged', () => {
  assert.deepEqual(gridEvents(ev(0, 1), null, false), ev(0, 1));
  assert.deepEqual(gridEvents([], null, false), []);
});
