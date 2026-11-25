import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ATLAS_N,
  TILE_PX,
  buildingId,
  geodeticToEnu,
  lonLatToTileXY,
  localToAtlasUv,
  localToTile,
  maskGeo,
  maskLevel,
  maskWindow,
  metresPerTexel,
  tileXYToLonLat,
  windowStale,
} from './maskMath.js';
import {
  dataTilesFor,
  decodeTexel,
  distanceTransform,
  fillPolygon,
  rasteriseMaskTile,
  strokeLine,
} from './raster.js';
import { createMaskGenerator } from './maskJob.js';

test('mercator round trip and tile window', () => {
  for (const [lat, lon] of [
    [37.8555, -122.489],
    [48.853, 2.287],
    [35.684, 139.69],
    [-33.86, 151.21],
  ]) {
    const p = lonLatToTileXY(lon, lat, 16);
    const q = tileXYToLonLat(p.x, p.y, 16);
    assert.ok(Math.abs(q.lat - lat) < 1e-9 && Math.abs(q.lon - lon) < 1e-9);
    const win = maskWindow(lat, lon, 16);
    assert.equal(win.tiles.length, ATLAS_N * ATLAS_N);
    // the anchor is the window's centre corner and the focus tile comes first
    const a = lonLatToTileXY(win.anchor.lon, win.anchor.lat, 16);
    assert.ok(Math.abs(a.x - win.cx) < 1e-6 && Math.abs(a.y - win.cy) < 1e-6);
    assert.ok(Math.abs(win.tiles[0].x + 0.5 - p.x) <= 1.5 && Math.abs(win.tiles[0].y + 0.5 - p.y) <= 1.5);
    assert.equal(windowStale(win, lat, lon, 16), false);
    assert.equal(windowStale(win, lat, lon, 15), true);
  }
  assert.deepEqual(maskLevel(400), { z: 16, fade: 1, global: false });
  assert.equal(maskLevel(3000).z, 15);
  assert.equal(maskLevel(10000).z, 14);
  assert.equal(maskLevel(10000).global, false);
  // globe scale: a water-only mask in world-position mapping
  assert.deepEqual(maskLevel(1e6), { z: 5, fade: 1, global: true });
  assert.equal(maskLevel(1.4e7).z, 3);
});

test('local ENU -> tile uv (the GLSL map) is within 0.25 m of exact WGS84 -> mercator over +-3 km', () => {
  for (const [lat0, lon0, z] of [
    [37.85, -122.48, 16],
    [48.85, 2.29, 16],
    [35.68, 139.7, 16],
    [64.1, -21.9, 16],
    [-33.9, 151.2, 15],
  ]) {
    const geo = maskGeo(lat0, z);
    const a = lonLatToTileXY(lon0, lat0, z);
    const mpt = metresPerTexel(lat0, z) * TILE_PX; // metres per tile
    let worst = 0;
    for (const de of [-3000, -1500, 0, 1700, 3000])
      for (const dn of [-3000, -800, 0, 1200, 3000]) {
        // a point on the ground: its exact ENU at the anchor, then the map
        const lat = lat0 + dn / 111000;
        const lon = lon0 + de / (111000 * Math.cos((lat0 * Math.PI) / 180));
        const [e, n] = geodeticToEnu(lat, lon, 30, lat0, lon0);
        const [X, Y] = localToTile(e, n, geo);
        const p = lonLatToTileXY(lon, lat, z);
        const err = Math.hypot(X - (p.x - a.x), Y - (p.y - a.y)) * mpt;
        worst = Math.max(worst, err);
      }
    assert.ok(worst < 0.1, `lat ${lat0}: worst ${worst.toFixed(3)} m`);
  }
  // atlas uv: the anchor is the centre, east is +u, north is -v
  const geo = maskGeo(37.85, 16);
  assert.deepEqual(localToAtlasUv(0, 0, geo), [0.5, 0.5]);
  const [u, v] = localToAtlasUv(100, 100, geo);
  assert.ok(u > 0.5 && v < 0.5);
});

test('polygon fill: even-odd with holes, texel-centre sampling', () => {
  const w = 10;
  const out = new Uint8Array(w * w);
  const outer = [
    [1, 1],
    [9, 1],
    [9, 9],
    [1, 9],
  ];
  const hole = [
    [4, 4],
    [6, 4],
    [6, 6],
    [4, 6],
  ];
  fillPolygon(out, w, w, [outer, hole], 7);
  let n = 0;
  for (const x of out) if (x === 7) n++;
  assert.equal(n, 64 - 4);
  assert.equal(out[0], 0);
  assert.equal(out[1 * w + 1], 7);
  assert.equal(out[4 * w + 4], 0);
  assert.equal(out[8 * w + 8], 7);
  assert.equal(out[9 * w + 9], 0);
});

test('line stroke width and distance transform', () => {
  const w = 20;
  const out = new Uint8Array(w * w);
  strokeLine(out, w, w, [
    [2, 10],
    [18, 10],
  ], 1.5, 1);
  assert.equal(out[10 * w + 10], 1);
  assert.equal(out[9 * w + 10], 1);
  assert.equal(out[12 * w + 10], 0);
  const d = distanceTransform(w, w, (i) => i === 0);
  assert.equal(d[0], 0);
  assert.ok(Math.abs(d[3 * w + 4] - 5) < 1e-9);
});

