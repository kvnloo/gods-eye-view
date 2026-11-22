import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CITY_R1_FEATURES, cityLookFlags } from './cityLookFlags.js';

test('no switches: the parent build', () => {
  const f = cityLookFlags('?welcome=0&massing=1');
  assert.equal(f.look, null);
  for (const k of CITY_R1_FEATURES) assert.equal(f[k], false);
});

test('look=cozy and a feature list', () => {
  const f = cityLookFlags('?look=cozy&cityR1=ghost, KIT');
  assert.equal(f.look, 'cozy');
  assert.equal(f.ghost, true);
  assert.equal(f.kit, true);
  assert.equal(f.flat, false);
  assert.equal(f.tray, false);
});

test('all turns every round-1 feature on; other looks are ignored', () => {
  const f = cityLookFlags('?look=noir&cityR1=all');
  assert.equal(f.look, null);
  for (const k of CITY_R1_FEATURES) assert.equal(f[k], true);
});
