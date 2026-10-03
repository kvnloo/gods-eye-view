import test from 'node:test';
import assert from 'node:assert/strict';
import {
  directionsRouteIdentity,
  evaluateDirectionsDisasterAccess,
  isDirectionsDisasterAccessCurrent,
} from './disasterDirections.js';

function route(overrides = {}) {
  return {
    mode: 'car',
    distanceM: 1234.5,
    durationS: 321,
    geometry: [
      [85.1, 27.9],
      [85.11, 27.91],
      [85.12, 27.92],
    ],
    ...overrides,
  };
}

function segment(id, state = 'open', freshness = 'fresh') {
  return {
    id,
    state,
    determination: 'observed',
    observedAt: '2026-08-26T08:00:00Z',
    receivedAt: '2026-08-26T08:01:00Z',
    freshness,
    provenance: { source: 'fixture' },
  };
}

test('Directions route identity is deterministic and changes with route geometry', () => {
  const first = directionsRouteIdentity(route());
  const same = directionsRouteIdentity(route());
  const changed = directionsRouteIdentity(
    route({
      geometry: [
        [85.1, 27.9],
        [85.111, 27.911],
        [85.12, 27.92],
      ],
    }),
  );

  assert.match(first, /^osrm:[0-9a-f]{8}$/);
  assert.equal(same, first);
  assert.notEqual(changed, first);
});

test('explicit fresh open evidence supports a mapped Directions candidate', () => {
  const result = evaluateDirectionsDisasterAccess({
    route: route(),
    segmentIds: ['a', 'b'],
    accessSegments: [segment('a'), segment('b')],
    accessRevision: 'access-r1',
  });

  assert.equal(result.route.source, 'osrm');
  assert.equal(result.accessRevision, 'access-r1');
  assert.equal(result.support, 'supported');
  assert.deepEqual(result.reasons, []);
});

test('one injected blocked segment invalidates the same route deterministically', () => {
  const candidate = route();
  const baseline = evaluateDirectionsDisasterAccess({
    route: candidate,
    segmentIds: ['a', 'b'],
    accessSegments: [segment('a'), segment('b')],
    accessRevision: 'access-r1',
  });
  const changed = evaluateDirectionsDisasterAccess({
    route: candidate,
    segmentIds: ['a', 'b'],
    accessSegments: [segment('a'), segment('b', 'blocked')],
    accessRevision: 'access-r2',
  });

  assert.equal(changed.route.id, baseline.route.id);
  assert.equal(baseline.support, 'supported');
  assert.equal(changed.support, 'unsupported');
  assert.deepEqual(changed.reasons, ['blocked:b']);
});

test('stale open evidence does not become current-open because OSRM returned a route', () => {
  const result = evaluateDirectionsDisasterAccess({
    route: route(),
    segmentIds: ['a'],
    accessSegments: [segment('a', 'open', 'stale')],
    accessRevision: 'access-r1',
  });

  assert.equal(result.support, 'unknown');
  assert.deepEqual(result.reasons, ['stale-access:a']);
});

test('an unmapped Directions route stays unknown instead of implying access', () => {
  const result = evaluateDirectionsDisasterAccess({
    route: route(),
    accessSegments: [segment('a')],
    accessRevision: 'access-r1',
  });

  assert.equal(result.support, 'unknown');
  assert.deepEqual(result.reasons, ['route-segments-not-mapped']);
});

test('missing access revision fails closed before publishing a reusable receipt', () => {
  const result = evaluateDirectionsDisasterAccess({
    route: route(),
    segmentIds: ['a'],
    accessSegments: [segment('a')],
  });

  assert.equal(result.accessRevision, null);
  assert.equal(result.support, 'unknown');
  assert.deepEqual(result.reasons, ['access-revision-missing']);
});

test('changed access revision or changed route forces re-evaluation', () => {
  const candidate = route();
  const receipt = evaluateDirectionsDisasterAccess({
    route: candidate,
    segmentIds: ['a'],
    accessSegments: [segment('a')],
    accessRevision: 'access-r1',
  });

  assert.equal(
    isDirectionsDisasterAccessCurrent(receipt, {
      route: candidate,
      accessRevision: 'access-r1',
    }),
    true,
  );
  assert.equal(
    isDirectionsDisasterAccessCurrent(receipt, {
      route: candidate,
      accessRevision: 'access-r2',
    }),
    false,
  );
  assert.equal(
    isDirectionsDisasterAccessCurrent(receipt, {
      route: route({ distanceM: 1300 }),
      accessRevision: 'access-r1',
    }),
    false,
  );
});

test('the adapter emits evidence-support language, never a safety verdict', () => {
  const result = evaluateDirectionsDisasterAccess({
    route: route(),
    segmentIds: ['a'],
    accessSegments: [segment('a')],
    accessRevision: 'access-r1',
  });

  assert.equal(JSON.stringify(result).toLowerCase().includes('safe'), false);
});
