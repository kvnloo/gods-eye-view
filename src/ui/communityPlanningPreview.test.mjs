// src/ui/communityPlanningPreview.test.mjs — the planning preview owner
// presents two authored hypothetical proposals, their provenance and the
// records the projection excludes, and owns at most one open comparison.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import {
  mountCommunityPlanningPreview,
  presentCommunityPlanningPreview,
} from './communityPlanningPreview.js';
import { useCommunityPlanningStore } from './stores/communityPlanning.js';
import { useSceneSharingStore } from './stores/sceneSharing.js';
import { createSyntheticCommunityPlanningFixture } from '../standalone/communityPlanningFixture.js';

const prefix = 'draft-scenario:community-plan:synthetic-park:';

/** The fixture with authored records replaced or added, for negative cases. */
function withAuthored(edit) {
  const fixture = createSyntheticCommunityPlanningFixture();
  const authored = { ...fixture.collaborationState.authored };
  edit(authored);
  return {
    project: fixture.project,
    collaborationState: { ...fixture.collaborationState, authored },
  };
}

test('co-op shows both credited hypothetical proposals and 5 schematic markers', () => {
  const view = presentCommunityPlanningPreview(
    createSyntheticCommunityPlanningFixture(),
  );
  assert.equal(view.mode, 'co-op');
  assert.equal(view.gameDisabled, false);
  assert.equal(view.unavailable, null);
  assert.deepEqual(view.inspect, []);
  assert.deepEqual(
    view.cards.map((card) => [card.title, card.author, card.hidden]),
    [
      [
        'Play & community garden',
        'Recorded author: bob (unverified identity)',
        false,
      ],
      ['Trees & shade', 'Recorded author: alice (unverified identity)', false],
    ],
  );
  assert.equal(view.cards.flatMap((card) => card.markers).length, 5);
  for (const marker of view.cards.flatMap((card) => card.markers)) {
    assert.ok(marker.x >= 16 && marker.x <= 284, marker.label);
    assert.ok(marker.y >= 16 && marker.y <= 134, marker.label);
  }
  assert.ok(
    view.cards.every((card) => card.impact === 'Modeled impact: not-evaluated'),
  );
  assert.ok(
    view.cards.every((card) => card.approval === 'Approval: not-requested'),
  );
  assert.match(
    view.sources[0],
    /^Baseline citation \(UNVERIFIED\): synthetic-source/,
  );
  assert.match(view.sources[0], /NOT rights-cleared\): synthetic-test-data/);
  assert.match(
    view.recordSummary,
    /^Planning records excluded as stale or incompatible: 0 · valid beyond this two-proposal preview: 0\./,
  );
  assert.equal(view.additional, null);
  assert.equal(view.excluded, null);
  assert.equal(view.modeStatus, 'View: co-op · neither mode grants authority');
});

test('game focuses one proposal; inspecting switches it without changing data', () => {
  const fixture = createSyntheticCommunityPlanningFixture();
  const before = JSON.stringify(fixture.collaborationState);
  const first = presentCommunityPlanningPreview(fixture, { mode: 'game' });
  assert.equal(first.mode, 'game');
  assert.deepEqual(
    first.cards.map((card) => card.hidden),
    [false, true],
  );
  assert.deepEqual(
    first.inspect.map((item) => item.pressed),
    [true, false],
  );
  assert.match(
    first.modeStatus,
    /^View: game · inspecting Play & community garden · proposal play-first/,
  );
  const second = presentCommunityPlanningPreview(fixture, {
    mode: 'game',
    focusedId: 'trees-first',
  });
  assert.deepEqual(
    second.cards.map((card) => card.hidden),
    [true, false],
  );
  assert.deepEqual(
    second.inspect.map((item) => item.pressed),
    [false, true],
  );
  assert.equal(JSON.stringify(fixture.collaborationState), before);
});

