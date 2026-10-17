// Source-to-presentation regression for quanticsoul4772's #848 review.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createObservedTrafficSource } from '../traffic/observed.js';
import { summarizeCameraTrafficObservation, indexCameraTrafficObservations } from './trafficObservations.js';

const now = Date.parse('2026-10-16T12:00:00Z');
const record = (cameraId, ageMs, overrides = {}) => ({
  id: `${cameraId}:approach`, cameraId, sourceId: 'fixture-observer',
  observedAt: now - ageMs,
  geometry: { type: 'intersection', coordinates: [-87.63, 41.88] },
  flow: { vehiclesPerMin: 18 },
  provenance: { source: 'Synthetic review fixture' },
  ...overrides,
});
const fromSource = (records, staleAfterMs) => createObservedTrafficSource({
  staleAfterMs, read: () => ({ records }),
}).request({}, { now });

test('mixed snapshot marks an expired camera stale under the source TTL', async () => {
  const snapshot = await fromSource([record('old', 180_000), record('fresh', 10_000)], 60_000);
  assert.equal(snapshot.state, 'partial');
  assert.equal(snapshot.staleCount, 1);
  assert.equal(summarizeCameraTrafficObservation(snapshot, 'old', { now }).state, 'stale');
  assert.equal(summarizeCameraTrafficObservation(snapshot, 'fresh', { now }).state, 'partial');
});

test('a longer source TTL does not spuriously expire a camera', async () => {
  const snapshot = await fromSource([record('camera', 600_000)], 3_600_000);
  assert.equal(snapshot.state, 'fresh');
  assert.equal(summarizeCameraTrafficObservation(snapshot, 'camera', { now }).state, 'fresh');
});

test('cached records age past the carried source TTL without a fetch', async () => {
  const snapshot = await fromSource([record('camera', 30_000)], 60_000);
  assert.equal(summarizeCameraTrafficObservation(snapshot, 'camera', { now }).state, 'fresh');
  assert.equal(summarizeCameraTrafficObservation(snapshot, 'camera', { now: now + 30_001 }).state, 'stale');
});

test('zero TTL remains zero instead of becoming the default', async () => {
  const snapshot = await fromSource([record('camera', 0)], 0);
  assert.equal(summarizeCameraTrafficObservation(snapshot, 'camera', { now }).state, 'fresh');
  assert.equal(summarizeCameraTrafficObservation(snapshot, 'camera', { now: now + 1 }).state, 'stale');
});

test('observation windows and preindexed lookups use the same expiry', async () => {
  const snapshot = await fromSource([
    record('camera', 600_000, { windowStart: now - 600_000, windowEnd: now - 90_000 }),
    record('sibling', 0),
  ], 60_000);
  const index = indexCameraTrafficObservations(snapshot);
  const summary = summarizeCameraTrafficObservation(snapshot, 'camera', { now, recordIndex: index });
  assert.equal(summary.ageMs, 90_000);
  assert.equal(summary.state, 'stale');
});

test('a presentation fallback cannot override source-owned validity', async () => {
  const snapshot = await fromSource([record('old', 180_000), record('fresh', 0)], 60_000);
  assert.equal(summarizeCameraTrafficObservation(snapshot, 'old', {
    now, staleAfterMs: 86_400_000,
  }).state, 'stale');
});

test('legacy snapshots keep the documented presentation fallback', () => {
  const snapshot = { configured: true, records: [record('camera', 180_000)] };
  assert.equal(summarizeCameraTrafficObservation(snapshot, 'camera', { now }).state, 'fresh');
  assert.equal(summarizeCameraTrafficObservation(snapshot, 'camera', { now, staleAfterMs: 60_000 }).state, 'stale');
});

test('retained source errors remain stale regardless of source TTL', async () => {
  const snapshot = await fromSource([record('camera', 1_000)], 3_600_000);
  snapshot.error = 'Observed traffic source unavailable';
  assert.equal(summarizeCameraTrafficObservation(snapshot, 'camera', { now }).state, 'stale');
});

test('producer payload cannot override the source expiry policy', async () => {
  const source = createObservedTrafficSource({
    staleAfterMs: 60_000,
    read: () => ({ staleAfterMs: 86_400_000, records: [record('old', 180_000), record('fresh', 0)] }),
  });
  const snapshot = await source.request({}, { now });
  assert.equal(snapshot.staleAfterMs, 60_000);
  assert.equal(summarizeCameraTrafficObservation(snapshot, 'old', { now }).state, 'stale');
});
