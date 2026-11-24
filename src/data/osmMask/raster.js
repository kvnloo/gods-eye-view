/**
 * @module data/osmMask/raster
 * @description FORK-ONLY (exp/theme-engine-v0, loop v3). Rasterises
 * OpenStreetMap polygons and lines (decoded OpenMapTiles z14 tiles, see
 * data/nearField/cellData.js decodeDataTile) into one web-mercator mask tile
 * for the theme tile stage:
 *
 *   R  water signed distance to the shore: 127.5 + 2 * metres (water > 128),
 *      clamped to +-63 m (a blurred water channel: shallows, foam)
 *   G  vegetation: 0 none, 128 grass / park / meadow, 255 wood / forest
 *   B  surface id (read nearest): 0 ground, 1 road, 2..255 building id
 *      (a hash of the footprint centroid: one roof colour per building)
 *   A  0 = not loaded (the classifier decides); loaded: 1 + 20 * metres from the
 *      footprint edge inside a building (1 outside; 255 = 12.7 m or more): roof
 *      eave lines of a fixed width in metres
 *
 * Pure (typed arrays only): runs in the mask worker and in node tests. The
 * data is (c) OpenStreetMap contributors (ODbL), kept in memory only.
 */
import { DATA_ZOOM, PAD_PX, TILE_PX, buildingId, metresPerTexel, tileXYToLonLat } from './maskMath.js';

/** Road widths in metres by OpenMapTiles class (decodeDataTile maps minor -> residential, path -> footway). */
export const ROAD_WIDTH_M = Object.freeze({
  motorway: 22,
  trunk: 18,
  primary: 14,
  secondary: 12,
  tertiary: 10,
  residential: 8,
  busway: 8,
  raceway: 8,
  service: 5,
  pedestrian: 5,
  track: 3,
  footway: 2.5,
});

/**
 * Fill polygons (each a list of rings [[x,y],...], outer + holes, even-odd)
 * into `out` (w x h, u8) with `value`, sampling at texel centres.
 */
export function fillPolygon(out, w, h, rings, value) {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const r of rings)
    for (const p of r) {
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
  const j0 = Math.max(0, Math.ceil(y0 - 0.5));
  const j1 = Math.min(h - 1, Math.floor(y1 - 0.5));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const yc = j + 0.5;
    xs.length = 0;
    for (const r of rings) {
      const n = r.length;
      for (let i = 0, k = n - 1; i < n; k = i++) {
        const a = r[k];
        const b = r[i];
        if ((a[1] > yc) !== (b[1] > yc)) xs.push(a[0] + ((yc - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const i1 = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      if (i1 >= i0) out.fill(value, j * w + i0, j * w + i1 + 1);
    }
  }
}

/** Stroke a polyline of half-width `hw` texels (round caps and joins). */
export function strokeLine(out, w, h, pts, hw, value) {
  const r2 = hw * hw;
  for (let s = 0; s + 1 < pts.length; s++) {
    const [ax, ay] = pts[s];
    const [bx, by] = pts[s + 1];
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - hw));
    const i1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + hw));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by) - hw));
    const j1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + hw));
    const dx = bx - ax;
    const dy = by - ay;
    const L = dx * dx + dy * dy || 1e-9;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const px = i + 0.5 - ax;
        const py = j + 0.5 - ay;
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / L));
        const ex = px - t * dx;
        const ey = py - t * dy;
        if (ex * ex + ey * ey <= r2) out[j * w + i] = value;
      }
  }
}

/** 1D squared distance transform (Felzenszwalb & Huttenlocher 2012). */
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Euclidean distance (texels) from each texel to the nearest texel where `isSeed` is true. */
export function distanceTransform(w, h, isSeed) {
  const INF = 1e20;
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = isSeed(i) ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x]);
  }
  return g;
}

/**
 * Data tiles (z14) whose area overlaps a mask tile (with its pad). Mask tiles
 * near a z14 edge need the neighbour too, or its water edge reads as a shore.
 */
export function dataTilesFor(tile, pad = PAD_PX, px = TILE_PX) {
  const k = 2 ** (tile.z - DATA_ZOOM);
  const m = pad / px;
  const x0 = Math.floor((tile.x - m) / k);
  const x1 = Math.floor((tile.x + 1 + m) / k);
  const y0 = Math.floor((tile.y - m) / k);
  const y1 = Math.floor((tile.y + 1 + m) / k);
  const n = 2 ** DATA_ZOOM;
  const out = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) if (y >= 0 && y < n) out.push({ z: DATA_ZOOM, x: ((x % n) + n) % n, y, dx: x });
  return out;
}

/**
 * Rasterise one mask tile (z >= 14) from decoded data tiles.
 * @param {{z,x,y}} tile
 * @param {Array<{tile:{z,x,y,dx?}, extent, buildings, water, cover, roads}>} datas decoded tiles
 *        (decodeDataTile output; `tile.dx` = unwrapped x, set by the caller near the antimeridian)
 * @returns {Uint8Array} TILE_PX^2 RGBA
 */
