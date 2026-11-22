/**
 * @module render/cesium/photorealCut
 * @description The globe port's `cutPhotoreal` (`contract/globe.d.ts`): a
 * polygon cut out of each shown 3D tileset as a `ClippingPolygon`, joining
 * any clipping the tileset already has. While at least one cut stands on a
 * tileset, it draws its back faces (the photoreal mesh is a hollow shell: a
 * cut through a neighbour shows its inside, not the sky) and takes shadows
 * without casting any (its light is baked in); the last cut's release puts
 * back what the first one found.
 */
import * as Cesium from 'cesium';

/**
 * @param {object} scene A Cesium scene.
 * @param {{tilesets: () => object[], requestRender: (reason: string) => void}} options
 *   `tilesets`: the 3D tilesets among the scene's primitives, shown or not.
 * @returns {(ring: Array<{lon: number, lat: number}>) => (() => void)|null}
 */
export function createCesiumPhotorealCut(scene, { tilesets, requestRender }) {
  /** Per cut tileset: how many cuts stand and what the first one found. */
  const held = new WeakMap();

  return function cutPhotoreal(ring) {
    if (scene.isDestroyed?.()) return null;
    const points = (ring ?? []).filter(
      (p) => Number.isFinite(p?.lon) && Number.isFinite(p?.lat),
    );
    if (points.length < 3) return null;
    if (!Cesium.ClippingPolygonCollection.isSupported(scene)) return null;
    const shown = tilesets().filter(
      (tileset) => tileset.show && !tileset.isDestroyed?.(),
    );
    if (!shown.length) return null;
    const positions = Cesium.Cartesian3.fromDegreesArray(
      points.flatMap(({ lon, lat }) => [lon, lat]),
    );
    const cuts = shown.map((tileset) => {
      let entry = held.get(tileset);
      if (!entry) {
        entry = {
          count: 0,
          created: !tileset.clippingPolygons,
          shadows: tileset.shadows,
          backFaceCulling: tileset.backFaceCulling,
        };
        held.set(tileset, entry);
        if (entry.created)
          tileset.clippingPolygons = new Cesium.ClippingPolygonCollection();
        tileset.shadows = Cesium.ShadowMode.RECEIVE_ONLY;
        tileset.backFaceCulling = false;
      }
      entry.count += 1;
      const polygon = tileset.clippingPolygons.add(
        new Cesium.ClippingPolygon({ positions }),
      );
      return { tileset, polygon, entry };
    });
    requestRender('photoreal-cut');
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const { tileset, polygon, entry } of cuts) {
        if (tileset.isDestroyed?.()) continue;
        tileset.clippingPolygons?.remove(polygon);
        entry.count -= 1;
        if (entry.count > 0) continue;
        held.delete(tileset);
        if (entry.created && tileset.clippingPolygons?.length === 0)
          tileset.clippingPolygons = undefined;
        tileset.shadows = entry.shadows;
        tileset.backFaceCulling = entry.backFaceCulling;
      }
      if (!scene.isDestroyed?.()) requestRender('photoreal-cut');
    };
  };
}
