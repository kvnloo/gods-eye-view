/**
 * Pure comparison of two traffic *simulation* runs.
 *
 * GEV owns neither the simulator nor the signal controller. This adapter only
 * accepts external receipts and never promotes simulation to observed traffic.
 */

const CONTEXT_STRINGS = [
  'networkRevision',
  'demandRevision',
  'inputEvidenceRevision',
  'simulatorId',
  'simulatorVersion',
  'evaluationRevision',
];

const CONTEXT_NUMBERS = ['randomSeed', 'windowStartMs', 'windowEndMs'];

/** Units belong to metric names; no implicit cross-unit conversion is allowed. */
export const TRAFFIC_SCENARIO_METRICS = Object.freeze({
  meanPersonDelaySeconds: 'seconds/person',
  p95PersonDelaySeconds: 'seconds/person',
  maxQueueVehicles: 'vehicles',
  pedestrianWaitSeconds: 'seconds/person',
  transitDelaySeconds: 'seconds/person',
  emergencyTravelSeconds: 'seconds',
});

const validId = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 128 &&
  value.trim() === value;

function validateRun(run) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) return 'invalid-run';
  if (run.determination !== 'simulated') return 'not-simulated';
  if (
    !validId(run.runId) ||
    !validId(run.planRevision) ||
    !validId(run.sourceRef)
  )
    return 'missing-run-identity';
  const ctx = run.context;
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx))
    return 'missing-context';
  if (CONTEXT_STRINGS.some((key) => !validId(ctx[key])))
    return 'missing-context';
  if (
    CONTEXT_NUMBERS.some((key) => !Number.isSafeInteger(ctx[key])) ||
    ctx.randomSeed < 0 ||
    ctx.windowEndMs <= ctx.windowStartMs
  )
    return 'invalid-context';
  return null;
}

function compareMetric(baselineMetrics, candidateMetrics, key, unit) {
  const left = baselineMetrics?.[key];
  const right = candidateMetrics?.[key];
  const present = (value) => value !== undefined && value !== null;
  if (!present(left) || !present(right)) {
    return {
      unit,
      status: 'missing',
      baseline: null,
      candidate: null,
      delta: null,
      percentChange: null,
    };
  }
  if (
    typeof left !== 'number' ||
    typeof right !== 'number' ||
    !Number.isFinite(left) ||
    !Number.isFinite(right) ||
    left < 0 ||
    right < 0
  ) {
    return {
      unit,
      status: 'invalid',
      baseline: null,
      candidate: null,
      delta: null,
      percentChange: null,
    };
  }
  const delta = right - left;
  const rawPercent = left === 0 ? null : (delta / left) * 100;
  return {
    unit,
    status: 'compared',
    baseline: left,
    candidate: right,
    delta,
    percentChange: Number.isFinite(rawPercent) ? rawPercent : null,
  };
}

/**
 * Compare outputs from two distinct scenario runs against an identical world,
 * demand, evidence, simulator version, evaluation policy, seed, and time window.
 *
 * The returned signed deltas are neutral (candidate minus baseline), not a
 * safety judgment, an improvement claim, or authorization to modify signals.
 * Absent metrics stay missing; measured zeros are valid.
 *
 * @param {object} baseline - Immutable externally simulated run receipt.
 * @param {object} candidate - Immutable externally simulated run receipt.
 * @returns {object} Bounded, serializable comparison receipt.
 */
export function compareTrafficScenarioRuns(baseline, candidate) {
  const leftIssue = validateRun(baseline);
  const rightIssue = validateRun(candidate);
  if (leftIssue || rightIssue) {
    return {
      status: 'unknown',
      reason: leftIssue || rightIssue,
      metrics: {},
    };
  }
  if (baseline.runId === candidate.runId) {
    return { status: 'incomparable', reason: 'same-run', metrics: {} };
  }
  const differingFields = [...CONTEXT_STRINGS, ...CONTEXT_NUMBERS].filter(
    (key) => baseline.context[key] !== candidate.context[key],
  );
  if (differingFields.length) {
    return {
      status: 'incomparable',
      reason: 'context-mismatch',
      differingFields,
      metrics: {},
    };
  }
  const metrics = {};
  let compared = 0;
  for (const [key, unit] of Object.entries(TRAFFIC_SCENARIO_METRICS)) {
    const metric = compareMetric(baseline.metrics, candidate.metrics, key, unit);
    metrics[key] = metric;
    if (metric.status === 'compared') compared++;
  }
  return {
    status: compared > 0 ? 'comparable' : 'unknown',
    reason: compared > 0 ? null : 'no-comparable-metrics',
    determination: 'simulated',
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
    baselinePlanRevision: baseline.planRevision,
    candidatePlanRevision: candidate.planRevision,
    baselineSourceRef: baseline.sourceRef,
    candidateSourceRef: candidate.sourceRef,
    context: { ...baseline.context },
    metrics,
  };
}
