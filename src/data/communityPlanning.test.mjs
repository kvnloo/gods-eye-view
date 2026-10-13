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
