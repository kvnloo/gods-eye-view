// FORK-ONLY (exp/city-loop-v5, fix1 / q02): location-aware plot grids.
//
// The global play-mode grid (cityPlot.js) is a lattice of 40 m latitude bands:
// it is square to north, not to the streets, and knows nothing about water or
// buildings. Where a QA location has a fitted grid (cityGridSpecs.js, made by
// downstream/city-loop/inner/fit-grids.mjs from the location's OSM fixture and
// public-domain USGS 3DEP elevation) the plots are that grid's cells instead:
// turned to the local street bearing, and only the cells the fit found on
// land, clear of OSM buildings and roads, and flat enough to stand a block on
// are plots at all. A point inside a grid's claim but not on a valid cell has
// no plot (null), so a click on the bay or a roof never makes one.
//
// Pure: no Cesium, DOM or i18n.
import { CITY_GRIDS } from './cityGridSpecs.js';

const M = 111_320;
const ID = /^plot-([a-z]+)-(\d+)-(\d+)$/;

function freeze(value) {
  Object.values(value).forEach((v) => {
    if (v && typeof v === 'object') freeze(v);
  });
  return Object.freeze(value);
}

/**
 * One grid from its spec: `origin` [lon, lat] is the (row 0, col 0) corner,
 * `bearingDeg` the street bearing (clockwise from north) the columns run
 * across, `size` the cell side in metres, `cells` one string per row (row 0
 * first) of '1' (a plot) or '0', `claim` {lon, lat, meters} the disc whose
 * points this grid answers for.
 */
export function makeGrid(spec) {
  const [lon0, lat0] = spec.origin;
  const kx = M * Math.cos((lat0 * Math.PI) / 180);
  const t = (spec.bearingDeg * Math.PI) / 180;
  const [sin, cos] = [Math.sin(t), Math.cos(t)];
  // u runs across the street bearing (east-ish), v along it (north-ish).
  const toLonLat = (u, v) => [
    lon0 + (u * cos + v * sin) / kx,
    lat0 + (-u * sin + v * cos) / M,
  ];
  const toUV = (lon, lat) => {
    const e = (lon - lon0) * kx;
    const n = (lat - lat0) * M;
    return [e * cos - n * sin, e * sin + n * cos];
  };
  const valid = (row, col) => spec.cells[row]?.[col] === '1';
  const cache = new Map();
  function cell(row, col) {
    if (!Number.isInteger(row) || !Number.isInteger(col) || !valid(row, col))
      return null;
    const key = `${row}-${col}`;
    if (!cache.has(key)) {
      const s = spec.size;
      const [x, y] = [col * s, row * s];
      const [lon, lat] = toLonLat(x + s / 2, y + s / 2);
      cache.set(
        key,
        freeze({
          id: `plot-${spec.key}-${row}-${col}`,
          row,
          col,
          sizeMeters: s,
          areaSquareMeters: s * s,
          center: { lat, lon },
          corners: [
            toLonLat(x, y),
            toLonLat(x + s, y),
            toLonLat(x + s, y + s),
            toLonLat(x, y + s),
          ],
        }),
      );
    }
    return cache.get(key);
  }
  const claimK = M * Math.cos((spec.claim.lat * Math.PI) / 180);
  const claims = ({ lat, lon }) =>
    Math.hypot((lon - spec.claim.lon) * claimK, (lat - spec.claim.lat) * M) <=
    spec.claim.meters;
  function snap({ lat, lon }) {
    const [u, v] = toUV(lon, lat);
    return cell(Math.floor(v / spec.size), Math.floor(u / spec.size));
  }
  function plots() {
    const out = [];
    for (let row = 0; row < spec.rows; row++)
      for (let col = 0; col < spec.cols; col++) {
        const p = cell(row, col);
        if (p) out.push(p);
      }
    return out;
  }
  return Object.freeze({ spec, cell, snap, claims, plots, toLonLat, toUV });
}

const GRIDS = new Map(
  Object.entries(CITY_GRIDS).map(([key, spec]) => [key, makeGrid(spec)]),
);

/** The fitted grid for a location key, or null. */
export const cityGrid = (key) => GRIDS.get(key) ?? null;

/** The grid whose claim holds a point, or null (the global grid answers there). */
export function gridAt(point) {
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) return null;
  for (const grid of GRIDS.values()) if (grid.claims(point)) return grid;
  return null;
}

/** True for a plot of a fitted grid (its id names the grid). */
export function isGridPlot(plot) {
  const m = ID.exec(typeof plot?.id === 'string' ? plot.id : '');
  return Boolean(m && GRIDS.has(m[1]));
}

/** The grid plot an id names (`plot-sausalito-3-4`), or null. */
export function gridPlotFromId(id) {
  const m = ID.exec(typeof id === 'string' ? id : '');
  return (m && GRIDS.get(m[1])?.cell(Number(m[2]), Number(m[3]))) ?? null;
}

const gridOf = (plot) => GRIDS.get(ID.exec(plot?.id ?? '')?.[1]) ?? null;

/** Valid cells within `radius` rings of a grid plot, the plot itself excluded. */
export function gridNeighbors(plot, radius = 1) {
  const grid = gridOf(plot);
  if (!grid) return [];
  const out = [];
  for (let dr = -radius; dr <= radius; dr++)
    for (let dc = -radius; dc <= radius; dc++) {
      if (!dr && !dc) continue;
      const p = grid.cell(plot.row + dr, plot.col + dc);
      if (p) out.push(p);
    }
  return out;
}

/**
 * The valid cells of the rectangle between two plots of one grid (both
 * included), row by row; null across grids, past `maxSide` cells on a side,
 * or when the rectangle holds no plot.
 */
export function gridBlock(from, to, maxSide) {
  const grid = gridOf(from);
  if (!grid || grid !== gridOf(to)) return null;
  const [r0, r1] = [Math.min(from.row, to.row), Math.max(from.row, to.row)];
  const [c0, c1] = [Math.min(from.col, to.col), Math.max(from.col, to.col)];
  if (r1 - r0 >= maxSide || c1 - c0 >= maxSide) return null;
  const out = [];
  for (let row = r0; row <= r1; row++)
    for (let col = c0; col <= c1; col++) {
      const p = grid.cell(row, col);
      if (p) out.push(p);
    }
  return out.length ? out : null;
}

/** A point at fractions (fx across, fy along the street) of a grid plot. */
export function gridPoint(plot, fx, fy) {
  const grid = gridOf(plot);
  const s = grid.spec.size;
  const [lon, lat] = grid.toLonLat((plot.col + fx) * s, (plot.row + fy) * s);
  return { lat, lon };
}

/** A grid's plots as one far-zoom district (its lattice outline as corners). */
export function gridDistrict(grid) {
  const { rows, cols, size, key } = grid.spec;
  const plots = grid.plots();
  const [lon, lat] = grid.toLonLat((cols * size) / 2, (rows * size) / 2);
  return {
    id: `d-${key}`,
    plots,
    center: { lat, lon },
    corners: [
      grid.toLonLat(0, 0),
      grid.toLonLat(cols * size, 0),
      grid.toLonLat(cols * size, rows * size),
      grid.toLonLat(0, rows * size),
    ],
  };
}
