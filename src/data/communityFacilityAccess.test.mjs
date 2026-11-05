import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateHypotheticalFacilityAccess, FACILITY_ACCESS_LIMITS } from './communityFacilityAccess.js';

const POSITIONS = Object.freeze({ 'zone-n': 0, 'zone-s': 10, 'site-oak': 2, 'site-play': 8 });

function metric(positions = POSITIONS) {
  const nodeIds = Object.keys(positions);
  const distancesMeters = nodeIds.map((a) => nodeIds.map((b) => Math.abs(positions[a] - positions[b])));
  return { nodeIds, distancesMeters };
}

function fixture(changes = {}) {
  return {
    studyId: 'park-access-study',
    determination: 'hypothetical',
    datasetKind: 'synthetic',
    sourceRef: 'synthetic:fixture-s1',
    baselineRevision: 'parcel-r1',
    networkRevision: 'pedestrian-r1',
    demandRevision: 'weights-r1',
    metricRevision: 'walk-distances-r1',
    zones: [{ id: 'zone-n', weight: 3 }, { id: 'zone-s', weight: 1 }],
    sites: [{ id: 'site-oak', eligibility: 'assumed-feasible' },
            { id: 'site-play', eligibility: 'assumed-feasible' }],
    siteCount: 1,
    metric: metric(),
    ...changes,
  };
}

const run = changes => evaluateHypotheticalFacilityAccess(fixture(changes));

test('one-park exact reference reports weighted average AND underserved-zone distance', () => {
  const result = run();
  assert.equal(result.status, 'evaluated');
  assert.equal(result.approval, 'not-requested');
  assert.equal(result.determination, 'hypothetical');
  assert.deepEqual(result.alternatives.map(x => x.siteIds), [['site-oak'], ['site-play']]);
  assert.deepEqual(result.alternatives.map(x => x.weightedMeanDistanceMeters), [3.5, 6.5]);
  assert.equal(result.alternatives[0].worstServedDistanceMeters, 8);
  assert.equal(result.alternatives[0].zoneAccess.find(x => x.zoneId === 'zone-s').walkingDistanceMeters, 8);
  assert.equal('winner' in result, false);
});

test('two-park exact reference uses both sites; explicit siteCount bound', () => {
  const result = run({ siteCount: 2 });
  assert.equal(result.status, 'evaluated');
  assert.deepEqual(result.alternatives[0].siteIds, ['site-oak', 'site-play']);
  assert.equal(result.alternatives[0].weightedMeanDistanceMeters, 2);
  assert.equal(result.alternatives[0].worstServedDistanceMeters, 2);
  assert.equal(run({ siteCount: 3 }).status, 'unsupported');
});

test('no imported property can grant approval or transform synthetic into observed', () => {
  const result = run({ approval: 'approved', result: 'safe' });
  assert.equal(result.approval, 'not-requested');
  assert.equal(result.possibleWorld, true);
  assert.throws(() => run({ determination: 'observed' }), /hypothetical synthetic/);
  assert.throws(() => run({ datasetKind: 'real' }), /hypothetical synthetic/);
});

test('missing weight stays unknown, while valid zero weight stays zero', () => {
  assert.equal(run({ zones: [{ id: 'zone-n', weight: null }, { id: 'zone-s', weight: 1 }] }).reason, 'missing-zone-weight');
  const zero = run({ zones: [{ id: 'zone-n', weight: 0 }, { id: 'zone-s', weight: 1 }] });
  assert.equal(zero.status, 'evaluated');
  assert.equal(zero.alternatives[0].zoneAccess.find(z => z.zoneId === 'zone-n').weight, 0);
  assert.equal(run({ zones: [{ id: 'zone-n', weight: 0 }, { id: 'zone-s', weight: 0 }] }).reason, 'zero-total-demand');
});

test('metric missing/unreachable does not become a valid zero-length route', () => {
  const m = metric();
  m.distancesMeters[0][2] = null;
  assert.equal(run({ metric: m }).reason, 'missing-or-unreachable-distance');
  m.distancesMeters[0][2] = Infinity;
  assert.equal(run({ metric: m }).status, 'unknown');
  assert.equal(run({ metric: null }).reason, 'missing-metric');
});

test('asymmetric, zero-offdiagonal and nonzero diagonal are not metrics', () => {
  const m = metric();
  m.distancesMeters[0][2] = 3;
  assert.equal(run({ metric: m }).reason, 'not-a-proper-symmetric-metric');
  const z = metric(); z.distancesMeters[0][1] = 0; z.distancesMeters[1][0] = 0;
  assert.equal(run({ metric: z }).reason, 'not-a-proper-symmetric-metric');
  const d = metric(); d.distancesMeters[1][1] = 1;
  assert.equal(run({ metric: d }).reason, 'not-a-proper-symmetric-metric');
});

