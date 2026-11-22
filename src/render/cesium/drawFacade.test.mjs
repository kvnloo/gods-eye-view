import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { FACADE_TYPE, facadeMaterial, facadeUniforms } from './drawFacade.js';

const look = {
  shopfront: { sill: 0.1, head: 0.72, share: 0.8 },
  floor: { sill: 0.26, head: 0.8, share: 0.56 },
  fascia: { bottom: 0.76, top: 0.92 },
  colors: {
    body: '#d8d4cb',
    frame: '#26343a',
    glass: '#1b2a33',
    blind: '#c9c4b8',
    fascia: '#c9924b',
    coping: '#eceae4',
    roof: '#9a9fa3',
    paving: '#989690',
    glow: '#cfeef6',
  },
};
const wall = (normal) => ({
  normal,
  offsetM: 16,
  lengthM: 32,
  middleM: 0,
  bays: 10,
});
const facade = {
  origin: { lon: -122.4103, lat: 37.8006, height: -8.25 },
  storeys: 6,
  storeyHeightM: 3.2,
  heightM: 19.2,
  parapetM: 0.576,
  walls: [wall([0, 1]), wall([1, 0]), wall([0, -1]), wall([-1, 0])],
  look,
};
const within = (a, b, tolerance, label) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${label}: ${a} != ${b}`);

// Cesium registers a material type when it first asks for it (in a browser);
// here the image types its uniform check names stand in.
for (const name of [
  'HTMLCanvasElement',
  'HTMLImageElement',
  'ImageBitmap',
  'OffscreenCanvas',
])
  globalThis[name] ??= class {};

test('a facade fill is an opaque material of its look, its uniforms the fill’s numbers', () => {
  const material = facadeMaterial(facade);
  assert.equal(material.type, FACADE_TYPE);
  assert.equal(material.isTranslucent(), false, 'the body is opaque');
  const u = material.uniforms;
  assert.deepEqual(
    [u.gevLevels.x, u.gevLevels.y, u.gevLevels.z, u.gevLevels.w],
    [6, 3.2, 19.2, 0.576],
  );
  const origin = Cesium.Cartographic.fromCartesian(
    Cesium.Cartesian3.add(u.gevOriginHigh, u.gevOriginLow, new Cesium.Cartesian3()),
  );
  within(origin.height, -8.25, 1e-3, 'origin on the ground');
  within(Cesium.Math.toDegrees(origin.latitude), 37.8006, 1e-6, 'lat');
  for (const w of [u.gevWall0, u.gevWall1, u.gevWall2, u.gevWall3]) {
    within(Math.hypot(w.x, w.y), 1, 1e-9, 'unit normal');
    within(w.z, 16, 1e-9, 'offset');
    within(w.w, 16, 1e-9, 'half of 32 m');
  }
  assert.deepEqual([u.gevBays.x, u.gevBays.y, u.gevBays.z, u.gevBays.w], [10, 10, 10, 10]);
  material.destroy();
});

test('one material type per look; the same look shares it', () => {
  const a = facadeMaterial(facade);
  const b = facadeMaterial({ ...facade, storeys: 5, heightM: 16 });
  const c = facadeMaterial({
    ...facade,
    look: { ...look, colors: { ...look.colors, body: '#ffffff' } },
  });
  assert.equal(b.type, a.type);
  assert.notEqual(c.type, a.type);
  assert.equal(b.uniforms.gevLevels.x, 5);
  for (const m of [a, b, c]) m.destroy();
});

test('a facade with fewer than four walls repeats its last; none is refused', () => {
  const u = facadeUniforms({ ...facade, walls: facade.walls.slice(0, 2) });
  assert.deepEqual(
    [u.gevWall2.x, u.gevWall2.y, u.gevWall3.x, u.gevWall3.y],
    [1, 0, 1, 0],
  );
  assert.throws(() => facadeUniforms({ ...facade, walls: [] }), TypeError);
});
