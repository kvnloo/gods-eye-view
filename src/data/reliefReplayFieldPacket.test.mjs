import test from 'node:test';
import assert from 'node:assert/strict';
import { replaySyntheticReliefOutage } from './reliefOutageReplay.js';
import { projectReliefOutageFieldPacket, formatReliefReplayFieldText,
  RELIEF_FIELD_PACKET_VERSION } from './reliefReplayFieldPacket.js';

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
  return { studyId: 'idai-style-synthetic', sourceRef: 'synthetic:fictional-no-live-data',
    determination: 'hypothetical', datasetKind: 'synthetic',
    worldRevision: 'world-r1', stockRevision: 'stock-r1', fleetRevision: 'fleet-r1',
    needRevision: 'needs-r1', accessRevision: 'access-r1', routeRevision: 'routes-r1',
    policyRevision: 'policy-r1', policy: { objective: 'serve-units-then-priority-then-time' },
    depots: [{ id: 'depot-a', stockUnits: 5 }], vehicles, zones,
    routes: vehicles.flatMap((v, i) => zones.map((z, j) => ({
      vehicleId: v.id, zoneId: z.id, status: times[i][j] === null ? 'blocked' : 'supported',
      travelMinutes: times[i][j], evidenceRef: 'synthetic:route-evidence-r1',
    }))),
  };
}
function replay(baseline = fixture(), changes = {}) {
  return replaySyntheticReliefOutage({ baseline, change: {
    vehicleId: 'truck-a', zoneId: 'zone-west', accessRevision: 'access-r2',
    routeRevision: 'routes-r2', evidenceRef: 'synthetic:closure-r2', ...changes,
  } });
}
const project = (data = replay(), options = {}) => projectReliefOutageFieldPacket(data, options);

test('produces an explicit two-snapshot offline Relief Packet, not live-world truth', () => {
  const packet = project();
  assert.equal(packet.schemaVersion, RELIEF_FIELD_PACKET_VERSION);
  assert.equal(packet.determination, 'hypothetical');
  assert.equal(packet.authority, 'none');
  assert.equal(packet.status, 'evaluated');
  assert.equal(packet.world.status, 'not-attached');
  assert.equal(packet.historicalBaselineCurrent, false);
  assert.equal(packet.stages[0].interpretation, 'superseded-synthetic-snapshot');
  assert.equal(packet.stages[1].interpretation, 'synthetic-revision-only');
  assert.deepEqual(packet.stages.map(x => x.accessRevision), ['access-r1', 'access-r2']);
  assert.deepEqual(packet.stages.map(x => x.knownOnlyExact.servedUnits), [4, 2]);
  assert.deepEqual(packet.stages.map(x => x.knownOnlyNearestFirst.servedUnits), [2, 2]);
  assert.equal(packet.delta.knownOnlyServedUnits, -2);
  assert.equal(packet.fieldLite.layout, 'single-column');
  assert.equal(packet.fieldLite.rows.length, 2);
});

test('offline text projection works without Cesium, DOM or network', () => {
  const txt = formatReliefReplayFieldText(project());
  assert.match(txt, /TRAINING ONLY/);
  assert.match(txt, /Before \(synthetic, superseded\).*exact 4 units/);
  assert.match(txt, /After \(synthetic\).*exact 2 units/);
  assert.match(txt, /Change in known-only exact service: -2 synthetic units/);
  assert.match(txt, /synthetic:closure-r2/);
  assert.match(txt, /No operational route or delivery decisions are authorized/);
  assert.doesNotMatch(txt, /Current road is open|Route is safe|dispatch now/i);
});

test('world fingerprint is optional, reference-only and does not copy camera/tracked entities', () => {
  const packet = project(replay(), { worldPacketReference: {
    semanticFingerprint: 'fnv1a64:0123456789abcdef', revision: 'world-r1',
    camera: { latitude: 5, longitude: 4 }, tracked: ['private'],
    freshness: 'fresh', authority: 'action-capable',
  } });
  assert.equal(packet.world.semanticFingerprint, 'fnv1a64:0123456789abcdef');
  assert.equal(packet.world.status, 'reference-only');
  assert.equal(packet.world.freshness, 'not-assessed-offline');
  assert.equal(packet.world.authority, 'none');
  assert.equal('camera' in packet.world, false);
  assert.equal('tracked' in packet.world, false);
  assert.equal('fresh' in packet.world, false);
  assert.doesNotMatch(JSON.stringify(packet), /private|latitude|longitude/);
});

