import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WALK_ACCESS_LIMITS,
  createPedestrianGraph,
  evaluateWalkAccess,
  shortestPathsMeters,
} from './walkAccess.js';
import { WALK_ACCESS_FIXTURE as F } from './walkAccessFixture.js';

const graph = createPedestrianGraph(F);
const ids = F.nodes.map((node) => node.id);

// Independent oracle: Floyd–Warshall all pairs and brute-force nearest-node snap.
function floydWarshall({ nodes, edges }) {
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const d = nodes.map((_, i) => nodes.map((__, j) => (i === j ? 0 : Infinity)));
  for (const { from, to, meters } of edges) {
    const [i, j] = [index.get(from), index.get(to)];
    d[i][j] = d[j][i] = Math.min(d[i][j], meters);
  }
  for (let k = 0; k < nodes.length; k++)
    for (let i = 0; i < nodes.length; i++)
      for (let j = 0; j < nodes.length; j++)
        if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j];
  return (a, b) => d[index.get(a)][index.get(b)];
}
const oracle = floydWarshall(F);
const nearestNode = (p) =>
  F.nodes.reduce((best, node) =>
    Math.hypot(node.x - p.x, node.y - p.y) <
    Math.hypot(best.x - p.x, best.y - p.y)
      ? node
      : best,
  ).id;
const oracleTotal = (parks) =>
  F.zones.reduce(
    (sum, zone) =>
      sum +
      Math.min(
        ...parks.map((park) => oracle(nearestNode(zone), nearestNode(park))),
      ),
    0,
  );
const access = (parks, zones = F.zones, g = graph) =>
  evaluateWalkAccess({ graph: g, zones, parks });

test('fixture is a vetted, tiny, connected network with explicit sites', () => {
  assert.ok(F.zones.length >= 2 && F.zones.length <= WALK_ACCESS_LIMITS.zones);
  assert.equal(F.kind, 'synthetic');
  assert.ok(F.parks.length >= 1 && F.sites.length >= 2);
  const reach = shortestPathsMeters(graph, ids[0]);
  assert.equal(reach.size, ids.length, 'every fixture node is reachable');
  for (const p of [...F.zones, ...F.parks, ...F.sites]) {
    const node = F.nodes.find((n) => n.id === nearestNode(p));
    assert.ok(Math.hypot(node.x - p.x, node.y - p.y) <= 60, `${p.id} snaps`);
  }
});

test('graph build rejects edges that cannot be walkway lengths', () => {
  const nodes = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 100, y: 0 },
  ];
  const build = (edges) => createPedestrianGraph({ nodes, edges });
  assert.throws(
    () => build([{ from: 'a', to: 'b', meters: 99 }]),
    /straight-line/,
  );
  assert.throws(
    () => build([{ from: 'a', to: 'b', meters: 100.5 }]),
    /integer/,
  );
  assert.throws(() => build([{ from: 'a', to: 'b', meters: 0 }]), /integer/);
  assert.throws(() => build([{ from: 'a', to: 'a', meters: 5 }]), /two known/);
  assert.throws(() => build([{ from: 'a', to: 'z', meters: 5 }]), /two known/);
  assert.throws(
    () => createPedestrianGraph({ nodes: [...nodes, nodes[0]], edges: [] }),
    /duplicate/,
  );
  // Parallel ways keep the shorter walk, in both directions.
  const g = build([
    { from: 'a', to: 'b', meters: 140 },
    { from: 'b', to: 'a', meters: 100 },
  ]);
  assert.equal(shortestPathsMeters(g, 'a').get('b'), 100);
  assert.equal(shortestPathsMeters(g, 'b').get('a'), 100);
});

test('Dijkstra distances form a validated metric equal to Floyd–Warshall', () => {
  const rows = new Map(ids.map((id) => [id, shortestPathsMeters(graph, id)]));
  const d = (a, b) => rows.get(a).get(b);
  for (const a of ids)
    for (const b of ids) {
      assert.ok(Number.isSafeInteger(d(a, b)), 'finite integer metres');
      assert.equal(d(a, b), d(b, a), 'symmetric');
      assert.equal(d(a, b) === 0, a === b, 'zero exactly on the diagonal');
      assert.equal(d(a, b), oracle(a, b), 'matches the independent oracle');
      for (const c of ids) assert.ok(d(a, c) <= d(a, b) + d(b, c), 'triangle');
    }
});

test('baseline reports mean and worst-served walk to the nearest park', () => {
  const base = access(F.parks);
  assert.equal(base.status, 'evaluated');
  assert.equal(base.determination, 'hypothetical');
  assert.equal(base.knownCount, F.zones.length);
  assert.equal(base.totalMeters, oracleTotal(F.parks));
  assert.equal(base.meanMeters, base.totalMeters / F.zones.length);
  assert.equal(
    base.worstMeters,
    Math.max(...base.zones.map((zone) => zone.meters)),
  );
  // Hand-checked on the fixture drawing: a3 must cross the rail line.
  assert.equal(base.zones.find((z) => z.id === 'zone-3').meters, 710);
  assert.equal(base.worstMeters, 710);
  assert.equal(base.totalMeters, 3885);
});

