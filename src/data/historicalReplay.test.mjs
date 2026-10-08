import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  applyHistoricalReplayMutation,
  branchHistoricalReplay,
  createHistoricalReplaySession,
  exportHistoricalReplayReceipt,
  historicalReplayDecisionNeedsReevaluation,
  historicalReplayReceiptJson,
  materializeHistoricalReplayEvidence,
  mountHistoricalReplayComparisonLane,
  recordHistoricalReplayDecision,
  seekHistoricalReplayCheckpoint,
  setHistoricalReplayPaused,
} from './historicalReplay.js';
import {
  BHOTE_KOSHI_TRAINING_ACCESS_FIXTURE_ID,
  createBhoteKoshiTrainingReplay,
} from './bhoteKoshiTrainingReplay.js';

const event = JSON.parse(
  await readFile(
    new URL('../../public/events/bhote-koshi-2026/event.json', import.meta.url),
    'utf8',
  ),
);

function scenario() {
  return createBhoteKoshiTrainingReplay(event);
}

function session() {
  return createHistoricalReplaySession(scenario(), {
    sessionId: 'study-session-1',
    participantId: 'participant-a',
  });
}

test('Bhote Koshi fixture freezes historical evidence, imagery, rights and training status', () => {
  const fixture = scenario();

  assert.equal(fixture.mode, 'historical-training');
  assert.equal(fixture.trainingOnly, true);
  assert.equal(fixture.operationalGuidance, false);
  assert.equal(fixture.event.id, 'bhote-koshi-2026');
  assert.equal(fixture.event.observedAt, '2026-08-26');
  assert.equal(fixture.evidence.length, 18);
  assert.equal(fixture.provenance.historicalEvidenceCount, 16);
  assert.equal(fixture.rights.linkedMediaNotRedistributed, true);
  assert.match(fixture.disclaimer, /not live operational guidance/i);
  assert.ok(Object.isFrozen(fixture));
  assert.ok(Object.isFrozen(fixture.evidence));
});

test('same event pack produces the same deterministic fixture revision', () => {
  assert.equal(scenario().fixtureRevision, scenario().fixtureRevision);
});

test('canonical fixture cannot be mutated and branch mutations leave it unchanged', () => {
  const canonical = session();
  assert.throws(
    () => applyHistoricalReplayMutation(canonical, 'facilitator-blocked-segment-r1'),
    /canonical replay fixture cannot be mutated/,
  );

  const branch = branchHistoricalReplay(canonical, 'blocked-branch');
  const mutated = applyHistoricalReplayMutation(
    branch,
    'facilitator-blocked-segment-r1',
  );
  const canonicalIds = materializeHistoricalReplayEvidence(canonical).map(
    ({ id }) => id,
  );
  const mutatedEvidence = materializeHistoricalReplayEvidence(mutated);

  assert.equal(
    canonicalIds.includes(BHOTE_KOSHI_TRAINING_ACCESS_FIXTURE_ID),
    false,
  );
  assert.equal(
    mutatedEvidence.find(
      ({ id }) => id === BHOTE_KOSHI_TRAINING_ACCESS_FIXTURE_ID,
    ).state,
    'blocked',
  );
  assert.equal(canonical.scenario.evidence.length, 18);
});

test('pause, seek, rewind and branch are deterministic data operations', () => {
  let replay = setHistoricalReplayPaused(session(), false);
  assert.equal(replay.paused, false);

  replay = seekHistoricalReplayCheckpoint(
    replay,
    'blocked-segment-reassessment',
  );
  assert.equal(replay.paused, true);
  assert.equal(replay.cursor.index, 1);

  replay = seekHistoricalReplayCheckpoint(replay, 'baseline-access-assessment');
  assert.equal(replay.cursor.index, 0);

  replay = branchHistoricalReplay(replay, 'hypothesis-a');
  assert.deepEqual(replay.branch, {
    id: 'hypothesis-a',
    parentId: 'canonical',
    mutations: [],
  });
});

