/**
 * Pure counterfactual replay over the tiny synthetic capacity reference (#152).
 * No historical event, verified road status, safe route, or dispatch action.
 * A baseline access receipt becomes non-current after injecting new evidence.
 */
import { compareSyntheticReliefCapacity } from './reliefCapacityBenchmark.js';

export const RELIEF_OUTAGE_REPLAY_VERSION = 'synthetic-outage-replay-v1';

const ID = /^[a-z][a-z0-9-]{0,63}$/;

function id(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) {
    throw new TypeError(`${label} must be a bounded synthetic identifier`);
  }
  return value;
}

function source(value, label) {
  if (typeof value !== 'string' || !/^synthetic:[a-zA-Z0-9_.:-]{1,100}$/.test(value)) {
    throw new TypeError(`${label} must be a versioned synthetic evidence reference`);
  }
  return value;
}

function revision(value, label, previous) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160 ||
      value.trim() !== value || value === previous) {
    throw new TypeError(`${label} must be a distinct nonempty revision`);
  }
  return value;
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function response(status, reason, fields = {}) {
  return freeze({
    kind: RELIEF_OUTAGE_REPLAY_VERSION,
    determination: 'hypothetical',
    authority: 'none',
    implementation: 'not-authorized',
    accessClaim: 'not-evaluated',
    status,
    reason,
    ...fields,
  });
}

function eligible(run) {
  return run?.status === 'evaluated' || run?.status === 'limited';
}

function snapshot(run) {
  // Numeric outputs and bound are a sensitivity analysis, not a probability
  // that real access is open or that a person can be reached.
  return {
    accessRevision: run.context.accessRevision,
    routeRevision: run.context.routeRevision,
    status: run.status,
    unknownRoutes: run.unknownRoutes,
    knownOnlyExhaustive: run.exhaustive,
    knownOnlyNearestFirst: run.nearestFirst,
    upperBoundIfUnknownPassableUnits: run.theoreticalUpperBoundIfUnknownPassableUnits,
  };
}

/**
 * Produce two non-authoritative solver receipts for identical synthetic supply,
 * demand, fleet, and objective, changing only one explicitly evidenced access
 * pair. The before-receipt is historical after a new evidence revision arrives.
 */
export function replaySyntheticReliefOutage({ baseline, change } = {}) {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline) ||
      !change || typeof change !== 'object' || Array.isArray(change)) {
    throw new TypeError('baseline and explicit change objects required');
  }
  const vehicleId = id(change.vehicleId, 'vehicle id');
  const zoneId = id(change.zoneId, 'zone id');
  const accessRevision = revision(change.accessRevision, 'accessRevision', baseline.accessRevision);
  const routeRevision = revision(change.routeRevision, 'routeRevision', baseline.routeRevision);
  const evidenceRef = source(change.evidenceRef, 'evidenceRef');

  // Verify the complete starting fixture first. An incomplete matrix does not
  // acquire a solution merely because one entry is replaced.
  const before = compareSyntheticReliefCapacity(baseline);
  if (!eligible(before)) {
    return response('unknown', 'invalid-or-incomplete-baseline', {
      baselineStatus: before.status,
      baselineReason: before.reason ?? null,
    });
  }
  const matches = baseline.routes.filter(
    (route) => route.vehicleId === vehicleId && route.zoneId === zoneId,
  );
  if (matches.length !== 1) {
    return response('unknown', 'outage-route-not-mapped', {
      context: { accessRevision: baseline.accessRevision, routeRevision: baseline.routeRevision },
    });
  }
  const original = matches[0];
  if (original.status !== 'supported') {
    return response('unknown', 'outage-route-not-supported', {
      previousStatus: original.status,
      context: { accessRevision: baseline.accessRevision, routeRevision: baseline.routeRevision },
    });
  }
  if (original.evidenceRef === evidenceRef) {
    throw new TypeError('a new access status requires new evidenceRef');
  }
  const routes = baseline.routes.map((route) =>
    route.vehicleId === vehicleId && route.zoneId === zoneId
      ? { ...route, status: 'blocked', travelMinutes: null, evidenceRef }
      : { ...route },
  );
  const changedInput = {
    ...baseline,
    accessRevision,
    routeRevision,
    routes,
  };
  const after = compareSyntheticReliefCapacity(changedInput);
  if (!eligible(after)) {
    return response('unknown', 'invalid-replay-result', {
      afterStatus: after.status,
      afterReason: after.reason ?? null,
    });
  }
  const baselineSummary = snapshot(before);
  const currentSummary = snapshot(after);
  return response(
    before.status === 'limited' || after.status === 'limited' ? 'limited' : 'evaluated',
    null,
    {
      comparison: 'same-synthetic-inputs-except-explicit-access-evidence',
      inputIdentities: {
        studyId: before.context.studyId,
        sourceRef: before.context.sourceRef,
        worldRevision: before.context.worldRevision,
        stockRevision: before.context.stockRevision,
        fleetRevision: before.context.fleetRevision,
        needRevision: before.context.needRevision,
        policyRevision: before.context.policyRevision,
      },
      injectedChange: {
        vehicleId,
        zoneId,
        previousStatus: original.status,
        currentStatus: 'blocked',
        previousEvidenceRef: original.evidenceRef,
        currentEvidenceRef: evidenceRef,
      },
      baselineReceiptCurrent: false,
      historicalBaseline: baselineSummary,
      revisedScenario: currentSummary,
      syntheticDelta: {
        knownOnlyServedUnits:
          after.exhaustive.servedUnits - before.exhaustive.servedUnits,
        knownOnlyPriorityWeightedServedUnits:
          after.exhaustive.priorityWeightedServedUnits - before.exhaustive.priorityWeightedServedUnits,
        knownOnlyNearestFirstUnits:
          after.nearestFirst.servedUnits - before.nearestFirst.servedUnits,
      },
    },
  );
}
