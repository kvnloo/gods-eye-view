/**
 * Screen positions for situation pins, through the renderer's own ports:
 * the query port projects a surface point and says when the globe hides it,
 * and the frame port reports each rendered frame.
 */

import { fromDegrees } from '../geo/ellipsoid.js';
import { canvasOf, findFrame, findQuery } from '../render/rendererOf.js';

/** `{ project(lat, lon), onFrame(cb), requestRender(reason) }` for a viewer. */
export function createGlobeProjector(viewer) {
  const canvas = () => canvasOf(viewer);
  return {
    project(lat, lon) {
      const query = findQuery(viewer);
      if (!query) return null;
      const world = fromDegrees(lon, lat, 0);
      if (query.isOccluded(world)) return null;
      const xy = query.project(world);
      if (!xy || !Number.isFinite(xy.x) || !Number.isFinite(xy.y)) return null;
      const element = canvas();
      const width = element?.clientWidth || globalThis.innerWidth || 1920;
      const height = element?.clientHeight || globalThis.innerHeight || 1080;
      if (xy.x < 0 || xy.y < 0 || xy.x > width || xy.y > height) return null;
      return xy;
    },
    onFrame(callback) {
      return findFrame(viewer)?.on('postRender', callback) ?? (() => {});
    },
    requestRender(reason) {
      findFrame(viewer)?.requestRender(reason);
    },
  };
}
