import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emptyVisionSuitabilitySnapshot,
  formatVisionSuitabilityAge,
  indexVisionSuitabilityByCamera,
  normalizeVisionSuitabilityRecord,
  normalizeVisionSuitabilitySnapshot,
  summarizeVisionSuitability,
} from './visionSuitability.js';

const NOW = Date.parse('2026-09-29T06:00:00Z');

function record(overrides = {}) {
  return {
    cameraId: 'cam-1',
    status: 'ready',
    medianObjectPx: 42,
    usableShare: 0.76,
    reason: 'Roadway occupies the lower half of frame',
    measuredAt: NOW - 30_000,
    provenance: {
      source: 'External camera qualification',
      method: 'recorded-fixture',
    },
    ...overrides,
  };
}

test('normalizes provider-neutral suitability without inventing thresholds', () => {
  const normalized = normalizeVisionSuitabilityRecord(record());
  assert.deepEqual(normalized, record());
});

test('non-unknown suitability claims require timestamp and provenance', () => {
  assert.equal(
    normalizeVisionSuitabilityRecord(record({ measuredAt: null })),
    null,
  );
  assert.equal(
    normalizeVisionSuitabilityRecord(record({ provenance: null })),
    null,
  );
  assert.ok(
    normalizeVisionSuitabilityRecord({
      cameraId: 'cam-1',
      status: 'unknown',
      reason: 'Not qualified yet',
    }),
  );
});

test('rejects invalid status and out-of-range optional metrics', () => {
  assert.equal(
    normalizeVisionSuitabilityRecord(record({ status: 'excellent' })),
    null,
  );
  const normalized = normalizeVisionSuitabilityRecord(
    record({ medianObjectPx: -1, usableShare: 2 }),
  );
  assert.equal('medianObjectPx' in normalized, false);
  assert.equal('usableShare' in normalized, false);
});

test('snapshot drops malformed siblings and sanitizes provider errors', () => {
  const snapshot = normalizeVisionSuitabilitySnapshot({
    source: 'fixture',
    partial: false,
    records: [record(), record({ cameraId: '', status: 'ready' })],
    error: 'token=secret upstream exploded',
  });
  assert.equal(snapshot.accepted, 1);
  assert.equal(snapshot.dropped, 1);
  assert.equal(snapshot.partial, true);
  assert.equal(snapshot.error, 'Vision qualification unavailable');
  assert.ok(!JSON.stringify(snapshot).includes('secret'));
});

test('absent source remains unconfigured and produces no presentation', () => {
  const snapshot = emptyVisionSuitabilitySnapshot();
  assert.equal(snapshot.configured, false);
  assert.equal(
    summarizeVisionSuitability(snapshot, 'cam-1', { now: NOW }),
    null,
  );
});

test('configured source without camera data is explicitly unknown', () => {
  const summary = summarizeVisionSuitability(
    normalizeVisionSuitabilitySnapshot({ source: 'fixture', records: [] }),
    'cam-1',
    { now: NOW },
  );
  assert.equal(summary.status, 'unknown');
  assert.equal(summary.label, 'VISION · UNKNOWN');
  assert.equal(summary.detail, 'No qualification data');
});

test('ready record preserves producer status, provenance, age and metrics', () => {
  const summary = summarizeVisionSuitability(
    normalizeVisionSuitabilitySnapshot({
      source: 'fixture',
      records: [record()],
    }),
    'cam-1',
    { now: NOW },
  );
  assert.equal(summary.status, 'ready');
  assert.equal(summary.label, 'VISION · READY');
  assert.match(summary.detail, /30s ago/);
  assert.match(summary.detail, /External camera qualification/);
  assert.match(summary.detail, /median 42px/);
  assert.match(summary.detail, /76% usable/);
  assert.deepEqual(summary.cardDetails, [
    'VISION READY',
    '30s ago · External camera qualification',
  ]);
});

test('source errors fail closed even when last-known READY metadata exists', () => {
  const summary = summarizeVisionSuitability(
    normalizeVisionSuitabilitySnapshot({
      source: 'fixture',
      error: 'provider down',
      records: [record()],
    }),
    'cam-1',
    { now: NOW },
  );
  assert.equal(summary.status, 'unknown');
  assert.equal(summary.label, 'VISION · UNKNOWN');
  assert.match(summary.detail, /Qualification source unavailable/);
  assert.match(summary.detail, /last ready/);
  assert.deepEqual(summary.cardDetails, []);
});

test('freshest qualification record wins per camera', () => {
  const snapshot = normalizeVisionSuitabilitySnapshot({
    records: [
      record({ status: 'marginal', measuredAt: NOW - 60_000 }),
      record({ status: 'unsuitable', measuredAt: NOW - 10_000 }),
    ],
  });
  const index = indexVisionSuitabilityByCamera(snapshot);
  assert.equal(index.get('cam-1').status, 'unsuitable');
});

test('age formatter stays compact', () => {
  assert.equal(formatVisionSuitabilityAge(18_000), '18s ago');
  assert.equal(formatVisionSuitabilityAge(120_000), '2m ago');
  assert.equal(formatVisionSuitabilityAge(7_200_000), '2h ago');
});
