import test from 'node:test';
import assert from 'node:assert/strict';
import { compareTrafficScenarioRuns } from './trafficScenarioComparison.js';

const context = {
  networkRevision: 'synthetic:road-1',
  demandRevision: 'synthetic:demand-1',
  inputEvidenceRevision: 'synthetic:evidence-1',
  simulatorId: 'sumo',
  simulatorVersion: 'unverified:synthetic',
  evaluationRevision: 'sumo-stats-complete-v1',
  randomSeed: 7,
  windowStartMs: 0,
  windowEndMs: 60000,
};

function receipt(runId, planRevision, meanVehicleTimeLossSeconds) {
  return {
    runId,
    planRevision,
    determination: 'simulated',
    sourceRef: `synthetic:${runId}`,
    context,
    metrics: { meanVehicleTimeLossSeconds },
    quality: {
      sourceFormat: 'sumo-statistics',
      coverage: 'complete',
      reasonCodes: [],
      vehicleCounts: {
        loaded: 4,
        inserted: 4,
        running: 0,
        waiting: 0,
        tripStatisticsCount: 4,
      },
      teleports: 0,
      safety: { collisions: 0, emergencyStops: 0 },
    },
  };
}

test('SUMO vehicle time loss uses the correct unit and delta', () => {
  const result = compareTrafficScenarioRuns(
    receipt('baseline', 'fixed', 40),
    receipt('candidate', 'actuated', 30),
  );
  assert.equal(result.status, 'comparable');
  assert.deepEqual(result.metrics.meanVehicleTimeLossSeconds, {
    unit: 'seconds/vehicle',
    status: 'compared',
    baseline: 40,
    candidate: 30,
    delta: -10,
    percentChange: -25,
  });
  assert.equal(result.metrics.meanPersonDelaySeconds.status, 'missing');
});

test('unfinished vehicles or teleports block apparent gains', () => {
  for (const modify of [
    (x) => {
      x.quality.vehicleCounts.running = 1;
    },
    (x) => {
      x.quality.vehicleCounts.tripStatisticsCount = 3;
    },
    (x) => {
      x.quality.coverage = 'partial';
    },
    (x) => {
      x.quality.teleports = 1;
    },
    (x) => {
      x.quality.reasonCodes = ['unfinished-or-waiting-vehicles'];
    },
  ]) {
    const baseline = receipt('base', 'fixed', 40);
    const candidate = receipt('new', 'actuated', 10);
    modify(candidate);
    const result = compareTrafficScenarioRuns(baseline, candidate);
    assert.equal(result.status, 'unknown');
    assert.deepEqual(result.metrics, {});
  }
});

test('unknown format and missing coverage block comparisons', () => {
  const baseline = receipt('base', 'fixed', 40);
  const candidate = receipt('new', 'actuated', 10);
  candidate.quality.sourceFormat = 'other-model';
  assert.equal(
    compareTrafficScenarioRuns(baseline, candidate).reason,
    'source-format-mismatch',
  );
  delete candidate.quality;
  delete baseline.quality;
  assert.equal(
    compareTrafficScenarioRuns(baseline, candidate).reason,
    'missing-sumo-coverage',
  );
});

test('safety faults, absent safety and invalid counters reject simulated gains', () => {
  for (const mutate of [
    (x) => {
      x.quality.safety.collisions = 1;
    },
    (x) => {
      x.quality.safety.emergencyStops = 2;
    },
    (x) => {
      x.quality.safety.collisions = -1;
    },
    (x) => {
      x.quality.safety.emergencyStops = '0';
    },
    (x) => {
      delete x.quality.safety;
    },
  ]) {
    const candidate = receipt('new', 'actuated', 1);
    mutate(candidate);
    const result = compareTrafficScenarioRuns(
      receipt('base', 'fixed', 40), candidate,
    );
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'incomplete-simulation-coverage');
    assert.deepEqual(result.metrics, {});
  }
});

test('SUMO inputs still reject seed and demand mismatch', () => {
  for (const [field, changed] of [
    ['randomSeed', 8],
    ['demandRevision', 'synthetic:other-demand'],
  ]) {
    const candidate = receipt('new', 'actuated', 10);
    candidate.context = { ...context, [field]: changed };
    assert.equal(
      compareTrafficScenarioRuns(receipt('base', 'fixed', 40), candidate)
        .reason,
      'context-mismatch',
    );
  }
});
