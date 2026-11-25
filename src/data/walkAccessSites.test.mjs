import assert from 'node:assert/strict';
import test from 'node:test';
import { createPedestrianGraph, evaluateWalkAccess } from './walkAccess.js';
import { WALK_ACCESS_FIXTURE } from './walkAccessFixture.js';
import { presentCityWalkAccess } from '../ui/cityWalkAccess.js';

// Ten fixed cases for exact site suggestions (#206). Each one calls the function
// the City builder walk-access panel calls, on the panel's own sample network.
// The import is dynamic so that a missing module fails each case on its own.
const suggest = async (study) =>
  (await import('./walkAccessSites.js')).suggestWalkAccessSites(study);

const ALL = Object.fromEntries(
  WALK_ACCESS_FIXTURE.sites.map((site) => [site.id, 'assumed-feasible']),
);
const study = (changes = {}) => ({
  network: WALK_ACCESS_FIXTURE,
  eligibility: ALL,
  siteCount: 1,
  objective: 'average',
  ...changes,
});
const OBJECTIVES = ['average', 'worst-served'];
const pick = ({ siteIds, meanMeters, worstMeters }) => ({
  siteIds: [...siteIds],
  meanMeters,
  worstMeters,
});

// Independent oracle. Floyd-Warshall over the sample's edges, nearest-node
// snapping and subset enumeration are written here; nothing below comes from the
// solver or from walkAccess.js.
function oracle(network) {
  const ids = network.nodes.map((node) => node.id);
  const d = new Map(
    ids.map((a) => [a, new Map(ids.map((b) => [b, a === b ? 0 : Infinity]))]),
  );
  for (const { from, to, meters } of network.edges)
    if (meters < d.get(from).get(to)) {
      d.get(from).set(to, meters);
      d.get(to).set(from, meters);
    }
  for (const k of ids)
    for (const i of ids)
      for (const j of ids) {
        const via = d.get(i).get(k) + d.get(k).get(j);
        if (via < d.get(i).get(j)) d.get(i).set(j, via);
      }
  const node = ({ x, y }) => {
    let best = null;
    for (const candidate of network.nodes) {
      const gap = Math.hypot(candidate.x - x, candidate.y - y);
      if (
        !best ||
        gap < best.gap ||
        (gap === best.gap && candidate.id < best.id)
      )
        best = { id: candidate.id, gap };
    }
    return best.gap <= 300 ? best.id : null;
  };
  return { between: (a, b) => d.get(a).get(b), node };
}

function bruteForce(network, eligibleIds, siteCount, objective) {
  const { between, node } = oracle(network);
  const parks = network.parks.map(node).filter(Boolean);
  const sites = network.sites
    .filter((site) => eligibleIds.includes(site.id))
    .map((site) => ({ id: site.id, node: node(site) }));
  const subsets =
    siteCount === 1
      ? sites.map((site) => [site])
      : sites.flatMap((a, i) => sites.slice(i + 1).map((b) => [a, b]));
  const [first, second] =
    objective === 'average'
      ? ['meanMeters', 'worstMeters']
      : ['worstMeters', 'meanMeters'];
  return subsets
    .map((subset) => {
      const walks = network.zones.map((zone) =>
        Math.min(
          ...[...parks, ...subset.map((site) => site.node)].map((park) =>
            between(node(zone), park),
          ),
        ),
      );
      return {
        siteIds: subset.map((site) => site.id).sort(),
        meanMeters: walks.reduce((sum, m) => sum + m, 0) / walks.length,
        worstMeters: Math.max(...walks),
      };
    })
    .sort(
      (a, b) =>
        a[first] - b[first] ||
        a[second] - b[second] ||
        (a.siteIds.join() < b.siteIds.join() ? -1 : 1),
    );
}

