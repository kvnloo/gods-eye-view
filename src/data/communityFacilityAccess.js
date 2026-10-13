/**
 * Exact tiny reference for hypothetical k-median facility access (#206).
 * Only symmetric integer-metre metrics are supported. This is not a street router,
 * land-eligibility authority, demographic demand estimator or live simulation.
 */
export const FACILITY_ACCESS_LIMITS = Object.freeze({
  zones: 12,
  sites: 10,
  siteCount: 2,
  distanceMeters: 1_000_000,
  weight: 10_000,
});

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_COMBINATIONS = 45;

function validId(value) {
  return typeof value === 'string' && ID.test(value);
}

function requiredId(value, label) {
  if (!validId(value)) throw new TypeError(label + ' must be a bounded lowercase identifier');
  return value;
}

function requiredRef(value, label) {
  if (typeof value !== 'string' || !value.trim() ||
      value !== value.trim() || value.length > 200) {
    throw new TypeError(label + ' must be a nonempty bounded source/revision reference');
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function receipt(context, result) {
  return deepFreeze({
    determination: 'hypothetical',
    approval: 'not-requested',
    kind: 'exact-synthetic-facility-access-reference',
    context,
    ...result,
  });
}

function compareIdLists(left, right) {
  const size = Math.min(left.length, right.length);
  for (let i = 0; i < size; i++) {
    const c = left[i] < right[i] ? -1 : left[i] > right[i] ? 1 : 0;
    if (c) return c;
  }
  return left.length - right.length;
}

function combinations(sortedIds, k) {
  const out = [];
  function walk(start, current) {
    if (current.length === k) {
      out.push([...current]);
      return;
    }
    for (let i = start; i <= sortedIds.length - (k - current.length); i++) {
      current.push(sortedIds[i]);
      walk(i + 1, current);
      current.pop();
    }
  }
  walk(0, []);
  return out;
}

/**
 * Return a complete exact ranking of at most 45 synthetic facility alternatives.
 * No real-world coordinates are inferred or exposed; all user-supplied zones are
 * aggregated counts with an independently supplied, fixed rational (integer)
 * walking-distance metric. No candidate gains a factual or civic approval state.
 *
 * @param {object} input - Versioned synthetic zone, site, and metric fixture.
 */
export function evaluateHypotheticalFacilityAccess(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('study object required');
  }
  if (input.determination !== 'hypothetical' || input.datasetKind !== 'synthetic') {
    throw new TypeError('only hypothetical synthetic input is supported');
  }
  const context = {
    studyId: requiredId(input.studyId, 'study id'),
    sourceRef: requiredRef(input.sourceRef, 'source reference'),
    baselineRevision: requiredRef(input.baselineRevision, 'baseline revision'),
    networkRevision: requiredRef(input.networkRevision, 'network revision'),
    demandRevision: requiredRef(input.demandRevision, 'demand revision'),
    metricRevision: requiredRef(input.metricRevision, 'metric revision'),
  };
  const zones = input.zones;
  const sites = input.sites;
  if (!Array.isArray(zones) || !Array.isArray(sites) ||
      zones.length === 0 || sites.length === 0) {
    throw new TypeError('nonempty zone and site arrays required');
  }
  if (zones.length > FACILITY_ACCESS_LIMITS.zones ||
      sites.length > FACILITY_ACCESS_LIMITS.sites) {
    return receipt(context, { status: 'unsupported', reason: 'reference-size-limit', alternatives: [] });
  }
  const parsedZones = zones.map((zone) => {
    const id = requiredId(zone?.id, 'zone id');
    if (zone.weight === null || zone.weight === undefined) return { id, weight: null };
    if (!Number.isSafeInteger(zone.weight) || zone.weight < 0 ||
        zone.weight > FACILITY_ACCESS_LIMITS.weight) {
      throw new TypeError('zone weight must be a bounded nonnegative integer or missing');
    }
    return { id, weight: zone.weight };
  });
  const parsedSites = sites.map((site) => {
    const id = requiredId(site?.id, 'site id');
    if (!['assumed-feasible', 'excluded', 'unknown'].includes(site.eligibility)) {
      throw new TypeError('site eligibility must be explicitly assumed-feasible/excluded/unknown');
    }
    return { id, eligibility: site.eligibility };
  });
  const names = [...parsedZones.map((z) => z.id), ...parsedSites.map((s) => s.id)];
  if (new Set(names).size !== names.length) throw new TypeError('zone and site ids must be unique');
  if (!Number.isSafeInteger(input.siteCount) || input.siteCount < 1) {
    throw new TypeError('siteCount must be a positive integer');
  }
  if (input.siteCount > FACILITY_ACCESS_LIMITS.siteCount) {
    return receipt(context, { status: 'unsupported', reason: 'reference-site-count-limit', alternatives: [] });
  }
  if (parsedZones.some((zone) => zone.weight === null)) {
    return receipt(context, { status: 'unknown', reason: 'missing-zone-weight', alternatives: [] });
  }
  const totalWeight = parsedZones.reduce((sum, z) => sum + z.weight, 0);
  if (totalWeight === 0) {
    return receipt(context, { status: 'not-applicable', reason: 'zero-total-demand', alternatives: [] });
  }
  const eligible = parsedSites.filter((site) => site.eligibility === 'assumed-feasible')
    .map((site) => site.id).sort();
  const excludedSites = parsedSites.filter((s) => s.eligibility !== 'assumed-feasible')
    .map((site) => ({ id: site.id, reason: site.eligibility })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (eligible.length < input.siteCount) {
    return receipt(context, {
      status: parsedSites.some((site) => site.eligibility === 'unknown') ? 'unknown' : 'infeasible',
      reason: 'insufficient-assumed-feasible-sites', excludedSites, alternatives: [],
    });
  }
  const metric = input.metric;
  if (!metric || !Array.isArray(metric.nodeIds) || !Array.isArray(metric.distancesMeters) ||
      metric.nodeIds.length !== names.length || metric.distancesMeters.length !== names.length) {
    return receipt(context, { status: 'unknown', reason: 'missing-metric', alternatives: [] });
  }
  const nodeIds = metric.nodeIds.map((id) => requiredId(id, 'metric node id'));
  if (new Set(nodeIds).size !== names.length ||
      nodeIds.some((id) => !names.includes(id))) {
    throw new TypeError('metric nodes must cover exactly the supplied zone and site ids');
  }
  const n = names.length;
  const distances = metric.distancesMeters;
  if (distances.some((row) => !Array.isArray(row) || row.length !== n)) {
    return receipt(context, { status: 'unknown', reason: 'incomplete-metric', alternatives: [] });
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = distances[i][j];
    if (v === null || v === undefined || v === Infinity) {
      return receipt(context, { status: 'unknown', reason: 'missing-or-unreachable-distance', alternatives: [] });
    }
    if (!Number.isSafeInteger(v) || v < 0 || v > FACILITY_ACCESS_LIMITS.distanceMeters) {
      return receipt(context, { status: 'unsupported', reason: 'noninteger-or-out-of-range-metric', alternatives: [] });
    }
    if ((i === j && v !== 0) || (i !== j && v === 0) || v !== distances[j]?.[i]) {
      return receipt(context, { status: 'unsupported', reason: 'not-a-proper-symmetric-metric', alternatives: [] });
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    for (let k = 0; k < n; k++) {
      if (distances[i][k] > distances[i][j] + distances[j][k]) {
        return receipt(context, { status: 'unsupported', reason: 'triangle-inequality-failed', alternatives: [] });
      }
    }
  }
  const index = Object.fromEntries(nodeIds.map((id, i) => [id, i]));
  const siteSets = combinations(eligible, input.siteCount);
  if (siteSets.length > MAX_COMBINATIONS) {
    return receipt(context, { status: 'unsupported', reason: 'combination-limit', alternatives: [] });
  }
  const alternatives = siteSets.map((siteIds) => {
    let weightedSum = 0;
    let maxDistance = 0;
    const zoneAccess = parsedZones.map((zone) => {
      const distancesTo = siteIds.map((siteId) => ({
        siteId,
        distance: distances[index[zone.id]][index[siteId]],
      })).sort((a, b) => a.distance - b.distance || (a.siteId < b.siteId ? -1 : a.siteId > b.siteId ? 1 : 0));
      const nearest = distancesTo[0];
      weightedSum += zone.weight * nearest.distance;
      if (zone.weight > 0) maxDistance = Math.max(maxDistance, nearest.distance);
      return {
        zoneId: zone.id,
        weight: zone.weight,
        nearestSiteId: nearest.siteId,
        walkingDistanceMeters: nearest.distance,
      };
    }).sort((a, b) => a.zoneId < b.zoneId ? -1 : a.zoneId > b.zoneId ? 1 : 0);
    return {
      siteIds,
      totalWeightedDistanceMeters: weightedSum,
      weightedMeanDistanceMeters: weightedSum / totalWeight,
      worstServedDistanceMeters: maxDistance,
      zoneAccess,
    };
  }).sort((a, b) => a.totalWeightedDistanceMeters - b.totalWeightedDistanceMeters ||
    a.worstServedDistanceMeters - b.worstServedDistanceMeters ||
    compareIdLists(a.siteIds, b.siteIds));
  return receipt(context, {
    status: 'evaluated',
    objective: 'minimize-synthetic-weighted-mean-walking-distance',
    eligibleSites: eligible,
    excludedSites,
    totalSyntheticDemandWeight: totalWeight,
    alternatives,
    // A ranking is a numerical comparison, NOT a site authorization/recommendation.
    possibleWorld: true,
  });
}
