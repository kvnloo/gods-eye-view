import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { createCesiumSunShadows } from './sunShadows.js';

function sceneDouble() {
  return {
    globe: { shadows: Cesium.ShadowMode.DISABLED },
    shadowMap: {
      enabled: false,
      softShadows: false,
      darkness: 0.3,
      maximumDistance: 5000,
    },
  };
}

const ON = { cast: true, darkness: 0.4, softEdges: true };

test('the sun casts on the globe, soft and as dark as asked, and the scene settings come back', () => {
  const scene = sceneDouble();
  const asked = [];
  const sun = createCesiumSunShadows(scene, {
    requestRender: (reason) => asked.push(reason),
  });
  assert.equal(sun.set(ON), true);
  assert.equal(scene.shadowMap.enabled, true);
  assert.equal(scene.shadowMap.softShadows, true);
  assert.equal(scene.shadowMap.darkness, 0.4);
  assert.equal(scene.globe.shadows, Cesium.ShadowMode.RECEIVE_ONLY);
  assert.equal(sun.draws(), true);
  assert.equal(sun.set(ON), false, 'the same settings change nothing');
  assert.deepEqual(asked, ['sun-shadows']);
  assert.equal(sun.set(null), true);
  assert.deepEqual(
    [
      scene.shadowMap.enabled,
      scene.shadowMap.softShadows,
      scene.shadowMap.darkness,
      scene.shadowMap.maximumDistance,
      scene.globe.shadows,
    ],
    [false, false, 0.3, 5000, Cesium.ShadowMode.DISABLED],
  );
  assert.equal(sun.draws(), false);
  assert.equal(sun.set(null), false);
});

test('with the sun down the map stays as the scene had it; a map the scene drew stays on', () => {
  const scene = sceneDouble();
  const sun = createCesiumSunShadows(scene, { requestRender() {} });
  sun.set({ ...ON, cast: false });
  assert.equal(scene.shadowMap.enabled, false);
  sun.set(null);
  scene.shadowMap.enabled = true;
  sun.set({ ...ON, cast: false });
  assert.equal(scene.shadowMap.enabled, true);
  sun.dispose();
  assert.equal(scene.shadowMap.enabled, true);
});

test('the map ends where asked, never beyond the scene’s own end, and comes back', () => {
  const scene = sceneDouble();
  const sun = createCesiumSunShadows(scene, { requestRender() {} });
  sun.set({ ...ON, maxDistanceM: 1400 });
  assert.equal(scene.shadowMap.maximumDistance, 1400);
  sun.set({ ...ON, maxDistanceM: 9000 });
  assert.equal(scene.shadowMap.maximumDistance, 5000);
  sun.set(ON);
  assert.equal(scene.shadowMap.maximumDistance, 5000);
  sun.dispose();
  assert.equal(scene.shadowMap.maximumDistance, 5000);
  assert.equal(scene.shadowMap.darkness, 0.3, 'restored');
});