test('one or zero valid proposals say comparison is unavailable and disable Game', () => {
  const one = presentCommunityPlanningPreview(
    withAuthored((authored) => delete authored[`${prefix}trees-first`]),
    { mode: 'game' },
  );
  assert.equal(
    one.unavailable,
    'Only one valid proposal is available; comparing requires two.',
  );
  assert.equal(one.gameDisabled, true);
  assert.equal(one.mode, 'co-op');
  assert.equal(one.cards.length, 1);
  const none = presentCommunityPlanningPreview(
    withAuthored((authored) => {
      for (const key of Object.keys(authored)) delete authored[key];
    }),
  );
  assert.match(none.unavailable, /^No valid proposals to compare/);
  assert.equal(none.cards.length, 0);
});

test('excluded records show one fixed reason and never their rejected payload', () => {
  const view = presentCommunityPlanningPreview(
    withAuthored((authored) => {
      const record = authored[`${prefix}play-first`];
      const proposal = record.fields.proposal.value;
      authored[`${prefix}play-first`] = {
        ...record,
        fields: {
          ...record.fields,
          proposal: {
            ...record.fields.proposal,
            value: { ...proposal, approval: 'CITY COUNCIL APPROVED' },
          },
        },
      };
      authored[`${prefix}Bad ID`] = { kind: 'draft-scenario' };
    }),
  );
  assert.match(
    view.recordSummary,
    /^Planning records excluded as stale or incompatible: 2 ·/,
  );
  assert.equal(view.excluded.summary, 'Inspect 2 excluded proposal records');
  assert.deepEqual(view.excluded.items, [
    'Excluded (invalid proposal id) · invalid proposal identifier; other validation failures may exist',
    'Excluded play-first · proposal carries an unverified approval claim; other validation failures may exist',
  ]);
  assert.doesNotMatch(JSON.stringify(view), /CITY COUNCIL|Bad ID/);
});

function mounted(t, fixture = createSyntheticCommunityPlanningFixture()) {
  const pinia = createPinia();
  const store = useCommunityPlanningStore(pinia);
  const sharing = useSceneSharingStore(pinia);
  const dispose = mountCommunityPlanningPreview(fixture, { pinia });
  t.after(dispose);
  return { store, sharing, dispose };
}

test('the owner offers a launcher, opens one comparison and tears down idempotently', (t) => {
  const { store, dispose } = mounted(t);
  assert.equal(store.launcher.label, 'COMPARE PARK PROPOSALS · FIXTURE');
  assert.equal(store.preview, null);
  store.controls.open();
  const opened = store.preview;
  assert.equal(opened.cards.length, 2);
  store.controls.open();
  assert.equal(store.preview, opened, 'a second open is ignored');
  store.controls.setMode('game');
  assert.equal(store.preview.mode, 'game');
  store.controls.inspect('trees-first');
  assert.deepEqual(
    store.preview.cards.map((card) => card.hidden),
    [true, false],
  );
  store.controls.setMode('bogus');
  assert.equal(store.preview.mode, 'game');
  store.controls.close();
  assert.equal(store.preview, null);
  store.controls.open();
  assert.equal(store.preview.mode, 'co-op', 'reopening starts in co-op');
  const controls = store.controls;
  dispose();
  dispose();
  assert.equal(store.launcher, null);
  assert.equal(store.preview, null);
  assert.equal(store.controls, null);
  controls.open();
  assert.equal(store.preview, null, 'a retained control cannot reopen it');
});

test('the comparison never opens beneath another Scene dialog', (t) => {
  const { store, sharing } = mounted(t);
  sharing.publishDialog({ id: 1, title: 'Edit', items: [] });
  store.controls.open();
  assert.equal(store.preview, null);
  sharing.publishDialog(null);
  store.controls.open();
  assert.ok(store.preview);
});

test('a newer owner keeps the store when an older one is torn down', (t) => {
  const pinia = createPinia();
  const store = useCommunityPlanningStore(pinia);
  const fixture = createSyntheticCommunityPlanningFixture();
  const older = mountCommunityPlanningPreview(fixture, { pinia });
  const newer = mountCommunityPlanningPreview(fixture, { pinia });
  t.after(newer);
  older();
  assert.ok(store.launcher);
  store.controls.open();
  assert.ok(store.preview);
});
