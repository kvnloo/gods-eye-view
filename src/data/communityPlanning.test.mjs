import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCommunityPlanningProject,
  createPlanningAlternativeOperation,
  listPlanningAlternatives,
  planningView,
} from './communityPlanning.js';

import {
  applyCollaborationOperation,
  applyCollaborationOperations,
  createCollaborationState,
} from './collaborationAuthority.js';

function project() {
  return createCommunityPlanningProject({
    id: 'sample-park', title: 'Neighborhood park proposal',
    place: { label: 'Synthetic public parcel', bounds: [-88.2, 40.0, -88.1, 40.1] },
    baseline: { revision: 'reference-r1', sources: [{
      id: 'public-parcel', revision: '2026-09',
      url: 'https://example.org/parcel', attribution: 'Fixture, not verified land ownership',
      license: 'synthetic fixture',
    }] },
  });
}

function proposal(alternativeId, actorId, operationId, featureId, kind = 'tree') {
  return createPlanningAlternativeOperation(project(), {
    alternativeId, actorId, operationId, counter: 1,
    title: `${alternativeId} park option`,
    features: [{ id: featureId, kind, point: [-88.15, 40.05] }],
    assumptions: ['Site availability has not been verified'],
  });
}

function projection(operations) {
  const authored = {};
  for (const operation of operations) {
    authored[`draft-scenario:${operation.targetId}`] = {
      kind: operation.kind,
      targetId: operation.targetId,
      fields: { proposal: { value: operation.value } },
    };
  }
  return authored;
}

test('baseline is reference-only and cannot become approved through a mode switch', () => {
  const original = project();
  assert.equal(original.baseline.state, 'reference-only');
  assert.ok(Object.isFrozen(original));
  assert.deepEqual(original.place.bounds, [-88.2, 40, -88.1, 40.1]);
  const game = planningView(original, {}, 'game');
  const coop = planningView(original, {}, 'co-op');
  assert.equal(game.effectPrediction, 'not-modeled');
  assert.equal(coop.officialApproval, 'not-requested');
  assert.equal(original.approval, 'not-requested');
});

test('park options are separate mergeable draft-scenario operations', () => {
  const a = proposal('trees-first', 'alice', 'alice-op', 'oak');
  const b = proposal('play-first', 'bob', 'bob-op', 'play', 'play-area');
  for (const item of [a, b]) {
    assert.equal(item.kind, 'draft-scenario');
    assert.equal(item.field, 'proposal');
    assert.equal(item.value.state, 'hypothesis');
    assert.equal(item.value.baselineRevision, 'reference-r1');
    assert.equal(item.value.approval, 'not-requested');
    assert.equal(item.value.modeledImpact, 'not-evaluated');
  }
  assert.notEqual(a.targetId, b.targetId);
  const forward = listPlanningAlternatives(project(), { authored: projection([a, b]) });
  const reverse = listPlanningAlternatives(project(), { authored: projection([b, a]) });
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.map((x) => x.alternativeId), ['play-first', 'trees-first']);
});

test('park alternative ordering is stable under locale-dependent collation', () => {
  const cases = [
    proposal('aa', 'alice', 'op-aa', 'feat-aa'),
    proposal('ab', 'bob', 'op-ab', 'feat-ab'),
    proposal('z', 'charlie', 'op-z', 'feat-z'),
    proposal('a-1', 'dana', 'op-a-1', 'feat-a-1'),
  ];
  const ids = (operations) => listPlanningAlternatives(project(), {
    authored: projection(operations),
  }).map((item) => item.alternativeId);
  // This is a versioned synthetic comparison, not surveyed geometry.
  // Code-unit ordering must be independent of device/browser locale.
  const expected = ['a-1', 'aa', 'ab', 'z'];
  assert.deepEqual(ids(cases), expected);
  assert.deepEqual(ids([...cases].reverse()), expected);
  assert.deepEqual(ids(cases).slice(0, 2), ['a-1', 'aa']);
});

