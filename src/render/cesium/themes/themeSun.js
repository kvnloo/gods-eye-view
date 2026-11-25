/**
 * @module render/cesium/themes/themeSun
 * @description FORK-ONLY (exp/app-dreamloop). A preset's own sun.
 *
 * The app drives Cesium's clock from wall time, so a theme looked at in the
 * evening (or by a harness at night in the viewed city) was lit by a sun
 * below the horizon: the tile stage fell back to a flat high key and the
 * shadow map reported itself out of view, so no cast shadows ever showed.
 * A preset may now carry
 *
 *   sun: { minEl: 18, maxEl: 38, shadows: true, darkness: 0.55, softShadows: true,
 *          size: 4096, maxDistance: 5000, color: [1, 0.92, 0.8], intensity: 2 }
 *
 * The sun keeps the real azimuth at the scene time (or a time set with
 * setTime, e.g. a capture's own time) and its elevation is clamped to
 * [minEl, maxEl] degrees at the camera, so every hour reads as a warm,
 * low, shadow-casting sun. It is a Cesium DirectionalLight: the tile stage
 * (czm_lightDirectionEC), PBR models and the shadow map all follow it.
 * Removing the preset's sun puts the scene's light and shadow settings back.
 */

import {
  shadowPrimitiveDepthBias,
  setShadowPrimitiveDepthBias,
} from '../internals.js';

const D2R = Math.PI / 180;

/** Unit vector from the earth toward the sun in fixed (ECEF) axes at `julian`. */
export function sunDirectionWC(Cesium, julian, result) {
  const m =
    Cesium.Transforms.computeIcrfToFixedMatrix(julian) ??
    Cesium.Transforms.computeTemeToPseudoFixedMatrix(julian);
  const p =
    Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
      julian,
    );
  Cesium.Matrix3.multiplyByVector(m, p, result);
  return Cesium.Cartesian3.normalize(result, result);
}

/**
 * `toSun` with its elevation over the local horizon (normal `up`) clamped to
 * [minEl, maxEl] degrees, azimuth kept. Pure math on {x,y,z}; returns a new
 * unit vector and the elevations before/after (degrees).
 */
export function clampElevation(toSun, up, minEl, maxEl) {
  const d = toSun.x * up.x + toSun.y * up.y + toSun.z * up.z;
  let hx = toSun.x - up.x * d;
  let hy = toSun.y - up.y * d;
  let hz = toSun.z - up.z * d;
  let hl = Math.hypot(hx, hy, hz);
  if (hl < 1e-6) {
    // sun at the zenith/nadir: any horizontal direction will do
    const ax = Math.abs(up.z) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    hx = ax[1] * up.z - ax[2] * up.y;
    hy = ax[2] * up.x - ax[0] * up.z;
    hz = ax[0] * up.y - ax[1] * up.x;
    hl = Math.hypot(hx, hy, hz);
  }
  const el0 = Math.asin(Math.max(-1, Math.min(1, d))) / D2R;
  const el = Math.max(minEl, Math.min(maxEl, el0));
  const c = Math.cos(el * D2R) / hl;
  const s = Math.sin(el * D2R);
  return {
    x: hx * c + up.x * s,
    y: hy * c + up.y * s,
    z: hz * c + up.z * s,
    el0,
    el,
  };
}

export function createThemeSun(Cesium, viewer) {
  const scene = viewer.scene;
  let spec = null;
  let prior = null;
  let fixedTime = null;
  let light = null;
  const toSun = new Cesium.Cartesian3();
  const up = new Cesium.Cartesian3();
  const state = { el0: null, el: null, active: false };

  function restore() {
    if (!prior) return;
    scene.light = prior.light;
    viewer.shadows = prior.shadows;
    const sm = scene.shadowMap;
    if (sm) {
      sm.darkness = prior.darkness;
      sm.softShadows = prior.softShadows;
      sm.maximumDistance = prior.maximumDistance;
      if (prior.size && sm.size !== prior.size) sm.size = prior.size;
      if (prior.depthBias !== undefined) setShadowPrimitiveDepthBias(sm, prior.depthBias);
    }
    prior = null;
    light = null;
    state.active = false;
  }

  function set(next) {
    if (!next || typeof next !== 'object') {
      spec = null;
      restore();
      scene.requestRender?.();
      return;
    }
    spec = {
      minEl: Number.isFinite(next.minEl) ? next.minEl : 15,
      maxEl: Number.isFinite(next.maxEl) ? next.maxEl : 40,
      shadows: next.shadows !== false,
      darkness: Number.isFinite(next.darkness) ? next.darkness : 0.55,
      softShadows: next.softShadows !== false,
      size: Number.isFinite(next.size) ? next.size : 4096,
      maxDistance: Number.isFinite(next.maxDistance) ? next.maxDistance : 5000,
      color: Array.isArray(next.color) ? next.color : [1, 1, 1],
      intensity: Number.isFinite(next.intensity) ? next.intensity : 2,
      // photogrammetry tiles carry no normals, so Cesium's normal offset cannot
      // push the lookup off the surface: a larger depth bias stops the acne
      depthBias: Number.isFinite(next.depthBias) ? next.depthBias : null,
    };
    const sm = scene.shadowMap;
    if (!prior)
      prior = {
        light: scene.light,
        shadows: viewer.shadows,
        darkness: sm?.darkness,
        softShadows: sm?.softShadows,
        maximumDistance: sm?.maximumDistance,
        size: sm?.size,
        depthBias: shadowPrimitiveDepthBias(sm),
      };
    light = new Cesium.DirectionalLight({
      direction: new Cesium.Cartesian3(0, 0, -1),
      color: new Cesium.Color(spec.color[0], spec.color[1], spec.color[2], 1),
      intensity: spec.intensity,
    });
    update();
    scene.light = light;
    viewer.shadows = spec.shadows;
    if (sm && spec.shadows) {
      sm.darkness = spec.darkness;
      sm.softShadows = spec.softShadows;
      sm.maximumDistance = spec.maxDistance;
      if (sm.size !== spec.size) sm.size = spec.size;
      if (spec.depthBias !== null) setShadowPrimitiveDepthBias(sm, spec.depthBias);
    }
    state.active = true;
    scene.requestRender?.();
  }

  /** Recompute the direction for the current camera and time (each frame). */
  function update() {
    if (!spec || !light) return;
    const t = fixedTime ?? viewer.clock?.currentTime ?? Cesium.JulianDate.now();
    sunDirectionWC(Cesium, t, toSun);
    scene.globe.ellipsoid.geodeticSurfaceNormal(scene.camera.positionWC, up);
    const r = clampElevation(toSun, up, spec.minEl, spec.maxEl);
    state.el0 = r.el0;
    state.el = r.el;
    light.direction.x = -r.x;
    light.direction.y = -r.y;
    light.direction.z = -r.z;
  }

  return {
    set,
    update,
    /** Fix the sun's time (ISO string, ms or JulianDate); null = the scene clock. */
    setTime(time) {
      if (time === null || time === undefined) fixedTime = null;
      else if (time instanceof Cesium.JulianDate) fixedTime = time.clone();
      else if (typeof time === 'number')
        fixedTime = Cesium.JulianDate.fromDate(new Date(time));
      else fixedTime = Cesium.JulianDate.fromIso8601(String(time));
      update();
      scene.requestRender?.();
    },
    get state() {
      return { ...state, spec: spec ? { ...spec } : null };
    },
    dispose() {
      spec = null;
      restore();
    },
  };
}
