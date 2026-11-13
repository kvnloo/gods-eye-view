/**
 * Hypothetical walking access to the nearest park (#206). Symmetric shortest
 * paths on an undirected pedestrian graph with integer-metre edges, measured
 * between snapped network nodes. Unreachable or off-network zones stay unknown;
 * they are never zero and never dropped. Demand is uniform per zone.
 */
const ID = /^[a-z][a-z0-9-]{0,63}$/;

export const WALK_ACCESS_LIMITS = Object.freeze({
  zones: 12,
  nodes: 20_000,
  snapMeters: 300,
});

function fail(message) {
  throw new TypeError(message);
}

function point(value, label) {
  if (
    !ID.test(value?.id) ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y)
  )
    fail(`invalid ${label}`);
  return { id: value.id, x: value.x, y: value.y };
}

const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Validate nodes (local metres) and walkway edges into an undirected graph. */
export function createPedestrianGraph({ nodes, edges } = {}) {
  if (
    !Array.isArray(nodes) ||
    !Array.isArray(edges) ||
    nodes.length > WALK_ACCESS_LIMITS.nodes
  )
    fail('bounded node and edge arrays required');
  const byId = new Map();
  for (const node of nodes) {
    const valid = point(node, 'node');
    if (byId.has(valid.id)) fail('duplicate node id');
    byId.set(valid.id, valid);
  }
  const adjacency = new Map([...byId.keys()].map((id) => [id, new Map()]));
  for (const { from, to, meters } of edges) {
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b || from === to) fail('edges must join two known nodes');
    // A walkway cannot be shorter than the straight line between its ends.
    if (!Number.isSafeInteger(meters) || meters < 1)
      fail('edge length must be positive integer metres');
    if (meters < Math.floor(gap(a, b)))
      fail('edge is shorter than the straight-line gap');
    const kept = Math.min(meters, adjacency.get(from).get(to) ?? Infinity);
    adjacency.get(from).set(to, kept);
    adjacency.get(to).set(from, kept);
  }
  return Object.freeze({
    nodes: freeze([...byId.values()]),
    adjacency,
  });
}

/** Dijkstra from one node. Unreachable nodes are absent, never Infinity or 0. */
export function shortestPathsMeters(graph, source) {
  if (!graph.adjacency.has(source)) fail('unknown source node');
  const dist = new Map([[source, 0]]);
  const heap = [[0, source]];
  while (heap.length) {
    const [d, id] = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    if (d > dist.get(id)) continue;
    for (const [next, meters] of graph.adjacency.get(id)) {
      const candidate = d + meters;
      if (candidate >= (dist.get(next) ?? Infinity)) continue;
      dist.set(next, candidate);
      heap.push([candidate, next]);
      for (let i = heap.length - 1; i > 0;) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[i], heap[p]] = [heap[p], heap[i]];
        i = p;
      }
    }
  }
  return dist;
}

/** The nearest network node within the snap tolerance, or null. */
export function snap(graph, target) {
  let best = null;
  for (const node of graph.nodes) {
    const d = gap(node, target);
    if (!best || d < best.d || (d === best.d && node.id < best.id))
      best = { id: node.id, d };
  }
  return best && best.d <= WALK_ACCESS_LIMITS.snapMeters ? best.id : null;
}

const mean = (values) => values.reduce((s, v) => s + v, 0) / values.length;

/**
 * Mean and worst-served network walk from each demand zone to its nearest
 * park. Each zone's range is the nearest-park distance from its snapped node
 * or any node one edge away, the snap tolerance. Aggregates cover known zones.
 */
export function evaluateWalkAccess({ graph, zones, parks }) {
  if (
    !Array.isArray(zones) ||
    zones.length < 1 ||
    zones.length > WALK_ACCESS_LIMITS.zones
  )
    fail(`1 to ${WALK_ACCESS_LIMITS.zones} demand zones required`);
  const zoneList = zones.map((zone) => point(zone, 'zone'));
  const parkList = parks.map((park) => point(park, 'park'));
  const empty = (reason, extra = {}) =>
    freeze({
      determination: 'hypothetical',
      status: 'unknown',
      reason,
      zoneCount: zoneList.length,
      knownCount: 0,
      totalMeters: null,
      meanMeters: null,
      meanRange: null,
      worstMeters: null,
      worstRange: null,
      unplacedParks: [],
      zones: zoneList.map(({ id }) => ({
        id,
        status: 'unknown',
        reason,
        meters: null,
      })),
      ...extra,
    });
  if (!graph?.nodes.length) return empty('missing-network');
  const placed = parkList.map((park) => ({ ...park, node: snap(graph, park) }));
  const unplacedParks = placed.filter((p) => !p.node).map((p) => p.id);
  const fields = [...new Set(placed.map((p) => p.node).filter(Boolean))].map(
    (node) => shortestPathsMeters(graph, node),
  );
  if (!fields.length) return empty('no-park-on-network', { unplacedParks });
  const nearest = (node) => {
    const reached = fields
      .map((f) => f.get(node))
      .filter((d) => d !== undefined);
    return reached.length ? Math.min(...reached) : null;
  };
  const access = zoneList.map(({ id, x, y }) => {
    const nodeId = snap(graph, { x, y });
    if (!nodeId)
      return { id, status: 'unknown', reason: 'off-network', meters: null };
    const meters = nearest(nodeId);
    if (meters === null)
      return {
        id,
        nodeId,
        status: 'unknown',
        reason: 'no-reachable-park',
        meters,
      };
    // Neighbours share the component, so every one of them reaches a park too.
    const around = [nodeId, ...graph.adjacency.get(nodeId).keys()].map(nearest);
    return {
      id,
      nodeId,
      status: 'known',
      meters,
      range: [Math.min(...around), Math.max(...around)],
    };
  });
  const known = access.filter((zone) => zone.status === 'known');
  if (!known.length)
    return empty('no-reachable-park', { unplacedParks, zones: access });
  const totalMeters = known.reduce((s, zone) => s + zone.meters, 0);
  return freeze({
    determination: 'hypothetical',
    status: 'evaluated',
    reason: null,
    zoneCount: zoneList.length,
    knownCount: known.length,
    totalMeters,
    meanMeters: totalMeters / known.length,
    meanRange: [
      mean(known.map((z) => z.range[0])),
      mean(known.map((z) => z.range[1])),
    ],
    worstMeters: Math.max(...known.map((z) => z.meters)),
    worstRange: [
      Math.max(...known.map((z) => z.range[0])),
      Math.max(...known.map((z) => z.range[1])),
    ],
    unplacedParks,
    zones: access,
  });
}