test('duplicate feature IDs and out-of-bounds geometry are refused', () => {
  assert.throws(() => createPlanningAlternativeOperation(project(), {
    alternativeId: 'x', operationId: 'one', actorId: 'alice', counter: 2,
    title: 'Duplicate ids',
    features: [{ id: 'a', kind: 'tree', point: [-88.15, 40.05] },
               { id: 'a', kind: 'garden', point: [-88.15, 40.05] }],
  }), /distinct/);
  assert.throws(() => createPlanningAlternativeOperation(project(), {
    alternativeId: 'x', operationId: 'one', actorId: 'alice', counter: 2,
    title: 'Out of footprint',
    features: [{ id: 'a', kind: 'tree', point: [-89, 40.05] }],
  }), /inside/);
});

test('missing provenance and invalid project bounds fail closed', () => {
  assert.throws(() => createCommunityPlanningProject({
    id: 'park', title: 'Park', place: { label: 'Parcel', bounds: [-88, 40, -88, 40.01] },
    baseline: { revision: 'r1' },
  }), /invalid planning bounds/);
  assert.throws(() => createCommunityPlanningProject({
    id: 'park', title: 'Park', place: { label: 'Parcel', bounds: [-88, 40, -87, 40.01] },
    baseline: { revision: 'r1', sources: [{ id: 's', revision: 'r1', url: 'http://invalid', attribution: 'X', license: 'X' }] },
  }), /HTTPS/);
});

test('baseline HTTPS credits reject credential parameters and unsafe fragments', () => {
  const baseline = project();
  const source = baseline.baseline.sources[0];
  const withUrl = (url) => createCommunityPlanningProject({
    id: baseline.id,
    title: baseline.title,
    place: baseline.place,
    baseline: {
      revision: baseline.baseline.revision,
      sources: [{ ...source, url }],
    },
  });
  for (const url of [
    'https://alice:secret@example.org/parcel',
    'https://alice@example.org/parcel',
    'https://:secret@example.org/parcel',
    'https://example.org/parcel?access_token=synthetic-canary',
    'https://example.org/parcel?API_KEY=synthetic-canary',
    'https://example.org/parcel?clientKey=synthetic-canary',
    'https://example.org/parcel?access_key=synthetic-canary',
    'https://example.org/parcel?privateKey=synthetic-canary',
    'https://example.org/parcel?x-service-key=synthetic-canary',
    'https://example.org/parcel?%63lient%4Bey=synthetic-canary',
    'https://example.org/parcel?%61ccess_token=synthetic-canary',
    'https://example.org/parcel?X-Amz-Signature=synthetic-canary',
    'https://example.org/parcel?session_id=synthetic-canary',
    'https://example.org/parcel?session=synthetic-canary',
    'https://example.org/parcel?code=synthetic-canary',
    'https://example.org/parcel?auth_code=synthetic-canary',
    'https://example.org/parcel?oauth_code=synthetic-canary',
    'https://example.org/parcel?%63ode=synthetic-canary',
    'https://localhost/parcel',
    'https://localhost./parcel',
    'https://intranet/parcel',
    'https://workstation.local/parcel',
    'https://planner.internal/parcel',
    'https://router.lan/parcel',
    'https://127.0.0.1/parcel',
    'https://127.1/parcel',
    'https://10.0.0.10/parcel',
    'https://192.168.2.1/parcel',
    'https://172.16.8.2/parcel',
    'https://169.254.169.254/metadata',
    'https://100.64.0.1/parcel',
    'https://[::1]/parcel',
    'https://example.org/parcel#access_token=synthetic-canary',
    'https://example.org/parcel#scene=private-position',
    'https://example.org/parcel#record%3Dprivate',
    'https://',
    'https://example.org/\nsecret',
    'http://example.org/parcel',
  ]) {
    assert.throws(() => withUrl(url), /HTTPS references/);
  }
  for (const url of [
    'https://example.org/parcel',
    'https://example.org/parcel?revision=1#record',
    'https://public.example.org/parcel',
    'https://1.1.1.1/parcel',
  ]) {
    assert.equal(withUrl(url).baseline.sources[0].url, url);
  }
});

