// Architecture massing v0 for a play-mode plot: an assumed (estimated) block,
// never a design, a permit or a city's zoning. Areas use the plot grid's local
// metric (111,320 m per degree of latitude; longitude scaled by the cosine of
// the polygon's mean latitude), so a grid plot is exactly its 40 m x 40 m cell.
const METERS_PER_DEGREE = 111_320;

/** What the block assumes until the user changes it; the stepper sets storeys. */
export const MASSING_ASSUMPTIONS = Object.freeze({
  storeys: 6,
  storeyHeightMeters: 3.2,
  setbackMeters: 4,
});
export const MAX_STOREYS = 60;

function fail(message) {
  throw new TypeError(message);
}

// Corners as metres east/north of their mean, and the way back to degrees.
function frameOf(corners) {
  if (
    !Array.isArray(corners) ||
    corners.length < 3 ||
    !corners.every(
      (c) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite),
    )
  )
    fail('polygon of at least 3 [lon, lat] corners required');
  const lon0 = corners.reduce((s, [lon]) => s + lon, 0) / corners.length;
  const lat0 = corners.reduce((s, [, lat]) => s + lat, 0) / corners.length;
  const kx = METERS_PER_DEGREE * Math.cos((lat0 * Math.PI) / 180);
  return {
    points: corners.map(([lon, lat]) => [
      (lon - lon0) * kx,
      (lat - lat0) * METERS_PER_DEGREE,
    ]),
    toLonLat: ([x, y]) => [lon0 + x / kx, lat0 + y / METERS_PER_DEGREE],
  };
}

function signedArea(points) {
  let sum = 0;
  points.forEach(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  });
  return sum / 2;
}

function intersect([[px, py], [rx, ry]], [[qx, qy], [sx, sy]]) {
  const cross = rx * sy - ry * sx;
  if (Math.abs(cross) < 1e-12) return null;
  const t = ((qx - px) * sy - (qy - py) * sx) / cross;
  return [px + t * rx, py + t * ry];
}

// A convex polygon with every edge moved `meters` inward, or null once it
// collapses (the moved edges cross and the turn direction flips).
function inset(points, meters) {
  const turn = Math.sign(signedArea(points));
  const lines = points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    const d = [q[0] - p[0], q[1] - p[1]];
    const k = (turn * meters) / Math.hypot(...d);
    return [[p[0] - d[1] * k, p[1] + d[0] * k], d];
  });
  const out = lines.map((line, i) => intersect(lines.at(i - 1), line));
  return out.every(Boolean) && Math.sign(signedArea(out)) === turn ? out : null;
}

/** Area in square metres of a [lon, lat] polygon. */
export function polygonAreaSquareMeters(corners) {
  return Math.abs(signedArea(frameOf(corners).points));
}

/**
 * The assumed block on a plot: its footprint is the plot inset by the setback,
 * every storey covers the footprint, and FAR = floor area / plot area. A
 * setback that leaves no footprint leaves no block: those values are null.
 */
export function plotMassing({
  corners,
  storeys = MASSING_ASSUMPTIONS.storeys,
  storeyHeightMeters = MASSING_ASSUMPTIONS.storeyHeightMeters,
  setbackMeters = MASSING_ASSUMPTIONS.setbackMeters,
}) {
  if (!Number.isInteger(storeys) || storeys < 1 || storeys > MAX_STOREYS)
    fail(`storeys must be a whole number from 1 to ${MAX_STOREYS}`);
  if (!Number.isFinite(storeyHeightMeters) || storeyHeightMeters <= 0)
    fail('storey height must be a positive number of metres');
  if (!Number.isFinite(setbackMeters) || setbackMeters < 0)
    fail('setback must be zero or more metres');
  const frame = frameOf(corners);
  const plotAreaSquareMeters = Math.abs(signedArea(frame.points));
  const inner = setbackMeters
    ? inset(frame.points, setbackMeters)
    : frame.points;
  const footprintAreaSquareMeters = inner && Math.abs(signedArea(inner));
  return Object.freeze({
    estimated: true,
    storeys,
    storeyHeightMeters,
    setbackMeters,
    plotAreaSquareMeters,
    footprint:
      inner &&
      Object.freeze(inner.map((p) => Object.freeze(frame.toLonLat(p)))),
    footprintAreaSquareMeters,
    floorAreaSquareMeters: inner && footprintAreaSquareMeters * storeys,
    far: inner && (footprintAreaSquareMeters * storeys) / plotAreaSquareMeters,
    heightMeters: inner && storeys * storeyHeightMeters,
  });
}

/** The stepper's next storey count, kept within 1 and MAX_STOREYS. */
export function stepStoreys(storeys, delta) {
  return Math.min(MAX_STOREYS, Math.max(1, storeys + delta));
}