test('exact brute-force k=1 and k=2 site choice is reproduced by the metric', () => {
  for (const k of [1, 2]) {
    const sets =
      k === 1
        ? F.sites.map((s) => [s])
        : F.sites.flatMap((s, i) => F.sites.slice(i + 1).map((t) => [s, t]));
    const scored = sets.map((set) => ({
      ids: set.map((s) => s.id).join('+'),
      metric: access([...F.parks, ...set]).totalMeters,
      exact: oracleTotal([...F.parks, ...set]),
    }));
    for (const row of scored) assert.equal(row.metric, row.exact, row.ids);
    const best = (key) =>
      scored.reduce((a, b) => (b[key] < a[key] ? b : a)).ids;
    assert.equal(best('metric'), best('exact'), `k=${k} optimum`);
  }
  assert.equal(access([...F.parks, F.sites[1]]).worstMeters, 480);
});

test('snap uncertainty brackets each zone by one edge either way', () => {
  const result = access(F.parks);
  for (const zone of result.zones) {
    const [low, high] = zone.range;
    assert.ok(low <= zone.meters && zone.meters <= high, zone.id);
    const neighbours = [
      zone.nodeId,
      ...graph.adjacency.get(zone.nodeId).keys(),
    ];
    const nearest = (node) =>
      Math.min(...F.parks.map((p) => oracle(node, nearestNode(p))));
    assert.equal(low, Math.min(...neighbours.map(nearest)), zone.id);
    assert.equal(high, Math.max(...neighbours.map(nearest)), zone.id);
  }
  const zones = result.zones;
  assert.equal(
    result.meanRange[0],
    zones.reduce((s, z) => s + z.range[0], 0) / zones.length,
  );
  assert.equal(result.worstRange[1], Math.max(...zones.map((z) => z.range[1])));
  assert.ok(result.meanRange[0] < result.meanMeters);
  assert.ok(result.meanMeters < result.meanRange[1]);
});

test('disconnected and off-network zones stay unknown, never zero or dropped', () => {
  const island = createPedestrianGraph({
    nodes: [
      ...F.nodes,
      { id: 'i0', x: 900, y: 900 },
      { id: 'i1', x: 960, y: 900 },
    ],
    edges: [...F.edges, { from: 'i0', to: 'i1', meters: 60 }],
  });
  const zones = [
    ...F.zones,
    { id: 'zone-island', x: 905, y: 905 },
    { id: 'zone-nowhere', x: 5000, y: 5000 },
  ];
  const result = access(F.parks, zones, island);
  assert.equal(result.status, 'evaluated');
  assert.equal(result.zoneCount, F.zones.length + 2);
  assert.equal(result.knownCount, F.zones.length);
  const unknown = result.zones.filter((z) => z.status === 'unknown');
  assert.deepEqual(
    unknown.map((z) => [z.id, z.reason, z.meters]),
    [
      ['zone-island', 'no-reachable-park', null],
      ['zone-nowhere', 'off-network', null],
    ],
  );
  // Known aggregates are unchanged by unknown zones; nothing averages in a zero.
  assert.equal(result.totalMeters, access(F.parks).totalMeters);
  assert.equal(result.worstMeters, access(F.parks).worstMeters);
});

test('missing network or unplaceable parks are explicit unknowns', () => {
  for (const g of [null, createPedestrianGraph({ nodes: [], edges: [] })]) {
    const result = evaluateWalkAccess({
      graph: g,
      zones: F.zones,
      parks: F.parks,
    });
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'missing-network');
    assert.equal(result.meanMeters, null);
    assert.equal(
      result.zones.every((z) => z.meters === null),
      true,
    );
  }
  const far = access([{ id: 'park-far', x: 9000, y: 9000 }]);
  assert.equal(far.status, 'unknown');
  assert.equal(far.reason, 'no-park-on-network');
  assert.deepEqual(far.unplacedParks, ['park-far']);
  assert.throws(() => access(F.parks, []), /demand zones/);
  assert.throws(
    () =>
      access(
        F.parks,
        Array.from({ length: 13 }, (_, i) => ({ id: `z${i}`, x: 0, y: 0 })),
      ),
    /demand zones/,
  );
});

test('results are frozen, deterministic and never mutate inputs', () => {
  const before = JSON.stringify(F);
  const a = access([...F.parks, F.sites[0]]);
  assert.deepEqual(a, access([...F.parks, F.sites[0]]));
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.zones[0]));
  assert.equal(JSON.stringify(F), before);
});
