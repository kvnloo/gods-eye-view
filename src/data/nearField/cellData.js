/**
 * @module data/nearField/cellData
 * @description FORK-ONLY (exp/near-field-v0). OpenStreetMap data for one
 * near-field cell, read from an OpenFreeMap vector tile (OpenMapTiles schema,
 * z14, keyless; the provider the app's outline/traffic/planner layers already
 * use). Output is a "cell fixture" in local east/north metres around the
 * cell centre, in the shape `cityDioramaMesh.js` already understands
 * (buildings, roads, areas, a run-length water raster).
 *
 * Data: (c) OpenStreetMap contributors, ODbL 1.0, via OpenMapTiles /
 * OpenFreeMap. The fixture lives in memory only (worker LRU); nothing is
 * written to disk. Nothing here reads Google content.
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { tileBounds, tileCentre, toLocal, tileSizeM } from './tiling.js';

export const WATER_CELL_M = 4;
/** OpenMapTiles water classes we treat as open water (pools sit on roofs and in yards). */
const WATER_CLASSES = new Set(['ocean', 'lake', 'river', 'pond', 'dock', 'basin', 'reservoir', 'canal']);
const TREE_COVER = new Set(['wood', 'forest']);
const GRASS_COVER = new Set(['grass', 'park', 'meadow', 'scrub', 'garden']);
const STREETS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'pedestrian', 'path', 'track', 'busway', 'raceway']);
const SUBCLASS_ROAD = { minor: 'residential', path: 'footway' };

/** Signed area in tile pixels (y down): > 0 = MVT exterior ring. */
function signedArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
  return s / 2;
}

/**
 * Decode one z14 tile into plain arrays in tile pixel coordinates (extent
 * 4096 by default). Polygons are [outer, ...holes] lists. Kept compact: the
 * worker caches this per data tile and cuts its 16 cells from it.
 */
export function decodeDataTile(buffer, tile) {
  const vt = new VectorTile(new PbfReader(buffer));
  const out = { tile, extent: 4096, buildings: [], water: [], piers: [], pierLines: [], cover: [], roads: [] };
  const polys = (f) => {
    const rings = f.loadGeometry();
    const list = [];
    for (const r of rings) {
      if (r.length < 4) continue;
      const pts = r.map((p) => [p.x, p.y]);
      if (signedArea(r) < 0 && list.length) list[list.length - 1].push(pts);
      else list.push([pts]);
    }
    return list;
  };
  const each = (name, fn) => {
    const layer = vt.layers[name];
    if (!layer) return;
    out.extent = layer.extent || out.extent;
    for (let i = 0; i < layer.length; i++) fn(layer.feature(i));
  };
  each('building', (f) => {
    const p = f.properties;
    const h = Number(p.render_height);
    const min = Number(p.render_min_height) || 0;
    for (const rings of polys(f))
      out.buildings.push({ rings, h: Number.isFinite(h) && h > 0 ? h : null, min: Math.max(0, min), hide: !!p.hide_3d });
  });
  each('water', (f) => {
    if (f.type !== 3 || !WATER_CLASSES.has(f.properties.class)) return;
    for (const rings of polys(f)) out.water.push({ rings, k: f.properties.class });
  });
  each('landcover', (f) => {
    const c = f.properties.class;
    const k = TREE_COVER.has(c) ? 'wood' : GRASS_COVER.has(c) ? 'grass' : null;
    if (!k || f.type !== 3) return;
    for (const rings of polys(f)) out.cover.push({ rings, k });
  });
  each('park', (f) => {
    if (f.type !== 3) return;
    for (const rings of polys(f)) out.cover.push({ rings, k: 'park' });
  });
  each('landuse', (f) => {
    if (f.type !== 3 || f.properties.class !== 'residential') return;
    for (const rings of polys(f)) out.cover.push({ rings, k: 'residential' });
  });
  each('transportation', (f) => {
    const c = f.properties.class;
    if (c === 'pier') {
      if (f.type === 3) for (const rings of polys(f)) out.piers.push({ rings });
      else if (f.type === 2) for (const line of f.loadGeometry()) out.pierLines.push(line.map((p) => [p.x, p.y]));
      return;
    }
    if (f.type !== 2 || !STREETS.has(c)) return;
    if (f.properties.brunnel === 'tunnel') return;
    const t = SUBCLASS_ROAD[c] ?? c;
    for (const line of f.loadGeometry()) if (line.length >= 2) out.roads.push({ t, p: line.map((q) => [q.x, q.y]) });
  });
  return out;
}

/** Tile-pixel -> local metres around the cell centre (mercator inverse per point). */
function projector(data, origin) {
  const { tile, extent } = data;
  const n = 2 ** tile.z;
  return ([px, py]) => {
    const lon = ((tile.x + px / extent) / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + py / extent)) / n))) * 180) / Math.PI;
    return toLocal(lat, lon, origin);
  };
}

const bboxOf = (ring) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
};
const overlaps = (b, half, pad = 0) => b[2] >= -half - pad && b[0] <= half + pad && b[3] >= -half - pad && b[1] <= half + pad;

export function ringArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return s / 2;
}

