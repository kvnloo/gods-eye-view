import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDisasterRouteSupport } from './disasterAccess.js';

const segment = (state = 'open') => ({
  id: 'bridge',
  state,
  freshness: 'fresh',
  determination: 'observed',
});

test('malformed route references cannot become fully supported', () => {
  for (const ref of [null, undefined, ' ', false, 0]) {
    const result = evaluateDisasterRouteSupport(
      { id: 'relief-bridge', segmentIds: ['bridge', ref] },
      [segment()],
    );
    assert.equal(result.support, 'unknown');
    assert.deepEqual(result.reasons, ['invalid-route-segment-refs']);
  }
});

test('a blocked segment overrides malformed route references', () => {
  const result = evaluateDisasterRouteSupport(
    { id: 'relief-bridge', segmentIds: [null, 'bridge'] },
    [segment('blocked')],
  );
  assert.equal(result.support, 'unsupported');
  assert.deepEqual(result.reasons, [
    'invalid-route-segment-refs',
    'blocked:bridge',
  ]);
});

test('fully invalid reference set is unknown', () => {
  const result = evaluateDisasterRouteSupport(
    { id: 'relief-bridge', segmentIds: [null, ' '] },
  );
  assert.equal(result.support, 'unknown');
  assert.deepEqual(result.reasons, [
    'route-segments-not-mapped',
    'invalid-route-segment-refs',
  ]);
});
