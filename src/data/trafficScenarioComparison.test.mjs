import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareTrafficScenarioRuns,
  TRAFFIC_SCENARIO_METRICS,
} from './trafficScenarioComparison.js';

function receipt({ runId = 'base', planRevision = 'fixed-time', ...changes } = {}) {
  return {
    runId,
    planRevision,
    determination: 'simulated',
    sourceRef: `local-fixture:${runId}`,
    context: {
      networkRevision: 'osm:cor-1',
      demandRevision: 'count:2026-10-12',
      inputEvidenceRevision: 'synthetic:fixture-1',
      simulatorId: 'sumo',
      simulatorVersion: '1.x',
      evaluationRevision: 'person-delay-v1',
      randomSeed: 7,
      windowStartMs: 1000,
      windowEndMs: 61000,
    },
    metrics: { meanPersonDelaySeconds: 40, maxQueueVehicles: 12 },
    ...changes,
  };
}

const compare = (left, right) =>
  compareTrafficScenarioRuns(
    receipt(left),
    receipt({ runId: 'candidate', planRevision: 'coordinated', ...right }),
  );

test('same input context: signed delta and source identities, never a winner', () => {
  const result = compare(
    {},
    { metrics: { meanPersonDelaySeconds: 30, maxQueueVehicles: 9 } },
  );
  assert.equal(result.status, 'comparable');
  assert.equal(result.determination, 'simulated');
  assert.equal(result.baselineSourceRef, 'local-fixture:base');
  assert.equal(result.candidatePlanRevision, 'coordinated');
  assert.deepEqual(result.metrics.meanPersonDelaySeconds, {
    unit: 'seconds/person',
    status: 'compared',
    baseline: 40,
    candidate: 30,
    delta: -10,
    percentChange: -25,
  });
  assert.equal(result.metrics.maxQueueVehicles.delta, -3);
  assert.equal('winner' in result, false);
});

test('a true zero is compared, missing metrics never default to zero', () => {
  const result = compare(
    { metrics: { meanPersonDelaySeconds: 0, maxQueueVehicles: 0 } },
    { metrics: { meanPersonDelaySeconds: 2 } },
  );
  assert.equal(result.metrics.meanPersonDelaySeconds.baseline, 0);
  assert.equal(result.metrics.meanPersonDelaySeconds.delta, 2);
  assert.equal(result.metrics.meanPersonDelaySeconds.percentChange, null);
  assert.equal(result.metrics.maxQueueVehicles.status, 'missing');
  assert.equal(result.metrics.maxQueueVehicles.delta, null);
  assert.equal(result.metrics.transitDelaySeconds.status, 'missing');
});

test('drift of network, demand, evidence, simulator, seed, time or evaluation blocks comparison', () => {
  for (const key of Object.keys(receipt().context)) {
    const original = receipt().context;
    const next = {
      ...original,
      [key]:
        typeof original[key] === 'number'
          ? original[key] + 1
          : `${original[key]}:changed`,
    };
    const result = compare({}, { context: next });
    assert.equal(result.status, 'incomparable', key);
    assert.equal(result.reason, 'context-mismatch', key);
    assert.deepEqual(result.differingFields, [key], key);
    assert.deepEqual(result.metrics, {}, key);
  }
});

test('invalid and incomplete contexts are unknown, not equivalent', () => {
  const bad = [
    null,
    {},
    { ...receipt(), determination: 'observed' },
    { ...receipt(), sourceRef: '' },
    { ...receipt(), context: { ...receipt().context, demandRevision: '' } },
    { ...receipt(), context: { ...receipt().context, randomSeed: -1 } },
    { ...receipt(), context: { ...receipt().context, windowEndMs: 1000 } },
  ];
  for (const run of bad) {
    const result = compareTrafficScenarioRuns(receipt(), run);
    assert.equal(result.status, 'unknown', JSON.stringify(run));
    assert.deepEqual(result.metrics, {});
  }
});

test('identical run IDs cannot be a baseline versus candidate', () => {
  assert.equal(compareTrafficScenarioRuns(receipt(), receipt()).reason, 'same-run');
});

test('non-finite, negative and coerced metric values are never compared', () => {
  for (const value of [NaN, Infinity, -1, '4', true]) {
    const result = compare(
      {},
      { metrics: { meanPersonDelaySeconds: value } },
    );
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'no-comparable-metrics');
    assert.equal(result.metrics.meanPersonDelaySeconds.status, 'invalid');
  }
});

test('no mutation, deterministic receipts, and bounded known metrics only', () => {
  const baseline = receipt();
  const candidate = receipt({
    runId: 'candidate',
    metrics: { meanPersonDelaySeconds: 20, customMetric: 999 },
  });
  const before = JSON.stringify({ baseline, candidate });
  const first = compareTrafficScenarioRuns(baseline, candidate);
  assert.deepEqual(first, compareTrafficScenarioRuns(baseline, candidate));
  assert.equal(JSON.stringify({ baseline, candidate }), before);
  assert.deepEqual(
    Object.keys(first.metrics),
    Object.keys(TRAFFIC_SCENARIO_METRICS),
  );
  assert.notEqual(first.context, baseline.context);
});

test('tiny but finite baselines cannot emit an infinite percentage', () => {
  const result = compare(
    { metrics: { meanPersonDelaySeconds: Number.MIN_VALUE } },
    { metrics: { meanPersonDelaySeconds: Number.MAX_VALUE } },
  );
  assert.equal(result.status, 'comparable');
  assert.equal(result.metrics.meanPersonDelaySeconds.percentChange, null);
});
