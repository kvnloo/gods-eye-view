/**
 * @module data/nearField/cellJob
 * @description FORK-ONLY (exp/near-field-v0). One near-field generation job:
 * fetch (or reuse) the z14 OpenFreeMap tile holding a cell, cut the cell
 * fixture, build its meshes and write two GLBs (buildings + water, and the
 * instanced trees and rocks, so the renderer can fade trees out earlier: LOD
 * by distance). Runs in the worker (worker.js) and in node tests.
 *
 * Caches are in memory only (ODbL data, never persisted here).
 */
import { createLru, parentTile, tileKey } from './tiling.js';
import { cellFixture, decodeDataTile } from './cellData.js';
import { buildCell, kitOf, waterViolations } from './cellMesh.js';
import { writeGlb } from './glb.js';

export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';

export function createCellGenerator({
  fetchImpl = (...a) => globalThis.fetch(...a),
  tileJsonUrl = OPENFREEMAP_TILEJSON,
  maxDataTiles = 24,
} = {}) {
  let template = null;
  const tiles = createLru(maxDataTiles);
  const stats = { dataFetches: 0, dataHits: 0, dataBytes: 0, emptyTiles: 0 };
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
  async function dataTile(cell) {
    const t = parentTile(cell);
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
        return decodeDataTile(new Uint8Array(0), t);
      }
      if (!res.ok) throw new Error(`OpenFreeMap tile ${key} HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      stats.dataBytes += buf.byteLength;
      return decodeDataTile(buf, t);
    })();
    tiles.set(key, p);
    p.catch(() => tiles.delete(key));
    return p;
  }
  return {
    stats,
    /**
     * @param {{cell:{z:number,x:number,y:number}, ground:object, kit?:string, kitOverrides?:object, trees?:number}} job
     */
    async generate({ cell, ground, kit = 'realism', kitOverrides = {}, trees = 1 }) {
      const t0 = Date.now();
      const data = await dataTile(cell);
      const t1 = Date.now();
      const fixture = cellFixture(data, cell);
      const built = buildCell(fixture, ground, kitOf(kit, kitOverrides), { trees });
      const t2 = Date.now();
      const main = writeGlb({ soup: built.soup });
      const treeGlb = built.protos.size ? writeGlb({ protos: built.protos.values() }) : null;
      const violations = waterViolations(built);
      return {
        cell: { z: cell.z, x: cell.x, y: cell.y },
        centre: fixture.centre,
        side: fixture.side,
        box: fixture.box,
        main,
        trees: treeGlb,
        footprints: built.footprints,
        water: built.water,
        buildings: built.buildings.map(({ c, kind, share, wallBottom, floor, top, area, support, p }) => ({
          c, kind, share, wallBottom, floor, top, area, support,
          // footprint vertices (local metres) for the terrain check; capped per building
          p: p.length > 16 ? p.filter((_, i) => i % Math.ceil(p.length / 16) === 0) : p,
        })),
        stats: { ...built.stats, waterViolations: violations.length, fetchMs: t1 - t0, buildMs: t2 - t1, totalMs: Date.now() - t0 },
      };
    },
  };
}