test('world revision drift or malformed fingerprint fails closed', () => {
  const one = project(replay(), { worldPacketReference: {
    semanticFingerprint: 'fnv1a64:0123456789abcdef', revision: 'world-r0',
  } });
  assert.equal(one.status, 'unknown');
  assert.equal(one.reason, 'world-reference-mismatch');
  assert.deepEqual(one.stages, []);
  assert.equal(one.delta, null);
  const two = project(replay(), { worldPacketReference: {
    semanticFingerprint: 'wrong', revision: 'world-r1',
  } });
  assert.equal(two.reason, 'world-reference-mismatch');
});

test('tampered authority, determination, implementation or kind cannot be laundered', () => {
  for (const modification of [
    { determination: 'observed' }, { authority: 'action-capable' },
    { implementation: 'authorized' }, { kind: 'live-relief-run' },
    { accessClaim: 'verified-safe' },
  ]) {
    const result = project({ ...replay(), ...modification });
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'invalid-replay-contract');
  }
});

test('inconsistent calculated delta is rejected, not shown as a credible effect', () => {
  const r = replay();
  const projected = project({ ...r, syntheticDelta: {
    ...r.syntheticDelta, knownOnlyServedUnits: 19,
  } });
  assert.equal(projected.reason, 'inconsistent-replay-delta');
  assert.equal(projected.delta, null);
});

test('stale route revision and reused source evidence are not accepted', () => {
  const r = replay();
  assert.equal(project({ ...r, revisedScenario: {
    ...r.revisedScenario, routeRevision: r.historicalBaseline.routeRevision,
  } }).reason, 'invalid-stage-revision-or-metrics');
  assert.equal(project({ ...r, injectedChange: {
    ...r.injectedChange, currentEvidenceRef: r.injectedChange.previousEvidenceRef,
  } }).reason, 'invalid-replay-provenance');
});

test('unknown routes remain explicit limited status and do not appear as selected assignment', () => {
  const x = fixture();
  x.routes[1] = { ...x.routes[1], status: 'unknown', travelMinutes: null };
  const packet = project(replay(x));
  assert.equal(packet.status, 'limited');
  assert.equal(packet.stages[0].status, 'limited');
  assert.equal(packet.stages[1].status, 'limited');
  assert.deepEqual(packet.stages.map(s => s.unknownRoutes), [1, 1]);
  assert.equal(packet.stages[0].upperBoundIsGuaranteedAchievable, false);
  assert.equal(packet.stages[1].upperBoundIsGuaranteedAchievable, false);
  assert.ok(packet.fieldLite.notices.some(s => s.includes('Unknown access')));
});

test('inconsistent unknown-route status cannot become an observed answer', () => {
  const r = replay();
  const after = { ...r.revisedScenario, status: 'evaluated', unknownRoutes: 1 };
  assert.equal(project({ ...r, revisedScenario: after }).reason, 'invalid-stage-revision-or-metrics');
  assert.equal(project({ ...r, status: 'limited' }).reason, 'inconsistent-uncertainty-status');
});

test('selected assignment evidence and unmet need are retained in compact structured form', () => {
  const out = project();
  const base = out.stages[0].knownOnlyExact;
  assert.equal(base.assignments.length > 0, true);
  assert.ok(base.assignments.every(x => x.evidenceRef.startsWith('synthetic:')));
  assert.equal(base.unmetNeed.reduce((n, x) => n + x.servedUnits, 0), base.servedUnits);
  assert.ok(base.unmetNeed.some(x => x.unmetUnits > 0));
  assert.ok(out.fieldLite.rows[0].evidenceRefs.includes('synthetic:route-evidence-r1'));
  assert.ok(out.fieldLite.rows[1].evidenceRefs.includes('synthetic:closure-r2'));
  assert.equal(out.fieldLite.rows[0].evidenceRefs.includes('synthetic:closure-r2'), false);
});

