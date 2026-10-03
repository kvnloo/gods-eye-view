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

function accessSegment(id, state = 'open') {
  return {
    id,
    state,
    determination: 'simulated',
    observedAt: '2026-08-26T08:00:00Z',
    receivedAt: '2026-08-26T08:01:00Z',
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
      accessRevision: 'bhote-koshi-access-r1',
    }),
    true,
  );

  const changedPacket = buildBhoteKoshiDisasterAccessPacket(event, {
    accessSegments: segmentIds.map((id) =>
      id === 'replay-bridge-b'
        ? accessSegment(id, 'blocked')
        : accessSegment(id),
    ),
  });

  assert.equal(
    isDirectionsDisasterAccessCurrent(baseline, {
      route: directionsRoute,
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
  assert.equal(changedPacket.evidence.observations.length, 16);
  assert.equal(
    changedPacket.access.segments.find(
      (segment) => segment.id === 'replay-bridge-b',
    ).determination,
    'simulated',
  );
  assert.equal(
    JSON.stringify({ baseline, recomputed }).toLowerCase().includes('safe'),
    false,
  );
});
