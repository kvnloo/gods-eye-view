import test from 'node:test';
import assert from 'node:assert/strict';
import { replaySyntheticReliefOutage } from './reliefOutageReplay.js';
import { compareSyntheticReliefCapacity } from './reliefCapacityBenchmark.js';

function fixture() {
  const vehicles = [
    { id: 'truck-a', depotId: 'depot-a', capacityUnits: 4, earliestMinute: 0, latestMinute: 120 },
    { id: 'truck-b', depotId: 'depot-a', capacityUnits: 1, earliestMinute: 0, latestMinute: 120 },
  ];
  const zones = [
    { id: 'zone-west', needUnits: 4, priorityWeight: 2, earliestMinute: 0, latestMinute: 120 },
    { id: 'zone-east', needUnits: 1, priorityWeight: 1, earliestMinute: 0, latestMinute: 120 },
  ];
  const times = [[8, 1], [1, null]];
  return {
    studyId: 'idai-style-synthetic', sourceRef: 'synthetic:fictional-no-live-data',
    determination: 'hypothetical', datasetKind: 'synthetic',
    worldRevision: 'world-r1', stockRevision: 'stock-r1', fleetRevision: 'fleet-r1',
    needRevision: 'needs-r1', accessRevision: 'access-r1', routeRevision: 'routes-r1',
    policyRevision: 'policy-r1',
    policy: { objective: 'serve-units-then-priority-then-time' },
    depots: [{ id: 'depot-a', stockUnits: 5 }],
    vehicles, zones,
    routes: vehicles.flatMap((vehicle, i) => zones.map((zone, j) => ({
      vehicleId: vehicle.id, zoneId: zone.id,
      status: times[i][j] === null ? 'blocked' : 'supported',
      travelMinutes: times[i][j], evidenceRef: 'synthetic:route-evidence-r1',
    }))),
  };
}

function run(baseline = fixture(), change = {}) {
  return replaySyntheticReliefOutage({ baseline, change: {
    vehicleId: 'truck-a', zoneId: 'zone-west',
    accessRevision: 'access-r2', routeRevision: 'routes-r2',
    evidenceRef: 'synthetic:road-closure-r2',
    ...change,
  } });
}

test('outage on the critical synthetic road changes both exact and nearest-first outcomes', () => {
  const result = run();
  assert.equal(result.status, 'evaluated');
  assert.equal(result.historicalBaseline.knownOnlyExhaustive.servedUnits, 4);
  assert.equal(result.historicalBaseline.knownOnlyNearestFirst.servedUnits, 2);
  assert.equal(result.revisedScenario.knownOnlyExhaustive.servedUnits, 2);
  assert.equal(result.syntheticDelta.knownOnlyServedUnits, -2);
  assert.equal(result.syntheticDelta.knownOnlyNearestFirstUnits, 0);
  assert.equal(result.baselineReceiptCurrent, false);
  assert.equal(result.historicalBaseline.accessRevision, 'access-r1');
  assert.equal(result.revisedScenario.accessRevision, 'access-r2');
});

test('replay changes exactly one route and preserves stock, need, fleet and policy revisions', () => {
  const baseline = fixture(); const saved = JSON.stringify(baseline);
  const result = run(baseline);
  assert.equal(JSON.stringify(baseline), saved);
  assert.deepEqual(result.inputIdentities, {
    studyId: baseline.studyId, sourceRef: baseline.sourceRef,
    worldRevision: baseline.worldRevision, stockRevision: baseline.stockRevision,
    fleetRevision: baseline.fleetRevision, needRevision: baseline.needRevision,
    policyRevision: baseline.policyRevision,
  });
  assert.equal(result.injectedChange.previousStatus, 'supported');
  assert.equal(result.injectedChange.currentStatus, 'blocked');
  assert.equal(result.injectedChange.currentEvidenceRef, 'synthetic:road-closure-r2');
  assert.deepEqual(result, run(baseline));
  assert.ok(Object.isFrozen(result.revisedScenario.knownOnlyExhaustive.assignments));
});

test('the synthetic replay can lose accessibility without pretending any route is safe', () => {
  const result = run();
  assert.equal(result.authority, 'none');
  assert.equal(result.implementation, 'not-authorized');
  assert.equal(result.determination, 'hypothetical');
  assert.equal(result.accessClaim, 'not-evaluated');
  assert.equal('safe' in result, false);
  assert.equal('dispatch' in result, false);
  assert.equal('approved' in result, false);
});

