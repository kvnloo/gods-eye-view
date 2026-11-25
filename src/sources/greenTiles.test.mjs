import test from 'node:test';
import assert from 'node:assert/strict';
import { PbfWriter } from 'pbf';
import {
  GREEN_TILE_ZOOM,
  createGreenTileSource,
  decodeGreenTile,
  tileOf,
  tilesFor,
} from './greenTiles.js';

// A minimal Mapbox Vector Tile writer: just enough of the spec (layers,
// features, string values, MoveTo/LineTo/ClosePath geometry) to hand the
// decoder real bytes.
const zigzag = (n) => (n << 1) ^ (n >> 31);
const command = (id, count) => (id & 0x7) | (count << 3);
function geometry(paths, closed) {
  const out = [];
  let x = 0;
  let y = 0;
  for (const path of paths) {
    const points = closed ? path.slice(0, -1) : path;
    out.push(command(1, 1), zigzag(points[0][0] - x), zigzag(points[0][1] - y));
    [x, y] = points[0];
    out.push(command(2, points.length - 1));
    for (const [px, py] of points.slice(1)) {
      out.push(zigzag(px - x), zigzag(py - y));
      [x, y] = [px, py];
    }
    if (closed) out.push(command(7, 1));
  }
  return out;
}
function encodeTile(layers, extent = 4096) {
  const pbf = new PbfWriter();
  for (const { name, features } of layers) {
    pbf.writeMessage(
      3,
      (layer, w) => {
        const keys = [];
        const values = [];
        const index = (list, v) => {
          const at = list.indexOf(v);
          return at >= 0 ? at : list.push(v) - 1;
        };
        w.writeVarintField(15, 2);
        w.writeStringField(1, name);
        for (const f of layer) {
          w.writeMessage(
            2,
            (feature, fw) => {
              const tags = [];
              for (const [k, v] of Object.entries(feature.properties))
                tags.push(index(keys, k), index(values, String(v)));
              fw.writePackedVarint(2, tags);
              fw.writeVarintField(3, feature.type);
              fw.writePackedVarint(
                4,
                geometry(feature.paths, feature.type === 3),
              );
            },
            f,
          );
        }
        for (const k of keys) w.writeStringField(3, k);
        for (const v of values)
          w.writeMessage(4, (s, vw) => vw.writeStringField(1, s), v);
        w.writeVarintField(5, extent);
      },
      features,
    );
  }
  return pbf.finish();
}

const square = [
  [0, 0],
  [2048, 0],
  [2048, 2048],
  [0, 2048],
  [0, 0],
];

test('tileOf and tilesFor: the z14 tile of a point, a box of tiles, and the cap', () => {
  assert.equal(GREEN_TILE_ZOOM, 14);
  // Null Island sits on the corner of four tiles: the one south-east of it.
  assert.deepEqual(tileOf(0, 0), { z: 14, x: 8192, y: 8192 });
  assert.deepEqual(tileOf(85, -180, 1), { z: 1, x: 0, y: 0 });
  const box = tilesFor([-0.01, -0.01, 0.01, 0.01]);
  assert.equal(box.length, 4);
  assert.deepEqual(
    box.map(({ x, y }) => `${x}/${y}`),
    ['8191/8191', '8191/8192', '8192/8191', '8192/8192'],
  );
  assert.throws(() => tilesFor([-1, -1, 1, 1]), RangeError);
});