test('a non-critical closure produces a neutral zero delta without false success', () => {
  const result = project(replay(fixture(), { zoneId: 'zone-east' }));
  assert.equal(result.status, 'evaluated');
  assert.equal(result.delta.knownOnlyServedUnits, 0);
  assert.match(formatReliefReplayFieldText(result), /0 synthetic units/);
});

test('all-zero supply remains an explicit measured synthetic zero, not missing', () => {
  const x = fixture(); x.depots[0].stockUnits = 0; x.stockRevision = 'stock-r2';
  const result = project(replay(x));
  assert.equal(result.status, 'evaluated');
  assert.equal(result.stages[0].knownOnlyExact.servedUnits, 0);
  assert.equal(result.stages[1].knownOnlyExact.servedUnits, 0);
  assert.equal(result.fieldLite.rows[0].exactKnownOnlyServedUnits, 0);
});

test('incomplete replay has no numeric projection; invalid outer packet has no renderable data', () => {
  const baseline = fixture(); baseline.routes.pop();
  const result = project(replay(baseline));
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'replay-not-evaluated');
  assert.equal(result.delta, null);
  assert.deepEqual(result.fieldLite.rows, []);
  assert.match(formatReliefReplayFieldText(result), /unavailable/);
  assert.match(formatReliefReplayFieldText({}), /invalid packet/);
});

test('untrusted extras, private fields and prototype-looking keys are not copied into packet', () => {
  const x = replay();
  const out = project({ ...x, secret: 'SENTINEL_PRIVATE', camera: { lat: 4 },
    injectedChange: { ...x.injectedChange, evidenceRef: 'http://bad',
      password: 'SENTINEL_PRIVATE' } });
  const encoded = JSON.stringify(out);
  assert.doesNotMatch(encoded, /SENTINEL_PRIVATE|camera|password|http:\/\/bad/);
  assert.equal(out.authority, 'none');
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.fieldLite.rows));
  assert.deepEqual(out, project(x));
});

test('invalid assignments or inlined non-synthetic sources are rejected', () => {
  const r = replay();
  const corrupt = structuredClone(r);
  corrupt.historicalBaseline.knownOnlyExhaustive.assignments[0].evidenceRef = 'https://private/route';
  assert.equal(project(corrupt).reason, 'invalid-stage-revision-or-metrics');
  const over = structuredClone(r);
  over.revisedScenario.knownOnlyNearestFirst.servedUnits = 999;
  assert.equal(project(over).reason, 'invalid-stage-revision-or-metrics');
});

test('projection is immutable, deterministic and bounded in serialized size for fixture', () => {
  const input = replay(), before = JSON.stringify(input);
  const p1 = project(input), p2 = project(input);
  assert.deepEqual(p1, p2);
  assert.equal(JSON.stringify(input), before);
  assert.ok(Object.isFrozen(p1.stages[0].knownOnlyExact.unmetNeed[0]));
  assert.ok(Buffer.byteLength(JSON.stringify(p1)) < 10000);
});


test('revised plan cannot select the explicitly closed route even if totals look consistent', () => {
  const r = structuredClone(replay());
  // Make the current assignment's one legal vehicle+zone pair exactly the
  // closed edge. The parent solver never emits this; the projection must
  // still reject a tampered receipt rather than declaring a valid plan.
  const assignment = r.revisedScenario.knownOnlyExhaustive.assignments[0];
  assignment.vehicleId = r.injectedChange.vehicleId;
  assignment.zoneId = r.injectedChange.zoneId;
  assert.equal(project(r).reason, 'blocked-edge-still-selected');
});

test('a changed travel-time total fails rather than rewriting the evidence', () => {
  const r = structuredClone(replay());
  r.revisedScenario.knownOnlyExhaustive.totalOneWayTravelMinutes += 5;
  assert.equal(project(r).reason, 'invalid-stage-revision-or-metrics');
});

test('formatter handles a superficially valid but incomplete imported packet', () => {
  const invalid = { kind: 'gev-relief-replay-field-packet',
    determination: 'hypothetical', authority: 'none', status: 'evaluated' };
  assert.match(formatReliefReplayFieldText(invalid), /invalid projection/);
});
