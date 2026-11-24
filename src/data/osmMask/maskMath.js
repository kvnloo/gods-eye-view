/**
 * @module data/osmMask/maskMath
 * @description FORK-ONLY (exp/theme-engine-v0, loop v3). Geometry of the
 * OSM class mask the theme tile stage samples: which web-mercator level and
 * tile window to rasterise around the camera, and the map from local
 * east/north metres (the shader's eye -> ENU position) to atlas texels.
 *
 * Pure: no Cesium, no DOM. The GLSL in render/cesium/themes/tileStage.js
 * mirrors `localToTile` term by term; osmMask.test.mjs checks it against the
 * exact WGS84 -> web-mercator transform.
 *
 * Everything here is derived from OSM geometry and the camera; nothing reads
 * Google content.
 */

export const WGS84_A = 6378137;
export const WGS84_E2 = 6.69437999014e-3;
/** OpenFreeMap / OpenMapTiles vector tiles stop at z14 (over-zoomed above). */
export const DATA_ZOOM = 14;
/** Atlas: ATLAS_N x ATLAS_N mask tiles of TILE_PX texels. */
export const ATLAS_N = 12;
export const TILE_PX = 256;
/** Texels of margin rasterised around a mask tile (correct shore distance near its edge). */
export const PAD_PX = 24;

/**
 * Mask level by eye height (metres above ground): finer near the ground, off
 * for far views (the classifier alone themes the globe). `fade` blends the
 * whole mask out between 16 and 24 km.
 */
export const LEVELS = Object.freeze([
  { z: 16, maxEye: 1400 },
  { z: 15, maxEye: 5000 },
  { z: 14, maxEye: 24000 },
]);
export function maskLevel(eyeHeight) {
  const h = Math.max(0, Number(eyeHeight) || 0);
  const lv = LEVELS.find((l) => h <= l.maxEye);
  if (!lv) return { z: 0, fade: 0 };
  const fade = h <= 16000 ? 1 : Math.max(0, 1 - (h - 16000) / 8000);
  return { z: lv.z, fade };
}

/** Global web-mercator coordinate in tile units at zoom z (x east, y south). */
export function lonLatToTileXY(lon, lat, z) {
  const n = 2 ** z;
  const la = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const r = (la * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  };
}

/** Inverse of lonLatToTileXY. */
export function tileXYToLonLat(x, y, z) {
  const n = 2 ** z;
  return {
    lon: (x / n) * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
  };
}

/**
 * The atlas window: ATLAS_N x ATLAS_N tiles at zoom z whose centre corner is
 * the tile corner nearest the focus point. `anchor` (lat, lon) is that corner;
 * the shader's ENU frame sits there.
 */
export function maskWindow(lat, lon, z, n = ATLAS_N) {
  const p = lonLatToTileXY(lon, lat, z);
  const cx = Math.round(p.x);
  const cy = Math.round(p.y);
  const half = n / 2;
  const ox = cx - half;
  const oy = cy - half;
  const a = tileXYToLonLat(cx, cy, z);
  const tiles = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = ox + i;
      const y = oy + j;
      if (y < 0 || y >= 2 ** z) continue;
      const wx = ((x % 2 ** z) + 2 ** z) % 2 ** z;
      tiles.push({ z, x: wx, y, slot: [i, j] });
    }
  // nearest first: the focus area streams in before the edges
  tiles.sort(
    (s, t) =>
      Math.hypot(s.slot[0] + 0.5 - (p.x - ox), s.slot[1] + 0.5 - (p.y - oy)) -
      Math.hypot(t.slot[0] + 0.5 - (p.x - ox), t.slot[1] + 0.5 - (p.y - oy)),
  );
  return {
    z,
    n,
    ox,
    oy,
    cx,
    cy,
    anchor: { lat: a.lat, lon: a.lon },
    key: `${z}/${cx}/${cy}`,
    tiles,
  };
}

