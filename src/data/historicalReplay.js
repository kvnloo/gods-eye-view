export const HISTORICAL_REPLAY_SCHEMA_VERSION = 1;
export const HISTORICAL_REPLAY_MODE = 'historical-training';

const DEFAULT_DISCLAIMER =
  'Historical/synthetic training output. Not live operational guidance.';

function nonEmptyText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function cloneJson(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
    return value;
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJson(entry)]),
    );
  }
  return null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function fnv1a32(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function historicalReplayValueRevision(prefix, value) {
  const name = nonEmptyText(prefix) || 'value';
  const hash = fnv1a32(canonicalJson(cloneJson(value)))
    .toString(16)
    .padStart(8, '0');
  return `${name}:${hash}`;
}

function uniqueIds(records, label) {
  const ids = new Set();
  for (const record of records) {
    const id = nonEmptyText(record?.id);
    if (!id) throw new TypeError(`${label} id is required`);
    if (ids.has(id)) throw new TypeError(`duplicate ${label} id: ${id}`);
    ids.add(id);
  }
}

function normalizeEvidence(record) {
  const id = nonEmptyText(record?.id);
  const revision = nonEmptyText(record?.revision);
  if (!id || !revision)
    throw new TypeError('evidence id and revision are required');
  return {
    ...cloneJson(record),
    id,
    revision,
  };
}

function normalizeMutation(mutation) {
  const id = nonEmptyText(mutation?.id);
  const kind = nonEmptyText(mutation?.kind);
  if (!id || !['upsert-evidence', 'remove-evidence'].includes(kind)) {
    throw new TypeError('mutation id and supported kind are required');
  }
  if (kind === 'upsert-evidence') {
    return {
      ...cloneJson(mutation),
      id,
      kind,
      record: normalizeEvidence(mutation.record),
    };
  }
  const evidenceId = nonEmptyText(mutation?.evidenceId);
  if (!evidenceId) throw new TypeError('remove-evidence requires evidenceId');
  return { ...cloneJson(mutation), id, kind, evidenceId };
}

function normalizeCheckpoint(checkpoint) {
  const id = nonEmptyText(checkpoint?.id);
  const expectedAssessment = nonEmptyText(checkpoint?.expectedAssessment);
  if (!id || !expectedAssessment)
    throw new TypeError('checkpoint id and expectedAssessment are required');
  const requiredEvidenceIds = [
    ...new Set(
      (Array.isArray(checkpoint.requiredEvidenceIds)
        ? checkpoint.requiredEvidenceIds
        : []
      )
        .map(nonEmptyText)
        .filter(Boolean),
    ),
  ];
  const watchedEvidenceIds = [
    ...new Set(
      (Array.isArray(checkpoint.watchedEvidenceIds)
        ? checkpoint.watchedEvidenceIds
        : requiredEvidenceIds
      )
        .map(nonEmptyText)
        .filter(Boolean),
    ),
  ];
  return {
    ...cloneJson(checkpoint),
    id,
    expectedAssessment,
    requiredEvidenceIds,
    watchedEvidenceIds,
  };
}

export function createHistoricalReplayScenario(input = {}) {
  const id = nonEmptyText(input.id);
  const title = nonEmptyText(input.title);
  const eventId = nonEmptyText(input.event?.id);
  const eventRevision = nonEmptyText(input.event?.revision);
  if (!id || !title || !eventId || !eventRevision) {
    throw new TypeError(
      'scenario id/title and event id/revision are required',
    );
  }

  const evidence = (Array.isArray(input.evidence) ? input.evidence : []).map(
    normalizeEvidence,
  );
  const mutations = (Array.isArray(input.mutations) ? input.mutations : []).map(
    normalizeMutation,
  );
  const checkpoints = (
    Array.isArray(input.checkpoints) ? input.checkpoints : []
  ).map(normalizeCheckpoint);
  uniqueIds(evidence, 'evidence');
  uniqueIds(mutations, 'mutation');
  uniqueIds(checkpoints, 'checkpoint');
  if (!checkpoints.length) throw new TypeError('at least one checkpoint is required');

  const fixture = {
    schemaVersion: HISTORICAL_REPLAY_SCHEMA_VERSION,
    mode: HISTORICAL_REPLAY_MODE,
    trainingOnly: true,
    operationalGuidance: false,
    id,
    title,
    event: cloneJson(input.event),
    evidence,
    routes: cloneJson(Array.isArray(input.routes) ? input.routes : []),
    annotations: cloneJson(
      Array.isArray(input.annotations) ? input.annotations : [],
    ),
    mutations,
    checkpoints,
    rights: cloneJson(input.rights ?? null),
    provenance: cloneJson(input.provenance ?? null),
    disclaimer: nonEmptyText(input.disclaimer) || DEFAULT_DISCLAIMER,
  };
  const fixtureRevision = historicalReplayValueRevision('replay', fixture);
  return deepFreeze({ ...fixture, fixtureRevision });
}

function assertScenario(scenario) {
  if (
    scenario?.schemaVersion !== HISTORICAL_REPLAY_SCHEMA_VERSION ||
    scenario?.mode !== HISTORICAL_REPLAY_MODE ||
    scenario?.trainingOnly !== true
  ) {
    throw new TypeError('valid historical replay scenario required');
  }
}

function sessionCopy(session, patch = {}) {
  return deepFreeze({
    ...session,
    ...patch,
  });
}

export function createHistoricalReplaySession(
  scenario,
  { sessionId = 'session', participantId = null } = {},
) {
  assertScenario(scenario);
  const normalizedSessionId = nonEmptyText(sessionId);
  if (!normalizedSessionId) throw new TypeError('sessionId is required');
  return sessionCopy({
    schemaVersion: HISTORICAL_REPLAY_SCHEMA_VERSION,
    sessionId: normalizedSessionId,
    participantId: nonEmptyText(participantId),
    scenario,
    branch: deepFreeze({ id: 'canonical', parentId: null, mutations: [] }),
    cursor: deepFreeze({ checkpointId: scenario.checkpoints[0].id, index: 0 }),
    paused: true,
    comparisonLanes: deepFreeze([]),
    decisions: deepFreeze([]),
  });
}

export function setHistoricalReplayPaused(session, paused = true) {
  assertScenario(session?.scenario);
  return sessionCopy(session, { paused: Boolean(paused) });
}

export function seekHistoricalReplayCheckpoint(session, checkpointId) {
  assertScenario(session?.scenario);
  const id = nonEmptyText(checkpointId);
  const index = session.scenario.checkpoints.findIndex(
    (checkpoint) => checkpoint.id === id,
  );
  if (index < 0) throw new RangeError(`unknown checkpoint: ${id}`);
  return sessionCopy(session, {
    cursor: deepFreeze({ checkpointId: id, index }),
    paused: true,
  });
}

export function branchHistoricalReplay(session, branchId) {
  assertScenario(session?.scenario);
  const id = nonEmptyText(branchId);
  if (!id || id === 'canonical') throw new TypeError('non-canonical branch id required');
  return sessionCopy(session, {
    branch: deepFreeze({
      id,
      parentId: session.branch.id,
      mutations: [...session.branch.mutations],
    }),
  });
}

function resolveMutation(scenario, mutation) {
  if (typeof mutation === 'string') {
    const found = scenario.mutations.find((candidate) => candidate.id === mutation);
    if (!found) throw new RangeError(`unknown mutation: ${mutation}`);
    return found;
  }
  return deepFreeze(normalizeMutation(mutation));
}

export function applyHistoricalReplayMutation(session, mutation) {
  assertScenario(session?.scenario);
  if (session.branch.id === 'canonical') {
    throw new Error('canonical replay fixture cannot be mutated; create a branch');
  }
  const resolved = resolveMutation(session.scenario, mutation);
  if (session.branch.mutations.some((entry) => entry.id === resolved.id))
    return session;
  return sessionCopy(session, {
    branch: deepFreeze({
      ...session.branch,
      mutations: [...session.branch.mutations, resolved],
    }),
  });
}

export function materializeHistoricalReplayEvidence(session) {
  assertScenario(session?.scenario);
  const order = [];
  const records = new Map();
  for (const record of session.scenario.evidence) {
    order.push(record.id);
    records.set(record.id, record);
  }
  for (const mutation of session.branch.mutations) {
    if (mutation.kind === 'remove-evidence') {
      records.delete(mutation.evidenceId);
      continue;
    }
    if (!records.has(mutation.record.id)) order.push(mutation.record.id);
    records.set(mutation.record.id, mutation.record);
  }
  return deepFreeze(order.filter((id) => records.has(id)).map((id) => records.get(id)));
}

export function mountHistoricalReplayComparisonLane(session, lane = {}) {
  assertScenario(session?.scenario);
  const id = nonEmptyText(lane.id);
  const revision = nonEmptyText(lane.revision);
  if (lane.kind !== 'live-comparison' || !id || !revision) {
    throw new TypeError(
      'live data requires an explicit live-comparison lane id and revision',
    );
  }
  if (session.comparisonLanes.some((entry) => entry.id === id)) return session;
  const normalized = deepFreeze({
    id,
    kind: 'live-comparison',
    revision,
    source: nonEmptyText(lane.source),
    label: nonEmptyText(lane.label),
  });
  return sessionCopy(session, {
    comparisonLanes: deepFreeze([...session.comparisonLanes, normalized]),
  });
}

function checkpointFor(session, id) {
  const checkpointId = nonEmptyText(id) || session.cursor.checkpointId;
  const checkpoint = session.scenario.checkpoints.find(
    (candidate) => candidate.id === checkpointId,
  );
  if (!checkpoint) throw new RangeError(`unknown checkpoint: ${checkpointId}`);
  return checkpoint;
}

function evidenceSnapshot(checkpoint, evidence) {
  const byId = new Map(evidence.map((record) => [record.id, record]));
  return Object.fromEntries(
    checkpoint.watchedEvidenceIds.map((id) => [
      id,
      byId.get(id)?.revision ?? null,
    ]),
  );
}

function normalizeEvidenceIds(value) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : []).map(nonEmptyText).filter(Boolean),
    ),
  ].sort();
}

