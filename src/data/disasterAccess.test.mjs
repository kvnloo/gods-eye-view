import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDisasterAccessPacket,
  evaluateDisasterRouteSupport,
  normalizeDisasterAccessSegment,
} from './disasterAccess.js';

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

test('missing access remains explicitly not assessed', () => {
  const packet = buildDisasterAccessPacket({
    event: {
      id: 'bhote-koshi-2026',
      title: 'Bhote Koshi Outburst Flood',
      observedDate: '2026-08-26',
    },
  });

  assert.equal(packet.event.id, 'bhote-koshi-2026');
  assert.deepEqual(packet.access.segments, []);
  assert.deepEqual(packet.gaps, ['access-not-assessed']);
});

test('a fresh blocked segment invalidates an otherwise supported candidate', () => {
  const route = { id: 'relief-a', segmentIds: ['a', 'b', 'c'] };
  const baseline = [
    segment('a'),
    segment('b'),
    segment('c'),
  ];

  assert.equal(
    evaluateDisasterRouteSupport(route, baseline).support,
    'supported',
  );

  const outage = baseline.map((entry) =>
    entry.id === 'b' ? segment('b', 'blocked') : entry,
  );
  const result = evaluateDisasterRouteSupport(route, outage);

  assert.equal(result.support, 'unsupported');
  assert.deepEqual(result.reasons, ['blocked:b']);
});

test('stale open evidence cannot support a current-open route claim', () => {
  const result = evaluateDisasterRouteSupport(
    { id: 'relief-a', segmentIds: ['a'] },
    [segment('a', 'open', 'stale')],
  );

  assert.equal(result.support, 'unknown');
  assert.deepEqual(result.reasons, ['stale-access:a']);
});

test('unknown, not-assessed and missing segments remain unknown', () => {
  const access = [
    segment('a', 'unknown'),
    segment('b', 'not-assessed'),
  ];
  const result = evaluateDisasterRouteSupport(
    { id: 'relief-a', segmentIds: ['a', 'b', 'c'] },
    access,
  );

  assert.equal(result.support, 'unknown');
  assert.deepEqual(result.reasons, [
    'unknown:a',
    'not-assessed:b',
    'missing-access:c',
  ]);
});

test('fresh degraded evidence stays distinct from open', () => {
  const result = evaluateDisasterRouteSupport(
    { id: 'relief-a', segmentIds: ['a', 'b'] },
    [segment('a'), segment('b', 'degraded')],
  );

  assert.equal(result.support, 'degraded');
  assert.deepEqual(result.reasons, ['degraded:b']);
});

test('invalid state fails closed to unknown instead of disappearing', () => {
  const normalized = normalizeDisasterAccessSegment({
    id: 'a',
    state: 'probably-open',
    determination: 'declared',
    freshness: 'fresh',
  });

  assert.equal(normalized.state, 'unknown');
  assert.equal(normalized.determination, 'declared');
  assert.equal(
    evaluateDisasterRouteSupport(
      { id: 'relief-a', segmentIds: ['a'] },
      [normalized],
    ).support,
    'unknown',
  );
});

test('candidate with no mapped access segments is unknown', () => {
  const result = evaluateDisasterRouteSupport(
    { id: 'relief-a', segmentIds: [] },
    [],
  );

  assert.equal(result.support, 'unknown');
  assert.deepEqual(result.reasons, ['route-segments-not-mapped']);
});

test('packet results use evidence-support language, never a safety verdict', () => {
  const packet = buildDisasterAccessPacket({
    accessSegments: [segment('a')],
    candidateRoutes: [{ id: 'relief-a', segmentIds: ['a'] }],
  });

  assert.equal(packet.routes[0].support, 'supported');
  assert.equal(JSON.stringify(packet).toLowerCase().includes('safe'), false);
});

test('conflicting segment states fail closed in either order', () => {
  const route = { id: 'relief-bridge', segmentIds: ['bridge'] };
  const observations = [
    segment('bridge', 'open'),
    segment('bridge', 'blocked'),
  ];
  for (const ordered of [observations, [...observations].reverse()]) {
    const result = evaluateDisasterRouteSupport(route, ordered);
    assert.equal(result.support, 'unknown');
    assert.deepEqual(result.reasons, ['conflicting-access:bridge']);
  }
});

test('matching duplicates preserve support; stale conflicts do not', () => {
  const route = { id: 'relief-bridge', segmentIds: ['bridge'] };
  const same = [segment('bridge'), segment('bridge')];
  assert.equal(evaluateDisasterRouteSupport(route, same).support, 'supported');

  const mixed = [segment('bridge'), segment('bridge', 'open', 'stale')];
  for (const ordered of [mixed, [...mixed].reverse()]) {
    const result = evaluateDisasterRouteSupport(route, ordered);
    assert.equal(result.support, 'unknown');
    assert.deepEqual(result.reasons, ['conflicting-access:bridge']);
  }
});

test('mixed observed and simulated declarations remain unknown', () => {
  const route = { id: 'relief-bridge', segmentIds: ['bridge'] };
  const observed = segment('bridge');
  const simulated = { ...segment('bridge'), determination: 'simulated' };
  for (const ordered of [[observed, simulated], [simulated, observed]]) {
    const result = evaluateDisasterRouteSupport(route, ordered);
    assert.equal(result.support, 'unknown');
    assert.deepEqual(result.reasons, ['conflicting-access:bridge']);
  }
});

test('malformed access collections remain unknown without throwing', () => {
  const route = { id: 'relief-a', segmentIds: ['a'] };
  for (const accessSegments of [null, {}, 'open']) {
    const evaluation = evaluateDisasterRouteSupport(route, accessSegments);
    assert.equal(evaluation.support, 'unknown');
    assert.deepEqual(evaluation.reasons, ['missing-access:a']);
  }
});

test('invalid packet collections are reported as evidence gaps', () => {
  const route = { id: 'relief-a', segmentIds: ['a'] };
  for (const accessSegments of [null, {}]) {
    const packet = buildDisasterAccessPacket({
      accessSegments,
      candidateRoutes: [route],
    });
    assert.equal(packet.routes[0].support, 'unknown');
    assert.deepEqual(packet.gaps, [
      'invalid-access-collection',
      'access-not-assessed',
    ]);
  }
});

test('malformed route collection cannot produce unreviewed candidates', () => {
  const packet = buildDisasterAccessPacket({
    accessSegments: [segment('a')],
    candidateRoutes: null,
  });
  assert.deepEqual(packet.routes, []);
  assert.deepEqual(packet.gaps, ['invalid-route-collection']);
});
