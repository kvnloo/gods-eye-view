import * as Cesium from 'cesium';
import { snapPlot } from './cityPlot.js';

function groundPoint(scene, camera, position) {
  let world = null;
  try {
    if (scene.pickPositionSupported) world = scene.pickPosition(position);
  } catch {
    world = null;
  }
  let carto = world && Cesium.Cartographic.fromCartesian(world);
  if (
    !carto ||
    !Number.isFinite(carto.height) ||
    Math.abs(carto.height) > 9000
  ) {
    world = camera.pickEllipsoid(position, Cesium.Ellipsoid.WGS84);
    carto = world && Cesium.Cartographic.fromCartesian(world);
  }
  if (!carto) return null;
  return {
    lat: Cesium.Math.toDegrees(carto.latitude),
    lon: Cesium.Math.toDegrees(carto.longitude),
    height: carto.height,
  };
}

function conceptPlot(scene, position, owns) {
  let hit = null;
  try {
    hit = scene.pick(position);
  } catch {
    return null;
  }
  const entity = hit?.id;
  if (!entity || !owns(entity)) return null;
  // Only a standing concept names its plot; tints and footprints fall through
  // to the ground pick, which snaps to the plot under the cursor.
  return entity._cityPlot ?? null;
}

/**
 * The plot a City builder click names: a standing concept's own plot (no
 * height), else the grid cell under the cursor with the ground height there.
 * `owns(entity)` says whether a picked entity is play mode's own. Null when
 * the click meets no plot.
 */
export function resolveClickedPlot({ scene, camera, position, owns }) {
  const named = conceptPlot(scene, position, owns);
  if (named) return { plot: named, height: undefined };
  const point = groundPoint(scene, camera, position);
  const plot = point && snapPlot(point);
  return plot ? { plot, height: point.height } : null;
}
