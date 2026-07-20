/* PR-MT6 — pure-logic unit test for the drop editor's validation + body builder.

   Node-only, no servers, no browser: imports the real TS helpers from
   app/(app)/dashboard/events/lib/drops.ts (type-stripped by Node) and asserts
   the client-side rules that MIRROR the backend contract. The server stays the
   source of truth at runtime; this just guards the mirror from drifting.

   Run (Node >= 22.6):
     node --experimental-strip-types apps/web/test/drop-validation.test.mjs
   The runner (run-drop-validation.mjs) invokes it with the flag for you:
     node apps/web/test/run-drop-validation.mjs
*/

import {
  buildBody,
  emptyForm,
  hasErrors,
  priceFromOf,
  usableTiers,
  validate,
} from '../app/(app)/dashboard/events/lib/drops.ts';

let pass = 0;
const fails = [];
const ok = (label) => {
  pass++;
  console.log(`✓ ${label}`);
};
const bad = (label, detail) => fails.push(`✗ ${label}\n    ${detail}`);
const assert = (cond, label, detail = '') => (cond ? ok(label) : bad(label, detail));

// A draft (non-sellable) with a name and no tiers is valid — drafts always allowed.
{
  const f = { ...emptyForm(), name: 'Garden Brunch', sellable: false };
  const e = validate(f);
  assert(!hasErrors(e), 'draft with name + empty tiers is valid', JSON.stringify(e));
}

// Name is required.
{
  const f = { ...emptyForm(), name: '   ', sellable: false };
  const e = validate(f);
  assert(!!e.name, 'blank name is rejected');
}

// Sellable requires at least one valid tier.
{
  const f = { ...emptyForm(), name: 'X', sellable: true, tiers: [{ name: '', price: '', capacity: '' }] };
  const e = validate(f);
  assert(!!e.tiers, 'sellable with no valid tier is rejected');
}

// Sellable with a valid tier passes.
{
  const f = { ...emptyForm(), name: 'X', sellable: true, tiers: [{ name: 'GA', price: '45000', capacity: '200' }] };
  const e = validate(f);
  assert(!hasErrors(e), 'sellable with one valid tier is valid', JSON.stringify(e));
}

// Negative price / non-numeric price rejected per row.
{
  const f = { ...emptyForm(), name: 'X', sellable: true, tiers: [{ name: 'GA', price: '-5', capacity: '10' }] };
  const e = validate(f);
  assert(!!(e.tierRows && e.tierRows[0]), 'negative price rejected');
}
{
  const f = { ...emptyForm(), name: 'X', sellable: true, tiers: [{ name: 'GA', price: 'abc', capacity: '10' }] };
  const e = validate(f);
  assert(!!(e.tierRows && e.tierRows[0]), 'non-numeric price rejected');
}

// Fractional capacity rejected (must be a whole number).
{
  const f = { ...emptyForm(), name: 'X', sellable: true, tiers: [{ name: 'GA', price: '10', capacity: '2.5' }] };
  const e = validate(f);
  assert(!!(e.tierRows && e.tierRows[0]), 'fractional capacity rejected');
}

// priceFrom = min tier price; buildBody stamps derived fields + the idem key.
{
  const f = {
    ...emptyForm(),
    name: '  Garden Brunch  ',
    sellable: true,
    tiers: [
      { name: 'Early', price: '45000', capacity: '100' },
      { name: 'General', price: '55000', capacity: '120' },
    ],
  };
  const tiers = usableTiers(f);
  assert(priceFromOf(tiers) === 45000, 'priceFrom is the minimum tier price', `got ${priceFromOf(tiers)}`);
  const body = buildBody(f, 'idem-123');
  assert(body.name === 'Garden Brunch', 'buildBody trims name', body.name);
  assert(body.priceFrom === 45000, 'buildBody sets priceFrom', String(body.priceFrom));
  assert(body.idempotencyKey === 'idem-123', 'buildBody carries idempotencyKey');
  assert(body.tiers.length === 2 && body.tiers[0].price === 45000, 'buildBody maps tier price to number');
  assert(body.sellable === true, 'buildBody carries sellable flag');
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\n' + fails.join('\n\n'));
  process.exit(1);
}
