/**
 * Small, exact reference enumerator for hypothetical 2×2 origin–destination demand.
 *
 * This is intentionally NOT the scalable polynomial-time sampler proposed in
 * OpenAI math family 115. It enumerates every feasible table for a tiny fixture
 * so future samplers can be independently checked. No inferred observation,
 * traffic forecast, real-world demand, route safety, or optimization verdict.
 */
export const FIXED_MARGIN_REFERENCE_VERSION = 'fixed-margins-2x2-v1';
export const MAX_REFERENCE_TABLES = 64;

function readMarginPair(values, name) {
  if (!Array.isArray(values) || values.length !== 2 ||
      !values.every((x) => Number.isSafeInteger(x) && x >= 0 && x <= 100000)) {
    throw new TypeError(`${name} must have two bounded nonnegative safe integers`);
  }
  return values;
}

function readRevision(revision) {
  if (typeof revision !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(revision)) {
    throw new TypeError('sourceRevision must be a bounded, explicit reference');
  }
  return revision;
}

function deepFreeze(obj) {
  if (obj && typeof obj === 'object') {
    for (const child of Object.values(obj)) deepFreeze(child);
    Object.freeze(obj);
  }
  return obj;
}

/**
 * Exhaustively enumerate a *tiny* 2×2 fixed-margin demand family.
 * Every output is synthetic; sourceRevision names the explicitly supplied
 * marginals' provenance, NOT an endorsement that they are observed or correct.
 *
 * rows = [originA, originB]; columns = [destinationA, destinationB].
 * All feasible tables have [t, r0-t; c0-t, r1-c0+t] where
 * max(0, r0-c1, c0-r1) <= t <= min(r0,c0).
 *
 * Fail closed when the enumeration would exceed the bounded reference size.
 */
export function enumerateFixedMarginDemand2x2(input = {}) {
  const [r0, r1] = readMarginPair(input.rowTotals, 'rowTotals');
  const [c0, c1] = readMarginPair(input.columnTotals, 'columnTotals');
  const revision = readRevision(input.sourceRevision);
  if (r0 + r1 !== c0 + c1) {
    return deepFreeze({
      status: 'infeasible',
      reason: 'unequal-total-demand',
      determination: 'hypothetical',
      modelVersion: FIXED_MARGIN_REFERENCE_VERSION,
      sourceRevision: revision,
      scenarios: [],
    });
  }
  const min = Math.max(0, r0 - c1, c0 - r1);
  const max = Math.min(r0, c0);
  const count = max - min + 1;
  if (count > MAX_REFERENCE_TABLES) {
    return deepFreeze({
      status: 'unsupported',
      reason: 'exhaustive-reference-limit',
      determination: 'hypothetical',
      modelVersion: FIXED_MARGIN_REFERENCE_VERSION,
      sourceRevision: revision,
      feasibleTableCount: count,
      scenarios: [],
    });
  }
  const scenarios = [];
  for (let t = min; t <= max; t++) {
    const table = [[t, r0 - t], [c0 - t, r1 - c0 + t]];
    const encodedTable = table.flat().join('-');
    scenarios.push({
      scenarioId: `od2x2-${t}`,
      determination: 'hypothetical',
      modelVersion: FIXED_MARGIN_REFERENCE_VERSION,
      sourceRevision: revision,
      // Content-derived for the tiny bounded reference only; no hash collisions.
      demandRevision: `synthetic:${revision}:${encodedTable}`,
      table,
    });
  }
  return deepFreeze({
    status: 'complete',
    determination: 'hypothetical',
    modelVersion: FIXED_MARGIN_REFERENCE_VERSION,
    sourceRevision: revision,
    rowTotals: [r0, r1],
    columnTotals: [c0, c1],
    feasibleTableCount: count,
    scenarios,
  });
}

