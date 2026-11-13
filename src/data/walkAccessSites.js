/**
 * Exact site suggestions for the walk-access comparison (#206). The reference in
 * communityFacilityAccess.js validates the distances and enumerates every set of
 * one or two eligible candidate sites; existing parks are then folded in, so a
 * suggestion's metres equal what evaluateWalkAccess reports for parks placed
 * there. A suggestion is a hypothetical option, not zoning, an approval or an
 * observed fact. A site without stated eligibility is never suggested, and a
 * missing, unreachable or invalid distance gives a reason instead of a site.
 */
import { evaluateHypotheticalFacilityAccess } from './communityFacilityAccess.js';
import {
  createPedestrianGraph,
  freeze,
  shortestPathsMeters,
  snap,
} from './walkAccess.js';

const OTHER = { average: 'worst-served', 'worst-served': 'average' };
const MEASURE = { average: 'totalMeters', 'worst-served': 'worstMeters' };

/**
 * @param {object} study
 * @param {object} study.network - nodes, edges, zones, parks and candidate sites.
 * @param {object} [study.eligibility] - site id to 'assumed-feasible', 'excluded' or 'unknown' (the default).
 * @param {1|2} [study.siteCount]
 * @param {'average'|'worst-served'} [study.objective]
 * @param {Function} [study.distanceMeters] - integer metres between two node ids, or null;
 *   defaults to shortest paths on the network. A supplied table is validated, never trusted.
 */
export function suggestWalkAccessSites({
  network,
  eligibility = {},
  siteCount = 1,
  objective = 'average',
  distanceMeters,
} = {}) {
  if (!OTHER[objective])
    throw new TypeError('objective must be average or worst-served');
  const graph = createPedestrianGraph(network);
  const fields = new Map();
  const between =
    distanceMeters ??
    ((from, to) => {
      if (!fields.has(from)) fields.set(from, shortestPathsMeters(graph, from));
      return fields.get(from).get(to) ?? null;
    });
  // Like the comparison, measure between snapped network nodes.
  const walk = (a, b) => (a && b ? between(a, b) : null);
  const points = [...network.zones, ...network.sites].map((place) => ({
    id: place.id,
    node: snap(graph, place),
  }));
  const reference = evaluateHypotheticalFacilityAccess({
    studyId: 'walk-access-sites',
    determination: 'hypothetical',
    datasetKind: network.kind,
    sourceRef: network.id,
    baselineRevision: network.revision,
    networkRevision: network.revision,
    demandRevision: 'uniform-zone-weights',
    metricRevision: distanceMeters ? 'supplied-distances' : 'shortest-paths',
    zones: network.zones.map(({ id }) => ({ id, weight: 1 })),
    sites: network.sites.map(({ id }) => ({
      id,
      eligibility: eligibility[id] ?? 'unknown',
    })),
    siteCount,
    metric: {
      nodeIds: points.map((point) => point.id),
      distancesMeters: points.map((a) =>
        points.map((b) => walk(a.node, b.node)),
      ),
    },
  });
  const record = {
    determination: 'hypothetical',
    claim: 'possible-option',
    approval: 'not-requested',
    zoning: 'not-assessed',
    observed: false,
    objective,
    siteCount,
    networkRevision: network.revision,
    status: reference.status,
    reason: reference.reason ?? null,
    excludedSites: reference.excludedSites ?? [],
    suggestion: null,
    tie: null,
    ranking: [],
  };
  if (reference.status !== 'evaluated') return freeze(record);
  const nodeOf = new Map(points.map((point) => [point.id, point.node]));
  const parks = network.parks.map((park) => snap(graph, park)).filter(Boolean);
  const first = MEASURE[objective];
  const second = MEASURE[OTHER[objective]];
  const ranking = reference.alternatives
    .map(({ siteIds, zoneAccess }) => {
      const zones = zoneAccess.map(({ zoneId, walkingDistanceMeters }) => ({
        id: zoneId,
        meters: Math.min(
          walkingDistanceMeters,
          ...parks.map((park) => walk(nodeOf.get(zoneId), park) ?? Infinity),
        ),
      }));
      const totalMeters = zones.reduce((sum, zone) => sum + zone.meters, 0);
      return {
        determination: 'hypothetical',
        siteIds,
        totalMeters,
        meanMeters: totalMeters / zones.length,
        worstMeters: Math.max(...zones.map((zone) => zone.meters)),
        zones,
      };
    })
    .sort(
      (a, b) =>
        a[first] - b[first] ||
        a[second] - b[second] ||
        (a.siteIds.join() < b.siteIds.join() ? -1 : 1),
    );
  const tied = ranking.filter((entry) => entry[first] === ranking[0][first]);
  return freeze({
    ...record,
    status: 'suggested',
    suggestion: ranking[0],
    tie:
      tied.length > 1
        ? {
            siteSets: tied.map((entry) => entry.siteIds),
            brokenBy:
              tied[0][second] === tied[1][second]
                ? 'site-id'
                : OTHER[objective],
          }
        : null,
    ranking,
  });
}
