// Pure measurement rules for scripts/qa-city-massing.mjs, unit-tested in
// src/tooling/qaMassingMeasure.test.mjs. No browser here.
import { plotFromId } from '../src/data/cityPlot.js';

const METERS_PER_DEGREE = 111_320;
// A plot centre this far above the mean of the street around it is a structure.
const STRUCTURE_METERS = 2.5;

/**
 * A measurement that cannot tell a shadow from no shadow. The run is INVALID:
 * neither a pass nor a shadow failure.
 */
export class InvalidMeasurement extends Error {
  name = 'InvalidMeasurement';
}

/**
 * Shadow on and off captures must come from two rendered frames whose pixels
 * differ. The same frame, or byte-identical pixels, prove nothing.
 */
export function distinctFrames(a, b, label) {
  if (!(b.frame > a.frame))
    throw new InvalidMeasurement(
      `${label}: no new frame was rendered between the captures (frame ${a.frame} then ${b.frame})`,
    );
  if (a.png.equals(b.png))
    throw new InvalidMeasurement(
      `${label}: the two captures are byte-identical (frames ${a.frame} and ${b.frame})`,
    );
}

/** The camera for QA_PLOT: south of the plot centre, looking north at 45°. */
export function siteForPlot(id, alt = 600) {
  const plot = plotFromId(id);
  if (!plot) throw new TypeError(`QA_PLOT must be a plot id: ${id}`);
  return {
    lat: plot.center.lat - alt / METERS_PER_DEGREE,
    lon: plot.center.lon,
    alt,
    heading: 0,
    pitch: -45,
  };
}

/**
 * The ground a block must stand on, from samples taken before MASSING cuts the
 * plot: the plot centre, unless a structure stands there (more than 2.5 m above
 * the mean of the street sampled outside the plot), then the lowest street.
 */
export function groundReference(centre, street) {
  const around = street.filter(Number.isFinite);
  const mean = around.reduce((sum, h) => sum + h, 0) / around.length;
  if (
    Number.isFinite(centre) &&
    !(around.length && centre - mean > STRUCTURE_METERS)
  )
    return { ground: centre, from: 'centre' };
  return around.length ? { ground: Math.min(...around), from: 'street' } : null;
}
