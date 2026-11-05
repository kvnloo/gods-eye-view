/**
 * Pre-registered, source-only scoring for the historical evidence pilot.
 *
 * Cases are scripted mutations, NOT observations about any real road. This
 * module neither reads the map nor certifies access or participant outcomes.
 */

/** Change only with a new documented protocol and fixture revision. */
export const PILOT_PROTOCOL_REVISION = 'GEV-I07-v1';
export const PILOT_EVIDENCE_REVISION = 'bhote-koshi-scripted-mutations-v1';

/** Incumbents count only when an actual, applicable workflow was exercised. */
export const PILOT_CONDITIONS = Object.freeze([
  'map-docs',
  'gev',
  'hot-tasking-manager',
  'mapswipe',
]);

/** Immutable answer key; never display this module to study participants. */
export const PILOT_CASES = Object.freeze([
  Object.freeze({
    id: 'blocked-update-v1',
    evidenceId: 'pilot:blocked-update-v1',
    expectedDecision: 'blocked',
    expectedFreshness: 'latest',
  }),
  Object.freeze({
    id: 'stale-open-v1',
    evidenceId: 'pilot:stale-open-v1',
    expectedDecision: 'unknown',
    expectedFreshness: 'stale',
  }),
]);

const CASES = new Map(PILOT_CASES.map((entry) => [entry.id, entry]));
const DECISIONS = new Set(['blocked', 'unknown', 'open', 'safe']);
const FRESHNESS = new Set(['latest', 'stale', 'unknown']);
const STATES = new Set(['scored', 'not-run', 'not-applicable']);
const REASONS = new Set([
  'not-scheduled',
  'tool-unavailable',
  'rights-blocked',
  'source-unavailable',
  'browser-unverified',
  'no-matched-workflow',
]);
const BASE_FIELDS = [
  'sessionKey',
  'evidenceRevision',
  'condition',
  'caseId',
  'status',
];
const SCORED_FIELDS = [
  ...BASE_FIELDS,
  'sequenceIndex',
  'decision',
  'freshness',
  'revisionRecognized',
  'recoveredEvidenceIds',
  'appAssertions',
  'elapsedSeconds',
  'evidenceNavigationActions',
];

function fail(message) {
  throw new TypeError('evidence pilot: ' + message);
}

function checkFields(record, allowed) {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) fail('unexpected field ' + key);
  }
  for (const key of allowed) {
    if (!Object.hasOwn(record, key)) fail('missing field ' + key);
  }
}

function nonnegative(value, integer = false) {
  return (
    value === null ||
    (typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0 &&
      (!integer || Number.isInteger(value)))
  );
}

