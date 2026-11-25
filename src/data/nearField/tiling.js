/**
 * @module data/nearField/tiling
 * @description FORK-ONLY (exp/near-field-v0). Pure math of the near-field
 * bubble: web-mercator cells around the camera, the bubble radius as a
 * function of eye height, and a small LRU. No Cesium, no DOM: runs (and is
 * tested) in node and in the worker.
 *
 * The world is cut into z16 web-mercator cells (about 611 m * cos(lat) on a
 * side: 483 m in San Francisco, 402 m in Paris). Each cell is generated once
 * from the z14 OpenFreeMap tile that contains it (OpenMapTiles stops at z14),
 * so one data tile feeds 16 cells.
 */

export const CELL_ZOOM = 16;
export const DATA_ZOOM = 14;
const EARTH_M = 40_075_016.686;
const M_PER_DEG = 111_320;

/** Bubble policy (metres). Exported so tests and the docs quote one source. */
export const BUBBLE = Object.freeze({
  /** radius = clamp(eyeHeight * perHeight, min, max) */
  cellZoom: CELL_ZOOM,
  perHeight: 2.2,
  min: 320,
  max: 1100,
  /** the bubble fades out between these eye heights; off above `offAbove` */
  fadeFrom: 1100,
  offAbove: 1500,
  /** objects dither out over the outer share of the radius */
  edge: 0.25,
  /** cells are loaded this far past the radius, so they exist before they show */
  margin: 160,
  /** the centre moves forward along the view, at most this share of the radius */
  lead: 0.45,
});

export const WORLD = Object.freeze({
  cellZoom: 15, perHeight: 3, min: 900, max: 3000, fadeFrom: 3200,
  offAbove: 4500, edge: 0.2, margin: 200, lead: 0.5,
});
export const WORLD_LITE = Object.freeze({ ...WORLD, max: 1800 });

/** `?nearField=1` flags, or null when the bubble is off (the default). */
export function nearFieldRequest(search = '') {
  const q = new URLSearchParams(search ?? '');
  if (q.get('world') === 'procedural') return {
    mode: 'world', pack: q.get('stylePack') || 'wintercats',
    lite: q.get('worldLite') === '1', debug: q.get('nearFieldDebug') === '1',
  };
  const on = q.get('nearField');
  if (on !== '1' && on !== 'true') return null;
  return {
    kit: q.get('nearFieldKit') || null,
    debug: q.get('nearFieldDebug') === '1',
  };
}

/** z/x/y of the tile holding a point. */
export function tileOf(lat, lon, z = CELL_ZOOM) {
  const n = 2 ** z;
  const la = Math.max(-85.0511, Math.min(85.0511, lat));
  const x = Math.floor(((((lon + 180) % 360) + 360) % 360 / 360) * n);
  const r = (la * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { z, x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/** [west, south, east, north] degrees of a tile. */
export function tileBounds({ z, x, y }) {
  const n = 2 ** z;
  const lon = (i) => (i / n) * 360 - 180;
  const lat = (j) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}

/** Centre (lat, lon) of a tile. */
export function tileCentre(tile) {
  const [w, s, e, n] = tileBounds(tile);
  return { lat: (s + n) / 2, lon: (w + e) / 2 };
}

/** Side of a tile in metres at its centre latitude. */
export function tileSizeM({ z, y }) {
  const n = 2 ** z;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)));
  return (EARTH_M * Math.cos(lat)) / n;
}

export const tileKey = ({ z, x, y }) => `${z}/${x}/${y}`;

/** The z14 data tile a cell is cut from. */
export function parentTile(tile, z = DATA_ZOOM) {
  const k = 2 ** (tile.z - z);
  return { z, x: Math.floor(tile.x / k), y: Math.floor(tile.y / k) };
}

/** Local east/north metres of (lat, lon) around an origin (equirectangular; < 1 cm error over 1 km). */
export function toLocal(lat, lon, origin) {
  const kx = M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180);
  const delta = lon - origin.lon;
  const east = delta > 180 ? delta - 360 : delta < -180 ? delta + 360 : delta;
  return [east * kx, (lat - origin.lat) * M_PER_DEG];
}

export function fromLocal(x, y, origin) {
  const kx = M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180);
  return { lat: origin.lat + y / M_PER_DEG, lon: origin.lon + x / kx };
}

/**
 * Bubble radius for an eye height above the ground (metres), and the global
 * fade (1 = fully on, 0 = off: far views are pure themed Google).
 */