test('incomplete baseline matrix does not acquire a fabricated solution', () => {
  const x = fixture(); x.routes.pop();
  const r = run(x);
  assert.equal(r.status, 'unknown');
  assert.equal(r.reason, 'invalid-or-incomplete-baseline');
  assert.equal(r.baselineStatus, 'unknown');
  assert.equal('syntheticDelta' in r, false);
});

test('unknown access elsewhere remains unknown rather than included as a delivery', () => {
  const x = fixture();
  x.routes[1] = { ...x.routes[1], status: 'unknown', travelMinutes: null };
  const r = run(x);
  assert.equal(r.status, 'limited');
  assert.equal(r.historicalBaseline.unknownRoutes, 1);
  assert.equal(r.revisedScenario.unknownRoutes, 1);
  assert.equal(r.revisedScenario.status, 'limited');
  assert.equal(r.revisedScenario.knownOnlyExhaustive.assignments.every(
    a => a.evidenceRef !== x.routes[1].evidenceRef || a.zoneId !== x.routes[1].zoneId,
  ), true);
  assert.equal(r.syntheticDelta.knownOnlyServedUnits <= 0, true);
});

test('attempting a second closure of a known-blocked route is not treated as new evidence', () => {
  const r = run(fixture(), { vehicleId: 'truck-b', zoneId: 'zone-east' });
  assert.equal(r.status, 'unknown');
  assert.equal(r.reason, 'outage-route-not-supported');
  assert.equal('historicalBaseline' in r, false);
});

test('no implicit route inference for unknown/absent pair identity', () => {
  const r = run(fixture(), { vehicleId: 'truck-absent' });
  assert.equal(r.status, 'unknown');
  assert.equal(r.reason, 'outage-route-not-mapped');
});

test('route revision and evidence revision must advance for a replay', () => {
  assert.throws(() => run(fixture(), { accessRevision: 'access-r1' }), /distinct/);
  assert.throws(() => run(fixture(), { routeRevision: 'routes-r1' }), /distinct/);
  assert.throws(() => run(fixture(), { evidenceRef: 'synthetic:route-evidence-r1' }), /new evidenceRef/);
  assert.throws(() => run(fixture(), { evidenceRef: 'https://example.com/live-location' }), /synthetic evidence/);
});

test('same outcome after non-critical synthetic closure is valid, not forced into a gain claim', () => {
  const x = fixture();
  // This edge is redundant for the baseline exact four-unit plan.
  const r = run(x, { vehicleId: 'truck-a', zoneId: 'zone-east' });
  assert.equal(r.status, 'evaluated');
  assert.equal(r.syntheticDelta.knownOnlyServedUnits, 0);
  assert.equal(r.revisedScenario.knownOnlyExhaustive.servedUnits, 4);
});

test('changing fleet stock or need changes the baseline identity and result', () => {
  const x = fixture(); x.depots[0].stockUnits = 1; x.stockRevision = 'stock-r2';
  const r = run(x);
  assert.equal(r.inputIdentities.stockRevision, 'stock-r2');
  assert.equal(r.historicalBaseline.knownOnlyExhaustive.servedUnits, 1);
  assert.equal(r.revisedScenario.knownOnlyExhaustive.servedUnits, 1);
});

test('outage exact objective matches independent known pair-case reasoning', () => {
  const x = fixture();
  for (let vehicle = 0; vehicle < 2; vehicle++) for (let zone = 0; zone < 2; zone++) {
    const chosen = x.routes[vehicle * 2 + zone];
    if (chosen.status !== 'supported') continue;
    const got = run(x, { vehicleId: chosen.vehicleId, zoneId: chosen.zoneId });
    const copy = structuredClone(x);
    copy.routes[vehicle * 2 + zone] = {
      ...copy.routes[vehicle * 2 + zone], status: 'blocked', travelMinutes: null,
      evidenceRef: 'synthetic:road-closure-r2',
    };
    copy.accessRevision = 'access-r2'; copy.routeRevision = 'routes-r2';
    const manual = compareSyntheticReliefCapacity(copy);
    assert.deepEqual(got.revisedScenario.knownOnlyExhaustive, manual.exhaustive);
    assert.deepEqual(got.revisedScenario.knownOnlyNearestFirst, manual.nearestFirst);
  }
});

test('invalid synthetic inputs fail closed through the existing capacity comparator', () => {
  assert.throws(() => run({ ...fixture(), determination: 'observed' }), /hypothetical synthetic/);
  assert.throws(() => run({ ...fixture(), datasetKind: 'real' }), /hypothetical synthetic/);
  assert.throws(() => run(fixture(), { vehicleId: '' }), /synthetic identifier/);
  assert.throws(() => run(fixture(), { evidenceRef: '' }), /synthetic evidence/);
});
