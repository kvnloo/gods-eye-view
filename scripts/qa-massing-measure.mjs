// Pure measurement rules for scripts/qa-city-massing.mjs, unit-tested in
// src/tooling/qaMassingMeasure.test.mjs. No browser here.
import { METERS_PER_DEGREE, plotFromId } from '../src/data/cityPlot.js';

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
 * Shadow on and off captures must come from two rendered frames, drawn with the
 * shadow map on and then off, whose pixels differ. The same frame, the wrong
 * shadow state or byte-identical pixels prove nothing.
 */
export function distinctFrames(a, b, label) {
  if (a.shadows === false || b.shadows === true)
    throw new InvalidMeasurement(
      `${label}: the frames were drawn with the shadow map ${a.shadows ? 'on' : 'off'} then ${b.shadows ? 'on' : 'off'}`,
    );
  if (!(b.frame > a.frame))
    throw new InvalidMeasurement(
      `${label}: no new frame was rendered between the captures (frame ${a.frame} then ${b.frame})`,
    );
  if (a.png.equals(b.png))
    throw new InvalidMeasurement(
      `${label}: the two captures are byte-identical (frames ${a.frame} and ${b.frame})`,
    );
}

/**
 * The camera for QA_PLOT: south of the plot centre, looking north at 45°. With
 * a `heading` (degrees clockwise from north) it looks that way from behind.
 */
export function siteForPlot(id, alt = 600, heading = 0) {
  const plot = plotFromId(id);
  if (!plot) throw new TypeError(`QA_PLOT must be a plot id: ${id}`);
  const turn = (heading * Math.PI) / 180;
  const east = METERS_PER_DEGREE * Math.cos((plot.center.lat * Math.PI) / 180);
  return {
    lat: plot.center.lat - (Math.cos(turn) * alt) / METERS_PER_DEGREE,
    lon: plot.center.lon - (Math.sin(turn) * alt) / east,
    alt,
    heading,
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

const DEMO_MARKS = [
  'ready',
  'select',
  'selected',
  'zone',
  'massing',
  'massingDrawn',
  'step',
  'stepDrawn',
];

/**
 * The 30 s demo cut from the journey page's own video (seconds on its clock):
 * the plot selected, MASSING on with its shadow, then +2 storeys with the
 * longer shadow. It starts after the app is ready (no loading splash), leaves
 * out every window where a capture turned the shadow map off, and holds each
 * view (1 : 2 : 2) to fill `total` seconds.
 */
export function demoCut(marks, total = 30) {
  for (const key of DEMO_MARKS)
    if (!Number.isFinite(marks[key]))
      throw new TypeError(`demo mark missing: ${key}`);
  const pad = 0.25;
  const off = [...(marks.flicker ?? [])].sort((a, b) => a[0] - b[0]);
  // Keep the part before the first shadow-off window; a segment that starts
  // inside one starts after it.
  const clear = (name, from, to) => {
    for (const [a, b] of off) {
      if (b + pad <= from || a - pad >= to) continue;
      if (a - pad <= from) from = b + pad;
      else to = a - pad;
    }
    return { name, from, to, hold: 0 };
  };
  const cut = [
    // Up to the plot framed, before the zone menu opens.
    clear(
      'select',
      Math.max(marks.ready, marks.select - 0.5),
      Math.min(marks.selected + 0.5, marks.zone - 0.1),
    ),
    clear('massing', marks.massing - 0.5, marks.massingDrawn + 2.5),
    clear('step', marks.step - 0.5, marks.stepDrawn + 2.5),
  ];
  const rest = total - cut.reduce((s, c) => s + c.to - c.from, 0);
  if (rest < 5) throw new RangeError(`the demo segments leave ${rest} s`);
  [0.2, 0.4, 0.4].forEach((share, i) => (cut[i].hold = rest * share));
  return cut;
}
