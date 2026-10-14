/** A deliberately fictional, keyless Field Lite training fixture. No Idai facts. */
import { replaySyntheticReliefOutage } from '../data/reliefOutageReplay.js';
import { projectReliefOutageFieldPacket } from '../data/reliefReplayFieldPacket.js';

export function createSyntheticReliefDemoReplay() {
  const vehicles = [
    { id: 'truck-a', depotId: 'depot-a', capacityUnits: 4, earliestMinute: 0, latestMinute: 120 },
    { id: 'truck-b', depotId: 'depot-a', capacityUnits: 1, earliestMinute: 0, latestMinute: 120 },
  ];
  const zones = [
    { id: 'zone-west', needUnits: 4, priorityWeight: 2, earliestMinute: 0, latestMinute: 120 },
    { id: 'zone-east', needUnits: 1, priorityWeight: 1, earliestMinute: 0, latestMinute: 120 },
  ];
  const minutes = [[8, 1], [1, null]];
  const baseline = {
    studyId: 'idai-style-synthetic', sourceRef: 'synthetic:fictional-no-live-data',
    determination: 'hypothetical', datasetKind: 'synthetic',
    worldRevision: 'world-r1', stockRevision: 'stock-r1', fleetRevision: 'fleet-r1',
    needRevision: 'needs-r1', accessRevision: 'access-r1', routeRevision: 'routes-r1',
    policyRevision: 'policy-r1', policy: { objective: 'serve-units-then-priority-then-time' },
    depots: [{ id: 'depot-a', stockUnits: 5 }], vehicles, zones,
    routes: vehicles.flatMap((vehicle, i) => zones.map((zone, j) => ({
      vehicleId: vehicle.id, zoneId: zone.id,
      status: minutes[i][j] === null ? 'blocked' : 'supported',
      travelMinutes: minutes[i][j], evidenceRef: 'synthetic:route-evidence-r1',
    }))),
  };
  const replay = replaySyntheticReliefOutage({ baseline, change: {
    vehicleId: 'truck-a', zoneId: 'zone-west', accessRevision: 'access-r2',
    routeRevision: 'routes-r2', evidenceRef: 'synthetic:road-closure-r2',
  } });
  return replay;
}

export function createSyntheticReliefDemoPacket() {
  return projectReliefOutageFieldPacket(createSyntheticReliefDemoReplay());
}
