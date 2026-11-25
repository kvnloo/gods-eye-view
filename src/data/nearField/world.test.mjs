import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { WORLD, WORLD_LITE, BUBBLE, bubbleCentre, bubbleRadius, cellsInBubble, edgeAlpha, nearFieldRequest, parentTile } from './tiling.js';
import { encodeRgbPng, pngCrc } from './png.js';
import { paintGround, buildWorldGround } from './worldGround.js';
import { rgb, stylePackHash, validateStylePack } from './stylePack.js';
import { canopyPrototype } from './canopy.js';
import { readGlbJson, writeGlb } from './glb.js';

const getPack = async (name) => JSON.parse(await readFile(new URL(`../../../public/themes/stylepacks/${name}.json`, import.meta.url)));
const wintercats = await getPack('wintercats');

test('world policy streams z15 cells from z14 parents across the antimeridian', () => {
  assert.equal(BUBBLE.cellZoom, 16);
  assert.deepEqual(bubbleRadius(100, WORLD), { radius: 900, fade: 1 });
  assert.deepEqual(bubbleRadius(700, WORLD), { radius: 2100, fade: 1 });
  assert.deepEqual(bubbleRadius(700, WORLD_LITE), { radius: 1800, fade: 1 });
  assert.deepEqual(bubbleRadius(3200, WORLD), { radius: 3000, fade: 1 });
  assert.deepEqual(bubbleRadius(3850, WORLD), { radius: 3000, fade: 0.5 });
  assert.deepEqual(bubbleRadius(4500, WORLD), { radius: 0, fade: 0 });
  assert.equal(edgeAlpha(2400, 3000, WORLD), 1);
  assert.equal(edgeAlpha(2700, 3000, WORLD), 0.5);
  assert.equal(bubbleCentre({ lat: 0, lon: 0, pitch: -0.1, eyeHeight: 700 }, 2100, WORLD).lead, 1050);
  const cells = cellsInBubble({ lat: 0, lon: 179.999 }, 1200, WORLD.cellZoom);
  assert.ok(cells.some(({ x }) => x === 0));
  assert.ok(cells.every((cell) => cell.z === 15 && parentTile(cell).z === 14));
  assert.deepEqual(nearFieldRequest('?world=procedural&worldLite=1&stylePack=plain'), { mode: 'world', pack: 'plain', lite: true, debug: false });
});

test('PNG encoder writes valid chunks and round-trips RGB scanlines', async () => {
  const rgb = Uint8Array.of(240, 12, 8, 15, 0, 250, 0, 150, 3, 255, 128, 0);
  const png = await encodeRgbPng(2, 2, rgb);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer);
  const chunks = {};
  for (let i = 8; i < png.length;) {
    const length = view.getUint32(i);
    const type = new TextDecoder().decode(png.subarray(i + 4, i + 8));
    assert.equal(view.getUint32(i + length + 8), pngCrc(png.subarray(i + 4, i + length + 8)));
    chunks[type] = png.subarray(i + 8, i + 8 + length);
    i += length + 12;
  }
  assert.deepEqual(Object.keys(chunks), ['IHDR', 'IDAT', 'IEND']);
  assert.deepEqual([...chunks.IHDR], [0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0]);
  const filtered = inflateSync(chunks.IDAT);
  for (let row = 0; row < 2; row++) {
    assert.equal(filtered[row * 7], 1);
    const current = filtered.subarray(row * 7 + 1, row * 7 + 7);
    for (let i = 3; i < current.length; i++) current[i] += current[i - 3];
    assert.deepEqual([...current], [...rgb.subarray(row * 6, row * 6 + 6)]);
  }
});

const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

