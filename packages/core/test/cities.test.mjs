import assert from 'node:assert/strict';
import test from 'node:test';
import { CityCache, cityKey, citySlug, isUpcoming, todayIn, withCityFields } from '../dist/cities.js';

const c = (id, name, extra = {}) => ({
  id, name, country: 'Tanzania', currency: 'TZS', timezone: 'Africa/Dar_es_Salaam', aliases: [], status: 'active',
  sort: 100, mergedInto: null, requestedBy: null, requestedAt: null, ...extra,
});

const cache = () => {
  const k = new CityCache(async () => []);
  k.load([
    c('dar', 'Dar es Salaam', { aliases: ['dsm', 'dar es salaam'] }),
    c('zanzibar', 'Zanzibar'),
    c('mwanza', 'Mwanza', { status: 'merged', mergedInto: 'dar' }),
    c('old', 'Old Town', { status: 'merged', mergedInto: 'mwanza' }),
  ]);
  return k;
};

test('cityKey and citySlug normalise spelling', () => {
  assert.equal(cityKey('  Dar-es-Salaam '), 'dar es salaam');
  assert.equal(cityKey('Lomé'), 'lome');
  assert.equal(citySlug('Stone Town'), 'stone-town');
});

test('canon resolves ids, names, spellings; unknown passes through', () => {
  const k = cache();
  assert.equal(k.canon('dar'), 'dar');
  assert.equal(k.canon('Dar Es Salaam'), 'dar');
  assert.equal(k.canon('DSM'), 'dar');
  assert.equal(k.canon('atlantis'), 'atlantis');
  assert.equal(k.canon(null), null);
  assert.equal(k.canon(''), '');
});

test('canon follows merges, including chains', () => {
  const k = cache();
  assert.equal(k.canon('mwanza'), 'dar');
  assert.equal(k.canon('Old Town'), 'dar');
  assert.equal(k.get('old')?.id, 'dar');
});

test('withCityFields adds name + currency and never drops an unknown city', () => {
  const k = cache();
  assert.deepEqual(withCityFields({ id: 'e', city: 'dsm' }, k), { id: 'e', city: 'dar', cityName: 'Dar es Salaam', cityCurrency: 'TZS' });
  assert.deepEqual(withCityFields({ id: 'e', city: 'Atlantis' }, k), { id: 'e', city: 'Atlantis' });
  assert.deepEqual(withCityFields({ id: 'e' }, k), { id: 'e' });
});

test('active() lists only active cities', () => {
  assert.deepEqual(cache().active().map((x) => x.id), ['dar', 'zanzibar']);
});

test('isUpcoming uses the city time zone; no date counts as upcoming', () => {
  const now = new Date('2026-11-23T22:30:00Z'); // already the 24th in Dar (UTC+3)
  assert.equal(todayIn('Africa/Dar_es_Salaam', now), '2026-11-24');
  assert.equal(isUpcoming('2026-11-23', 'Africa/Dar_es_Salaam', now), false);
  assert.equal(isUpcoming('2026-11-24', 'Africa/Dar_es_Salaam', now), true);
  assert.equal(isUpcoming(undefined, 'Africa/Dar_es_Salaam', now), true);
  assert.equal(todayIn('Not/AZone', now), '2026-11-23');
});

test('ensureFresh fails open and keeps the last list', async () => {
  let calls = 0;
  const k = new CityCache(async () => { calls++; if (calls > 1) throw new Error('db down'); return [c('dar', 'Dar es Salaam')]; }, 0);
  await k.ensureFresh();
  await k.ensureFresh();
  assert.equal(k.canon('Dar es Salaam'), 'dar');
});

test('a cold cache whose read fails stays unloaded and passes values through', async () => {
  const k = new CityCache(async () => { throw new Error('db down'); });
  await k.ensureFresh();
  assert.equal(k.loaded(), false);
  assert.equal(k.canon('dar'), 'dar');
  assert.equal(k.get('dar'), undefined);
});

test('names that normalise to nothing never become a lookup key', () => {
  const k = new CityCache(async () => []);
  k.load([c('athens', 'Αθήνα'), c('dar', 'Dar es Salaam')]);
  assert.equal(k.canon('-'), '-');
  assert.equal(k.canon('Θεσσαλονίκη'), 'Θεσσαλονίκη');
  assert.equal(k.canon('athens'), 'athens');
});

test('a city added later under a declined name is the one that name finds', () => {
  const k = new CityCache(async () => []);
  k.load([c('moshi', 'Moshi', { status: 'declined', sort: 1 }), c('moshi-2', 'Moshi', { sort: 50 })]);
  assert.equal(k.canon('Moshi'), 'moshi-2');
  assert.equal(k.canon('moshi-2'), 'moshi-2');
});

test('a merged city still redirects by its id', () => {
  assert.equal(cache().canon('mwanza'), 'dar');
});

test('a forced refresh does not reuse a read that started before it', async () => {
  let n = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const k = new CityCache(async () => {
    n++;
    if (n === 1) { await gate; return [c('dar', 'Dar es Salaam')]; }
    return [c('dar', 'Dar es Salaam'), c('arusha', 'Arusha')];
  });
  const first = k.refresh();          // a read already in flight (old data)
  const forced = k.refresh({ force: true }); // the caller just wrote Arusha
  release();
  await Promise.all([first, forced]);
  assert.equal(n, 2);
  assert.equal(k.canon('Arusha'), 'arusha');
});
