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
import { buildWorldGround, terrainFrame } from './worldGround.js';
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
  const fixtures = createLru(48);
  async function fixtureOf(cell, world) {
    const key = `${tileKey(cell)}:${!!world}`;
    if (fixtures.has(key)) return fixtures.get(key);
    const fx = cellFixture(await dataTile(cell), cell, world);
    fixtures.set(key, fx);
    return fx;
  }
  return {
    stats,
    /**
     * Phase 1: the cell's building footprint vertices (local metres, flat
     * [x0, y0, x1, y1, ...]) so the renderer can sample World Terrain at each
     * of them exactly (a grid would float buildings on steep slopes).
     */
    async prepare({ cell, world }) {
      const fx = await fixtureOf(cell, world);
      const n = fx.buildings.reduce((a, b) => a + b.p.length, 0);
      const points = new Float64Array(n * 2);
      let k = 0;
      for (const b of fx.buildings) for (const [x, y] of b.p) ((points[k++] = x), (points[k++] = y));
      return { points, centre: fx.centre };
    },
    /**
     * Phase 2 (or the whole job when `vertexHeights` is absent: heights then
     * come from the ground grid alone).
     * @param {{cell:{z:number,x:number,y:number}, ground:object, vertexHeights?:Float32Array|number[], kit?:string, kitOverrides?:object, trees?:number}} job
     */
    async generate({ cell, ground, vertexHeights = null, kit = 'realism', kitOverrides = {}, trees = 1, style, groundPx = 512 }) {
      const t0 = Date.now();
      const fixture = await fixtureOf(cell, !!style);
      const t1 = Date.now();
      if (vertexHeights) {
        let k = 0;
        for (const b of fixture.buildings) {
          b.hz = Array.from({ length: b.p.length }, () => vertexHeights[k++]);
        }
      }
      const built = buildCell(fixture, ground, kitOf(kit, style?.kit ?? kitOverrides), { trees, style });
      const t2 = Date.now();
      if (style) {
        const frame = terrainFrame(fixture.centre);
        const p = built.soup.p;
        for (let i = 0; i < p.length; i += 3) {
          const [x, y, z] = frame(p[i], p[i + 1], p[i + 2]);
          p[i] = x; p[i + 1] = y; p[i + 2] = z;
        }
        for (const { instances } of built.protos.values()) {
          for (const instance of instances) {
            const [x, y, z] = frame(...instance);
            instance[0] = x; instance[1] = y; instance[2] = z;
          }
        }
      }
      const main = writeGlb({ soup: built.soup, normals: !!style });
      const groundGlb = style ? writeGlb({ ground: await buildWorldGround(fixture, ground, style.ground, groundPx) }) : null;
      const waterGlb = built.waterSoup.p.length ? writeGlb({ soup: built.waterSoup }) : null;
      const treeGlb = built.protos.size ? writeGlb({ protos: built.protos.values(), normals: !!style }) : null;
      const violations = waterViolations(built);
      return {
        cell: { z: cell.z, x: cell.x, y: cell.y },
        centre: fixture.centre,
        side: fixture.side,
        box: fixture.box,
        main,
        ground: groundGlb,
        water: waterGlb,
        trees: treeGlb,
        footprints: built.footprints,
        waterRects: built.water,
        buildings: built.buildings.map(({ c, kind, share, wallBottom, floor, top, lift, area, support, p }) => ({
          c, kind, share, wallBottom, floor, top, lift, area, support,
          // footprint vertices (local metres) for the terrain check; capped per building
          p: p.length > 16 ? p.filter((_, i) => i % Math.ceil(p.length / 16) === 0) : p,
        })),
        stats: { ...built.stats, groundPx: style ? groundPx : 0, waterViolations: violations.length, fetchMs: t1 - t0, buildMs: t2 - t1, totalMs: Date.now() - t0 },
      };
    },
  };
}
