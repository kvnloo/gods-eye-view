/**
 * What the city planner reads around a place from OpenFreeMap's vector tiles
 * (the provider the outline and traffic layers already use): building
 * footprints with their mapped heights, parks, tree and grass cover, and the
 * walkable street and path network. Keyless; no new provider.
 */

import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';

export const GREEN_TILE_ZOOM = 14;
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const MAX_TILES = 9;
const WALKABLE = new Set([
  'path',
  'track',
  'minor',
  'service',
  'tertiary',
  'secondary',
  'primary',
  'trunk',
  'pedestrian',
  'living_street',
]);
const GREEN_COVER = new Set(['grass', 'wood', 'farmland', 'wetland']);
const OPEN_LAND = new Set([
  'brownfield',
  'grass',
  'greenfield',
  'construction',
]);

/** The z/x/y tile holding a point. */
export function tileOf(lat, lon, z = GREEN_TILE_ZOOM) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  );
  return { z, x, y };
}

/** Tiles covering a lon/lat box, at most MAX_TILES. */
export function tilesFor([west, south, east, north], z = GREEN_TILE_ZOOM) {
  const a = tileOf(north, west, z);
  const b = tileOf(south, east, z);
  const tiles = [];
  for (let x = a.x; x <= b.x; x++)
    for (let y = a.y; y <= b.y; y++) tiles.push({ z, x, y });
  if (tiles.length > MAX_TILES)
    throw new RangeError(`area needs ${tiles.length} tiles, over ${MAX_TILES}`);
  return tiles;
}

function lonLat(px, py, extent, { z, x, y }) {
  const n = 2 ** z;
  const lon = ((x + px / extent) / n) * 360 - 180;
  const m = Math.PI * (1 - (2 * (y + py / extent)) / n);
  const lat = (Math.atan(Math.sinh(m)) * 180) / Math.PI;
  return [Number(lon.toFixed(7)), Number(lat.toFixed(7))];
}

const ringsOf = (feature, extent, tile) =>
  feature
    .loadGeometry()
    .map((ring) => ring.map((p) => lonLat(p.x, p.y, extent, tile)));

/**
 * Decode one tile into planner features. Buildings keep the tile's
 * render_height (mapped height or levels, else OpenMapTiles' default) and say
 * which; polygons are outer rings in lon/lat.
 */
export function decodeGreenTile(buffer, tile) {
  const vt = new VectorTile(new Pbf(buffer));
  const out = { buildings: [], parks: [], cover: [], open: [], ways: [] };
  const each = (name, fn) => {
    const layer = vt.layers[name];
    if (!layer) return;
    for (let i = 0; i < layer.length; i++) fn(layer.feature(i), layer.extent);
  };
  each('building', (f, extent) => {
    const height = Number(f.properties.render_height);
    for (const ring of ringsOf(f, extent, tile))
      if (ring.length >= 4)
        out.buildings.push({
          ring,
          heightM: Number.isFinite(height) ? height : null,
          minHeightM: Number(f.properties.render_min_height) || 0,
        });
  });
  each('park', (f, extent) => {
    for (const ring of ringsOf(f, extent, tile))
      if (ring.length >= 4)
        out.parks.push({ ring, name: f.properties.name ?? null });
  });
  each('landcover', (f, extent) => {
    if (!GREEN_COVER.has(f.properties.class)) return;
    for (const ring of ringsOf(f, extent, tile))
      if (ring.length >= 4) out.cover.push({ ring, class: f.properties.class });
  });
  each('landuse', (f, extent) => {
    if (!OPEN_LAND.has(f.properties.class)) return;
    for (const ring of ringsOf(f, extent, tile))
      if (ring.length >= 4) out.open.push({ ring, class: f.properties.class });
  });
  each('transportation', (f, extent) => {
    if (!WALKABLE.has(f.properties.class) || f.type !== 2) return;
    if (f.properties.class === 'path' && f.properties.subclass === 'cycleway')
      return;
    for (const line of ringsOf(f, extent, tile))
      if (line.length >= 2) out.ways.push({ line, class: f.properties.class });
  });
  return out;
}

/** Fetch and decode the tiles around a box; every list is merged. */
export function createGreenTileSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  let template = null;
  const cache = new Map();
  // One tilejson request for all the tiles of a box read at once; a failed
  // one is asked again on the next read.
  function tileTemplate(signal) {
    template ??= (async () => {
      const res = await fetchImpl(TILEJSON, { signal });
      if (!res.ok) throw new Error(`OpenFreeMap tilejson HTTP ${res.status}`);
      return (await res.json()).tiles[0];
    })().catch((error) => {
      template = null;
      throw error;
    });
    return template;
  }
  async function tileUrl(tile, signal) {
    return (await tileTemplate(signal))
      .replace('{z}', tile.z)
      .replace('{x}', tile.x)
      .replace('{y}', tile.y);
  }
  async function one(tile, signal) {
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    if (!cache.has(key)) {
      const url = await tileUrl(tile, signal);
      const res = await fetchImpl(url, { signal });
      if (!res.ok)
        throw new Error(`OpenFreeMap tile ${key} HTTP ${res.status}`);
      cache.set(
        key,
        decodeGreenTile(new Uint8Array(await res.arrayBuffer()), tile),
      );
      if (cache.size > 64) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  }
  return {
    async around(bounds, { signal } = {}) {
      const parts = await Promise.all(
        tilesFor(bounds).map((t) => one(t, signal)),
      );
      const merged = {
        buildings: [],
        parks: [],
        cover: [],
        open: [],
        ways: [],
      };
      for (const part of parts)
        for (const k of Object.keys(merged)) merged[k].push(...part[k]);
      return merged;
    },
  };
}
