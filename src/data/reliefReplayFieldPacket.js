/**
 * Offline, read-only projection of a synthetic relief outage replay.
 * Accepts a World Packet *reference* when available, never imports Cesium,
 * reconstructs live world truth, contacts a provider, or authorizes dispatch.
 * World Packet's current PR is intentionally not a code dependency.
 */
export const RELIEF_FIELD_PACKET_VERSION = 1;

const REF = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/;
const SYNTHETIC = /^synthetic:[a-zA-Z0-9_.:-]{1,150}$/;
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const SEMANTIC_FINGERPRINT = /^fnv1a64:[0-9a-f]{16}$/;
const OUTAGE_KIND = 'synthetic-outage-replay-v1';
const STATUSES = new Set(['evaluated', 'limited']);

const valid = (value, expression) =>
  typeof value === 'string' && expression.test(value);
const safeNumber = (x) => Number.isSafeInteger(x) && x >= 0;

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function worldBinding(reference, expectedRevision) {
  if (reference === undefined || reference === null) {
    return { status: 'not-attached', semanticFingerprint: null, revision: null,
      freshness: 'unknown', authority: 'none' };
  }
  if (!reference || Array.isArray(reference) || typeof reference !== 'object' ||
      !valid(reference.semanticFingerprint, SEMANTIC_FINGERPRINT) ||
      !valid(reference.revision, REF) || reference.revision !== expectedRevision) {
    return null;
  }
  // Never accept a caller's claim that an offline snapshot is currently live.
  return { status: 'reference-only', semanticFingerprint: reference.semanticFingerprint,
    revision: reference.revision, freshness: 'not-assessed-offline', authority: 'none' };
}

function stage(source, phase) {
  if (!source || typeof source !== 'object' ||
      !valid(source.accessRevision, REF) || !valid(source.routeRevision, REF) ||
      !STATUSES.has(source.status) || !safeNumber(source.unknownRoutes)) return null;
  const exact = source.knownOnlyExhaustive;
  const control = source.knownOnlyNearestFirst;
  const bound = source.upperBoundIfUnknownPassableUnits;
  if (!exact || !control || !safeNumber(bound)) return null;
  const metrics = ['servedUnits', 'priorityWeightedServedUnits', 'totalOneWayTravelMinutes'];
  if (metrics.some((key) => !safeNumber(exact[key]) || !safeNumber(control[key]))) return null;
  if (exact.servedUnits > bound || control.servedUnits > bound) return null;
  if (source.status === 'evaluated' && source.unknownRoutes !== 0) return null;
  if (source.status === 'limited' && source.unknownRoutes === 0) return null;
  const mapPlan = (plan) => {
    if (!Array.isArray(plan.unmetNeed) || plan.unmetNeed.length > 4 ||
        !Array.isArray(plan.assignments) || plan.assignments.length > 4) return null;
    const unmet = plan.unmetNeed.map((z) => {
      if (!valid(z?.zoneId, ID) || !safeNumber(z.needUnits) ||
          !safeNumber(z.servedUnits) || !safeNumber(z.unmetUnits) ||
          z.servedUnits + z.unmetUnits !== z.needUnits) return null;
      return { zoneId: z.zoneId, needUnits: z.needUnits,
        servedUnits: z.servedUnits, unmetUnits: z.unmetUnits };
    });
    const assignments = plan.assignments.map((a) => {
      if (!valid(a?.zoneId, ID) || !valid(a.vehicleId, ID) ||
          !valid(a.depotId, ID) || !valid(a.evidenceRef, SYNTHETIC) ||
          !safeNumber(a.units) || a.units === 0 ||
          !safeNumber(a.travelMinutes) || !safeNumber(a.deliveryMinute)) return null;
      return { vehicleId: a.vehicleId, depotId: a.depotId, zoneId: a.zoneId,
        units: a.units, travelMinutes: a.travelMinutes,
        deliveryMinute: a.deliveryMinute, evidenceRef: a.evidenceRef };
    });
    if (unmet.includes(null) || assignments.includes(null) ||
        assignments.reduce((n, a) => n + a.travelMinutes, 0) !==
          plan.totalOneWayTravelMinutes ||
        new Set(unmet.map((z) => z.zoneId)).size !== unmet.length ||
        new Set(assignments.map((a) => a.vehicleId)).size !== assignments.length ||
        assignments.reduce((n, a) => n + a.units, 0) !== plan.servedUnits ||
        unmet.reduce((n, z) => n + z.servedUnits, 0) !== plan.servedUnits) return null;
    return { servedUnits: plan.servedUnits,
      priorityWeightedServedUnits: plan.priorityWeightedServedUnits,
      totalOneWayTravelMinutes: plan.totalOneWayTravelMinutes,
      unmetNeed: unmet, assignments };
  };
  const exactPlan = mapPlan(exact);
  const controlPlan = mapPlan(control);
  if (!exactPlan || !controlPlan) return null;
  return { phase,
    accessRevision: source.accessRevision, routeRevision: source.routeRevision,
    status: source.status, unknownRoutes: source.unknownRoutes,
    knownOnlyExact: exactPlan, knownOnlyNearestFirst: controlPlan,
    upperBoundIfUnknownRoutesPassableUnits: bound,
    upperBoundIsGuaranteedAchievable: false,
    interpretation: phase === 'baseline' ? 'superseded-synthetic-snapshot' : 'synthetic-revision-only' };
}

