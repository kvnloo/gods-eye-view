// Plan score for City builder play mode: how far the accepted moves on a plot
// or street move a few community goals from an assumed baseline. The weights
// and baselines are ASSUMED (entered once, not measured) and the score is a
// projection of the plan, never a measurement or a forecast. It is the only
// source of the goal numbers the resource bar shows. The same table and cases
// are in __fixtures__/score-golden.json.

const goal = (w, base, scale, unit) => Object.freeze({ w, base, scale, unit });

/**
 * One goal table. A positive weight rewards a rise, a negative weight a fall;
 * a zero weight is shown as a trade-off and never scored.
 */
export const CITY_GOALS = Object.freeze({
  status: 'assumed',
  required: Object.freeze(['homes']),
  weights: Object.freeze({
    homes: goal(1, 12, 12, ''),
    public_space: goal(1, 0, 50, 'm²'),
    bike_m: goal(1, 0, 3, 'm'),
    walk_m: goal(0.5, 6, 4, 'm'),
    canopy_pct: goal(1, 18, 10, '%'),
    park_shade: goal(-1, 0, 1, ''),
    parking: goal(0, null, 1, ''),
    through_lanes: goal(0, null, 1, ''),
    headway_min: goal(-1, 15, 5, 'min'),
    transit_cap: goal(1, 240, 120, '/h'),
    parking_removed: goal(0, null, 1, ''),
  }),
});

const isPair = (pair) =>
  Array.isArray(pair) &&
  pair.length === 2 &&
  (pair[0] === null || Number.isFinite(pair[0])) &&
  Number.isFinite(pair[1]);

/**
 * Apply moves in order. Each move maps a metric to [before, after]; a metric's
 * base is the goal's assumed base, else the first before seen, and its value
 * is the latest after.
 * @param {Array<Record<string, [number|null, number]>>} moves
 * @param {typeof CITY_GOALS} [goals]
 * @returns {Record<string, {base: number|null, value: number, status: string}>}
 */
export function replayMoves(moves, goals = CITY_GOALS) {
  if (!Array.isArray(moves)) throw new TypeError('moves must be an array');
  const state = {};
  for (const move of moves) {
    for (const [metric, pair] of Object.entries(move ?? {})) {
      if (!isPair(pair))
        throw new TypeError(`${metric}: move must be [before, after]`);
      const [before, after] = pair;
      if (metric in state) {
        state[metric].value = after;
        continue;
      }
      const assumed = goals.weights[metric]?.base;
      state[metric] =
        assumed !== null && assumed !== undefined
          ? { base: assumed, value: after, status: 'ASSUMED-BASE' }
          : {
              base: before,
              value: after,
              status: before === null ? 'SPEC' : 'SPEC-BASE',
            };
    }
  }
  return state;
}

/**
 * Weighted mean of clamp((value - base) / scale, -1, 1) over the scored goals
 * present. Any required goal without a value means no score.
 * @returns {{value: number|null, tag: 'PROJECTED', missing: string[]}}
 */
export function planScore(state, goals = CITY_GOALS) {
  const missing = goals.required.filter(
    (k) => !Number.isFinite(state[k]?.value),
  );
  if (missing.length) return { value: null, tag: 'PROJECTED', missing };
  let sum = 0;
  let total = 0;
  for (const [k, g] of Object.entries(goals.weights)) {
    if (!g.w || !Number.isFinite(state[k]?.value)) continue;
    const change = (state[k].value - (g.base ?? 0)) / (g.scale || 1);
    sum += g.w * Math.max(-1, Math.min(1, change));
    total += Math.abs(g.w);
  }
  return { value: total ? sum / total : null, tag: 'PROJECTED', missing };
}

/**
 * The resource bar's figures: changed metrics, heaviest weight first, then by
 * name. Read-only; park shade is a constraint, not a resource.
 * @returns {Array<{metric: string, base: number|null, value: number, unit: string, status: string}>}
 */
export function resourceChips(state, goals = CITY_GOALS, limit = 4) {
  const weight = (k) => Math.abs(goals.weights[k]?.w ?? 0);
  return Object.keys(state)
    .filter((k) => k !== 'park_shade' && state[k].base !== state[k].value)
    .sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, limit)
    .map((metric) => ({
      metric,
      base: state[metric].base,
      value: state[metric].value,
      unit: goals.weights[metric]?.unit ?? '',
      status: state[metric].status,
    }));
}