export function rasteriseMaskTile(tile, datas, { px = TILE_PX, pad = PAD_PX } = {}) {
  const W = px + 2 * pad;
  const N = W * W;
  const water = new Uint8Array(N);
  const veg = new Uint8Array(N);
  const id = new Uint8Array(N);
  const k = 2 ** (tile.z - DATA_ZOOM);
  const mpp = metresPerTexel(tileXYToLonLat(tile.x + 0.5, tile.y + 0.5, tile.z).lat, tile.z, px);
  let features = 0;
  for (const data of datas) {
    const dx = data.tile.dx ?? data.tile.x;
    const ext = data.extent || 4096;
    // data-tile pixel -> mask grid texel
    const sx = (k * px) / ext;
    const ox = (dx * k - tile.x) * px + pad;
    const oy = (data.tile.y * k - tile.y) * px + pad;
    const P = (p) => [ox + p[0] * sx, oy + p[1] * sx];
    const inGrid = (rings) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of rings[0]) {
        const x = ox + p[0] * sx;
        const y = oy + p[1] * sx;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      return x1 >= 0 && x0 <= W && y1 >= 0 && y0 <= W;
    };
    for (const wtr of data.water ?? []) {
      if (!inGrid(wtr.rings)) continue;
      fillPolygon(water, W, W, wtr.rings.map((r) => r.map(P)), 1);
      features++;
    }
    for (const c of data.cover ?? []) {
      if (c.k !== 'grass' && c.k !== 'park') continue;
      if (!inGrid(c.rings)) continue;
      fillPolygon(veg, W, W, c.rings.map((r) => r.map(P)), 128);
      features++;
    }
    for (const c of data.cover ?? []) {
      if (c.k !== 'wood' || !inGrid(c.rings)) continue;
      fillPolygon(veg, W, W, c.rings.map((r) => r.map(P)), 255);
      features++;
    }
    for (const r of data.roads ?? []) {
      const wm = ROAD_WIDTH_M[r.t] ?? 6;
      const hw = Math.max(0.6, wm / 2 / mpp);
      strokeLine(id, W, W, r.p.map(P), hw, 1);
      features++;
    }
    for (const b of data.buildings ?? []) {
      if (!inGrid(b.rings)) continue;
      // id from the centroid of the outer ring in lon/lat: identical in every tile
      const o = b.rings[0];
      let cx = 0, cy = 0;
      for (const p of o) {
        cx += p[0];
        cy += p[1];
      }
      cx /= o.length;
      cy /= o.length;
      const g = tileXYToLonLat(dx + cx / ext, data.tile.y + cy / ext, DATA_ZOOM);
      fillPolygon(id, W, W, b.rings.map((r) => r.map(P)), buildingId(g.lon, g.lat));
      features++;
    }
  }
  const out = new Uint8Array(px * px * 4);
  let sd = null;
  let anyWater = false;
  let anyLand = false;
  for (let i = 0; i < N; i++) {
    if (water[i]) anyWater = true;
    else anyLand = true;
  }
  if (anyWater && anyLand) {
    const dLand = distanceTransform(W, W, (i) => !water[i]);
    const dWater = distanceTransform(W, W, (i) => water[i] === 1);
    sd = (i) => (water[i] ? dLand[i] - 0.5 : -(dWater[i] - 0.5)) * mpp;
  }
  let anyBuilding = false;
  for (let i = 0; i < N; i++) if (id[i] >= 2) { anyBuilding = true; break; }
  const dEdge = anyBuilding ? distanceTransform(W, W, (i) => id[i] < 2) : null;
  for (let j = 0; j < px; j++)
    for (let i = 0; i < px; i++) {
      const g = (j + pad) * W + (i + pad);
      const o = (j * px + i) * 4;
      const m = sd ? sd(g) : anyWater ? 64 : -64;
      out[o] = Math.max(0, Math.min(255, Math.round(127.5 + 2 * m)));
      out[o + 1] = veg[g];
      out[o + 2] = id[g];
      out[o + 3] = id[g] >= 2 && dEdge ? Math.min(255, 1 + Math.round(Math.max(0, dEdge[g] - 0.5) * mpp * 20)) : 1;
    }
  return { rgba: out, features, mpp };
}

/** Decode helpers for tests and QA (mirror the GLSL). */
export const decodeTexel = (r, g, b, a) => ({
  shoreM: (r - 127.5) / 2,
  water: r > 127.5,
  grass: g > 64 && g < 192,
  forest: g >= 192,
  road: b === 1,
  building: b >= 2 ? b : 0,
  valid: a > 0,
  edgeM: a > 0 ? (a - 1) / 20 : 0,
});