export function bubbleRadius(eyeHeight, policy = BUBBLE) {
  const h = Math.max(0, Number(eyeHeight) || 0);
  if (h >= policy.offAbove) return { radius: 0, fade: 0 };
  const radius = Math.min(policy.max, Math.max(policy.min, h * policy.perHeight));
  const t = (h - policy.fadeFrom) / (policy.offAbove - policy.fadeFrom);
  const fade = t <= 0 ? 1 : 1 - Math.min(1, t) ** 2 * (3 - 2 * Math.min(1, t));
  return { radius, fade };
}

/**
 * Bubble centre: the ground point under the camera pushed forward along the
 * view heading, so an oblique view gets its detail where it looks.
 * `pitch` in radians (negative = looking down), heading in radians from north.
 */
export function bubbleCentre({ lat, lon, heading = 0, pitch = -Math.PI / 2, eyeHeight = 0 }, radius, policy = BUBBLE) {
  const down = Math.max(0.05, -pitch);
  const ahead = down >= Math.PI / 2 - 1e-3 ? 0 : eyeHeight / Math.tan(down);
  const lead = Math.min(policy.lead * radius, ahead);
  const p = fromLocal(Math.sin(heading) * lead, Math.cos(heading) * lead, { lat, lon });
  return { lat: p.lat, lon: ((p.lon + 540) % 360) - 180, lead };
}

/**
 * Cells whose square comes within `radius` of the centre, nearest first.
 * Each entry: { z, x, y, key, distance } (metres, centre to nearest point of the cell).
 */
export function cellsInBubble(centre, radius, z = CELL_ZOOM, limit = 400) {
  if (!(radius > 0)) return [];
  const c = tileOf(centre.lat, centre.lon, z);
  const side = tileSizeM(c);
  const span = Math.ceil(Math.min(radius / side, Math.sqrt(limit / Math.PI) + 2)) + 1;
  const n = 2 ** z;
  const out = [];
  for (let dy = -span; dy <= span; dy++)
    for (let dx = -span; dx <= span; dx++) {
      const x = (((c.x + dx) % n) + n) % n;
      const y = c.y + dy;
      if (y < 0 || y >= n) continue;
      const tile = { z, x, y };
      let [w, s, e, nn] = tileBounds(tile);
      // across the antimeridian: measure the tile on the centre's side
      const shift = w - centre.lon > 180 ? -360 : centre.lon - e > 180 ? 360 : 0;
      w += shift;
      e += shift;
      const [x0, y0] = toLocal(s, w, centre);
      const [x1, y1] = toLocal(nn, e, centre);
      const ex = Math.max(x0, Math.min(0, x1));
      const ey = Math.max(y0, Math.min(0, y1));
      const distance = Math.hypot(ex, ey);
      if (distance <= radius) out.push({ ...tile, key: tileKey(tile), distance });
    }
  out.sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key));
  return out.slice(0, limit);
}

/**
 * A bounded LRU. `get` refreshes, `set` evicts the least recently used past
 * `max`, calling `onEvict(key, value)` for each eviction (the renderer destroys
 * models there). `pinned(key)` (optional) keeps entries that are in view.
 */
export function createLru(max, { onEvict = () => {}, pinned = () => false } = {}) {
  const m = new Map();
  const lru = {
    get size() {
      return m.size;
    },
    has: (k) => m.has(k),
    peek: (k) => m.get(k),
    get(k) {
      if (!m.has(k)) return undefined;
      const v = m.get(k);
      m.delete(k);
      m.set(k, v);
      return v;
    },
    set(k, v) {
      if (m.has(k)) m.delete(k);
      m.set(k, v);
      lru.trim();
      return v;
    },
    delete(k) {
      if (!m.has(k)) return false;
      const v = m.get(k);
      m.delete(k);
      onEvict(k, v);
      return true;
    },
    trim() {
      if (m.size <= max) return;
      for (const k of [...m.keys()]) {
        if (m.size <= max) break;
        if (pinned(k)) continue;
        const v = m.get(k);
        m.delete(k);
        onEvict(k, v);
      }
    },
    keys: () => [...m.keys()],
    values: () => [...m.values()],
    iterate: () => m.values(),
    clear() {
      for (const [k, v] of [...m]) {
        m.delete(k);
        onEvict(k, v);
      }
    },
  };
  return lru;
}

/** Distance dither alpha at `d` metres from the centre (1 inside, 0 past the radius). */
export function edgeAlpha(d, radius, policy = BUBBLE) {
  if (!(radius > 0)) return 0;
  const a = radius * (1 - policy.edge);
  if (d <= a) return 1;
  if (d >= radius) return 0;
  const t = (d - a) / (radius - a);
  return 1 - t * t * (3 - 2 * t);
}
