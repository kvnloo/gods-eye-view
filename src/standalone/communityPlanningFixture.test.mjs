import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticCommunityPlanningFixture } from './communityPlanningFixture.js';
import { planningView } from '../data/communityPlanning.js';

/** The browser preview is always demo evidence, never a neighborhood claim. */
test('fixture uses two credited alternatives with an immutable synthetic baseline', () => {
  const { project, collaborationState } =
    createSyntheticCommunityPlanningFixture();
  assert.equal(project.baseline.state, 'reference-only');
  assert.equal(project.approval, 'not-requested');
  assert.match(project.place.label, /Synthetic/);
  assert.equal(project.baseline.sources[0].license, 'synthetic-test-data');
  const view = planningView(project, collaborationState);
  assert.equal(view.alternatives.length, 2);
  assert.deepEqual(
    view.alternatives.map((item) => item.authorship.actorId).sort(),
    ['alice', 'bob'],
  );
  assert.ok(view.alternatives.every((item) =>
    item.state === 'hypothesis' &&
    item.approval === 'not-requested' &&
    item.modeledImpact === 'not-evaluated' &&
    item.authorship.status === 'recorded'
  ));
  assert.ok(Object.isFrozen(project));
  assert.ok(Object.isFrozen(view));
});

test('co-op and game share alternatives without authority or impact claims', () => {
  const { project, collaborationState } =
    createSyntheticCommunityPlanningFixture();
  const a = planningView(project, collaborationState, 'co-op');
  const b = planningView(project, collaborationState, 'game');
  assert.deepEqual(a.alternatives, b.alternatives);
  assert.equal(a.effectPrediction, 'not-modeled');
  assert.equal(b.officialApproval, 'not-requested');
  assert.deepEqual(
    a.alternatives.map((item) => item.features.length).sort(),
    [2, 3],
  );
  const again = createSyntheticCommunityPlanningFixture();
  assert.deepEqual(planningView(again.project, again.collaborationState), a);
});