test('ground paint respects land use, roads, shoreline distance and contact shade', async () => {
  const fixture = {
    side: 100, centre: { lat: 0, lon: 0 }, box: [-50, -50, 50, 50],
    areas: [
      { k: 'wood', p: box(-48, -46, -20, -19) },
      { k: 'farmland', p: box(-40, 15, 0, 48) },
      { k: 'commercial', p: box(-15, 0, 16, 15) },
      { k: 'sand', p: box(-12, -48, 10, -22) },
    ],
    roads: [
      { t: 'primary', p: [[-48, -8], [48, -8]] },
      { t: 'rail', p: [[-48, -16], [48, -16]] },
      { t: 'pedestrian', p: [[-48, 3], [-18, 3]] },
      { t: 'footway', p: [[-48, 38], [-35, 38]] },
    ],
    waterPolygons: [{ rings: [box(20, 0, 95, 70)] }],
    contacts: [[box(2, 20, 10, 32)]],
  };
  const palette = Object.fromEntries(Object.entries(wintercats.ground).map(([k, [colour]]) => [k, [colour, 0]]));
  const pixels = paintGround(fixture, 100, palette);
  const at = (x, y) => [...pixels.subarray(((49 - y) * 100 + 50 + x) * 3, ((49 - y) * 100 + 50 + x) * 3 + 3)];
  const colour = (name) => rgb(palette[name][0]).map((c) => Math.round(c * 255));
  for (const [x, y, name] of [
    [-30, -35, 'wood'], [-25, 35, 'farmland'], [0, 9, 'commercial'], [0, -31, 'sand'],
    [0, -8, 'road'], [-34, -16, 'rail'], [-34, 3, 'paving'], [-43, 38, 'path'], [45, 35, 'water'],
  ]) assert.deepEqual(at(x, y), colour(name), name);
  assert.ok(at(21, 30)[1] > at(45, 30)[1]);
  assert.ok(at(6, 19)[1] < colour('meadow')[1]);
  const mesh = await buildWorldGround(fixture, null, palette, 32);
  const gltf = readGlbJson(writeGlb({ ground: mesh }));
  assert.equal(gltf.images[0].mimeType, 'image/png');
  assert.equal(gltf.samplers[0].minFilter, 9987);
  assert.ok(gltf.meshes[0].primitives[0].attributes.TEXCOORD_0 >= 0);
  assert.ok(mesh.p.some((z, i) => i % 3 === 2 && z < -7)); // skirts
});

test('style packs validate, preserve defaults, and hash differently', async () => {
  const valid = validateStylePack(wintercats);
  assert.deepEqual(valid.problems, []);
  const plain = validateStylePack(await getPack('plain'), valid.pack);
  assert.deepEqual(plain.problems, []);
  assert.notEqual(stylePackHash(plain.pack), stylePackHash(valid.pack));
  assert.equal(plain.pack.ground.sand, valid.pack.ground.sand);
  const invalid = validateStylePack({
    extra: 1,
    ground: { meadow: ['#xyz', 2], unknown: ['#ffffff', 0] },
    trees: { species: [{ ...wintercats.trees.species[0], radius: [7, 1], surprise: true }] },
    light: { minEl: 60, maxEl: 20 },
  }, valid.pack);
  assert.deepEqual(invalid.problems.sort(), [
    'bad ground.meadow', 'bad light elevation range', 'bad trees.species.0.radius',
    'unknown extra', 'unknown ground.unknown', 'unknown trees.species.0.surprise',
  ].sort());
  assert.deepEqual(invalid.pack.ground.meadow, valid.pack.ground.meadow);
  assert.equal(invalid.pack.light.minEl, valid.pack.light.minEl);
});

test('all canopy shapes and variants are closed and fit the phone prototype budget', () => {
  for (const species of wintercats.trees.species) {
    const a = canopyPrototype(species, 0);
    const b = canopyPrototype(species, 1);
    assert.notDeepEqual(a.p, b.p, species.shape);
    for (const { p, indices, triangles } of [a, b]) {
      const edges = new Map();
      for (let i = 0; i < indices.length; i += 3) {
        for (let j = 0; j < 3; j++) {
          const lo = indices[i + j], hi = indices[i + (j + 1) % 3];
          assert.notEqual(lo, hi);
          assert.ok(lo < p.length / 3 && hi < p.length / 3);
          const key = lo < hi ? `${lo},${hi}` : `${hi},${lo}`;
          const [count, balance] = edges.get(key) ?? [0, 0];
          edges.set(key, [count + 1, balance + Math.sign(hi - lo)]);
        }
      }
      assert.ok([...edges.values()].every(([count, balance]) => count === 2 && balance === 0));
      assert.ok(triangles <= 300 && triangles > 100);
      for (let i = 0; i < p.length; i += 3) {
        assert.ok(Math.hypot(p[i], p[i + 1]) <= 1.22);
        assert.ok(p[i + 2] > 0 && p[i + 2] <= 1 + 2 * species.squash);
      }
    }
  }
});