test('stale or cross-project alternatives are not materialized as current', () => {
  const op = proposal('trees-first', 'alice', 'op-1', 'oak');
  assert.deepEqual(listPlanningAlternatives(project(), { authored: {
    [`draft-scenario:${op.targetId}`]: {
      fields: { proposal: { value: { ...op.value, baselineRevision: 'older-r0' } } },
    },
  } }), []);
  assert.deepEqual(listPlanningAlternatives(project(), { authored: {
    [`draft-scenario:${op.targetId}`]: {
      fields: { proposal: { value: { ...op.value, approval: 'approved' } } },
    },
  } }), []);
});

test('unknown imported schema revisions cannot be rebranded as local v1', () => {
  const p = project();
  const valid = proposal('trees-first', 'alice', 'alice-op', 'oak');
  for (const version of [0, 2, 99, null, undefined]) {
    const remote = {
      ...valid,
      id: `future-schema-${String(version)}`,
      value: { ...valid.value, schemaVersion: version },
    };
    const merged = applyCollaborationOperation(
      createCollaborationState(),
      remote,
    );
    assert.equal(merged.result.accepted, true);
    assert.deepEqual(listPlanningAlternatives(p, merged.state), []);
    assert.deepEqual(planningView(p, merged.state).alternatives, []);
  }
  const accepted = applyCollaborationOperation(
    createCollaborationState(),
    valid,
  );
  assert.equal(listPlanningAlternatives(p, accepted.state).length, 1);
  assert.equal(
    listPlanningAlternatives(p, accepted.state)[0].schemaVersion,
    1,
  );
});

test('co-op projection preserves recorded actor credits without identity claims', () => {
  const first = proposal('trees-first', 'alice', 'alice-op', 'oak');
  const second = proposal('play-first', 'bob', 'bob-op', 'play', 'play-area');
  const merged = applyCollaborationOperations(
    createCollaborationState(), [first, second],
  );
  const alternatives = listPlanningAlternatives(project(), merged.state);
  const byId = Object.fromEntries(
    alternatives.map((entry) => [entry.alternativeId, entry]),
  );
  assert.deepEqual(byId['trees-first'].authorship, {
    status: 'recorded', actorId: 'alice',
    operationId: 'alice-op', counter: 1,
  });
  assert.deepEqual(byId['play-first'].authorship, {
    status: 'recorded', actorId: 'bob',
    operationId: 'bob-op', counter: 1,
  });
  assert.equal(Object.isFrozen(alternatives[0].authorship), true);

  const noProof = listPlanningAlternatives(project(), {
    authored: projection([first]),
  });
  assert.deepEqual(noProof[0].authorship, {
    status: 'unknown', actorId: null,
    operationId: null, counter: null,
  });
  const tampered = applyCollaborationOperation(
    createCollaborationState(), first,
  ).state;
  const key = `draft-scenario:${first.targetId}`;
  tampered.authored[key].fields.proposal.clock.actorId = '<script>';
  assert.equal(
    listPlanningAlternatives(project(), tampered)[0].authorship.status,
    'unknown',
  );
});

test('invalid remote side effects cannot be authored by the planning API', () => {
  assert.throws(() => createPlanningAlternativeOperation(project(), {
    alternativeId: 'illegal', operationId: 'op', actorId: 'alice', counter: 0,
    title: 'Forbidden operation',
    features: [{ id: 'mic', kind: 'microphone', point: [-88.15, 40.05] }],
  }), /supported kind/);
  assert.throws(() => planningView(project(), {}, 'admin'), /unsupported planning mode/);
});

