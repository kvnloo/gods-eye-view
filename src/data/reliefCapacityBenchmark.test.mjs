import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSyntheticReliefCapacity, RELIEF_CAPACITY_LIMITS } from './reliefCapacityBenchmark.js';
import { solveSyntheticReliefMatching } from './syntheticReliefMatching.js';

function fixture() {
  const depots = [{ id: 'depot-a', stockUnits: 5 }];
  const vehicles = [
    { id: 'vehicle-a', depotId: 'depot-a', capacityUnits: 4, earliestMinute: 0, latestMinute: 100 },
    { id: 'vehicle-b', depotId: 'depot-a', capacityUnits: 1, earliestMinute: 0, latestMinute: 100 },
  ];
  const zones = [
    { id: 'zone-a', needUnits: 4, priorityWeight: 1, earliestMinute: 0, latestMinute: 100 },
    { id: 'zone-b', needUnits: 1, priorityWeight: 1, earliestMinute: 0, latestMinute: 100 },
  ];
  const times = [[8, 1], [1, null]];
  const routes = vehicles.flatMap((v, i) => zones.map((z, j) => ({
    vehicleId: v.id, zoneId: z.id,
    status: times[i][j] === null ? 'blocked' : 'supported',
    travelMinutes: times[i][j], evidenceRef: 'synthetic:access-matrix-r1',
  })));
  return {
    studyId: 'idai-toy', sourceRef: 'synthetic:author-generated',
    determination: 'hypothetical', datasetKind: 'synthetic',
    worldRevision: 'world-r1', stockRevision: 'stock-r1', fleetRevision: 'fleet-r1',
    needRevision: 'need-r1', accessRevision: 'access-r1', routeRevision: 'routes-r1',
    policyRevision: 'explicit-policy-r1',
    policy: { objective: 'serve-units-then-priority-then-time' },
    depots, vehicles, zones, routes,
  };
}
const solve = (patch = {}) => compareSyntheticReliefCapacity({ ...fixture(), ...patch });
const changeRoute = (f, vehicleId, zoneId, status, minutes = null) => ({
  ...f, routes: f.routes.map(r => r.vehicleId === vehicleId && r.zoneId === zoneId
    ? { ...r, status, travelMinutes: minutes } : r),
});

// Independent enumerator: exhaustive assignments only for 2 vehicles / 2 zones.
// It uses different control flow: decode mixed-radix choices and check constraints
// after building the whole assignment rather than rolling mutable state forward.
function independentOracle(f) {
  const choices = f.vehicles.map(v => [{ zoneId: null, units: 0 }, ...f.zones.flatMap(z =>
    Array.from({ length: v.capacityUnits }, (_, i) => ({ zoneId: z.id, units: i + 1 })))]);
  let bestServed = 0;
  let bestWeighted = -1;
  let bestTime = Infinity;
  for (let i = 0; i < choices[0].length; i++) for (let j = 0; j < choices[1].length; j++) {
    const picked = [choices[0][i], choices[1][j]];
    const usedByDepot = Object.fromEntries(f.depots.map(d => [d.id, 0]));
    const usedByZone = Object.fromEntries(f.zones.map(z => [z.id, 0]));
    let travel = 0, valid = true;
    picked.forEach((p, k) => {
      if (!p.zoneId) return;
      const v = f.vehicles[k], z = f.zones.find(x => x.id === p.zoneId);
      const route = f.routes.find(x => x.vehicleId === v.id && x.zoneId === z.id);
      if (!route || route.status !== 'supported') { valid = false; return; }
      const delivery = Math.max(v.earliestMinute + route.travelMinutes, z.earliestMinute);
      if (delivery > v.latestMinute || delivery > z.latestMinute) { valid = false; return; }
      usedByDepot[v.depotId] += p.units;
      usedByZone[z.id] += p.units;
      travel += route.travelMinutes;
    });
    if (!valid) continue;
    if (f.depots.some(d => usedByDepot[d.id] > d.stockUnits) ||
        f.zones.some(z => usedByZone[z.id] > z.needUnits)) continue;
    const served = Object.values(usedByZone).reduce((a, b) => a + b, 0);
    const weighted = f.zones.reduce((a, z) => a + usedByZone[z.id] * z.priorityWeight, 0);
    if (served > bestServed || (served === bestServed && weighted > bestWeighted) ||
        (served === bestServed && weighted === bestWeighted && travel < bestTime)) {
      bestServed = served; bestWeighted = weighted; bestTime = travel;
    }
  }
  return bestServed;
}