// Cases 1 to 4. The expected sites and metres are also written out, so a wrong
// oracle cannot agree with a wrong suggestion unnoticed.
for (const [n, siteCount, objective, siteIds, totalMeters, worstMeters] of [
  [1, 1, 'average', ['site-b'], 2075, 480],
  [2, 1, 'worst-served', ['site-a'], 2685, 450],
  [3, 2, 'average', ['site-b', 'site-c'], 1520, 320],
  [4, 2, 'worst-served', ['site-b', 'site-c'], 1520, 320],
])
  test(`${n}. k=${siteCount}, ${objective}: the suggestion equals an independent brute force`, async () => {
    const record = await suggest(study({ siteCount, objective }));
    const expected = bruteForce(
      WALK_ACCESS_FIXTURE,
      Object.keys(ALL),
      siteCount,
      objective,
    );
    assert.equal(record.status, 'suggested');
    assert.equal(record.objective, objective);
    assert.equal(record.siteCount, siteCount);
    assert.deepEqual(pick(record.suggestion), expected[0]);
    assert.deepEqual(record.ranking.map(pick), expected);
    assert.deepEqual(pick(record.suggestion), {
      siteIds,
      meanMeters: totalMeters / WALK_ACCESS_FIXTURE.zones.length,
      worstMeters,
    });
  });

test('5. ties resolve deterministically and the record says it was a tie', async () => {
  // Sites B+C and B+D both leave the worst-served zone 320 m from a park.
  const tied = study({ siteCount: 2, objective: 'worst-served' });
  const record = await suggest(tied);
  assert.deepEqual(record.tie, {
    siteSets: [
      ['site-b', 'site-c'],
      ['site-b', 'site-d'],
    ],
    brokenBy: 'average',
  });
  assert.deepEqual(record.suggestion.siteIds, ['site-b', 'site-c']);
  assert.deepEqual(await suggest(tied), record);
  // The order candidates and zones arrive in does not change the resolution.
  const reversed = await suggest({
    ...tied,
    network: {
      ...WALK_ACCESS_FIXTURE,
      sites: [...WALK_ACCESS_FIXTURE.sites].reverse(),
      zones: [...WALK_ACCESS_FIXTURE.zones].reverse(),
    },
  });
  assert.deepEqual(reversed.tie, record.tie);
  assert.deepEqual(pick(reversed.suggestion), pick(record.suggestion));
  // With zone-9 alone no candidate beats the existing park: all four tie on
  // both measures, and the lowest site id is reported with the tie.
  const flat = await suggest(
    study({
      network: {
        ...WALK_ACCESS_FIXTURE,
        zones: WALK_ACCESS_FIXTURE.zones.filter((z) => z.id === 'zone-9'),
      },
    }),
  );
  assert.deepEqual(flat.tie, {
    siteSets: [['site-a'], ['site-b'], ['site-c'], ['site-d']],
    brokenBy: 'site-id',
  });
  assert.deepEqual(pick(flat.suggestion), {
    siteIds: ['site-a'],
    meanMeters: 320,
    worstMeters: 320,
  });
  // A clear winner is not called a tie.
  assert.equal((await suggest(study())).tie, null);
});

test('6. an excluded or unknown-eligibility candidate is never suggested', async () => {
  // Site B is the best single site (case 1), so leaving it out changes the answer.
  const { 'site-b': _, ...unstated } = ALL;
  for (const eligibility of [
    { ...ALL, 'site-b': 'excluded' },
    { ...ALL, 'site-b': 'unknown' },
    unstated,
  ])
    for (const siteCount of [1, 2])
      for (const objective of OBJECTIVES) {
        const record = await suggest(
          study({ eligibility, siteCount, objective }),
        );
        assert.equal(record.status, 'suggested');
        assert.ok(record.ranking.every((e) => !e.siteIds.includes('site-b')));
        assert.deepEqual(
          record.ranking.map(pick),
          bruteForce(
            WALK_ACCESS_FIXTURE,
            ['site-a', 'site-c', 'site-d'],
            siteCount,
            objective,
          ),
        );
        assert.deepEqual(record.excludedSites, [
          { id: 'site-b', reason: eligibility['site-b'] ?? 'unknown' },
        ]);
      }
  // With no stated eligibility at all, nothing is suggested.
  for (const none of [
    study({ eligibility: {} }),
    { network: WALK_ACCESS_FIXTURE },
  ]) {
    const record = await suggest(none);
    assert.equal(record.status, 'unknown');
    assert.equal(record.suggestion, null);
    assert.deepEqual(record.ranking, []);
  }
});

