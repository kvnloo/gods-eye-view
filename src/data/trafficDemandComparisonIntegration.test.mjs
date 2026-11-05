import test from 'node:test';
import assert from 'node:assert/strict';
import { enumerateFixedMarginDemand2x2 } from './trafficDemandEnsemble.js';
import { compareTrafficScenarioRuns } from './trafficScenarioComparison.js';

// These are synthetic *simulation receipts*, not observations or predictions.
// Matching demandRevision is necessary but not proof that the simulated
// traffic represents real road conditions.
function simulatedRun(scenario, planRevision, metrics, changes = {}) {
  return {
    runId: 'sim-' + scenario.scenarioId + '-' + planRevision,
    planRevision,
    sourceRef: 'fixture:external-simulator-' + planRevision,
    determination: 'simulated',
    context: {
      networkRevision: 'osm:synthetic-corridor-r1',
      demandRevision: scenario.demandRevision,
      inputEvidenceRevision: scenario.sourceRevision,
      simulatorId: 'sumo',
      simulatorVersion: 'fixture-only-v1',
      evaluationRevision: 'person-delay-v1',
      randomSeed: 7,
      windowStartMs: 0,
      windowEndMs: 60000,
    },
    metrics,
    ...changes,
  };
}

test('each OD table permits within-table timing comparison but not between-table comparisons', () => {
  const family = enumerateFixedMarginDemand2x2({
    rowTotals: [3, 2], columnTotals: [2, 3], sourceRevision: 'synthetic-r1',
  });
  assert.equal(family.status, 'complete');
  assert.equal(family.scenarios.length, 3);
  for (const demand of family.scenarios) {
    const baseline = simulatedRun(demand, 'fixed-time', { meanPersonDelaySeconds: 40 });
    const candidate = simulatedRun(demand, 'coordinated', { meanPersonDelaySeconds: 30 });
    const sameDemand = compareTrafficScenarioRuns(baseline, candidate);
    assert.equal(sameDemand.status, 'comparable');
    assert.equal(sameDemand.context.demandRevision, demand.demandRevision);
    assert.equal(sameDemand.metrics.meanPersonDelaySeconds.delta, -10);
    assert.equal(sameDemand.determination, 'simulated');
    assert.equal('safe' in sameDemand, false);
    assert.equal('winner' in sameDemand, false);
  }
  const different = compareTrafficScenarioRuns(
    simulatedRun(family.scenarios[0], 'fixed-time', { meanPersonDelaySeconds: 40 }),
    simulatedRun(family.scenarios[1], 'coordinated', { meanPersonDelaySeconds: 30 }),
  );
  assert.equal(different.status, 'incomparable');
  assert.deepEqual(different.differingFields, ['demandRevision']);
});

test('changing demand source revision also makes outputs incomparable', () => {
  const a = enumerateFixedMarginDemand2x2({
    rowTotals: [3, 2], columnTotals: [2, 3], sourceRevision: 'synthetic-r1',
  }).scenarios[0];
  const b = enumerateFixedMarginDemand2x2({
    rowTotals: [3, 2], columnTotals: [2, 3], sourceRevision: 'synthetic-r2',
  }).scenarios[0];
  assert.deepEqual(a.table, b.table);
  const result = compareTrafficScenarioRuns(
    simulatedRun(a, 'fixed-time', { meanPersonDelaySeconds: 40 }),
    simulatedRun(b, 'coordinated', { meanPersonDelaySeconds: 30 }),
  );
  assert.equal(result.status, 'incomparable');
  assert.deepEqual(result.differingFields, ['demandRevision', 'inputEvidenceRevision']);
});

test('scenario generator is not itself a simulated run', () => {
  const synthetic = enumerateFixedMarginDemand2x2({
    rowTotals: [3, 2], columnTotals: [2, 3], sourceRevision: 'synthetic-r1',
  }).scenarios[0];
  const compare = compareTrafficScenarioRuns(synthetic, synthetic);
  assert.equal(compare.status, 'unknown');
  assert.equal(compare.reason, 'not-simulated');
});

test('missing simulation outputs never turn into zero benefit claims', () => {
  const demand = enumerateFixedMarginDemand2x2({
    rowTotals: [3, 2], columnTotals: [2, 3], sourceRevision: 'synthetic-r1',
  }).scenarios[0];
  const missing = compareTrafficScenarioRuns(
    simulatedRun(demand, 'fixed-time', { maxQueueVehicles: 0 }),
    simulatedRun(demand, 'coordinated', { maxQueueVehicles: null }),
  );
  assert.equal(missing.status, 'unknown');
  assert.equal(missing.metrics.maxQueueVehicles.status, 'missing');
  assert.equal(missing.metrics.maxQueueVehicles.delta, null);
  assert.equal(missing.metrics.maxQueueVehicles.baseline, null);
});

test('random seed drift invalidates fixed-demand comparison', () => {
  const demand = enumerateFixedMarginDemand2x2({
    rowTotals: [3, 2], columnTotals: [2, 3], sourceRevision: 'synthetic-r1',
  }).scenarios[0];
  const baseline = simulatedRun(demand, 'fixed-time', { meanPersonDelaySeconds: 40 });
  const candidate = simulatedRun(demand, 'coordinated', { meanPersonDelaySeconds: 30 });
  const changed = {
    ...candidate,
    context: { ...candidate.context, randomSeed: 8 },
  };
  assert.deepEqual(compareTrafficScenarioRuns(baseline, changed).differingFields, ['randomSeed']);
});