export function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Drop the closing duplicate point and make the ring counter-clockwise (east/north, y up). */
function tidy(ring, ccw = true) {
  const r = ring.slice();
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  if ((ringArea(r) > 0) !== ccw) r.reverse();
  return r;
}

/**
 * Even-odd scanline fill of polygons (lists of rings, local metres) into an
 * n x n grid of `cell` metres centred on the origin; row 0 = north (the
 * cityDioramaMesh water raster convention). Writes `id` into `ids`.
 */
export function rasterize(ids, n, cell, half, polygons, id = 1) {
  for (const rings of polygons) {
    const edges = [];
    for (const ring of rings)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x0, y0] = ring[j];
        const [x1, y1] = ring[i];
        if (y0 !== y1) edges.push([x0, y0, x1, y1]);
      }
    if (!edges.length) continue;
    for (let row = 0; row < n; row++) {
      const y = half - (row + 0.5) * cell;
      const xs = [];
      for (const [x0, y0, x1, y1] of edges)
        if ((y0 > y) !== (y1 > y)) xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] + half) / cell - 0.5));
        const i1 = Math.min(n - 1, Math.floor((xs[k + 1] + half) / cell - 0.5));
        for (let i = i0; i <= i1; i++) ids[row * n + i] = id;
      }
    }
  }
}

/** Run-length rows of a raster (the fixture @2 `water.rle` format). */
export function toRle(ids, n) {
  const rle = [];
  for (let j = 0; j < n; j++) {
    const row = [];
    let cur = ids[j * n], run = 0;
    for (let i = 0; i < n; i++) {
      const v = ids[j * n + i];
      if (v === cur) run++;
      else {
        row.push([cur, run]);
        cur = v;
        run = 1;
      }
    }
    row.push([cur, run]);
    rle.push(row);
  }
  return rle;
}

/**
 * The cell fixture: everything in local metres around the cell centre.
 * Buildings belong to the cell holding their centroid (each building is
 * generated exactly once across cells); trees and water are cut to the cell
 * square by the mesh builder.
 */
export function cellFixture(data, cell) {
  const origin = tileCentre(cell);
  const P = projector(data, origin);
  const side = tileSizeM(cell);
  const half = side / 2;
  const [w, s, e, nn] = tileBounds(cell);
  const [bx0, by0] = toLocal(s, w, origin);
  const [bx1, by1] = toLocal(nn, e, origin);
  const box = [bx0, by0, bx1, by1];
  const own = ([x, y]) => x >= box[0] && x < box[2] && y >= box[1] && y < box[3];
  const buildings = [];
  for (const b of data.buildings) {
    if (b.hide) continue; // building:part outlines that OpenMapTiles marks as not for 3D
    const rings = b.rings.map((r) => r.map(P));
    const outer = tidy(rings[0], true);
    if (outer.length < 3) continue;
    const bb = bboxOf(outer);
    if (!overlaps(bb, half, 60)) continue;
    const area = Math.abs(ringArea(outer));
    if (area < 6) continue;
    const c = ringCentroid(outer);
    if (!own(c)) continue;
    const holes = rings.slice(1).map((r) => tidy(r, false)).filter((r) => r.length >= 3 && Math.abs(ringArea(r)) > 4);
    buildings.push({ p: outer, holes, h: b.h, min: b.min, area, c });
  }
  const polysIn = (list, pad) =>
    list
      .map((f) => ({ ...f, rings: f.rings.map((r) => r.map(P)) }))
      .filter((f) => overlaps(bboxOf(f.rings[0]), half, pad));
  // water raster over the cell square plus a 2-cell apron
  const wn = Math.ceil((side + 2 * 2 * WATER_CELL_M) / WATER_CELL_M);
  const whalf = (wn * WATER_CELL_M) / 2;
  const ids = new Uint8Array(wn * wn);
  const water = polysIn(data.water, 20);
  // one id per water polygon (a pond on a hill keeps its own level next to the sea)
  water.forEach((f, i) => rasterize(ids, wn, WATER_CELL_M, whalf, [f.rings], Math.min(250, i + 1)));
  const piers = polysIn(data.piers, 20).map((f) => tidy(f.rings[0], true));
  const pierLines = data.pierLines.map((l) => l.map(P)).filter((l) => overlaps(bboxOf(l), half, 30));
  const areas = polysIn(data.cover, 20).map((f) => ({ k: f.k, p: tidy(f.rings[0], true), holes: f.rings.slice(1) }));
  const roads = data.roads
    .map((r) => ({ t: r.t, p: r.p.map(P) }))
    .filter((r) => overlaps(bboxOf(r.p), half, 30));
  const anyWater = ids.some((v) => v);
  return {
    schema: 'gev-near-field-cell@1',
    licence: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors (OpenMapTiles schema, OpenFreeMap tiles)',
    cell: { z: cell.z, x: cell.x, y: cell.y },
    centre: origin,
    side,
    box,
    buildings,
    roads,
    areas,
    piers,
    pierLines,
    water: anyWater ? { n: wn, cell: WATER_CELL_M, half: whalf, rle: toRle(ids, wn) } : null,
  };
}