function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('record must be an object');
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(record.sessionKey)) {
    fail('sessionKey must be an anonymous short code');
  }
  if (record.evidenceRevision !== PILOT_EVIDENCE_REVISION) {
    fail('evidence revision mismatch');
  }
  if (!PILOT_CONDITIONS.includes(record.condition)) {
    fail('unknown condition');
  }
  const caseInfo = CASES.get(record.caseId);
  if (!caseInfo) fail('unknown scripted case');
  if (!STATES.has(record.status)) fail('unknown record status');

  if (record.status !== 'scored') {
    checkFields(record, [...BASE_FIELDS, 'reason']);
    if (!REASONS.has(record.reason)) fail('unknown non-score reason');
    if (
      record.status === 'not-applicable' &&
      (record.condition === 'map-docs' ||
        record.condition === 'gev' ||
        record.reason !== 'no-matched-workflow')
    ) {
      fail('not-applicable is only for unmatched incumbent workflows');
    }
    if (
      record.status === 'not-run' &&
      record.reason === 'no-matched-workflow'
    ) {
      fail('unmatched workflow must be not-applicable');
    }
    return caseInfo;
  }

  checkFields(record, SCORED_FIELDS);
  if (!Number.isInteger(record.sequenceIndex) ||
    record.sequenceIndex < 1 ||
    record.sequenceIndex > PILOT_CONDITIONS.length) {
    fail('invalid sequenceIndex');
  }
  if (!DECISIONS.has(record.decision)) fail('invalid decision');
  if (!FRESHNESS.has(record.freshness)) fail('invalid freshness');
  if (typeof record.revisionRecognized !== 'boolean') {
    fail('revisionRecognized must be boolean');
  }
  if (!Array.isArray(record.recoveredEvidenceIds)) {
    fail('recoveredEvidenceIds must be an array');
  }
  const evidenceIds = new Set(PILOT_CASES.map((entry) => entry.evidenceId));
  if (
    new Set(record.recoveredEvidenceIds).size !==
      record.recoveredEvidenceIds.length ||
    record.recoveredEvidenceIds.some((id) => !evidenceIds.has(id))
  ) {
    fail('invalid or repeated recovered evidence ID');
  }
  if (
    record.appAssertions !== null &&
    (!Array.isArray(record.appAssertions) ||
      record.appAssertions.some((claim) => !DECISIONS.has(claim)))
  ) {
    fail('appAssertions must be null or an audited list of status claims');
  }
  if (record.condition !== 'gev' && record.appAssertions !== null) {
    fail('only GEV has an application-generated assertion audit');
  }
  if (!nonnegative(record.elapsedSeconds) ||
    !nonnegative(record.evidenceNavigationActions, true)) {
    fail('timing and navigation must be observed nonnegative values or null');
  }
  return caseInfo;
}

function grade(record, caseInfo) {
  const assertedOpen = record.decision === 'open' ||
    record.decision === 'safe';
  return {
    decisionErrors: Number(record.decision !== caseInfo.expectedDecision),
    freshnessErrors: Number(record.freshness !== caseInfo.expectedFreshness),
    falseOpenErrors: Number(assertedOpen),
    staleAsCurrentErrors: Number(
      caseInfo.id === 'stale-open-v1' &&
        (record.freshness === 'latest' || assertedOpen),
    ),
    unsupportedSafeClaims: Number(record.decision === 'safe'),
    revisionRecognitionCount: Number(record.revisionRecognized),
    citationRecoveredCount: Number(
      record.recoveredEvidenceIds.includes(caseInfo.evidenceId),
    ),
    appUnsupportedClaims: record.appAssertions === null
      ? null
      : record.appAssertions.filter((claim) =>
          claim === 'safe' || claim === 'open',
        ).length,
  };
}

function newSummary(condition) {
  return {
    condition,
    scored: 0,
    notRun: 0,
    notApplicable: 0,
    decisionErrors: 0,
    freshnessErrors: 0,
    falseOpenErrors: 0,
    staleAsCurrentErrors: 0,
    unsupportedSafeClaims: 0,
    revisionRecognitionCount: 0,
    revisionRecognitionRate: null,
    citationRecoveredCount: 0,
    citationEligibleCount: 0,
    citationRecoveryScore: null,
    measuredTimeCount: 0,
    elapsedSecondsTotal: 0,
    measuredNavigationCount: 0,
    navigationActionsTotal: 0,
    appAuditedCases: 0,
    appUnauditedCases: 0,
    appUnsupportedClaims: 0,
    appSafetyGate: null,
  };
}