function scoreDecision(checkpoint, assessment, evidenceIds, evidence) {
  const currentIds = new Set(evidence.map((record) => record.id));
  const requiredEvidenceCited = checkpoint.requiredEvidenceIds.every((id) =>
    evidenceIds.includes(id),
  );
  const citedEvidenceAvailable = evidenceIds.every((id) => currentIds.has(id));
  const assessmentCorrect = assessment === checkpoint.expectedAssessment;
  const unsupportedSafeClaim =
    assessment === 'safe' ||
    (assessment === 'open' && checkpoint.expectedAssessment !== 'open');
  return deepFreeze({
    assessmentCorrect,
    requiredEvidenceCited,
    citedEvidenceAvailable,
    unsupportedSafeClaim,
    pass:
      assessmentCorrect &&
      requiredEvidenceCited &&
      citedEvidenceAvailable &&
      !unsupportedSafeClaim,
  });
}

export function recordHistoricalReplayDecision(session, decision = {}) {
  assertScenario(session?.scenario);
  const id = nonEmptyText(decision.id);
  const assessment = nonEmptyText(decision.assessment);
  if (!id || !assessment) throw new TypeError('decision id and assessment required');
  if (session.decisions.some((entry) => entry.id === id)) return session;

  const checkpoint = checkpointFor(session, decision.checkpointId);
  const evidence = materializeHistoricalReplayEvidence(session);
  const evidenceIds = normalizeEvidenceIds(decision.evidenceIds);
  const receipt = deepFreeze({
    id,
    checkpointId: checkpoint.id,
    branchId: session.branch.id,
    assessment,
    evidenceIds,
    evidenceSnapshot: evidenceSnapshot(checkpoint, evidence),
    note: nonEmptyText(decision.note),
    scorecard: scoreDecision(checkpoint, assessment, evidenceIds, evidence),
    trainingOnly: true,
    operationalGuidance: false,
  });
  return sessionCopy(session, {
    decisions: deepFreeze([...session.decisions, receipt]),
  });
}