test('capacity and need invalidate interpreting maximum pair count as maximum people served', () => {
  const f = fixture();
  const matched = solveSyntheticReliefMatching({
    studyId: 'idai-toy', determination: 'hypothetical', datasetKind: 'synthetic',
    sourceRef: f.sourceRef, worldRevision: f.worldRevision,
    resourceRevision: f.fleetRevision, requestRevision: f.needRevision,
    accessRevision: f.accessRevision, policyRevision: f.policyRevision,
    resources: f.vehicles.map(v => ({ id: v.id })),
    requests: f.zones.map(z => ({ id: z.id })),
    edges: f.routes.map(r => ({ resourceId: r.vehicleId, requestId: r.zoneId,
      evidenceRef: r.evidenceRef, status: r.status === 'blocked' ? 'unsupported' : r.status })),
  });
  assert.equal(matched.matchedCount, 2);
  const result = solve();
  assert.equal(result.status, 'evaluated');
  assert.equal(result.exhaustive.servedUnits, 4);
  assert.equal(result.nearestFirst.servedUnits, 2);
  assert.equal(result.exhaustive.assignments.length, 1);
  assert.equal(result.exhaustive.assignments[0].vehicleId, 'vehicle-a');
  assert.equal(result.exhaustive.assignments[0].zoneId, 'zone-a');
  assert.equal(result.exhaustive.assignments[0].units, 4);
  assert.equal(result.exhaustive.unmetNeed.find(x => x.zoneId === 'zone-b').unmetUnits, 1);
  assert.equal(result.theoreticalUpperBoundIfUnknownPassableUnits, 5);
});

test('injecting one synthetic blocked road changes solution and keeps route unknowns separate', () => {
  const f = changeRoute(fixture(), 'vehicle-a', 'zone-a', 'blocked');
  const result = compareSyntheticReliefCapacity({ ...f, accessRevision: 'access-r2' });
  assert.equal(result.exhaustive.servedUnits, 2);
  assert.equal(result.context.accessRevision, 'access-r2');
  assert.ok(result.exhaustive.assignments.every(x => x.evidenceRef === 'synthetic:access-matrix-r1'));
  assert.equal(result.authority, 'none');
});

test('unknown access cannot be used as a supported delivery or a safe route', () => {
  const f = changeRoute(fixture(), 'vehicle-a', 'zone-a', 'unknown');
  const result = compareSyntheticReliefCapacity(f);
  assert.equal(result.status, 'limited');
  assert.equal(result.unknownRoutes, 1);
  assert.equal(result.exhaustive.servedUnits, 2);
  assert.ok(!result.exhaustive.assignments.some(x => x.vehicleId === 'vehicle-a' && x.zoneId === 'zone-a'));
  assert.equal(result.authority, 'none');
  assert.equal(result.accessClaim, 'not-evaluated');
});

test('one depot stock is shared across all vehicles, never double-counted', () => {
  const f = fixture(); f.depots[0].stockUnits = 2;
  const r = compareSyntheticReliefCapacity(f);
  assert.equal(r.exhaustive.servedUnits, 2);
  assert.ok(r.nearestFirst.servedUnits <= 2);
});

test('explicit per-zone demand limits prevent overdelivery', () => {
  const f = fixture(); f.zones[0].needUnits = 1; f.zones[1].needUnits = 1;
  const r = compareSyntheticReliefCapacity(f);
  assert.equal(r.exhaustive.servedUnits, 2);
  assert.deepEqual(r.exhaustive.unmetNeed.map(x => x.unmetUnits), [0,0]);
});

test('time windows forbid deliveries outside either vehicle or zone availability', () => {
  const f = fixture(); f.zones[0].latestMinute = 2;
  const r = compareSyntheticReliefCapacity(f);
  assert.equal(r.exhaustive.servedUnits, 2);
  assert.ok(!r.exhaustive.assignments.some(x => x.vehicleId === 'vehicle-a' && x.zoneId === 'zone-a'));
  assert.ok(r.exhaustive.assignments.some(x => x.vehicleId === 'vehicle-b' && x.zoneId === 'zone-a'));
});

test('missing evidence matrix returns unknown, no fabricated allocation', () => {
  const f = fixture(); f.routes.pop();
  const x = compareSyntheticReliefCapacity(f);
  assert.equal(x.status, 'unknown');
  assert.equal(x.reason, 'incomplete-route-matrix');
  assert.equal(x.exhaustive, undefined);
});

test('not applicable when every synthetic need is zero', () => {
  const f = fixture(); f.zones.forEach(x => { x.needUnits = 0; });
  const r = compareSyntheticReliefCapacity(f);
  assert.equal(r.status, 'not-applicable');
  assert.equal(r.exhaustive, undefined);
});

