import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUBBLE,
  bubbleCentre,
  bubbleRadius,
  cellsInBubble,
  createLru,
  edgeAlpha,
  nearFieldRequest,
  prefersLiteWorld,
  parentTile,
  tileBounds,
  tileCentre,
  tileOf,
  tileSizeM,
  toLocal,
} from './tiling.js';
import { cellFixture, rasterize, toRle } from './cellData.js';
import { buildCell, kitOf, NEAR_FIELD_KITS, waterViolations } from './cellMesh.js';
import { readGlbJson, writeGlb } from './glb.js';
import { waterField, inPolygon } from '../cityDioramaMesh.js';
import { BUILT_IN_PRESETS, normalizeNearField, normalizePreset } from '../../render/cesium/themes/presets.js';

const SAUSALITO = { lat: 37.8555, lon: -122.489 };

test('tiles: point -> tile -> bounds contain the point; z16 size at San Francisco', () => {
  for (const p of [SAUSALITO, { lat: 48.853, lon: 2.287 }, { lat: 35.684, lon: 139.69 }, { lat: -33.86, lon: 151.21 }]) {
    const t = tileOf(p.lat, p.lon, 16);
    const [w, s, e, n] = tileBounds(t);
    assert.ok(p.lon >= w && p.lon < e && p.lat > s && p.lat <= n, JSON.stringify({ p, t }));
    const c = tileCentre(t);
    assert.deepEqual(tileOf(c.lat, c.lon, 16), t);
    assert.deepEqual(parentTile(t), tileOf(p.lat, p.lon, 14));
  }
  const side = tileSizeM(tileOf(37.8, -122.4, 16));
  assert.ok(side > 470 && side < 495, `z16 side ${side}`);
});

test('bubble radius: scales with eye height, clamped, off above the cut-off', () => {
  assert.equal(bubbleRadius(0).radius, BUBBLE.min);
  assert.equal(bubbleRadius(100).radius, BUBBLE.min);
  assert.equal(bubbleRadius(300).radius, 300 * BUBBLE.perHeight);
  assert.equal(bubbleRadius(1000).radius, BUBBLE.max);
  assert.deepEqual(bubbleRadius(BUBBLE.offAbove), { radius: 0, fade: 0 });
  assert.equal(bubbleRadius(20000).radius, 0);
  assert.equal(bubbleRadius(900).fade, 1);
  let last = 1;
  for (let h = BUBBLE.fadeFrom; h < BUBBLE.offAbove; h += 25) {
    const { fade } = bubbleRadius(h);
    assert.ok(fade <= last + 1e-12 && fade >= 0, `fade not monotonic at ${h}`);
    last = fade;
  }
});

test('bubble centre: nadir looking straight down, leads along the heading when oblique', () => {
  const down = bubbleCentre({ ...SAUSALITO, heading: 1, pitch: -Math.PI / 2, eyeHeight: 400 }, 800);
  assert.ok(Math.hypot(...toLocal(down.lat, down.lon, SAUSALITO)) < 1);
  const north = bubbleCentre({ ...SAUSALITO, heading: 0, pitch: -Math.PI / 6, eyeHeight: 400 }, 800);
  const [x, y] = toLocal(north.lat, north.lon, SAUSALITO);
  assert.ok(Math.abs(x) < 1 && y > 0 && y <= BUBBLE.lead * 800 + 1e-6, JSON.stringify({ x, y }));
});

test('cells in bubble: nearest first, no duplicates, all within the radius, centre cell included', () => {
  const list = cellsInBubble(SAUSALITO, 900);
  const keys = list.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(list[0].distance, 0);
  assert.equal(list[0].key, `16/${tileOf(SAUSALITO.lat, SAUSALITO.lon).x}/${tileOf(SAUSALITO.lat, SAUSALITO.lon).y}`);
  for (let i = 1; i < list.length; i++) assert.ok(list[i].distance >= list[i - 1].distance);
  assert.ok(list.every((c) => c.distance <= 900));
  // every point of the disc is covered by some listed cell (sample a ring of points)
  for (let a = 0; a < 360; a += 15)
    for (const r of [0, 300, 600, 890]) {
      const kx = 111_320 * Math.cos((SAUSALITO.lat * Math.PI) / 180);
      const lat = SAUSALITO.lat + (Math.cos((a * Math.PI) / 180) * r) / 111_320;
      const lon = SAUSALITO.lon + (Math.sin((a * Math.PI) / 180) * r) / kx;
      const t = tileOf(lat, lon);
      assert.ok(keys.includes(`16/${t.x}/${t.y}`), `hole at ${a} deg ${r} m`);
    }
  assert.ok(cellsInBubble(SAUSALITO, 400).length < list.length);
  assert.deepEqual(cellsInBubble(SAUSALITO, 0), []);
  // across the antimeridian
  const wrap = cellsInBubble({ lat: 0, lon: 179.999 }, 500);
  assert.ok(wrap.some((c) => c.x === 0) && wrap.some((c) => c.x === 2 ** 16 - 1));
});

