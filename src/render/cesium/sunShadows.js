/**
 * @module render/cesium/sunShadows
 * @description The effects port's `sunShadows` (`contract/effects.d.ts`)
 * over the scene's one shadow map: while the application shows something
 * that casts (a proposed building), the sun's shadow map draws, the globe
 * takes the shadows, and their edges, darkness and reach are the
 * application's. The settings the scene had before the first call come back
 * on `null` and on disposal, so a shadow map the renderer's own quality
 * settings turned on stays on.
 *
 * A call that changes nothing asks for no frame: it is sent every frame
 * while the sun or the eye moves.
 */
import * as Cesium from 'cesium';

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

/**
 * @param {object} scene A Cesium scene.
 * @param {{requestRender: (reason: string) => void}} options
 * @returns {{set: (settings: import('../contract/effects').SunShadows|null) => boolean,
 *   draws: () => boolean, dispose: () => void}} `set` says whether it
 *   changed anything.
 */
export function createCesiumSunShadows(scene, { requestRender }) {
  /** The scene's own settings, kept from the first call until given back. */
  let taken = null;

  /** Write `value` to `target[key]` when it differs; whether it did. */
  function write(target, key, value) {
    if (!target || target[key] === value) return false;
    target[key] = value;
    return true;
  }

  function giveBack() {
    if (!taken) return false;
    const was = taken;
    taken = null;
    if (scene.isDestroyed?.()) return false;
    const map = scene.shadowMap;
    let changed = false;
    if (map) {
      changed = write(map, 'enabled', was.enabled) || changed;
      changed = write(map, 'softShadows', was.softShadows) || changed;
      changed = write(map, 'darkness', was.darkness) || changed;
      changed = write(map, 'maximumDistance', was.maximumDistance) || changed;
    }
    if (scene.globe)
      changed = write(scene.globe, 'shadows', was.globe) || changed;
    return changed;
  }

  return {
    set(settings) {
      if (scene.isDestroyed?.()) return false;
      const map = scene.shadowMap;
      if (!settings) {
        const changed = giveBack();
        if (changed) requestRender('sun-shadows');
        return changed;
      }
      if (!map) return false;
      taken ??= {
        enabled: map.enabled,
        softShadows: map.softShadows,
        darkness: map.darkness,
        maximumDistance: map.maximumDistance,
        globe: scene.globe?.shadows,
      };
      // Never farther than the scene's own end of the shadow map.
      const reach = Number(settings.maxDistanceM);
      const maximumDistance = Number.isFinite(reach)
        ? Math.min(taken.maximumDistance ?? Infinity, reach)
        : taken.maximumDistance;
      let changed = write(
        map,
        'enabled',
        Boolean(taken.enabled) || Boolean(settings.cast),
      );
      changed =
        write(scene.globe, 'shadows', Cesium.ShadowMode.RECEIVE_ONLY) ||
        changed;
      changed =
        write(map, 'softShadows', Boolean(settings.softEdges)) || changed;
      changed = write(map, 'darkness', clamp01(settings.darkness)) || changed;
      changed = write(map, 'maximumDistance', maximumDistance) || changed;
      if (changed) requestRender('sun-shadows');
      return changed;
    },
    /** Whether the shadow map draws for a call that holds the settings. */
    draws: () => Boolean(taken && scene.shadowMap?.enabled),
    dispose() {
      giveBack();
    },
  };
}
