// The growth decision for a district of play-mode plots: a cohort of them
// rises stage by stage (now, in 5 years, in 15) while a plot fitted to the sun
// (src/data/cityShadowFit.js) keeps its storeys. Pure: every home and square
// metre is the massing estimator's own (src/data/cityMassing.js), summed over
// the district. An estimate of assumed blocks, never a forecast or a permit.
import { plotMassing, stepStoreys } from './cityMassing.js';

/** The timeline's stops, in years from now. */
export const GROWTH_STAGES = Object.freeze([
  Object.freeze({ id: 'now', years: 0 }),
  Object.freeze({ id: '5yr', years: 5 }),
  Object.freeze({ id: '15yr', years: 15 }),
]);

/**
 * What the plan assumes until the player changes it, from the City builder
 * design loop's growth round (r081): every plot stands at three storeys, 12 of
 * 25 plots (the ones farthest from the frontage) rise to four and then five,
 * and six homes bring one delivery a day.
 */
export const GROWTH_ASSUMPTIONS = Object.freeze({
  storeys: Object.freeze([3, 4, 5]),
  baseStoreys: 3,
  cohortShare: 12 / 25,
  homesPerDelivery: 6,
});

/**
 * The plots that grow: the share of the district farthest from its anchor, the
 * plot the player picked first. Ids in the district's own order.
 */
export function growthCohort(plots, anchorId) {
  const anchor = plots.find((plot) => plot.id === anchorId) ?? plots[0];
  const k = Math.cos((anchor.center.lat * Math.PI) / 180);
  // Whole grid steps apart, so plots at one distance stay together.
  const far = (plot) =>
    Math.round(
      ((plot.center.lat - anchor.center.lat) * 111_320) ** 2 +
        ((plot.center.lon - anchor.center.lon) * 111_320 * k) ** 2,
    );
  const count = Math.ceil(plots.length * GROWTH_ASSUMPTIONS.cohortShare);
  const chosen = new Set(
    plots
      .map((plot, index) => ({ id: plot.id, far: far(plot), index }))
      .sort((a, b) => b.far - a.far || a.index - b.index)
      .slice(0, count)
      .map((entry) => entry.id),
  );
  return plots.filter((plot) => chosen.has(plot.id)).map((plot) => plot.id);
}

/** The player's edit: one stage's storeys moved by whole storeys, as a new list. */
export function editStage(storeys, index, delta) {
  return storeys.map((count, i) =>
    i === index ? stepStoreys(count, delta) : count,
  );
}

/**
 * The district at each stage. `plots` are grid cells (src/data/cityPlot.js),
 * `storeys` the cohort's count per stage and `locks` the fitted storeys of
 * sun-locked plots by id: a locked plot stands at its fit at every stage, in
 * the cohort or not. Each stage sums the estimator over its blocks; `lowered`
 * flags a stage edited below an earlier one, `works` counts the plots whose
 * storeys differ from now, and `deliveriesPerDay` is null (never zero) while
 * the homes-per-delivery rate is unknown.
 */
export function growthPlan({
  plots,
  anchorId,
  cohort = growthCohort(plots, anchorId),
  storeys = GROWTH_ASSUMPTIONS.storeys,
  baseStoreys = GROWTH_ASSUMPTIONS.baseStoreys,
  locks = {},
  homesPerDelivery = GROWTH_ASSUMPTIONS.homesPerDelivery,
}) {
  const growing = new Set(cohort);
  const locked = plots
    .filter((plot) => Object.hasOwn(locks, plot.id))
    .map((plot) => plot.id);
  const sum = (blocks, key) =>
    blocks.reduce((total, block) => total + block[key], 0);
  const stages = GROWTH_STAGES.map((stage, i) => {
    const blocks = plots.map((plot) => {
      const isLocked = Object.hasOwn(locks, plot.id);
      const massing = plotMassing({
        corners: plot.corners,
        storeys: isLocked
          ? locks[plot.id]
          : growing.has(plot.id)
            ? storeys[i]
            : baseStoreys,
      });
      return Object.freeze({
        plotId: plot.id,
        storeys: massing.storeys,
        cohort: growing.has(plot.id),
        locked: isLocked,
        heightMeters: massing.heightMeters,
        homes: massing.homes ?? 0,
        floorAreaSquareMeters: massing.floorAreaSquareMeters ?? 0,
        residentialSquareMeters:
          (massing.floorAreaSquareMeters ?? 0) * massing.residentialShare,
      });
    });
    const homes = sum(blocks, 'homes');
    return {
      ...stage,
      storeys: storeys[i],
      lowered: storeys.slice(0, i).some((earlier) => earlier > storeys[i]),
      blocks: Object.freeze(blocks),
      homes,
      floorAreaSquareMeters: sum(blocks, 'floorAreaSquareMeters'),
      residentialSquareMeters: sum(blocks, 'residentialSquareMeters'),
      deliveriesPerDay:
        homesPerDelivery > 0 ? Math.ceil(homes / homesPerDelivery) : null,
    };
  });
  return Object.freeze({
    estimated: true,
    plots: plots.length,
    areaSquareMeters: sum(plots, 'areaSquareMeters'),
    cohort: Object.freeze([...cohort]),
    locked: Object.freeze(locked),
    baseStoreys,
    homesPerDelivery: homesPerDelivery > 0 ? homesPerDelivery : null,
    stages: Object.freeze(
      stages.map((stage) =>
        Object.freeze({
          ...stage,
          works: stage.blocks.filter(
            (block, b) => block.storeys !== stages[0].blocks[b].storeys,
          ).length,
        }),
      ),
    ),
  });
}