/** Recentre when the focus left the middle of the window, or the level changed. */
export function windowStale(win, lat, lon, z, slack = 2) {
  if (!win || win.z !== z) return true;
  const p = lonLatToTileXY(lon, lat, z);
  return Math.abs(p.x - win.cx) > slack || Math.abs(p.y - win.cy) > slack;
}

/**
 * Coefficients of the local -> tile map at the anchor (shader uniform
 * u_th_osmGeo): X = kx * e * (1 + t * n), Y = -ky * (n + t * n^2 / 2 - t2 * e^2 / 2),
 * in tile units from the anchor corner; e/n are ENU metres on the WGS84
 * ellipsoid. kx, ky use the prime-vertical and meridian radii (a sphere of
 * radius a would be off by ~0.3 %: ~10 m at 3 km). The t2 term is the drop
 * of the tangent plane toward the equator east/west of the anchor (~0.5 m
 * at 3 km at mid latitudes).
 */
export function maskGeo(lat0, z) {
  const phi = (lat0 * Math.PI) / 180;
  const s = Math.sin(phi);
  const w = Math.sqrt(1 - WGS84_E2 * s * s);
  const N = WGS84_A / w;
  const M = (WGS84_A * (1 - WGS84_E2)) / (w * w * w);
  const c = Math.cos(phi);
  const k = 2 ** z / (2 * Math.PI);
  return { kx: k / (N * c), ky: k / (M * c), t: Math.tan(phi) / M, t2: Math.tan(phi) / N };
}

/** Local ENU metres around the anchor -> tile units from the anchor (mirrors the GLSL). */
export function localToTile(e, n, geo) {
  return [geo.kx * e * (1 + geo.t * n), -geo.ky * (n + 0.5 * geo.t * n * n - 0.5 * geo.t2 * e * e)];
}

/** Local ENU metres -> atlas uv (0..1, v down = south), as the shader does it. */
export function localToAtlasUv(e, n, geo, nTiles = ATLAS_N) {
  const [X, Y] = localToTile(e, n, geo);
  return [(X + nTiles / 2) / nTiles, (Y + nTiles / 2) / nTiles];
}

/** Exact WGS84 geodetic -> ECEF (tests and QA). */
export function geodeticToEcef(lat, lon, h = 0) {
  const p = (lat * Math.PI) / 180;
  const l = (lon * Math.PI) / 180;
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(p) ** 2);
  return [
    (N + h) * Math.cos(p) * Math.cos(l),
    (N + h) * Math.cos(p) * Math.sin(l),
    (N * (1 - WGS84_E2) + h) * Math.sin(p),
  ];
}

/** Exact ENU (east, north, up) of a geodetic point around an origin on the ellipsoid. */
export function geodeticToEnu(lat, lon, h, lat0, lon0) {
  const [x, y, z] = geodeticToEcef(lat, lon, h);
  const [x0, y0, z0] = geodeticToEcef(lat0, lon0, 0);
  const p = (lat0 * Math.PI) / 180;
  const l = (lon0 * Math.PI) / 180;
  const dx = x - x0;
  const dy = y - y0;
  const dz = z - z0;
  return [
    -Math.sin(l) * dx + Math.cos(l) * dy,
    -Math.sin(p) * Math.cos(l) * dx - Math.sin(p) * Math.sin(l) * dy + Math.cos(p) * dz,
    Math.cos(p) * Math.cos(l) * dx + Math.cos(p) * Math.sin(l) * dy + Math.sin(p) * dz,
  ];
}

/** Metres per mask texel at a latitude and zoom. */
export function metresPerTexel(lat, z, px = TILE_PX) {
  return (2 * Math.PI * WGS84_A * Math.cos((lat * Math.PI) / 180)) / 2 ** z / px;
}

/** Stable 2..255 id of a building from its centroid (lon/lat, ~1 m grid): same id in every tile. */
export function buildingId(lon, lat) {
  let h = Math.imul(Math.round(lon * 1e5) | 0, 0x9e3779b1) ^ Math.imul(Math.round(lat * 1e5) | 0, 0x85ebca77);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return 2 + ((h >>> 0) % 254);
}
