import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PILOT_CASES,
  PILOT_CONDITIONS,
  PILOT_EVIDENCE_REVISION,
  PILOT_PROTOCOL_REVISION,
  scoreEvidencePilot,
} from './evidencePilotScoring.js';

// Every row here is a constructed unit-test input, never a practitioner result.
function example(condition, caseId, overrides = {}) {
  const caseInfo = PILOT_CASES.find((entry) => entry.id === caseId);
  return {
    sessionKey: 'synthetic-test',
    evidenceRevision: PILOT_EVIDENCE_REVISION,
    condition,
    caseId,
    status: 'scored',
    sequenceIndex: PILOT_CONDITIONS.indexOf(condition) + 1,
    decision: caseInfo.expectedDecision,
    freshness: caseInfo.expectedFreshness,
    revisionRecognized: true,
    recoveredEvidenceIds: [caseInfo.evidenceId],
    appAssertions: condition === 'gev' ? [] : null,
    elapsedSeconds: null,
    evidenceNavigationActions: null,
    ...overrides,
  };
}

function skip(condition, caseId, status, reason) {
  return {
    sessionKey: 'synthetic-test',
    evidenceRevision: PILOT_EVIDENCE_REVISION,
    condition,
    caseId,
    status,
    reason,
  };
}

test('zero observations never produces a success score or a passed GEV safety gate', () => {
  const result = scoreEvidencePilot([]);
  assert.equal(result.protocolRevision, PILOT_PROTOCOL_REVISION);
  assert.equal(result.evidenceRevision, PILOT_EVIDENCE_REVISION);
  for (const condition of PILOT_CONDITIONS) {
    const row = result.byCondition[condition];
    assert.equal(row.scored, 0);
    assert.equal(row.citationRecoveryScore, null);
    assert.equal(row.revisionRecognitionRate, null);
    assert.equal(row.appSafetyGate, null);
  }
  for (const pair of result.pairedComparisons) {
    assert.equal(pair.pairedCases, 0);
    assert.equal(pair.decisionErrorDifference, null);
    assert.equal(pair.citationRecoveryDifference, null);
  }
});

test('same fixed mutations produce deterministic paired decision and citation scores', () => {
  const rows = [
    example('gev', 'blocked-update-v1', {
      elapsedSeconds: 12,
      evidenceNavigationActions: 2,
    }),
    example('gev', 'stale-open-v1', {
      elapsedSeconds: 15,
      evidenceNavigationActions: 3,
    }),
    example('map-docs', 'blocked-update-v1', {
      decision: 'open',
      freshness: 'stale',
      revisionRecognized: false,
      recoveredEvidenceIds: [],
    }),
    example('map-docs', 'stale-open-v1', {
      decision: 'open',
      freshness: 'latest',
      recoveredEvidenceIds: [],
    }),
    example('hot-tasking-manager', 'blocked-update-v1'),
    example('hot-tasking-manager', 'stale-open-v1', {
      decision: 'unknown',
      recoveredEvidenceIds: [],
    }),
    example('mapswipe', 'blocked-update-v1', {
      decision: 'unknown',
      recoveredEvidenceIds: [],
    }),
    example('mapswipe', 'stale-open-v1'),
  ];
  const original = JSON.stringify(rows);
  const result = scoreEvidencePilot(rows);
  assert.deepEqual(scoreEvidencePilot([...rows].reverse()), result);
  assert.equal(JSON.stringify(rows), original);

  const gev = result.byCondition.gev;
  assert.equal(gev.scored, 2);
  assert.equal(gev.decisionErrors, 0);
  assert.equal(gev.falseOpenErrors, 0);
  assert.equal(gev.staleAsCurrentErrors, 0);
  assert.equal(gev.citationRecoveredCount, 2);
  assert.equal(gev.citationRecoveryScore, 1);
  assert.equal(gev.revisionRecognitionRate, 1);
  assert.equal(gev.appSafetyGate, true);
  assert.equal(gev.elapsedSecondsTotal, 27);
  assert.equal(gev.measuredTimeCount, 2);
  assert.equal(gev.navigationActionsTotal, 5);

  const docs = result.byCondition['map-docs'];
  assert.equal(docs.decisionErrors, 2);
  assert.equal(docs.freshnessErrors, 2);
  assert.equal(docs.falseOpenErrors, 2);
  assert.equal(docs.staleAsCurrentErrors, 1);
  assert.equal(docs.revisionRecognitionCount, 1);
  assert.equal(docs.citationRecoveryScore, 0);

  const baseline = result.pairedComparisons.find(
    (pair) => pair.comparator === 'map-docs',
  );
  assert.equal(baseline.pairedCases, 2);
  assert.equal(baseline.decisionErrorDifference, -2);
  assert.equal(baseline.citationRecoveryDifference, 2);
  const tasking = result.pairedComparisons.find(
    (pair) => pair.comparator === 'hot-tasking-manager',
  );
  assert.equal(tasking.pairedCases, 2);
  assert.equal(tasking.decisionErrorDifference, 0);
  assert.equal(tasking.citationRecoveryDifference, 1);
});