export function historicalReplayDecisionNeedsReevaluation(session, decision) {
  assertScenario(session?.scenario);
  const receipt =
    typeof decision === 'string'
      ? session.decisions.find((entry) => entry.id === decision)
      : decision;
  if (!receipt) throw new RangeError('decision receipt not found');
  const checkpoint = checkpointFor(session, receipt.checkpointId);
  const current = evidenceSnapshot(
    checkpoint,
    materializeHistoricalReplayEvidence(session),
  );
  return checkpoint.watchedEvidenceIds.some(
    (id) => current[id] !== receipt.evidenceSnapshot[id],
  );
}

export function exportHistoricalReplayReceipt(session) {
  assertScenario(session?.scenario);
  return deepFreeze({
    schemaVersion: HISTORICAL_REPLAY_SCHEMA_VERSION,
    kind: 'historical-training-receipt',
    trainingOnly: true,
    operationalGuidance: false,
    disclaimer: session.scenario.disclaimer,
    scenario: {
      id: session.scenario.id,
      fixtureRevision: session.scenario.fixtureRevision,
      event: cloneJson(session.scenario.event),
      rights: cloneJson(session.scenario.rights),
      provenance: cloneJson(session.scenario.provenance),
    },
    session: {
      id: session.sessionId,
      participantId: session.participantId,
      branchId: session.branch.id,
      parentBranchId: session.branch.parentId,
      checkpointId: session.cursor.checkpointId,
      paused: session.paused,
    },
    mutations: cloneJson(session.branch.mutations),
    comparisonLanes: cloneJson(session.comparisonLanes),
    decisions: cloneJson(session.decisions),
  });
}

export function historicalReplayReceiptJson(session) {
  return JSON.stringify(exportHistoricalReplayReceipt(session), null, 2);
}