test('LRU: evicts least recently used, refreshes on get, respects pins, reports evictions', () => {
  const gone = [];
  const pins = new Set(['b']);
  const lru = createLru(2, { onEvict: (k) => gone.push(k), pinned: (k) => pins.has(k) });
  lru.set('a', 1);
  lru.set('b', 2);
  lru.get('a');
  lru.set('c', 3); // b is pinned, a was refreshed but is the oldest unpinned
  assert.deepEqual(gone, ['a']);
  assert.ok(lru.has('b') && lru.has('c'));
  pins.clear();
  lru.set('d', 4);
  assert.deepEqual(gone, ['a', 'b']);
  lru.clear();
  assert.equal(lru.size, 0);
  assert.deepEqual(gone, ['a', 'b', 'c', 'd']);
});

test('edge alpha: 1 inside, 0 outside, monotonic across the band', () => {
  assert.equal(edgeAlpha(0, 800), 1);
  assert.equal(edgeAlpha(800 * (1 - BUBBLE.edge), 800), 1);
  assert.equal(edgeAlpha(800, 800), 0);
  assert.equal(edgeAlpha(5, 0), 0);
  let last = 1;
  for (let d = 600; d <= 800; d += 10) {
    const a = edgeAlpha(d, 800);
    assert.ok(a <= last);
    last = a;
  }
});

test('flags: off by default, on with nearField=1', () => {
  assert.equal(nearFieldRequest(''), null);
  assert.equal(nearFieldRequest('?theme=wintercats&world=photoreal'), null);
  assert.equal(nearFieldRequest('?theme=wintercats-learned'), null);
  assert.equal(nearFieldRequest('?theme=noir'), null);
  assert.equal(nearFieldRequest('?nearField=0'), null);
  assert.deepEqual(nearFieldRequest('?nearField=1&nearFieldKit=norse'), { kit: 'norse', debug: false });
});

test('flags: wintercats picks the procedural world by default; lite follows the device unless set', () => {
  const full = { mode: 'world', pack: 'wintercats', lite: false, debug: false };
  assert.deepEqual(nearFieldRequest('?theme=wintercats'), full);
  assert.deepEqual(nearFieldRequest('?preset=wintercats'), full);
  assert.deepEqual(nearFieldRequest('?world=procedural'), full);
  assert.deepEqual(nearFieldRequest('?theme=wintercats', { lite: true }), { ...full, lite: true });
  assert.deepEqual(nearFieldRequest('?theme=wintercats&worldLite=0', { lite: true }), full);
  assert.deepEqual(nearFieldRequest('?world=procedural&worldLite=1'), { ...full, lite: true });
  assert.equal(prefersLiteWorld(undefined), false);
  const phone = { matchMedia: () => ({ matches: true }), screen: { width: 412, height: 915 } };
  const desk = { matchMedia: () => ({ matches: false }), screen: { width: 2560, height: 1440 } };
  assert.equal(prefersLiteWorld(phone), true);
  assert.equal(prefersLiteWorld(desk), false);
});

test('raster: scanline fill + RLE round trip through the diorama water field', () => {
  const n = 20, cell = 4, half = 40;
  const ids = new Uint8Array(n * n);
  rasterize(ids, n, cell, half, [[[[-20, -20], [20, -20], [20, 20], [-20, 20]]]], 3);
  const f = waterField({ water: { n, cell, half, rle: toRle(ids, n) } });
  assert.equal(f.at(0, 0), 3);
  assert.equal(f.at(-30, 0), 0);
  assert.equal(f.at(30, 30), 0);
  assert.equal(ids.reduce((a, v) => a + (v ? 1 : 0), 0), 100);
});