test('unsupported safe/open app assertions are separate from participant mistakes', () => {
  const score = scoreEvidencePilot([
    example('gev', 'blocked-update-v1', {
      decision: 'safe',
      freshness: 'unknown',
      recoveredEvidenceIds: [],
      revisionRecognized: false,
      appAssertions: ['safe', 'open', 'unknown'],
    }),
    example('gev', 'stale-open-v1', {
      decision: 'open',
      freshness: 'latest',
      appAssertions: [],
    }),
  ]).byCondition.gev;
  assert.equal(score.decisionErrors, 2);
  assert.equal(score.falseOpenErrors, 2);
  assert.equal(score.unsupportedSafeClaims, 1);
  assert.equal(score.staleAsCurrentErrors, 1);
  assert.equal(score.appAuditedCases, 2);
  assert.equal(score.appUnsupportedClaims, 2);
  assert.equal(score.appSafetyGate, false);
  assert.equal(score.citationRecoveredCount, 1);
  assert.equal(score.revisionRecognitionRate, 0.5);
});

test('one audited GEV mutation is insufficient to pass the two-case safety gate', () => {
  const onlyOne = scoreEvidencePilot([
    example('gev', 'blocked-update-v1'),
  ]).byCondition.gev;
  assert.equal(onlyOne.scored, 1);
  assert.equal(onlyOne.appAuditedCases, 1);
  assert.equal(onlyOne.appSafetyGate, null);
  const unavailableOther = scoreEvidencePilot([
    example('gev', 'blocked-update-v1'),
    skip('gev', 'stale-open-v1', 'not-run', 'browser-unverified'),
  ]).byCondition.gev;
  assert.equal(unavailableOther.notRun, 1);
  assert.equal(unavailableOther.appSafetyGate, null);
});

test('unaudited app output and missing measurements stay unknown, not zero or passed', () => {
  const score = scoreEvidencePilot([
    example('gev', 'blocked-update-v1', {
      appAssertions: null,
      elapsedSeconds: null,
      evidenceNavigationActions: null,
    }),
    example('gev', 'stale-open-v1'),
  ]).byCondition.gev;
  assert.equal(score.appAuditedCases, 1);
  assert.equal(score.appUnauditedCases, 1);
  assert.equal(score.appUnsupportedClaims, 0);
  assert.equal(score.appSafetyGate, null);
  assert.equal(score.measuredTimeCount, 0);
  assert.equal(score.measuredNavigationCount, 0);
});

test('unmatched incumbent workflows are not scored as failures or as victories', () => {
  const rows = [
    example('gev', 'blocked-update-v1'),
    skip(
      'hot-tasking-manager',
      'blocked-update-v1',
      'not-applicable',
      'no-matched-workflow',
    ),
    skip(
      'mapswipe',
      'blocked-update-v1',
      'not-run',
      'rights-blocked',
    ),
  ];
  const score = scoreEvidencePilot(rows);
  assert.equal(score.byCondition['hot-tasking-manager'].notApplicable, 1);
  assert.equal(score.byCondition['hot-tasking-manager'].decisionErrors, 0);
  assert.equal(score.byCondition.mapswipe.notRun, 1);
  assert.equal(
    score.pairedComparisons.find(
      (pair) => pair.comparator === 'hot-tasking-manager',
    ).decisionErrorDifference,
    null,
  );
  assert.equal(
    score.pairedComparisons.find(
      (pair) => pair.comparator === 'mapswipe',
    ).pairedCases,
    0,
  );
});

test('citation recovery requires the case-specific scripted evidence card', () => {
  const score = scoreEvidencePilot([
    example('map-docs', 'blocked-update-v1', {
      recoveredEvidenceIds: ['pilot:stale-open-v1'],
    }),
  ]).byCondition['map-docs'];
  assert.equal(score.citationRecoveredCount, 0);
  assert.equal(score.citationEligibleCount, 1);
  assert.equal(score.citationRecoveryScore, 0);
});

test('the scorer rejects unregistered cases, missing audit, duplicates and shortcuts', () => {
  const valid = example('gev', 'blocked-update-v1');
  const badRows = [
    { ...valid, evidenceRevision: 'other-script' },
    { ...valid, caseId: 'invented-access-case' },
    { ...valid, condition: 'fake-incumbent' },
    { ...valid, appAssertions: undefined },
    { ...valid, recoveredEvidenceIds: ['pilot:blocked-update-v1', 'pilot:blocked-update-v1'] },
    { ...valid, recoveredEvidenceIds: ['pilot:invented'] },
    { ...valid, elapsedSeconds: -1 },
    { ...valid, evidenceNavigationActions: 1.5 },
    { ...valid, revisionRecognized: 'yes' },
    { ...valid, status: 'not-applicable', reason: 'no-matched-workflow' },
    { ...valid, participantName: 'forbidden' },
  ];
  for (const row of badRows) {
    assert.throws(() => scoreEvidencePilot([row]), TypeError);
  }
  assert.throws(() => scoreEvidencePilot([valid, { ...valid }]), /duplicate/);
  assert.throws(() => scoreEvidencePilot({ records: [] }), TypeError);
  assert.throws(
    () => scoreEvidencePilot([
      skip(
        'map-docs',
        'blocked-update-v1',
        'not-applicable',
        'no-matched-workflow',
      ),
    ]),
    /not-applicable/,
  );
});
