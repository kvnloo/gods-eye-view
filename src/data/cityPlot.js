// A play-mode plot is a deterministic local grid cell, not a surveyed parcel.
// Rows are fixed 40 m bands of latitude; each row's columns are 40 m wide at its
// centre latitude. Any point in a cell snaps to the identical frozen plot.
export const PLOT_METERS = 40;
/** Metres per degree of latitude: the plot grid's local metric. */
export const METERS_PER_DEGREE = 111_320;
const MAX_LATITUDE = 85;

function fail(message) {
  throw new TypeError(message);
}

function freeze(value) {
  Object.values(value).forEach((v) => {
    if (v && typeof v === 'object') freeze(v);
  });
  return Object.freeze(value);
}

function cell(row, col) {
  const south = (row * PLOT_METERS) / METERS_PER_DEGREE;
  const north = ((row + 1) * PLOT_METERS) / METERS_PER_DEGREE;
  const lat = (south + north) / 2;
  if (Math.abs(lat) > MAX_LATITUDE) return null;
  const width =
    PLOT_METERS / (METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180));
  const west = -180 + col * width;
  const east = west + width;
  // Cells touching the antimeridian would wrap; capture refuses them too.
  if (col < 0 || east > 180 - 1e-9) return null;
  return freeze({
    id: `plot-${row < 0 ? 's' : 'n'}${Math.abs(row)}-${col}`,
    row,
    col,
    sizeMeters: PLOT_METERS,
    areaSquareMeters: PLOT_METERS * PLOT_METERS,
    center: { lat, lon: (west + east) / 2 },
    corners: [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
    ],
  });
}

function rowOf(lat) {
  return Math.floor((lat * METERS_PER_DEGREE) / PLOT_METERS);
}

function colOf(row, lon) {
  const lat = ((row + 0.5) * PLOT_METERS) / METERS_PER_DEGREE;
  const width =
    PLOT_METERS / (METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180));
  return Math.floor((lon + 180) / width);
}

/** Snap a picked point to its grid cell, or null where no cell is valid. */
export function snapPlot(point) {
  const lat = point?.lat;
  const lon = point?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > MAX_LATITUDE || Math.abs(lon) > 180) return null;
  const row = rowOf(lat);
  return cell(row, colOf(row, lon));
}

/** Cells within `radius` rings around a plot, excluding the plot itself. */
export function neighborPlots(plot, radius = 1) {
  const out = [];
  for (let dr = -radius; dr <= radius; dr++) {
    const row = plot.row + dr;
    // Neighbouring rows have slightly different widths; snap by longitude.
    const col = colOf(row, plot.center.lon);
    for (let dc = -radius; dc <= radius; dc++) {
      if (!dr && !dc) continue;
      const next = cell(row, col + dc);
      if (next) out.push(next);
    }
  }
  return out;
}

/** A district is at most this many plots on a side (400 m). */
export const MAX_BLOCK_SIDE = 10;

/**
 * The block of cells between two plots, both included: rows south to north,
 * each row west to east. Rows are bricks, each shifted against the next, so
 * every row holds as many cells as the two plots are apart, starting at a
 * column that runs from the west plot's to the east plot's row by row. Null
 * when either is missing or the block is larger than MAX_BLOCK_SIDE on a side.
 */
export function plotBlock(from, to) {
  if (!from?.center || !to?.center) return null;
  const [west, east] =
    from.center.lon <= to.center.lon ? [from, to] : [to, from];
  const width = east.corners[1][0] - east.corners[0][0];
  const span = Math.round((east.center.lon - west.center.lon) / width);
  const south = Math.min(from.row, to.row);
  const north = Math.max(from.row, to.row);
  if (span >= MAX_BLOCK_SIDE || north - south >= MAX_BLOCK_SIDE) return null;
  // The centre of the block's west cell in the east plot's own row.
  const start = east.center.lon - span * width;
  const out = [];
  for (let row = south; row <= north; row++) {
    const k =
      east.row === west.row ? 0 : (row - west.row) / (east.row - west.row);
    const col = colOf(row, west.center.lon + (start - west.center.lon) * k);
    for (let i = 0; i <= span; i++) {
      const next = cell(row, col + i);
      if (!next) return null;
      out.push(next);
    }
  }
  return out;
}

/** Validate stored plot data: it must equal the cell its own centre snaps to. */
export function plotValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('plot object required');
  const expected = snapPlot(value.center);
  const names = Object.keys(value);
  if (!expected || names.length !== Object.keys(expected).length)
    fail('plot must have exact keys');
  if (JSON.stringify(value) !== JSON.stringify(expected))
    fail('plot must be an exact snapped grid cell');
  return expected;
}

/** A point at fractions (fx east, fy north) across the plot footprint. */
export function plotPoint(plot, fx, fy) {
  const [[west, south], , [east, north]] = plot.corners;
  return { lat: south + (north - south) * fy, lon: west + (east - west) * fx };
}

/** The plot an id from snapPlot names (`plot-n105199-126638`), or null. */
export function plotFromId(id) {
  const match = /^plot-([ns])(\d+)-(\d+)$/.exec(
    typeof id === 'string' ? id : '',
  );
  if (!match) return null;
  const plot = cell(
    (match[1] === 's' ? -1 : 1) * Number(match[2]),
    Number(match[3]),
  );
  return plot?.id === id ? plot : null;
}