test('decodeGreenTile keeps buildings with heights, parks, green cover, open land and walkable ways', () => {
  const tile = { z: 1, x: 1, y: 0 };
  const bytes = encodeTile([
    {
      name: 'building',
      features: [
        {
          type: 3,
          properties: { render_height: 12, render_min_height: 3 },
          paths: [square],
        },
        { type: 3, properties: {}, paths: [square] },
      ],
    },
    {
      name: 'park',
      features: [{ type: 3, properties: { name: 'Green' }, paths: [square] }],
    },
    {
      name: 'landcover',
      features: [
        { type: 3, properties: { class: 'grass' }, paths: [square] },
        { type: 3, properties: { class: 'rock' }, paths: [square] },
      ],
    },
    {
      name: 'landuse',
      features: [
        { type: 3, properties: { class: 'brownfield' }, paths: [square] },
        { type: 3, properties: { class: 'residential' }, paths: [square] },
      ],
    },
    {
      name: 'transportation',
      features: [
        {
          type: 2,
          properties: { class: 'minor' },
          paths: [
            [
              [0, 0],
              [4096, 4096],
            ],
          ],
        },
        {
          type: 2,
          properties: { class: 'path', subclass: 'cycleway' },
          paths: [
            [
              [0, 0],
              [10, 10],
            ],
          ],
        },
        {
          type: 2,
          properties: { class: 'motorway' },
          paths: [
            [
              [0, 0],
              [10, 10],
            ],
          ],
        },
      ],
    },
  ]);
  const out = decodeGreenTile(bytes, tile);
  assert.equal(out.buildings.length, 2);
  assert.equal(out.buildings[0].heightM, 12);
  assert.equal(out.buildings[0].minHeightM, 3);
  assert.equal(
    out.buildings[1].heightM,
    null,
    'no mapped height is unknown, not zero',
  );
  // Tile 1/1/0 is the north-east quarter of the world: its top-left corner is
  // 0° E on the Mercator limit, its middle 90° E.
  assert.deepEqual(out.buildings[0].ring[0], [0, 85.0511288]);
  assert.deepEqual(out.buildings[0].ring[1], [90, 85.0511288]);
  assert.deepEqual(
    out.parks.map((p) => p.name),
    ['Green'],
  );
  assert.deepEqual(
    out.cover.map((c) => c.class),
    ['grass'],
  );
  assert.deepEqual(
    out.open.map((o) => o.class),
    ['brownfield'],
  );
  assert.deepEqual(
    out.ways.map((w) => w.class),
    ['minor'],
    'no cycleway, no motorway',
  );
  assert.deepEqual(out.ways[0].line.at(-1), [180, 0]);
});

test('createGreenTileSource reads the tile template once, caches tiles and merges a box', async () => {
  const calls = [];
  const bytes = encodeTile([
    {
      name: 'park',
      features: [{ type: 3, properties: { name: 'P' }, paths: [square] }],
    },
  ]);
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === 'https://tiles.openfreemap.org/planet')
      return {
        ok: true,
        json: async () => ({ tiles: ['https://t.example/{z}/{x}/{y}.pbf'] }),
      };
    return {
      ok: true,
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
    };
  };
  const source = createGreenTileSource({ fetchImpl });
  const box = [-0.01, -0.01, 0.01, 0.01];
  const first = await source.around(box);
  assert.equal(first.parks.length, 4, 'one park from each of four tiles');
  assert.equal(calls.length, 5, 'the tile template once, then four tiles');
  assert.ok(calls.includes('https://t.example/14/8192/8192.pbf'));
  await source.around(box);
  assert.equal(calls.length, 5, 'a second read is served from the cache');
});

test('createGreenTileSource reports a failed request and asks again on the next read', async () => {
  let up = false;
  const bytes = encodeTile([]);
  const source = createGreenTileSource({
    fetchImpl: async (url) => {
      if (!up) return { ok: false, status: 503 };
      if (url.endsWith('/planet'))
        return {
          ok: true,
          json: async () => ({ tiles: ['https://t.example/{z}/{x}/{y}.pbf'] }),
        };
      return { ok: true, arrayBuffer: async () => bytes };
    },
  });
  await assert.rejects(source.around([0, 0, 0.001, 0.001]), /HTTP 503/);
  up = true;
  const next = await source.around([0, 0, 0.001, 0.001]);
  assert.deepEqual(next.parks, []);
});