test('unambiguous non-authoritative outcome; input immutability', () => {
  const f = fixture(), before = JSON.stringify(f);
  f.authority = 'approved'; f.implementation = 'live';
  const r = compareSyntheticReliefCapacity(f);
  assert.equal(r.implementation, 'not-authorized');
  assert.equal(r.determination, 'hypothetical');
  assert.deepEqual(compareSyntheticReliefCapacity(f), r);
  assert.equal(JSON.stringify(f), JSON.stringify({ ...JSON.parse(before), authority:'approved', implementation:'live' }));
  assert.ok(Object.isFrozen(r)); assert.ok(Object.isFrozen(r.exhaustive.assignments));
});

test('source revision changes propagate to separate result identities', () => {
  const a = solve(), b = solve({ policyRevision: 'policy-r2', accessRevision:'access-r2' });
  assert.notEqual(a.context.policyRevision, b.context.policyRevision);
  assert.notEqual(a.context.accessRevision, b.context.accessRevision);
  assert.equal('dispatch' in a, false);
});

test('invalid quantities, missing provenance and invented policy are refused', () => {
  assert.throws(() => solve({ determination:'observed' }), /hypothetical synthetic/);
  assert.throws(() => solve({ stockRevision:'' }), /stockRevision/);
  assert.throws(() => solve({ policy:{} }), /objective/);
  const f=fixture(); f.vehicles[0].capacityUnits=99;
  assert.throws(() => compareSyntheticReliefCapacity(f), /capacityUnits/);
  const g=fixture(); g.zones[0].needUnits=undefined;
  assert.throws(() => compareSyntheticReliefCapacity(g), /needUnits/);
});

test('oversized reference returns unsupported without a partial plan', () => {
  const f = fixture();
  f.vehicles = Array.from({ length: RELIEF_CAPACITY_LIMITS.vehicles + 1 }, (_, i) => ({
    id: `vehicle-${i}`, depotId:'depot-a', capacityUnits: 1, earliestMinute: 0, latestMinute: 100,
  }));
  assert.equal(compareSyntheticReliefCapacity(f).status,'unsupported');
});

test('independent tiny exact oracle agrees across synthetic stock/demand/weight grid', () => {
  let count = 0;
  for(let stock=0;stock<=4;stock++) for(let needA=0;needA<=3;needA++)
    for(let needB=0;needB<=2;needB++) for(let weight=1;weight<=3;weight++) {
      if (needA + needB === 0) continue;
      const f=fixture(); f.depots[0].stockUnits=stock;
      f.zones[0].needUnits=needA; f.zones[1].needUnits=needB;
      f.zones[0].priorityWeight=weight;
      const r=compareSyntheticReliefCapacity(f);
      assert.equal(r.exhaustive.servedUnits, independentOracle(f), JSON.stringify({stock, needA, needB, weight}));
      assert.ok(r.exhaustive.servedUnits >= r.nearestFirst.servedUnits);
      count++;
    }
  assert.equal(count, 165);
});

test('stable outcome independent of input ordering', () => {
  const f=fixture(); const reversed={...f,
    depots:[...f.depots].reverse(), zones:[...f.zones].reverse(),
    vehicles:[...f.vehicles].reverse(), routes:[...f.routes].reverse(),
  };
  assert.deepEqual(compareSyntheticReliefCapacity(f), compareSyntheticReliefCapacity(reversed));
});


test('explicit synthetic policy weights determine tie among equal delivered-unit alternatives', () => {
  const f = fixture();
  f.vehicles = [f.vehicles[0]];
  f.vehicles[0].capacityUnits = 2;
  f.depots[0].stockUnits = 2;
  f.zones.forEach(z => { z.needUnits = 2; });
  f.zones[0].priorityWeight = 5;
  f.zones[1].priorityWeight = 1;
  f.routes = f.routes.filter(r => r.vehicleId === 'vehicle-a');
  const out = compareSyntheticReliefCapacity(f);
  assert.equal(out.exhaustive.servedUnits, 2);
  assert.equal(out.exhaustive.priorityWeightedServedUnits, 10);
  assert.equal(out.exhaustive.assignments[0].zoneId, 'zone-a');
  assert.equal(out.nearestFirst.servedUnits, 2);
  assert.equal(out.nearestFirst.priorityWeightedServedUnits, 2);
  assert.equal(out.exhaustive.totalOneWayTravelMinutes, 8);
});

test('shortest one-way travel breaks ties only after served units and explicit priority', () => {
  const f = fixture();
  f.vehicles = [f.vehicles[0]];
  f.vehicles[0].capacityUnits = 1;
  f.depots[0].stockUnits = 1;
  f.routes = f.routes.filter(r => r.vehicleId === 'vehicle-a');
  f.zones.forEach(z => { z.needUnits = 1; z.priorityWeight = 1; });
  const out = compareSyntheticReliefCapacity(f);
  assert.equal(out.exhaustive.servedUnits, 1);
  assert.equal(out.exhaustive.assignments[0].zoneId, 'zone-b');
  assert.equal(out.exhaustive.totalOneWayTravelMinutes, 1);
});
