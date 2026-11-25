/**
 * @module data/osmMask/maskJob
 * @description FORK-ONLY (exp/theme-engine-v0, loop v3). Builds OSM class
 * mask tiles: fetches (or reuses) the OpenFreeMap z14 vector tiles under a
 * mask tile (the keyless OpenMapTiles source the near-field bubble and the
 * app's outline layers use), decodes them with the near-field decoder
 * (data/nearField/cellData.js) and rasterises (raster.js). Runs in the mask
 * worker and in node tests. Caches are in memory only (ODbL data, never
 * persisted).
 */
import { createLru, tileKey } from '../nearField/tiling.js';
import { decodeDataTile } from '../nearField/cellData.js';
import { dataTilesFor, rasteriseMaskTile } from './raster.js';

export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';

export function createMaskGenerator({
  fetchImpl = (...a) => globalThis.fetch(...a),
  tileJsonUrl = OPENFREEMAP_TILEJSON,
  maxDataTiles = 48,
} = {}) {
  let template = null;
  const tiles = createLru(maxDataTiles);
  const stats = { dataFetches: 0, dataHits: 0, dataBytes: 0, emptyTiles: 0, maskTiles: 0, rasterMs: 0 };
  async function tileUrl(t) {
    template ??= (async () => {
      const res = await fetchImpl(tileJsonUrl);
      if (!res.ok) throw new Error(`OpenFreeMap tilejson HTTP ${res.status}`);
      return (await res.json()).tiles[0];
    })().catch((e) => {
      template = null;
      throw e;
    });
    return (await template).replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
  }
  function dataTile(t) {
    const key = tileKey(t);
    if (tiles.has(key)) {
      stats.dataHits++;
      return tiles.get(key);
    }
    const p = (async () => {
      const res = await fetchImpl(await tileUrl(t));
      stats.dataFetches++;
      if (res.status === 204 || res.status === 404) {
        stats.emptyTiles++;
        return decodeDataTile(new Uint8Array(0), { z: t.z, x: t.x, y: t.y });
      }
      if (!res.ok) throw new Error(`OpenFreeMap tile ${key} HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      stats.dataBytes += buf.byteLength;
      return decodeDataTile(buf, { z: t.z, x: t.x, y: t.y });
    })();
    tiles.set(key, p);
    p.catch(() => tiles.delete(key));
    return p;
  }
  /** One mask tile {z,x,y} (z 14..16) -> { rgba, features, mpp }. */
  async function maskTile(tile) {
    const need = dataTilesFor(tile);
    const datas = await Promise.all(
      need.map(async (t) => {
        const d = await dataTile(t);
        // unwrapped x near the antimeridian, without mutating the cached tile
        return t.dx === d.tile.x ? d : { ...d, tile: { ...d.tile, dx: t.dx } };
      }),
    );
    const t0 = globalThis.performance?.now?.() ?? Date.now();
    const out = rasteriseMaskTile(tile, datas);
    stats.rasterMs += (globalThis.performance?.now?.() ?? Date.now()) - t0;
    stats.maskTiles++;
    return out;
  }
  return { maskTile, stats };
}
