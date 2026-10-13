/**
 * Exact, tiny synthetic capacity-aware relief assignment benchmark (#152/#207).
 * This is neither routing nor a dispatch recommendation. A vehicle makes at most
 * one synthetic single-stop delivery. Unassessed access never becomes passable.
 * Not an implementation of OpenAI family #120 (graph matching).
 */
export const RELIEF_CAPACITY_LIMITS = Object.freeze({
  depots: 3, zones: 4, vehicles: 4, perVehicleUnits: 4, stockUnits: 16,
  needUnits: 16, travelMinutes: 120, minute: 1440,
});
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const ACCESS = new Set(['supported', 'blocked', 'unknown']);

function ident(x, name) {
  if (typeof x !== 'string' || !ID.test(x)) throw new TypeError(`${name} must be a bounded synthetic id`);
  return x;
}
function ref(x, name) {
  if (typeof x !== 'string' || x.length < 1 || x.length > 160 || x.trim() !== x)
    throw new TypeError(`${name} must be an explicit bounded source revision`);
  return x;
}
function int(x, min, max, name) {
  if (!Number.isSafeInteger(x) || x < min || x > max)
    throw new TypeError(`${name} must be an integer in [${min},${max}]`);
  return x;
}
function freeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    for (const value of Object.values(x)) freeze(value);
    Object.freeze(x);
  }
  return x;
}
function receipt(context, result) {
  return freeze({
    kind: 'synthetic-single-stop-capacity-benchmark-v1', determination: 'hypothetical',
    authority: 'none', accessClaim: 'not-evaluated', implementation: 'not-authorized',
    context, ...result,
  });
}
function parseNodes(xs, label, max, transform) {
  if (!Array.isArray(xs) || xs.length < 1) throw new TypeError(`${label} nonempty array required`);
  if (xs.length > max) return null;
  const items = xs.map(transform);
  if (new Set(items.map(x => x.id)).size !== items.length)
    throw new TypeError(`${label} duplicate ids`);
  return items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function cmpPlan(a, b) {
  // Objective order: served units, weighted units, lower travel time, stable IDs.
  if (a.served !== b.served) return a.served - b.served;
  if (a.weighted !== b.weighted) return a.weighted - b.weighted;
  if (a.travel !== b.travel) return b.travel - a.travel;
  const ax = a.items.map(x => `${x.vehicleId}/${x.zoneId}/${x.units}`).join('|');
  const bx = b.items.map(x => `${x.vehicleId}/${x.zoneId}/${x.units}`).join('|');
  return ax < bx ? 1 : ax > bx ? -1 : 0;
}
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      input.determination !== 'hypothetical' || input.datasetKind !== 'synthetic')
    throw new TypeError('hypothetical synthetic benchmark required');
  const context = {
    studyId: ident(input.studyId, 'studyId'), sourceRef: ref(input.sourceRef, 'sourceRef'),
    worldRevision: ref(input.worldRevision, 'worldRevision'),
    stockRevision: ref(input.stockRevision, 'stockRevision'),
    fleetRevision: ref(input.fleetRevision, 'fleetRevision'),
    needRevision: ref(input.needRevision, 'needRevision'),
    accessRevision: ref(input.accessRevision, 'accessRevision'),
    routeRevision: ref(input.routeRevision, 'routeRevision'),
    policyRevision: ref(input.policyRevision, 'policyRevision'),
  };
  const depots = parseNodes(input.depots, 'depots', RELIEF_CAPACITY_LIMITS.depots, x => ({
    id: ident(x?.id, 'depot id'), stockUnits: int(x?.stockUnits, 0, RELIEF_CAPACITY_LIMITS.stockUnits, 'stockUnits'),
  }));
  const zones = parseNodes(input.zones, 'zones', RELIEF_CAPACITY_LIMITS.zones, x => ({
    id: ident(x?.id, 'zone id'), needUnits: int(x?.needUnits, 0, RELIEF_CAPACITY_LIMITS.needUnits, 'needUnits'),
    priorityWeight: int(x?.priorityWeight, 1, 5, 'priorityWeight'),
    earliestMinute: int(x?.earliestMinute, 0, RELIEF_CAPACITY_LIMITS.minute, 'earliestMinute'),
    latestMinute: int(x?.latestMinute, 0, RELIEF_CAPACITY_LIMITS.minute, 'latestMinute'),
  }));
  const vehicles = parseNodes(input.vehicles, 'vehicles', RELIEF_CAPACITY_LIMITS.vehicles, x => ({
    id: ident(x?.id, 'vehicle id'), depotId: ident(x?.depotId, 'depotId'),
    capacityUnits: int(x?.capacityUnits, 1, RELIEF_CAPACITY_LIMITS.perVehicleUnits, 'capacityUnits'),
    earliestMinute: int(x?.earliestMinute, 0, RELIEF_CAPACITY_LIMITS.minute, 'earliestMinute'),
    latestMinute: int(x?.latestMinute, 0, RELIEF_CAPACITY_LIMITS.minute, 'latestMinute'),
  }));
  if (!depots || !zones || !vehicles)
    return { context, status: 'unsupported', reason: 'reference-size-limit' };
  if (zones.some(z => z.earliestMinute > z.latestMinute) ||
      vehicles.some(v => v.earliestMinute > v.latestMinute))
    throw new TypeError('invalid time window');
  if (vehicles.some(v => !depots.some(d => d.id === v.depotId)))
    throw new TypeError('vehicle references an unknown depot');
  const allIds = [...depots, ...zones, ...vehicles].map(x => x.id);
  if (new Set(allIds).size !== allIds.length)
    throw new TypeError('identifiers across depots/zones/vehicles must be unique');
  if (input.policy?.objective !== 'serve-units-then-priority-then-time')
    throw new TypeError('explicit supported objective required');
  if (!Array.isArray(input.routes))
    return { context, status: 'unknown', reason: 'missing-route-matrix' };
  if (input.routes.length > vehicles.length * zones.length)
    throw new TypeError('route matrix has too many entries');
  const vehicleIds = new Set(vehicles.map(v => v.id));
  const zoneIds = new Set(zones.map(z => z.id));
  const routes = new Map();
  for (const entry of input.routes) {
    const vehicleId = ident(entry?.vehicleId, 'route vehicleId');
    const zoneId = ident(entry?.zoneId, 'route zoneId');
    if (!vehicleIds.has(vehicleId) || !zoneIds.has(zoneId))
      throw new TypeError('route endpoints unknown');
    const key = `${vehicleId}\0${zoneId}`;
    if (routes.has(key)) throw new TypeError('duplicate route');
    if (!ACCESS.has(entry?.status)) throw new TypeError('unsupported route status');
    const travelMinutes = entry.status === 'supported'
      ? int(entry.travelMinutes, 1, RELIEF_CAPACITY_LIMITS.travelMinutes, 'travelMinutes')
      : null;
    if (entry.status !== 'supported' && entry.travelMinutes != null)
      throw new TypeError('unknown/blocked route cannot supply certified time');
    routes.set(key, { status: entry.status, travelMinutes,
      evidenceRef: ref(entry.evidenceRef, 'route evidenceRef') });
  }
  if (routes.size !== vehicles.length * zones.length)
    return { context, status: 'unknown', reason: 'incomplete-route-matrix' };
  return { context, depots, zones, vehicles, routes };
}
function routeCandidates(data, vehicle) {
  const options = [];
  for (const zone of data.zones) {
    const route = data.routes.get(`${vehicle.id}\0${zone.id}`);
    if (route.status !== 'supported') continue;
    // Single-stop, one-way travel model: wait until the zone window opens.
    const deliveryMinute = Math.max(vehicle.earliestMinute + route.travelMinutes, zone.earliestMinute);
    if (deliveryMinute > zone.latestMinute || deliveryMinute > vehicle.latestMinute) continue;
    options.push({ vehicleId: vehicle.id, depotId: vehicle.depotId, zoneId: zone.id,
      travelMinutes: route.travelMinutes, deliveryMinute, evidenceRef: route.evidenceRef });
  }
  return options;
}
function solveExact(data) {
  const stock = Object.fromEntries(data.depots.map(d => [d.id, d.stockUnits]));
  const need = Object.fromEntries(data.zones.map(z => [z.id, z.needUnits]));
  const priority = Object.fromEntries(data.zones.map(z => [z.id, z.priorityWeight]));
  let best = { served: -1, weighted: -1, travel: Infinity, items: [] };
  const current = [];
  function visit(i, served, weighted, travel) {
    if (i === data.vehicles.length) {
      const proposal = { served, weighted, travel, items: current.map(x => ({ ...x })) };
      if (cmpPlan(proposal, best) > 0) best = proposal;
      return;
    }
    const vehicle = data.vehicles[i];
    // The unused option is always available, regardless of route evidence.
    visit(i + 1, served, weighted, travel);
    for (const route of routeCandidates(data, vehicle)) {
      const cap = Math.min(vehicle.capacityUnits, stock[vehicle.depotId], need[route.zoneId]);
      for (let units = 1; units <= cap; units++) {
        stock[vehicle.depotId] -= units;
        need[route.zoneId] -= units;
        current.push({ ...route, units });
        visit(i + 1, served + units, weighted + units * priority[route.zoneId], travel + route.travelMinutes);
        current.pop();
        stock[vehicle.depotId] += units;
        need[route.zoneId] += units;
      }
    }
  }
  visit(0, 0, 0, 0);
  return best;
}
function solveNearestFirst(data) {
  const stock = Object.fromEntries(data.depots.map(d => [d.id, d.stockUnits]));
  const need = Object.fromEntries(data.zones.map(z => [z.id, z.needUnits]));
  const items = [];
  for (const vehicle of data.vehicles) {
    const choices = routeCandidates(data, vehicle).sort((a, b) =>
      a.travelMinutes - b.travelMinutes || (a.zoneId < b.zoneId ? -1 : a.zoneId > b.zoneId ? 1 : 0));
    for (const option of choices) {
      const units = Math.min(vehicle.capacityUnits, stock[vehicle.depotId], need[option.zoneId]);
      if (units <= 0) continue;
      stock[vehicle.depotId] -= units; need[option.zoneId] -= units;
      items.push({ ...option, units });
      break;
    }
  }
  return items;
}
function totals(data, items) {
  const served = Object.fromEntries(data.zones.map(z => [z.id, 0]));
  let minutes = 0;
  for (const item of items) { served[item.zoneId] += item.units; minutes += item.travelMinutes; }
  const servedUnits = Object.values(served).reduce((a, b) => a + b, 0);
  return { servedUnits, totalOneWayTravelMinutes: minutes,
    unmetNeed: data.zones.map(z => ({ zoneId: z.id, needUnits: z.needUnits,
      servedUnits: served[z.id], unmetUnits: z.needUnits - served[z.id] })),
    assignments: items };
}
/** Exact, bounded reference and deterministic nearest-first control. */
export function compareSyntheticReliefCapacity(input = {}) {
  const data = validate(input);
  if (!data.depots) return receipt(data.context, { status: data.status, reason: data.reason });
  const totalNeed = data.zones.reduce((a, z) => a + z.needUnits, 0);
  const unknownRoutes = [...data.routes.values()].filter(r => r.status === 'unknown').length;
  if (totalNeed === 0) return receipt(data.context, { status: 'not-applicable', reason: 'zero-synthetic-need' });
  const best = solveExact(data);
  const nearest = solveNearestFirst(data);
  const stock = data.depots.reduce((a, d) => a + d.stockUnits, 0);
  const capacities = data.vehicles.reduce((a, v) => a + v.capacityUnits, 0);
  const optimisticCeiling = Math.min(totalNeed, stock, capacities);
  return receipt(data.context, {
    status: unknownRoutes ? 'limited' : 'evaluated',
    modelScope: 'synthetic-single-stop-capacity-and-time-window-only',
    objective: 'serve-units-then-priority-then-time',
    unknownRoutes,
    theoreticalUpperBoundIfUnknownPassableUnits: optimisticCeiling,
    // An unknown-route ceiling is not a promised achievable delivery.
    exhaustive: totals(data, best.items),
    nearestFirst: totals(data, nearest),
  });
}
