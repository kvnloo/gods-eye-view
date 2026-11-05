import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildBhoteKoshiDisasterAccessPacket } from './bhoteKoshiDisasterAccess.js';
import {
  evaluateDirectionsDisasterAccess,
  isDirectionsDisasterAccessCurrent,
} from './disasterDirections.js';

const eventUrl = new URL(
  '../../public/events/bhote-koshi-2026/event.json',
  import.meta.url,
);
const event = JSON.parse(await readFile(eventUrl, 'utf8'));

// Attributed access inputs are synthetic contract fixtures, not road observations.
function accessSegment(id, state = 'open', {
  determination = 'declared',
  observedAt = '2026-08-26T08:00:00Z',
  receivedAt = '2026-08-26T08:01:00Z',
} = {}) {
  return {
    id,
    state,
    determination,
    observedAt,
    receivedAt,
    freshness: 'fresh',
    provenance: { source: 'deterministic-replay-fixture' },
  };
}

const directionsRoute = Object.freeze({
  mode: 'car',
  distanceM: 18_420,
  durationS: 2_040,
  geometry: Object.freeze([
    Object.freeze([85.148, 27.925]),
    Object.freeze([85.188, 27.947]),
    Object.freeze([85.228, 27.969]),
  ]),
});

const segmentIds = Object.freeze([
  'replay-road-a',
  'replay-bridge-b',
  'replay-road-c',
]);

test('Bhote Koshi replay invalidates the old Directions receipt after a blocked access mutation', () => {
  const baselinePacket = buildBhoteKoshiDisasterAccessPacket(event, {
    accessSegments: segmentIds.map((id) => accessSegment(id)),
  });
  const baseline = evaluateDirectionsDisasterAccess({
    route: directionsRoute,
    segmentIds,
    accessSegments: baselinePacket.access.segments,
    accessRevision: 'bhote-koshi-access-r1',
  });

  assert.equal(baselinePacket.evidence.observations.length, 16);
  assert.equal(baseline.support, 'supported');
  assert.equal(
    isDirectionsDisasterAccessCurrent(baseline, {
      route: directionsRoute,
      segmentIds,
      accessRevision: 'bhote-koshi-access-r1',
    }),
    true,
  );

  const changedPacket = buildBhoteKoshiDisasterAccessPacket(event, {
    accessSegments: segmentIds.map((id) =>
      id === 'replay-bridge-b'
        ? accessSegment(id, 'blocked', {
            observedAt: '2026-08-26T08:05:00Z',
            receivedAt: '2026-08-26T08:06:00Z',
          })
        : accessSegment(id),
    ),
  });

  assert.equal(
    isDirectionsDisasterAccessCurrent(baseline, {
      route: directionsRoute,
      segmentIds,
      accessRevision: 'bhote-koshi-access-r2',
    }),
    false,
  );

  const recomputed = evaluateDirectionsDisasterAccess({
    route: directionsRoute,
    segmentIds,
    accessSegments: changedPacket.access.segments,
    accessRevision: 'bhote-koshi-access-r2',
  });

  assert.equal(recomputed.route.id, baseline.route.id);
  assert.equal(recomputed.support, 'unsupported');
  assert.deepEqual(recomputed.reasons, ['blocked:replay-bridge-b']);
  assert.equal(
    isDirectionsDisasterAccessCurrent(recomputed, {
      route: directionsRoute,
      segmentIds,
      accessRevision: 'bhote-koshi-access-r2',
    }),
    true,
  );
  assert.equal(changedPacket.evidence.observations.length, 16);
  assert.equal(
    changedPacket.access.segments.find(
      (segment) => segment.id === 'replay-bridge-b',
    ).determination,
    'declared',
  );
  assert.equal(
    JSON.stringify({ baseline, recomputed }).toLowerCase().includes('safe'),
    false,
  );
});

test('a simulated closure is diagnostic only, never operational route support', () => {
  const packet = buildBhoteKoshiDisasterAccessPacket(event, {
    accessSegments: segmentIds.map((id) =>
      accessSegment(id, id === 'replay-bridge-b' ? 'blocked' : 'open', {
        determination: 'simulated',
      }),
    ),
  });
  const result = evaluateDirectionsDisasterAccess({
    route: directionsRoute,
    segmentIds,
    accessSegments: packet.access.segments,
    accessRevision: 'bhote-koshi-simulation-r1',
  });

  assert.equal(result.support, 'unknown');
  assert.ok(result.reasons.includes('blocked:replay-bridge-b'));
  assert.ok(
    result.reasons.includes('unverified-access-basis:replay-bridge-b'),
  );
  assert.equal(packet.evidence.observations.length, 16);
  assert.equal(packet.access.segments[1].determination, 'simulated');
});

test('stale-open and unmapped access never imply OSRM route clearance', () => {
  const stale = evaluateDirectionsDisasterAccess({
    route: directionsRoute,
    segmentIds: ['replay-bridge-b'],
    accessSegments: [
      { ...accessSegment('replay-bridge-b'), freshness: 'stale' },
    ],
    accessRevision: 'stale-r1',
  });
  assert.equal(stale.support, 'unknown');
  assert.deepEqual(stale.reasons, ['stale-access:replay-bridge-b']);

  const unmapped = evaluateDirectionsDisasterAccess({
    route: directionsRoute,
    accessSegments: [accessSegment('replay-bridge-b')],
    accessRevision: 'mapped-r1',
  });
  assert.equal(unmapped.support, 'unknown');
  assert.deepEqual(unmapped.reasons, ['route-segments-not-mapped']);
});

test('without an access packet the OSRM candidate is unchanged and access stays unknown', () => {
  const routeSnapshot = JSON.stringify(directionsRoute);
  const withoutAccess = evaluateDirectionsDisasterAccess({
    route: directionsRoute,
    segmentIds,
  });

  assert.equal(JSON.stringify(directionsRoute), routeSnapshot);
  assert.equal(withoutAccess.route.source, 'osrm');
  assert.equal(withoutAccess.route.distanceM, directionsRoute.distanceM);
  assert.equal(withoutAccess.route.durationS, directionsRoute.durationS);
  assert.equal(withoutAccess.support, 'unknown');
  assert.deepEqual(withoutAccess.reasons, ['access-revision-missing']);
  assert.equal(
    isDirectionsDisasterAccessCurrent(withoutAccess, {
      route: directionsRoute,
      segmentIds,
    }),
    false,
  );
});
