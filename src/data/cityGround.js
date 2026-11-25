// FORK-ONLY (exp/city-loop-v5, fix1 / q02): where a block stands, as a pure
// function of its plot and a terrain sampler. The globe adapter
// (src/standalone/cityMassing.js) passes the live sampler (Cesium World
// Terrain / the diorama surface / photoreal tiles); the inner-loop harness
// (downstream/city-loop/inner) passes public-domain USGS 3DEP heights. Same
// code path, injected terrain. No Cesium, DOM or i18n.
import {
  edgeProbes,
  groundBase,
  localFrame,
  plotMassing,
} from './cityMassing.js';
import { districtGround } from './cityGameHud.js';
import { isGridPlot } from './cityGrid.js';

/** The street is sampled this far outside each edge of a global-grid plot. */
export const PROBE_METERS = 6;

/**
 * The ground for one plot, `{base, floor}` or null when nothing was sampled.
 * `sample([lon, lat])` returns metres or a non-finite value.
 *
 * A fitted-grid plot is known to be clear land (no roof, no road), so the
 * block is stood on the ground under its own footprint: the corners and the
 * centre, base at the middle of their range (within half the relief of every
 * one), floor at the lowest point anywhere on the plot so its plate reaches
 * the ground on a slope. A global-grid plot keeps the street-probe rule
 * (groundBase): its centre may be a roof.
 */
export function plotGround(plot, sample) {
  if (isGridPlot(plot)) {
    const { footprint } = plotMassing({ corners: plot.corners });
    const ring = footprint ?? plot.corners;
    const centre = [
      ring.reduce((s, p) => s + p[0], 0) / ring.length,
      ring.reduce((s, p) => s + p[1], 0) / ring.length,
    ];
    const under = [...ring, centre].map(sample).filter(Number.isFinite);
    if (!under.length) return null;
    const plate = plot.corners.map(sample).filter(Number.isFinite);
    const [low, high] = [Math.min(...under), Math.max(...under)];
    return { base: (low + high) / 2, floor: Math.min(low, ...plate) };
  }
  return groundBase(
    sample([plot.center.lon, plot.center.lat]),
    edgeProbes(plot.corners, PROBE_METERS).map(sample),
  );
}

/**
 * The grounds of a growth district's plots, sampled before anything is cut:
 * `{grounds, fitted}`. With `fit` (?cityHud=ground) a district of global-grid
 * plots stands on one plane fitted to the lowest ground at each plot
 * (districtGround), so a slope steps like terraces; `fitted` is that plane or
 * null. Fitted-grid plots each stand on their own footprint's ground
 * (plotGround): a plane through a shore park put blocks metres under or over
 * the lawn (loop-v5 r01/r02 growth: sunk 1-5 m).
 */
export function districtGrounds(plots, sample, { fit = false } = {}) {
  if (!fit || plots.length < 3 || plots.some(isGridPlot))
    return {
      grounds: plots.map((plot) => plotGround(plot, sample)),
      fitted: null,
    };
  const frame = localFrame(plots.map((p) => [p.center.lon, p.center.lat]));
  const lows = plots.map((plot) => {
    const heights = [
      sample([plot.center.lon, plot.center.lat]),
      ...edgeProbes(plot.corners, PROBE_METERS).map(sample),
    ].filter(Number.isFinite);
    const [x, y] = frame.toMeters([plot.center.lon, plot.center.lat]);
    return { x, y, h: heights.length ? Math.min(...heights) : NaN };
  });
  const fitted = districtGround(lows);
  return {
    grounds: lows.map(({ x, y }) =>
      fitted ? { base: fitted.at(x, y), floor: fitted.floor - 1 } : null,
    ),
    fitted,
  };
}