function unavailable(reason) {
  return freeze({
    schemaVersion: RELIEF_FIELD_PACKET_VERSION, kind: 'gev-relief-replay-field-packet',
    determination: 'hypothetical', authority: 'none', status: 'unknown',
    reason, world: { status: 'not-attached', semanticFingerprint: null,
      revision: null, freshness: 'unknown', authority: 'none' },
    stages: [], delta: null,
    fieldLite: { layout: 'single-column', contentKind: 'training-only',
      title: 'Synthetic relief comparison', rows: [],
      notices: ['No validated synthetic comparison is available.',
        'No operational route or delivery decisions are authorized.'] },
  });
}

/**
 * Convert a validated replay receipt into a small versioned, offline-usable
 * Relief Packet projection. Does not import the still-unmerged World Packet.
 * An optional {semanticFingerprint, revision} is an identity pointer only.
 */
export function projectReliefOutageFieldPacket(replay, { worldPacketReference = null } = {}) {
  if (!replay || typeof replay !== 'object' || Array.isArray(replay) ||
      replay.kind !== OUTAGE_KIND || replay.determination !== 'hypothetical' ||
      replay.authority !== 'none' || replay.implementation !== 'not-authorized' ||
      replay.accessClaim !== 'not-evaluated') return unavailable('invalid-replay-contract');
  if (!STATUSES.has(replay.status)) return unavailable('replay-not-evaluated');
  const identities = replay.inputIdentities;
  const change = replay.injectedChange;
  if (replay.comparison !== 'same-synthetic-inputs-except-explicit-access-evidence' ||
      replay.baselineReceiptCurrent !== false || !identities || !change ||
      !valid(identities.studyId, ID) || !valid(identities.sourceRef, SYNTHETIC) ||
      ['worldRevision', 'stockRevision', 'fleetRevision', 'needRevision', 'policyRevision']
        .some((key) => !valid(identities[key], REF)) ||
      !valid(change.vehicleId, ID) || !valid(change.zoneId, ID) ||
      change.previousStatus !== 'supported' || change.currentStatus !== 'blocked' ||
      !valid(change.previousEvidenceRef, SYNTHETIC) ||
      !valid(change.currentEvidenceRef, SYNTHETIC) ||
      change.previousEvidenceRef === change.currentEvidenceRef) {
    return unavailable('invalid-replay-provenance');
  }
  const world = worldBinding(worldPacketReference, identities.worldRevision);
  if (!world) return unavailable('world-reference-mismatch');
  const before = stage(replay.historicalBaseline, 'baseline');
  const after = stage(replay.revisedScenario, 'revised');
  if (!before || !after || before.accessRevision === after.accessRevision ||
      before.routeRevision === after.routeRevision) return unavailable('invalid-stage-revision-or-metrics');
  // A closure must not leave the newly blocked pair in the revised
  // known-only solver output, regardless of prior receipt assertions.
  for (const plan of [after.knownOnlyExact, after.knownOnlyNearestFirst]) {
    if (plan.assignments.some((a) => a.vehicleId === change.vehicleId &&
        a.zoneId === change.zoneId)) return unavailable('blocked-edge-still-selected');
  }
  const delta = replay.syntheticDelta;
  if (!delta || !Number.isSafeInteger(delta.knownOnlyServedUnits) ||
      !Number.isSafeInteger(delta.knownOnlyPriorityWeightedServedUnits) ||
      !Number.isSafeInteger(delta.knownOnlyNearestFirstUnits) ||
      delta.knownOnlyServedUnits !== after.knownOnlyExact.servedUnits - before.knownOnlyExact.servedUnits ||
      delta.knownOnlyPriorityWeightedServedUnits !==
        after.knownOnlyExact.priorityWeightedServedUnits - before.knownOnlyExact.priorityWeightedServedUnits ||
      delta.knownOnlyNearestFirstUnits !==
        after.knownOnlyNearestFirst.servedUnits - before.knownOnlyNearestFirst.servedUnits) {
    return unavailable('inconsistent-replay-delta');
  }
  const status = before.status === 'limited' || after.status === 'limited' ? 'limited' : 'evaluated';
  if (replay.status !== status) return unavailable('inconsistent-uncertainty-status');
  const compactIdentity = {
    studyId: identities.studyId, sourceRef: identities.sourceRef,
    worldRevision: identities.worldRevision, stockRevision: identities.stockRevision,
    fleetRevision: identities.fleetRevision, needRevision: identities.needRevision,
    policyRevision: identities.policyRevision,
  };
  const rows = [before, after].map((s) => ({
    phase: s.phase, accessRevision: s.accessRevision,
    label: s.phase === 'baseline' ? 'Before (synthetic, superseded)' : 'After (synthetic)',
    exactKnownOnlyServedUnits: s.knownOnlyExact.servedUnits,
    nearestFirstKnownOnlyServedUnits: s.knownOnlyNearestFirst.servedUnits,
    unknownRoutes: s.unknownRoutes,
    evidenceRefs: [...new Set([
      ...s.knownOnlyExact.assignments.map((a) => a.evidenceRef),
      ...s.knownOnlyNearestFirst.assignments.map((a) => a.evidenceRef),
      s.phase === 'baseline' ? change.previousEvidenceRef : change.currentEvidenceRef,
    ])].sort(),
  }));
  return freeze({
    schemaVersion: RELIEF_FIELD_PACKET_VERSION, kind: 'gev-relief-replay-field-packet',
    determination: 'hypothetical', authority: 'none', status, reason: null,
    world, source: compactIdentity,
    injectedChange: { vehicleId: change.vehicleId, zoneId: change.zoneId,
      previousStatus: 'supported', revisedStatus: 'blocked',
      previousEvidenceRef: change.previousEvidenceRef,
      revisedEvidenceRef: change.currentEvidenceRef },
    historicalBaselineCurrent: false,
    stages: [before, after],
    delta: { knownOnlyServedUnits: delta.knownOnlyServedUnits,
      knownOnlyPriorityWeightedServedUnits: delta.knownOnlyPriorityWeightedServedUnits,
      knownOnlyNearestFirstUnits: delta.knownOnlyNearestFirstUnits },
    fieldLite: { layout: 'single-column', contentKind: 'training-only',
      title: 'Synthetic relief comparison', rows,
      notices: ['Synthetic simulation, not observed road status.',
        'Before-revision calculations are superseded within this replay.',
        'Unknown access is excluded from known-only assignments.',
        'No operational route or delivery decisions are authorized.'] },
  });
}