test('real collaboration kernel merges both neighbors and rejects remote control', () => {
  const a = proposal('trees-first', 'alice', 'alice-op', 'oak');
  const b = proposal('play-first', 'bob', 'bob-op', 'play', 'play-area');
  const first = applyCollaborationOperations(createCollaborationState(), [a, b]);
  const reversed = applyCollaborationOperations(createCollaborationState(), [b, a, a]);
  assert.deepEqual(
    listPlanningAlternatives(project(), first.state),
    listPlanningAlternatives(project(), reversed.state),
  );
  assert.equal(listPlanningAlternatives(project(), first.state).length, 2);

  const forbidden = applyCollaborationOperation(first.state, {
    id: 'peer-mic', actorId: 'bob', kind: 'presentation',
    targetId: 'room', field: 'micEnabled', counter: 3, value: true,
  });
  assert.equal(forbidden.result.accepted, false);
  assert.equal(
    forbidden.result.reason,
    'remote-side-effect-requires-local-confirmation',
  );
});

test('sparse imported planning arrays fail closed without breaking valid neighbors', () => {
  const base = project();
  const valid = proposal('trees-first', 'alice', 'alice-op', 'oak');
  const apply = (value) => applyCollaborationOperation(
    createCollaborationState(),
    { ...valid, value },
  );
  // The merge kernel accepts authored data. The planning projection must
  // reject sparse imported lists before the Scene UI iterates their holes.
  for (const field of ['features', 'assumptions']) {
    const accepted = apply({ ...valid.value, [field]: Array(1) });
    assert.equal(accepted.result.accepted, true);
    assert.deepEqual(listPlanningAlternatives(base, accepted.state), []);
    assert.deepEqual(planningView(base, accepted.state).alternatives, []);
  }

  const input = {
    alternativeId: 'trees-first',
    actorId: 'alice',
    operationId: 'alice-op',
    counter: 1,
    title: 'Trees and shade',
  };
  assert.throws(() => createPlanningAlternativeOperation(base, {
    ...input, features: Array(1),
  }), /features must be a dense bounded array/);
  assert.throws(() => createPlanningAlternativeOperation(base, {
    ...input, assumptions: Array(1),
  }), /assumptions must be a dense bounded array/);
  assert.throws(() => createPlanningAlternativeOperation(base, {
    ...input, features: [
      { id: 'oak', kind: 'tree', point: Array(2) },
    ],
  }), /feature requires a supported kind/);

  const site = {
    id: 'sample-park',
    title: 'Synthetic park',
    place: { label: 'Fixture site', bounds: [-88.2, 40, -88.1, 40.1] },
    baseline: { revision: 'r1' },
  };
  assert.throws(() => createCommunityPlanningProject({
    ...site, place: { ...site.place, bounds: Array(4) },
  }), /place bounds/);
  assert.throws(() => createCommunityPlanningProject({
    ...site, baseline: { ...site.baseline, sources: Array(1) },
  }), /sources must be a dense bounded array/);
  const positive = apply(valid.value);
  assert.deepEqual(
    listPlanningAlternatives(base, positive.state).map((item) => item.alternativeId),
    ['trees-first'],
  );
});

test('imported authored planning records require matching draft-scenario owner metadata', () => {
  const base = project();
  const trees = proposal('trees-first', 'alice', 'alice-op', 'oak');
  const play = proposal('play-first', 'bob', 'bob-op', 'play', 'play-area');
  const accepted = applyCollaborationOperations(
    createCollaborationState(), [trees, play],
  );
  const key = `draft-scenario:${trees.targetId}`;
  assert.deepEqual(
    listPlanningAlternatives(base, accepted.state).map((entry) => entry.alternativeId),
    ['play-first', 'trees-first'],
  );
  for (const mismatch of [
    { kind: 'annotation' },
    { kind: undefined },
    { targetId: 'community-plan:another-project:trees-first' },
    { targetId: undefined },
  ]) {
    const imported = {
      ...accepted.state,
      authored: {
        ...accepted.state.authored,
        [key]: { ...accepted.state.authored[key], ...mismatch },
      },
    };
    const visible = listPlanningAlternatives(base, imported);
    assert.deepEqual(visible.map((entry) => entry.alternativeId), ['play-first']);
    assert.equal(visible[0].authorship.actorId, 'bob');
  }
});