// ---- a synthetic OpenMapTiles z14 tile in pixel coordinates
function syntheticData(t14) {
  const extent = 4096;
  const sq = (cx, cy, r) => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r], [cx - r, cy - r]];
  const buildings = [];
  // a grid of small houses everywhere, including on the z16 cell borders
  for (let px = 64; px < extent; px += 128) for (let py = 64; py < extent; py += 128) buildings.push({ rings: [sq(px, py, 6)], h: 7, min: 0, hide: false });
  // three buildings on the "sea" (east half of the tile): one small, one big, one big on a pier
  buildings.push({ rings: [sq(3600, 300, 5)], h: 6, min: 0, hide: false });
  buildings.push({ rings: [sq(3600, 560, 40)], h: 12, min: 0, hide: false });
  buildings.push({ rings: [sq(3600, 900, 30)], h: 9, min: 0, hide: false });
  return {
    tile: t14,
    extent,
    buildings,
    water: [{ rings: [[[3300, 0], [4096, 0], [4096, 2000], [3300, 2000], [3300, 0]]], k: 'ocean' }],
    piers: [{ rings: [sq(3600, 900, 45)] }],
    pierLines: [],
    cover: [{ rings: [[[200, 2400], [1600, 2400], [1600, 3800], [200, 3800], [200, 2400]]], k: 'wood' }],
    roads: [{ t: 'residential', p: [[0, 2048], [4096, 2048]] }],
  };
}
const flatGround = (side, h = 12) => {
  const n = 9;
  const spacing = (side + 48) / (n - 1);
  return { n, spacing, half: (spacing * (n - 1)) / 2, heights: Array.from({ length: n * n }, (_, k) => h + (k % n) * 0.5), centre: 0, offset: 0 };
};

test('cells: every building of a data tile is generated by exactly one of its 16 cells', () => {
  const t14 = tileOf(SAUSALITO.lat, SAUSALITO.lon, 14);
  const data = syntheticData(t14);
  let total = 0;
  const seen = new Set();
  for (let dx = 0; dx < 4; dx++)
    for (let dy = 0; dy < 4; dy++) {
      const cell = { z: 16, x: t14.x * 4 + dx, y: t14.y * 4 + dy };
      const fx = cellFixture(data, cell);
      for (const b of fx.buildings) {
        const g = toLocal(0, 0, { lat: 0, lon: 0 });
        assert.ok(g);
        const kx = 111_320 * Math.cos((fx.centre.lat * Math.PI) / 180);
        const id = `${(fx.centre.lon + b.c[0] / kx).toFixed(6)},${(fx.centre.lat + b.c[1] / 111_320).toFixed(6)}`;
        assert.ok(!seen.has(id), `building ${id} generated twice`);
        seen.add(id);
        total++;
      }
    }
  assert.equal(total, data.buildings.length);
});

test('osm-geo invariants: no building on water without a pier or hull; terrain contact; trees off water and roofs', () => {
  const t14 = tileOf(SAUSALITO.lat, SAUSALITO.lon, 14);
  const data = syntheticData(t14);
  const cell = { z: 16, x: t14.x * 4 + 3, y: t14.y * 4 }; // north-east cell: the "sea" half
  const fx = cellFixture(data, cell);
  assert.ok(fx.water, 'cell has water');
  const ground = flatGround(fx.side);
  const built = buildCell(fx, ground, kitOf('norse'));
  assert.equal(waterViolations(built).length, 0);
  const kinds = built.buildings.map((b) => b.kind);
  assert.ok(kinds.includes('hull'), 'small building on water floats on a hull');
  assert.ok(kinds.includes('pier'), 'building over a pier stands on posts');
  assert.equal(built.stats.droppedOnWater, 1, 'big building on open water is dropped');
  const water = waterField(fx);
  for (const b of built.buildings) {
    if (b.kind !== 'land') continue;
    // walls reach below the lowest corner of the terrain under the footprint
    const zs = b.p.map(([x, y]) => {
      const fxv = Math.min(ground.n - 1.001, Math.max(0, (x + ground.half) / ground.spacing));
      const fyv = Math.min(ground.n - 1.001, Math.max(0, (y + ground.half) / ground.spacing));
      const i = Math.floor(fxv), j = Math.floor(fyv), tx = fxv - i, ty = fyv - j;
      const at = (a, c) => ground.heights[c * ground.n + a];
      return at(i, j) * (1 - tx) * (1 - ty) + at(i + 1, j) * tx * (1 - ty) + at(i, j + 1) * (1 - tx) * ty + at(i + 1, j + 1) * tx * ty;
    });
    assert.ok(b.wallBottom <= Math.min(...zs) - 1, 'walls go into the ground');
    assert.ok(Math.abs(b.floor - zs.reduce((a, z) => a + z, 0) / zs.length) < 1e-6, 'floor = mean terrain under the footprint');
  }
  for (const p of built.protos.values()) {
    for (const [x, y] of p.instances) {
      if (p.soup && p.instances.length && p.r === 1) continue; // rocks sit on the shore by design
      assert.equal(water.at(x, y), 0, 'tree on water');
      assert.ok(!built.footprints.some((f) => inPolygon([x, y], f.rings[0])), 'tree inside a building');
    }
  }
});