// a synthetic decoded data tile (OpenMapTiles layout, tile pixels, extent 4096)
function fakeData(tile) {
  const sq = (x0, y0, x1, y1) => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  return {
    tile,
    extent: 4096,
    // east half water
    water: [{ rings: [sq(2048, -64, 4160, 4160)], k: 'ocean' }],
    cover: [
      { rings: [sq(0, 0, 1024, 1024)], k: 'park' },
      { rings: [sq(0, 3072, 1024, 4096)], k: 'wood' },
    ],
    roads: [{ t: 'residential', p: [[0, 2048], [2048, 2048]] }],
    buildings: [
      { rings: [sq(1300, 1300, 1500, 1500)], h: 10, min: 0, hide: false },
      { rings: [sq(1600, 1300, 1800, 1500)], h: 10, min: 0, hide: false },
    ],
    piers: [],
    // a pier line out over the water
    pierLines: [[[2048, 3584], [4000, 3584]]],
  };
}

test('mask tile raster: classes, shore distance, building ids', () => {
  const tile = { z: 14, x: 2620, y: 6330 };
  const data = fakeData({ z: 14, x: 2620, y: 6330 });
  const { rgba, mpp } = rasteriseMaskTile(tile, [data]);
  assert.equal(rgba.length, TILE_PX * TILE_PX * 4);
  const at = (i, j) => {
    const o = (j * TILE_PX + i) * 4;
    return decodeTexel(rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]);
  };
  // park NW, wood SW, water E, road along the middle row (west half), buildings
  assert.ok(at(20, 20).grass && !at(20, 20).water && at(20, 20).valid);
  assert.ok(at(20, 240).forest);
  assert.ok(at(200, 100).water && at(200, 100).shoreM > 30);
  assert.ok(at(60, 128).road);
  // the pier over the water is a surface (id 1), not open water for the shader
  assert.ok(at(200, 224).road && at(200, 224).water);
  const b1 = at(87, 87).building;
  const b2 = at(106, 87).building;
  assert.ok(b1 >= 2 && b2 >= 2);
  // A: metres from the footprint edge inside a building (eave lines), 0 outside
  assert.equal(at(70, 87).edgeM, 0);
  assert.ok(at(81, 87).edgeM > 0 && at(81, 87).edgeM < at(82, 87).edgeM, `${at(81, 87).edgeM} ${at(82, 87).edgeM}`);
  assert.ok(Math.abs(at(81, 87).edgeM - 0.5 * mpp) < 0.1, `${at(81, 87).edgeM} vs ${0.5 * mpp}`);
  // shore distance grows away from the shore line (x = 128 texels), in metres
  const s1 = at(130, 100).shoreM;
  const s2 = at(133, 100).shoreM;
  assert.ok(s1 > 0 && s1 < 3 * mpp, `s1 ${s1}`);
  assert.ok(Math.abs(s2 - s1 - 3 * mpp) < 1, `s2-s1 ${s2 - s1}`);
  assert.ok(at(120, 100).shoreM < 0);
  // the building id comes from the footprint centroid: same id when cut from another mask tile
  const sub = rasteriseMaskTile({ z: 16, x: 2620 * 4 + 1, y: 6330 * 4 + 1 }, [data]);
  const o = (100 * TILE_PX + 92) * 4; // inside building 1 (z14 texel ~87 -> z16 texel)
  assert.equal(sub.rgba[o + 2] >= 2, true);
  assert.equal(sub.rgba[o + 2], b1);
  assert.equal(buildingId(-122.48, 37.85), buildingId(-122.48, 37.85));
});

test('mask tiles near a z14 edge also read the neighbour data tile', () => {
  const ts = dataTilesFor({ z: 16, x: 4 * 100, y: 4 * 200 + 1 });
  assert.deepEqual(
    ts.map((t) => `${t.x}/${t.y}`).sort(),
    ['100/200', '99/200'].sort(),
  );
  assert.equal(dataTilesFor({ z: 16, x: 4 * 100 + 1, y: 4 * 200 + 1 }).length, 1);
  // below z14 the data tile is the mask tile itself (plus neighbours for the pad)
  const low = dataTilesFor({ z: 5, x: 5, y: 12 });
  assert.ok(low.every((t) => t.z === 5) && low.some((t) => t.x === 5 && t.y === 12));
});

test('low-zoom mask tiles carry water only', () => {
  const tile = { z: 5, x: 5, y: 12 };
  const data = { ...fakeData({ z: 5, x: 5, y: 12 }) };
  const { rgba } = rasteriseMaskTile(tile, [data]);
  const at = (i, j) => {
    const o = (j * TILE_PX + i) * 4;
    return decodeTexel(rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]);
  };
  assert.ok(at(200, 100).water);
  assert.ok(!at(20, 20).grass && !at(60, 128).road && !at(87, 87).building);
});

test('mask generator fetches each data tile once and rasterises from a stub', async () => {
  let fetches = 0;
  const fetchImpl = async (url) => {
    fetches++;
    if (url.endsWith('/planet'))
      return { ok: true, status: 200, json: async () => ({ tiles: ['https://x/{z}/{x}/{y}.pbf'] }) };
    return { ok: false, status: 404 };
  };
  const gen = createMaskGenerator({ fetchImpl, tileJsonUrl: 'https://x/planet' });
  const a = await gen.maskTile({ z: 16, x: 401, y: 801 });
  const b = await gen.maskTile({ z: 16, x: 402, y: 801 });
  assert.equal(a.rgba[3], 1); // loaded, no building
  assert.equal(a.rgba[0] < 128, true); // no water
  assert.equal(b.features, 0);
  assert.equal(fetches, 2); // tilejson + one data tile (cached for the second mask tile)
  assert.equal(gen.stats.emptyTiles, 1);
});