/** Minimal offline, non-interactive text view for 2D Field Lite consumers. */
export function formatReliefReplayFieldText(packet) {
  if (!packet || packet.kind !== 'gev-relief-replay-field-packet' ||
      packet.determination !== 'hypothetical' || packet.authority !== 'none') {
    return 'Synthetic relief comparison — unavailable: invalid packet';
  }
  if (packet.status !== 'unknown' && (
      !Array.isArray(packet.fieldLite?.rows) || !Array.isArray(packet.fieldLite?.notices) ||
      !packet.delta || !Number.isSafeInteger(packet.delta.knownOnlyServedUnits))) {
    return 'Synthetic relief comparison — unavailable: invalid projection';
  }
  if (packet.status === 'unknown') {
    return `Synthetic relief comparison — unavailable (${packet.reason ?? 'unknown'})\n` +
      'No operational route or delivery decisions are authorized.';
  }
  const lines = [packet.fieldLite.title + ' — TRAINING ONLY'];
  for (const row of packet.fieldLite.rows) {
    lines.push(`${row.label} [${row.accessRevision}]: exact ${row.exactKnownOnlyServedUnits} ` +
      `units, nearest-first ${row.nearestFirstKnownOnlyServedUnits} units, ` +
      `unknown routes ${row.unknownRoutes}`);
    lines.push('  Evidence: ' + (row.evidenceRefs.length ? row.evidenceRefs.join(', ') : 'none'));
  }
  lines.push(`Change in known-only exact service: ${packet.delta.knownOnlyServedUnits} synthetic units`);
  lines.push(...packet.fieldLite.notices);
  return lines.join('\n');
}
