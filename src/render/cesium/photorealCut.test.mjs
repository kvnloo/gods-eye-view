import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { createCesiumPhotorealCut } from './photorealCut.js';

// A photoreal tileset as the cut sees it: a Cesium3DTileset that can be cut.
function tileset() {
  return Object.assign(Object.create(Cesium.Cesium3DTileset.prototype), {
    show: true,
    shadows: Cesium.ShadowMode.ENABLED,
    backFaceCulling: true,
    _tilesLoaded: true,
    isDestroyed: () => false,
  });
}

const ring = [
  { lon: -122.4105, lat: 37.8004 },
  { lon: -122.4101, lat: 37.8004 },
  { lon: -122.4101, lat: 37.8008 },
  { lon: -122.4105, lat: 37.8008 },
];

function cutter(tiles) {
  const asked = [];
  const scene = { context: { webgl2: true } };
  const cut = createCesiumPhotorealCut(scene, {
    tilesets: () => tiles,
    requestRender: (reason) => asked.push(reason),
  });
  return { cut, asked };
}

test('a ring is cut out of each shown tileset, which draws its inside and takes shadows only, until released', () => {
  const tiles = tileset();
  const { cut, asked } = cutter([tiles]);
  const release = cut(ring);
  assert.equal(typeof release, 'function');
  assert.equal(tiles.clippingPolygons.length, 1);
  tiles.clippingPolygons.get(0).positions.forEach((p, i) => {
    const c = Cesium.Cartographic.fromCartesian(p);
    assert.ok(Math.abs(Cesium.Math.toDegrees(c.longitude) - ring[i].lon) < 1e-9);
    assert.ok(Math.abs(Cesium.Math.toDegrees(c.latitude) - ring[i].lat) < 1e-9);
  });
  // The mesh is a hollow shell: sliced by the cut, its inside is drawn.
  assert.equal(tiles.backFaceCulling, false);
  assert.equal(tiles.shadows, Cesium.ShadowMode.RECEIVE_ONLY);
  assert.deepEqual(asked, ['photoreal-cut']);
  release();
  release();
  assert.equal(tiles.clippingPolygons, undefined, 'our collection is gone');
  assert.equal(tiles.shadows, Cesium.ShadowMode.ENABLED);
  assert.equal(tiles.backFaceCulling, true, 'restored');
  assert.deepEqual(asked, ['photoreal-cut', 'photoreal-cut']);
});

test('an existing cut stays: ours joins it and leaves again', () => {
  const tiles = tileset();
  const theirs = new Cesium.ClippingPolygonCollection({
    polygons: [
      new Cesium.ClippingPolygon({
        positions: Cesium.Cartesian3.fromDegreesArray([0, 0, 1, 0, 0, 1]),
      }),
    ],
  });
  tiles.clippingPolygons = theirs;
  const { cut } = cutter([tiles]);
  const release = cut(ring);
  assert.equal(tiles.clippingPolygons, theirs);
  assert.equal(theirs.length, 2);
  release();
  assert.equal(tiles.clippingPolygons, theirs);
  assert.equal(theirs.length, 1);
});

test('two cuts on one tileset: the last release puts back what the first found', () => {
  const tiles = tileset();
  const { cut } = cutter([tiles]);
  const a = cut(ring);
  const b = cut(ring);
  assert.equal(tiles.clippingPolygons.length, 2);
  a();
  assert.equal(tiles.clippingPolygons.length, 1);
  assert.equal(tiles.shadows, Cesium.ShadowMode.RECEIVE_ONLY, 'still cut');
  b();
  assert.equal(tiles.clippingPolygons, undefined);
  assert.equal(tiles.shadows, Cesium.ShadowMode.ENABLED);
});

test('nothing is cut without shown tiles or with fewer than three corners', () => {
  const hidden = Object.assign(tileset(), { show: false });
  assert.equal(cutter([]).cut(ring), null);
  assert.equal(cutter([hidden]).cut(ring), null);
  assert.equal(hidden.clippingPolygons, undefined);
  assert.equal(cutter([tileset()]).cut(ring.slice(0, 2)), null);
});