test('marinas: no generated water near mapped docks, but buildings there still count as on water', () => {
  const t14 = tileOf(SAUSALITO.lat, SAUSALITO.lon, 14);
  const data = syntheticData(t14);
  data.pierLines.push([[3400, 150], [3400, 450]]); // a dock in the "sea"
  const fx = cellFixture(data, { z: 16, x: t14.x * 4 + 3, y: t14.y * 4 });
  const truth = waterField(fx);
  const shown = waterField({ water: fx.waterShown });
  const [dx, dy] = (() => {
    // the dock's middle in local metres: find it through the fixture's own pier line
    const l = fx.pierLines.find((q) => q.length === 2);
    return [(l[0][0] + l[1][0]) / 2, (l[0][1] + l[1][1]) / 2];
  })();
  assert.ok(truth.at(dx + 6, dy) > 0, 'truth raster keeps the water at the dock');
  assert.equal(shown.at(dx + 6, dy), 0, 'no generated water 6 m from the dock');
  assert.ok(shown.at(dx + 60, dy) > 0, 'generated water away from the dock');
});

test('trees: wood landcover is planted, density follows the kit, deterministic per cell', () => {
  const t14 = tileOf(SAUSALITO.lat, SAUSALITO.lon, 14);
  const data = syntheticData(t14);
  const cell = { z: 16, x: t14.x * 4, y: t14.y * 4 + 3 }; // south-west cell: the wood
  const fx = cellFixture(data, cell);
  const a = buildCell(fx, flatGround(fx.side), kitOf('norse'));
  const b = buildCell(fx, flatGround(fx.side), kitOf('norse'));
  const sparse = buildCell(fx, flatGround(fx.side), kitOf('norse', { density: 0.3 }));
  assert.ok(a.stats.trees > 100, `trees ${a.stats.trees}`);
  assert.equal(a.stats.trees, b.stats.trees);
  assert.ok(sparse.stats.trees < a.stats.trees * 0.6);
});

test('glb: buildings and instanced trees; instanced translations carry min/max (Cesium bounds them)', () => {
  const t14 = tileOf(SAUSALITO.lat, SAUSALITO.lon, 14);
  const fx = cellFixture(syntheticData(t14), { z: 16, x: t14.x * 4, y: t14.y * 4 + 3 });
  const built = buildCell(fx, flatGround(fx.side), kitOf('realism'));
  const main = readGlbJson(writeGlb({ soup: built.soup }));
  assert.equal(main.nodes.length, 1);
  assert.ok(main.meshes[0].primitives[0].attributes.COLOR_0 !== undefined);
  const trees = readGlbJson(writeGlb({ protos: built.protos.values() }));
  assert.ok(trees.extensionsUsed.includes('EXT_mesh_gpu_instancing'));
  for (const n of trees.nodes) {
    const tr = trees.accessors[n.extensions.EXT_mesh_gpu_instancing.attributes.TRANSLATION];
    assert.ok(Array.isArray(tr.min) && Array.isArray(tr.max));
  }
  assert.equal(writeGlb({ protos: [] }), null);
});

test('theme presets carry a near-field kit (wintercats = norse) and bad blocks are cleaned', () => {
  assert.equal(normalizePreset(BUILT_IN_PRESETS.wintercats).preset.nearField.kit, 'norse');
  assert.equal(normalizePreset(BUILT_IN_PRESETS['enhanced-realism']).preset.nearField.kit, 'realism');
  assert.equal(normalizePreset(BUILT_IN_PRESETS.none).preset.nearField, null);
  const problems = [];
  const n = normalizeNearField({ kit: 'klingon', key: 99, colours: { walls: ['#zzz'] } }, problems);
  assert.equal(n.kit, 'realism');
  assert.equal(n.key, 0.8);
  assert.ok(problems.length >= 2);
  assert.ok(Object.keys(NEAR_FIELD_KITS).includes('norse'));
  assert.deepEqual(kitOf('norse', { walls: ['#112233'] }).walls, ['#112233']);
});