test('evidence revision change forces re-evaluation before the next decision', () => {
  let replay = recordHistoricalReplayDecision(session(), {
    id: 'decision-baseline',
    assessment: 'unknown',
    evidenceIds: [event.evidenceSpine[0].id],
  });
  const baseline = replay.decisions[0];
  assert.equal(baseline.scorecard.pass, true);
  assert.equal(
    historicalReplayDecisionNeedsReevaluation(replay, baseline),
    false,
  );

  replay = branchHistoricalReplay(replay, 'facilitator-branch');
  replay = applyHistoricalReplayMutation(
    replay,
    'facilitator-blocked-segment-r1',
  );
  assert.equal(
    historicalReplayDecisionNeedsReevaluation(replay, baseline),
    true,
  );

  replay = seekHistoricalReplayCheckpoint(
    replay,
    'blocked-segment-reassessment',
  );
  replay = recordHistoricalReplayDecision(replay, {
    id: 'decision-blocked',
    assessment: 'unsupported',
    evidenceIds: [BHOTE_KOSHI_TRAINING_ACCESS_FIXTURE_ID],
  });
  const blocked = replay.decisions.at(-1);
  assert.equal(blocked.scorecard.pass, true);
  assert.equal(blocked.trainingOnly, true);
  assert.equal(blocked.operationalGuidance, false);

  replay = applyHistoricalReplayMutation(
    replay,
    'facilitator-stale-open-r2',
  );
  assert.equal(
    historicalReplayDecisionNeedsReevaluation(replay, blocked),
    true,
  );
});

test('stale-open evidence expects unknown and unsupported safe claims fail', () => {
  let replay = branchHistoricalReplay(session(), 'stale-open-branch');
  replay = applyHistoricalReplayMutation(
    replay,
    'facilitator-stale-open-r2',
  );
  replay = seekHistoricalReplayCheckpoint(replay, 'stale-open-reassessment');
  replay = recordHistoricalReplayDecision(replay, {
    id: 'decision-stale',
    assessment: 'unknown',
    evidenceIds: [BHOTE_KOSHI_TRAINING_ACCESS_FIXTURE_ID],
  });
  assert.equal(replay.decisions.at(-1).scorecard.pass, true);

  replay = recordHistoricalReplayDecision(replay, {
    id: 'decision-safe',
    assessment: 'safe',
    evidenceIds: [BHOTE_KOSHI_TRAINING_ACCESS_FIXTURE_ID],
  });
  const unsafe = replay.decisions.at(-1).scorecard;
  assert.equal(unsafe.unsupportedSafeClaim, true);
  assert.equal(unsafe.pass, false);
});

test('live feeds require an explicit separate comparison lane', () => {
  const replay = session();
  assert.deepEqual(replay.comparisonLanes, []);
  assert.throws(
    () =>
      mountHistoricalReplayComparisonLane(replay, {
        id: 'weather-now',
        revision: 'r1',
      }),
    /explicit live-comparison lane/,
  );

  const compared = mountHistoricalReplayComparisonLane(replay, {
    id: 'weather-now',
    kind: 'live-comparison',
    revision: 'provider:r1',
    source: 'explicit test provider',
  });
  assert.deepEqual(compared.comparisonLanes, [
    {
      id: 'weather-now',
      kind: 'live-comparison',
      revision: 'provider:r1',
      source: 'explicit test provider',
      label: null,
    },
  ]);
  assert.equal(replay.comparisonLanes.length, 0);
});

test('participant decisions and mutations export as deterministic training receipts', () => {
  let replay = branchHistoricalReplay(session(), 'export-branch');
  replay = applyHistoricalReplayMutation(
    replay,
    'facilitator-blocked-segment-r1',
  );
  replay = seekHistoricalReplayCheckpoint(
    replay,
    'blocked-segment-reassessment',
  );
  replay = recordHistoricalReplayDecision(replay, {
    id: 'decision-export',
    assessment: 'unsupported',
    evidenceIds: [BHOTE_KOSHI_TRAINING_ACCESS_FIXTURE_ID],
    note: 'Explicit simulated blocked segment changed the assessment.',
  });

  const receipt = exportHistoricalReplayReceipt(replay);
  assert.equal(receipt.kind, 'historical-training-receipt');
  assert.equal(receipt.trainingOnly, true);
  assert.equal(receipt.operationalGuidance, false);
  assert.equal(receipt.mutations.length, 1);
  assert.equal(receipt.decisions.length, 1);
  assert.equal(receipt.session.branchId, 'export-branch');
  assert.match(receipt.scenario.provenance.reconstructionCaveat, /not an official/i);
  assert.equal(
    historicalReplayReceiptJson(replay),
    historicalReplayReceiptJson(replay),
  );
});
