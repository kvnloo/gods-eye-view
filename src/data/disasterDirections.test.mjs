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

  assert.match(first, /^osrm:[0-9a-f]{16}$/);
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
      segmentIds: ['a'],
    }),
    true,
  );
  assert.equal(
    isDirectionsDisasterAccessCurrent(receipt, {
      route: candidate,
      accessRevision: 'access-r2',
      segmentIds: ['a'],
    }),
    false,
  );
  assert.equal(
    isDirectionsDisasterAccessCurrent(receipt, {
      route: route({ distanceM: 1300 }),
      accessRevision: 'access-r1',
      segmentIds: ['a'],
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

test('remapping route segments invalidates the old receipt', () => {
  const candidate = route();
  const receipt = evaluateDirectionsDisasterAccess({
    route: candidate,
    segmentIds: ['a'],
    accessSegments: [segment('a'), segment('b', 'blocked')],
    accessRevision: 'access-r1',
  });

  assert.equal(receipt.support, 'supported');
  assert.equal(
    isDirectionsDisasterAccessCurrent(receipt, {
      route: candidate,
      accessRevision: 'access-r1',
    }),
    false,
  );
  assert.equal(
    isDirectionsDisasterAccessCurrent(receipt, {
      route: candidate,
      accessRevision: 'access-r1',
      segmentIds: ['a', 'b'],
    }),
    false,
  );
  assert.equal(
    isDirectionsDisasterAccessCurrent(receipt, {
      route: candidate,
      accessRevision: 'access-r1',
      segmentIds: ['b'],
    }),
    false,
  );
  assert.equal(
    isDirectionsDisasterAccessCurrent(receipt, {
      route: candidate,
      accessRevision: 'access-r1',
      segmentIds: ['a'],
    }),
    true,
  );
});

test('reordered equivalent segment mappings do not invalidate receipts', () => {
  const candidate = route();
  const receipt = evaluateDirectionsDisasterAccess({
    route: candidate,
    segmentIds: ['a', 'b'],
    accessSegments: [segment('a'), segment('b')],
    accessRevision: 'access-r1',
  });

  assert.equal(
    isDirectionsDisasterAccessCurrent(receipt, {
      route: candidate,
      accessRevision: 'access-r1',
      segmentIds: ['b', 'a', 'a'],
    }),
    true,
  );
});

test('malformed coordinates cannot invent an OSRM candidate at zero latitude', () => {
  const malformed = [
    [[null, null], [null, null]],
    [['', ''], [false, false]],
    [[undefined, 28], [85, null]],
  ];
  for (const geometry of malformed) {
    const candidate = route({ geometry });
    assert.equal(directionsRouteIdentity(candidate), null);
    const result = evaluateDirectionsDisasterAccess({
      route: candidate,
      segmentIds: ['bridge'],
      accessSegments: [segment('bridge')],
      accessRevision: 'access-r1',
    });
    assert.equal(result.support, 'unknown');
    assert.deepEqual(result.reasons, ['directions-route-unavailable']);
  }

  // Real zero coordinates remain valid; legacy numeric strings stay compatible.
  assert.equal(
    directionsRouteIdentity(route({ geometry: [[0, 0], [1, 1]] })),
    directionsRouteIdentity(route({ geometry: [['0', '0'], ['1', '1']] })),
  );
  assert.match(
    directionsRouteIdentity(route({ geometry: [[0, 0], [1, 1]] })),
    /^osrm:[0-9a-f]{16}$/,
  );
});

test('one invalid interior vertex makes the full candidate unavailable', () => {
  const valid = route({
    geometry: [[85.1, 27.9], [85.11, 27.91], [85.12, 27.92]],
  });
  assert.match(directionsRouteIdentity(valid), /^osrm:[0-9a-f]{16}$/);

  const broken = [
    [[85.1, 27.9], [null, null], [85.12, 27.92]],
    [[85.1, 27.9], [181, 91], [85.12, 27.92]],
    [[85.1, 27.9], null, [85.12, 27.92]],
  ];
  for (const geometry of broken) {
    const candidate = route({ geometry });
    assert.equal(directionsRouteIdentity(candidate), null);
    const receipt = evaluateDirectionsDisasterAccess({
      route: candidate,
      segmentIds: ['bridge'],
      accessSegments: [segment('bridge')],
      accessRevision: 'access-r1',
    });
    assert.equal(receipt.support, 'unknown');
    assert.deepEqual(receipt.reasons, ['directions-route-unavailable']);
  }
});

test('simulated access cannot establish operational support', () => {
  for (const state of ['open', 'blocked', 'degraded']) {
    const result = evaluateDirectionsDisasterAccess({
      route: route(),
      segmentIds: ['a'],
      accessSegments: [
        { ...segment('a', state), determination: 'simulated' },
      ],
      accessRevision: 'access-r1',
    });
    assert.equal(result.support, 'unknown');
    assert.deepEqual(
      result.reasons,
      [
        ...(state === 'open' ? [] : [`${state === 'blocked' ? 'blocked' : 'degraded'}:a`]),
        'unverified-access-basis:a',
      ],
    );
  }
});

test('derived or missing evidence determination remains unknown', () => {
  for (const determination of ['derived', null]) {
    const result = evaluateDirectionsDisasterAccess({
      route: route(),
      segmentIds: ['a'],
      accessSegments: [{ ...segment('a'), determination }],
      accessRevision: 'access-r1',
    });
    assert.equal(result.support, 'unknown');
    assert.deepEqual(result.reasons, ['unverified-access-basis:a']);
  }
});

test('evidence without timestamps or source attribution fails closed', () => {
  const records = [
    { ...segment('a'), observedAt: null },
    { ...segment('a'), receivedAt: null },
    { ...segment('a'), provenance: null },
  ];
  for (const evidence of records) {
    const result = evaluateDirectionsDisasterAccess({
      route: route(),
      segmentIds: ['a'],
      accessSegments: [evidence],
      accessRevision: 'access-r1',
    });
    assert.equal(result.support, 'unknown');
    assert.deepEqual(result.reasons, ['unattributed-access:a']);
  }
});

test('attributed declared evidence retains its degraded status', () => {
  const result = evaluateDirectionsDisasterAccess({
    route: route(),
    segmentIds: ['a'],
    accessSegments: [{
      ...segment('a', 'degraded'),
      determination: 'declared',
      provenance: { authority: 'fixture transport agency' },
    }],
    accessRevision: 'access-r1',
  });
  assert.equal(result.support, 'degraded');
  assert.deepEqual(result.reasons, ['degraded:a']);
});

test('invalid evidence collection returns unknown instead of throwing', () => {
  for (const accessSegments of [null, {}, 'open']) {
    const receipt = evaluateDirectionsDisasterAccess({
      route: route(),
      segmentIds: ['a'],
      accessSegments,
      accessRevision: 'access-r1',
    });
    assert.equal(receipt.support, 'unknown');
    assert.deepEqual(receipt.reasons, [
      'missing-access:a',
      'invalid-access-collection',
    ]);
  }
});

test('distinct routes sharing a legacy 32-bit ID cannot reuse an access receipt', () => {
  const a = route({
    geometry: [[85.1, 27.9], [85.248725, 27.917841], [85.12, 27.92]],
  });
  const b = route({
    geometry: [[85.1, 27.9], [85.333471, 27.916722], [85.12, 27.92]],
  });
  assert.notEqual(directionsRouteIdentity(a), directionsRouteIdentity(b));
  const receipt = evaluateDirectionsDisasterAccess({
    route: a,
    segmentIds: ['bridge'],
    accessSegments: [segment('bridge')],
    accessRevision: 'access-r1',
  });
  assert.equal(receipt.support, 'supported');
  assert.equal(
    isDirectionsDisasterAccessCurrent(receipt, {
      route: b,
      segmentIds: ['bridge'],
      accessRevision: 'access-r1',
    }),
    false,
  );
});

test('missing, non-finite, negative, or overflowed route metrics cannot support relief access', () => {
  for (const overrides of [
    { distanceM: undefined }, { durationS: undefined },
    { distanceM: null }, { durationS: null },
    { distanceM: '' }, { durationS: '' },
    { distanceM: -1 }, { durationS: -1 },
    { distanceM: Number.MAX_VALUE }, { durationS: Number.MAX_VALUE },
    { distanceM: NaN }, { durationS: NaN },
  ]) {
    const candidate = route(overrides);
    assert.equal(directionsRouteIdentity(candidate), null);
    const receipt = evaluateDirectionsDisasterAccess({
      route: candidate, segmentIds: ['bridge'],
      accessSegments: [segment('bridge')], accessRevision: 'r1',
    });
    assert.equal(receipt.support, 'unknown');
    assert.deepEqual(receipt.reasons, ['directions-route-unavailable']);
  }
});

test('nondecimal numeric strings cannot manufacture OSRM route coordinates or metrics', () => {
  for (const overrides of [
    { distanceM: '0x10' }, { durationS: '0b10' },
    { distanceM: '0o10' }, { geometry: [['0x10', 0], [1, 1]] },
  ]) {
    const candidate = route(overrides);
    assert.equal(directionsRouteIdentity(candidate), null);
    assert.equal(evaluateDirectionsDisasterAccess({
      route: candidate, segmentIds: ['bridge'],
      accessSegments: [segment('bridge')], accessRevision: 'r1',
    }).support, 'unknown');
  }
});

test('zero-length and finite decimal-string metadata remain accepted', () => {
  assert.match(directionsRouteIdentity(route({
    distanceM: '1234.5', durationS: '3.21e2',
  })), /^osrm:[0-9a-f]{16}$/);
  assert.match(directionsRouteIdentity(route({
    distanceM: 0, durationS: 0,
  })), /^osrm:[0-9a-f]{16}$/);
});

test('out-of-range raw coordinates are rejected before identity rounding', () => {
  const invalid = [
    [[180.0000001, 20], [180, 20.1]],
    [[80, 90.0000001], [80.1, 90]],
    [[-180.0000001, 20], [-180, 20.1]],
  ];
  for (const geometry of invalid) {
    const candidate = route({ geometry });
    assert.equal(directionsRouteIdentity(candidate), null);
    const receipt = evaluateDirectionsDisasterAccess({
      route: candidate, segmentIds: ['bridge'],
      accessSegments: [segment('bridge')], accessRevision: 'r1',
    });
    assert.equal(receipt.support, 'unknown');
    assert.deepEqual(receipt.reasons, ['directions-route-unavailable']);
  }
  assert.match(directionsRouteIdentity(route({
    geometry: [[180, 90], [179.9999, 89.9999]],
  })), /^osrm:[0-9a-f]{16}$/);
});

test('malformed or chronologically impossible access times stay unknown', () => {
  const invalid = [
    { observedAt: 'not a timestamp' },
    { observedAt: '2026-02-30T08:00:00Z' },
    { observedAt: '2026-02-29T08:00:00Z' },
    { observedAt: '2026-08-26T08:00:61Z' },
    { observedAt: '2026-08-26T09:00:00Z' },
    { receivedAt: 'tomorrow' },
  ];
  for (const overrides of invalid) {
    const receipt = evaluateDirectionsDisasterAccess({
      route: route(), segmentIds: ['bridge'],
      accessSegments: [{ ...segment('bridge'), ...overrides }],
      accessRevision: 'r1',
    });
    assert.equal(receipt.support, 'unknown');
    assert.deepEqual(receipt.reasons, ['invalid-access-time:bridge']);
  }
  for (const observedAt of [
    '2026-08-26T13:30:00+05:30', '2026-08-26T08:00:00Z',
  ]) {
    const receipt = evaluateDirectionsDisasterAccess({
      route: route(), segmentIds: ['bridge'],
      accessSegments: [{ ...segment('bridge'), observedAt }],
      accessRevision: 'r1',
    });
    assert.equal(receipt.support, 'supported');
    assert.deepEqual(receipt.reasons, []);
  }
});
