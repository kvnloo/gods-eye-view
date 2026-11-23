import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COZY2_DEFAULTS, parseLookParams } from './cozyShaderParams.js';

test('lk JSON: known numbers and vec3s kept, the rest dropped', () => {
  const p = parseLookParams(JSON.stringify({ greenSat: '1.8', hazeCol: [0.1, 0.2, 0.3], nope: 1, sat: 'x', water: [1, 2] }));
  assert.deepEqual(p, { greenSat: 1.8, hazeCol: [0.1, 0.2, 0.3] });
});

test('bad or empty lk gives no overrides', () => {
  assert.deepEqual(parseLookParams(''), {});
  assert.deepEqual(parseLookParams('{oops'), {});
  assert.deepEqual(parseLookParams(null), {});
});

test('defaults are frozen and carry no AO / vignette', () => {
  assert.ok(Object.isFrozen(COZY2_DEFAULTS));
  assert.equal(COZY2_DEFAULTS.vignette, 0);
  assert.equal(COZY2_DEFAULTS.ts, 1);
});