test('triangle inequality violations are explicit unsupported state', () => {
  const m = metric();
  m.distancesMeters[0][1] = 20;
  m.distancesMeters[1][0] = 20;
  assert.equal(run({ metric: m }).reason, 'triangle-inequality-failed');
});

test('site eligibility unknown and excluded are never promoted to assumed-feasible', () => {
  const sites = [{ id: 'site-oak', eligibility: 'unknown' },
                 { id: 'site-play', eligibility: 'assumed-feasible' }];
  const result = run({ sites });
  assert.deepEqual(result.eligibleSites, ['site-play']);
  assert.deepEqual(result.excludedSites, [{ id: 'site-oak', reason: 'unknown' }]);
  assert.equal(run({ sites, siteCount: 2 }).status, 'unknown');
  assert.equal(run({ sites: sites.map(s => ({ ...s, eligibility: 'excluded' })) }).status, 'infeasible');
});

test('invalid assumptions and IDs fail without guessing missing sources or input sizes', () => {
  for (const field of ['baselineRevision', 'networkRevision', 'demandRevision', 'metricRevision', 'sourceRef']) {
    assert.throws(() => run({ [field]: '' }), /reference/);
  }
  assert.throws(() => run({ zones: [{ id: 'zone-n', weight: '3' }, { id: 'zone-s', weight: 1 }] }), /weight/);
  assert.throws(() => run({ zones: [{ id: 'zone-n', weight: -1 }, { id: 'zone-s', weight: 1 }] }), /weight/);
  assert.throws(() => run({ sites: [{ id: 'site-oak', eligibility: 'assumed-feasible' }, { id: 'site-oak', eligibility: 'assumed-feasible' }] }), /unique/);
  assert.throws(() => run({ siteCount: 0 }), /siteCount/);
  const bad = metric(); bad.nodeIds[0] = 'site-oak';
  assert.throws(() => run({ metric: bad }), /exactly/);
  assert.equal(FACILITY_ACCESS_LIMITS.siteCount, 2);
});

test('input revision / eligibility and source identity survive; no mutation', () => {
  const input = fixture(); const before = JSON.stringify(input);
  const out = evaluateHypotheticalFacilityAccess(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(out.context.sourceRef, input.sourceRef);
  assert.equal(out.context.demandRevision, input.demandRevision);
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.alternatives));
  assert.deepEqual(out, evaluateHypotheticalFacilityAccess(input));
  const other = run({ demandRevision: 'weights-r2' });
  assert.notEqual(out.context.demandRevision, other.context.demandRevision);
});

test('enumeration is bounded and no partial proposed sites leak on size overflow', () => {
  const zones = Array.from({length: FACILITY_ACCESS_LIMITS.zones + 1}, (_, i) => ({id:'zone-'+i,weight:1}));
  assert.equal(run({ zones }).reason, 'reference-size-limit');
  const sites = Array.from({length: FACILITY_ACCESS_LIMITS.sites + 1}, (_, i) => ({id:'site-'+i,eligibility:'assumed-feasible'}));
  assert.equal(run({ sites }).reason, 'reference-size-limit');
});

test('all feasible unordered site subsets are enumerated, sorted and deduplicated', () => {
  const positions = {a:0,b:10,c:2,d:4,e:8};
  const zones = [{id:'a',weight:1},{id:'b',weight:1}];
  const sites = [{id:'c',eligibility:'assumed-feasible'}, {id:'d',eligibility:'assumed-feasible'}, {id:'e',eligibility:'assumed-feasible'}];
  const out=run({zones,sites,siteCount:2,metric:metric(positions)});
  assert.equal(out.status,'evaluated');
  assert.equal(out.alternatives.length,3);
  assert.deepEqual(out.alternatives.map(x=>x.siteIds.join(',')), ['c,e','d,e','c,d']);
});

test('independent exact oracle agrees with evaluation on synthetic line metrics', () => {
  for(let w0=0;w0<=4;w0++) for(let w1=0;w1<=4;w1++) {
    if(w0+w1===0) continue;
    const zones=[{id:'zone-n',weight:w0},{id:'zone-s',weight:w1}];
    const out=run({zones});
    const brute=[
      {site:'site-oak',cost:w0*2+w1*8},
      {site:'site-play',cost:w0*8+w1*2},
    ].sort((a,b)=>a.cost-b.cost||a.site.localeCompare(b.site));
    assert.equal(out.alternatives[0].totalWeightedDistanceMeters,brute[0].cost);
    assert.equal(out.alternatives[0].siteIds[0],brute[0].site);
    assert.equal(out.alternatives[0].weightedMeanDistanceMeters,brute[0].cost/(w0+w1));
  }
});
