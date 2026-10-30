import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseDestination, LOOKS, DESTINATIONS } from './05-toybox.js';

test('destination picker always stays inside vetted catalog', () => {
  assert.equal(chooseDestination(() => 0), DESTINATIONS[0]);
  assert.equal(chooseDestination(() => 0.999999), DESTINATIONS.at(-1));
  assert.equal(chooseDestination(() => 1), DESTINATIONS.at(-1));
  assert.equal(chooseDestination(() => -1), DESTINATIONS[0]);
  assert.equal(chooseDestination(() => NaN), DESTINATIONS[0]);
});
test('toybox only exposes unique existing shader selectors', () => {
  const names = LOOKS.map(([key]) => key);
  assert.equal(new Set(names).size, names.length);
  for (const expected of ['normal', 'surveillance', 'thermal', 'retro', 'anime', 'noir', 'snow'])
    assert.ok(names.includes(expected));
});