test("7. an unreachable zone gives an explicit unknown, never a suggestion or an 'optimal' label", async () => {
  // zone-1 snaps to node a0. Cut a0 off the network, or move the zone off it.
  const cut = {
    ...WALK_ACCESS_FIXTURE,
    edges: WALK_ACCESS_FIXTURE.edges.filter(
      (edge) => edge.from !== 'a0' && edge.to !== 'a0',
    ),
  };
  const offNetwork = {
    ...WALK_ACCESS_FIXTURE,
    zones: WALK_ACCESS_FIXTURE.zones.map((zone) =>
      zone.id === 'zone-1' ? { ...zone, y: 5000 } : zone,
    ),
  };
  for (const network of [cut, offNetwork])
    for (const siteCount of [1, 2])
      for (const objective of OBJECTIVES) {
        const record = await suggest(study({ network, siteCount, objective }));
        assert.equal(record.status, 'unknown');
        assert.match(record.reason, /unreachable/);
        assert.equal(record.suggestion, null);
        assert.deepEqual(record.ranking, []);
        assert.doesNotMatch(JSON.stringify(record), /optimal/i);
      }
});

test('8. an asymmetric or non-metric distance input gives no suggestion and a reason', async () => {
  const { between } = oracle(WALK_ACCESS_FIXTURE);
  const asymmetric = (a, b) => between(a, b) + (a < b ? 7 : 0);
  // One inflated pair (zone-1's node to site A's node) stays symmetric but
  // breaks the triangle inequality.
  const detour = (a, b) =>
    [a, b].sort().join() === 'a0,b2' ? 5000 : between(a, b);
  for (const [distanceMeters, reason] of [
    [asymmetric, /symmetric/],
    [detour, /triangle/],
  ])
    for (const siteCount of [1, 2])
      for (const objective of OBJECTIVES) {
        const record = await suggest(
          study({ distanceMeters, siteCount, objective }),
        );
        assert.equal(record.status, 'unsupported');
        assert.match(record.reason, reason);
        assert.equal(record.suggestion, null);
        assert.deepEqual(record.ranking, []);
      }
  // Control: the true symmetric table supplied the same way is accepted.
  const control = await suggest(study({ distanceMeters: between }));
  assert.deepEqual(control.ranking, (await suggest(study())).ranking);
});

test('9. every suggestion is labelled hypothetical: a possible option, not zoning, approval or an observed fact', async () => {
  const studies = [
    ...[1, 2].flatMap((siteCount) =>
      OBJECTIVES.map((objective) => study({ siteCount, objective })),
    ),
    study({ eligibility: {} }),
    // A caller cannot promote the record.
    study({ determination: 'observed', approval: 'approved', observed: true }),
  ];
  for (const input of studies) {
    const record = await suggest(input);
    assert.equal(record.determination, 'hypothetical');
    assert.equal(record.claim, 'possible-option');
    assert.equal(record.approval, 'not-requested');
    assert.equal(record.zoning, 'not-assessed');
    assert.equal(record.observed, false);
    for (const entry of record.ranking)
      assert.equal(entry.determination, 'hypothetical');
    assert.doesNotMatch(JSON.stringify(record), /optimal|recommend|approved/i);
  }
  assert.equal((await suggest(studies[0])).ranking.length, 4);
});

test('10. a suggestion mutates neither the walk-access state nor the sample network', async () => {
  const network = structuredClone(WALK_ACCESS_FIXTURE);
  const eligibility = { ...ALL };
  const before = structuredClone({ network, eligibility });
  const evaluate = () =>
    evaluateWalkAccess({
      graph: createPedestrianGraph(network),
      zones: network.zones,
      parks: network.parks,
    });
  const alternatives = [
    {
      id: 'world-1',
      title: 'Park',
      parameters: { kind: 'park', site: 'site-a' },
    },
    {
      id: 'world-2',
      title: 'Plaza',
      parameters: { kind: 'plaza', site: null },
    },
  ];
  const alternativesBefore = structuredClone(alternatives);
  const accessBefore = evaluate();
  const panelBefore = structuredClone(presentCityWalkAccess(alternatives));
  for (const siteCount of [1, 2])
    for (const objective of OBJECTIVES) {
      const record = await suggest({
        network,
        eligibility,
        siteCount,
        objective,
      });
      assert.equal(record.status, 'suggested');
      assert.ok(Object.isFrozen(record));
      assert.ok(Object.isFrozen(record.ranking));
      // The frozen sample itself is accepted too.
      assert.deepEqual(await suggest(study({ siteCount, objective })), record);
    }
  assert.deepEqual({ network, eligibility }, before);
  assert.deepEqual(evaluate(), accessBefore);
  assert.deepEqual(alternatives, alternativesBefore);
  assert.deepEqual(
    structuredClone(presentCityWalkAccess(alternatives)),
    panelBefore,
  );
});