function matchedComparison(comparator, pairs) {
  let pairedCases = 0;
  let gevDecisionErrors = 0;
  let incumbentDecisionErrors = 0;
  let gevCitationsRecovered = 0;
  let incumbentCitationsRecovered = 0;
  for (const pair of pairs.values()) {
    const gev = pair.get('gev');
    const other = pair.get(comparator);
    if (!gev || !other) continue;
    pairedCases += 1;
    gevDecisionErrors += gev.decisionErrors;
    incumbentDecisionErrors += other.decisionErrors;
    gevCitationsRecovered += gev.citationRecoveredCount;
    incumbentCitationsRecovered += other.citationRecoveredCount;
  }
  return {
    comparator,
    pairedCases,
    gevDecisionErrors,
    comparatorDecisionErrors: incumbentDecisionErrors,
    decisionErrorDifference: pairedCases
      ? gevDecisionErrors - incumbentDecisionErrors
      : null,
    gevCitationsRecovered,
    comparatorCitationsRecovered: incumbentCitationsRecovered,
    citationRecoveryDifference: pairedCases
      ? gevCitationsRecovered - incumbentCitationsRecovered
      : null,
  };
}

/**
 * Score de-identified, independently adjudicated study records.
 *
 * Missing trials, inapplicable incumbent workflows and unaudited GEV output
 * never become successes. The function has no network, clock or participant
 * access. Comparisons pair only the same anonymous session and scripted case.
 *
 * @param {Array<object>} records Protocol-formatted study observations.
 * @returns {object} Counts, denominators, matched differences and audit gates.
 */
export function scoreEvidencePilot(records) {
  if (!Array.isArray(records)) fail('records must be an array');
  const summaries = Object.fromEntries(
    PILOT_CONDITIONS.map((condition) => [condition, newSummary(condition)]),
  );
  const seen = new Set();
  const pairs = new Map();

  for (const record of records) {
    const caseInfo = validateRecord(record);
    const key = JSON.stringify([
      record.sessionKey,
      record.condition,
      caseInfo.id,
    ]);
    if (seen.has(key)) fail('duplicate session/condition/case');
    seen.add(key);
    const summary = summaries[record.condition];
    if (record.status === 'not-run') {
      summary.notRun += 1;
      continue;
    }
    if (record.status === 'not-applicable') {
      summary.notApplicable += 1;
      continue;
    }

    const result = grade(record, caseInfo);
    summary.scored += 1;
    for (const field of [
      'decisionErrors',
      'freshnessErrors',
      'falseOpenErrors',
      'staleAsCurrentErrors',
      'unsupportedSafeClaims',
      'revisionRecognitionCount',
      'citationRecoveredCount',
    ]) {
      summary[field] += result[field];
    }
    summary.citationEligibleCount += 1;
    if (record.elapsedSeconds !== null) {
      summary.measuredTimeCount += 1;
      summary.elapsedSecondsTotal += record.elapsedSeconds;
    }
    if (record.evidenceNavigationActions !== null) {
      summary.measuredNavigationCount += 1;
      summary.navigationActionsTotal += record.evidenceNavigationActions;
    }
    if (record.condition === 'gev') {
      if (result.appUnsupportedClaims === null) {
        summary.appUnauditedCases += 1;
      } else {
        summary.appAuditedCases += 1;
        summary.appUnsupportedClaims += result.appUnsupportedClaims;
      }
    }
    const pairKey = JSON.stringify([record.sessionKey, caseInfo.id]);
    if (!pairs.has(pairKey)) pairs.set(pairKey, new Map());
    pairs.get(pairKey).set(record.condition, result);
  }

  for (const summary of Object.values(summaries)) {
    if (!summary.scored) continue;
    summary.citationRecoveryScore =
      summary.citationRecoveredCount / summary.citationEligibleCount;
    summary.revisionRecognitionRate =
      summary.revisionRecognitionCount / summary.scored;
  }
  const gev = summaries.gev;
  if (gev.scored && gev.appUnauditedCases === 0) {
    gev.appSafetyGate = gev.appUnsupportedClaims === 0;
  }
  return {
    protocolRevision: PILOT_PROTOCOL_REVISION,
    evidenceRevision: PILOT_EVIDENCE_REVISION,
    byCondition: summaries,
    pairedComparisons: PILOT_CONDITIONS.filter(
      (condition) => condition !== 'gev',
    ).map((condition) => matchedComparison(condition, pairs)),
  };
}
