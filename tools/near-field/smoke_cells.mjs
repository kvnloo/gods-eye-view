// Smoke: generate the cells of a bubble around a point from live OpenFreeMap data
// (flat 0 m ground; the renderer supplies World Terrain heights). Prints per-cell stats.
// usage: node tools/near-field/smoke_cells.mjs <lat> <lon> [radius] [kit]
import { createCellGenerator } from '../../src/data/nearField/cellJob.js';
import { cellsInBubble } from '../../src/data/nearField/tiling.js';
const [lat, lon] = [Number(process.argv[2]), Number(process.argv[3])];
const radius = Number(process.argv[4] ?? 600);
const kit = process.argv[5] ?? 'norse';
const gen = createCellGenerator();
const cells = cellsInBubble({ lat, lon }, radius);
const flat = (side) => ({ n: 9, spacing: side / 8 + 10, half: (side / 8 + 10) * 4, heights: new Array(81).fill(0), centre: 0, offset: 0 });
let tot = { b: 0, t: 0, tri: 0, bytes: 0, viol: 0, ms: 0, pier: 0, hull: 0, drop: 0 };
for (const c of cells) {
  const t0 = Date.now();
  const out = await gen.generate({ cell: c, ground: flat(500), kit });
  const s = out.stats;
  tot.b += s.buildings; tot.t += s.trees; tot.tri += s.triangles; tot.bytes += (out.main?.byteLength ?? 0) + (out.trees?.byteLength ?? 0);
  tot.viol += s.waterViolations; tot.ms += Date.now() - t0; tot.pier += s.pier; tot.hull += s.hull; tot.drop += s.droppedOnWater;
  console.log(c.key, `d=${c.distance.toFixed(0)}`, JSON.stringify({ b: s.buildings, g: s.gabled, x: s.extruded, pier: s.pier, hull: s.hull, drop: s.droppedOnWater, trees: s.trees, rocks: s.rocks, w: s.waterRects, tri: s.triangles, kb: Math.round(((out.main?.byteLength ?? 0) + (out.trees?.byteLength ?? 0)) / 1024), viol: s.waterViolations, buildMs: s.buildMs, fetchMs: s.fetchMs }));
}
console.log('TOTAL', cells.length, 'cells', JSON.stringify({ ...tot, mb: (tot.bytes / 1048576).toFixed(1) }), JSON.stringify(gen.stats));
